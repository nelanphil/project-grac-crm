import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { SquareClient, SquareEnvironment } from "square";
import { Types } from "mongoose";
import { env } from "../config/env";
import {
  IPaymentProviderAccount,
  PaymentEnvironment,
  PaymentProviderAccount,
} from "../models/mongo/PaymentProviderAccount";
import { User } from "../models/mongo/User";
import { encryptCredential, decryptCredential } from "../utils/credentialsCrypto";

const SQUARE_OAUTH_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
].join("+");

const OAUTH_STATE_TTL_SECONDS = 10 * 60;
/** Refresh when fewer than this many ms remain before expiry. */
const REFRESH_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

export type SquareOAuthStatePayload = {
  purpose: "square_oauth";
  nonce: string;
  environment: PaymentEnvironment;
  ownerUserId: string | null;
  initiatedBy: string;
  friendlyName?: string;
};

function squareHosts(environment: PaymentEnvironment) {
  const sandbox = environment === "sandbox";
  return {
    authorizeBase: sandbox
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com",
    tokenUrl: sandbox
      ? "https://connect.squareupsandbox.com/oauth2/token"
      : "https://connect.squareup.com/oauth2/token",
    revokeUrl: sandbox
      ? "https://connect.squareupsandbox.com/oauth2/revoke"
      : "https://connect.squareup.com/oauth2/revoke",
  };
}

export function getSquareAppCredentials(environment: PaymentEnvironment): {
  applicationId: string;
  applicationSecret: string;
} {
  if (environment === "sandbox") {
    return {
      applicationId: env.square.sandboxApplicationId,
      applicationSecret: env.square.sandboxApplicationSecret,
    };
  }
  return {
    applicationId: env.square.applicationId,
    applicationSecret: env.square.applicationSecret,
  };
}

export function isSquareOAuthConfigured(environment?: PaymentEnvironment): {
  sandbox: boolean;
  production: boolean;
  forEnvironment: boolean;
} {
  const sandbox = Boolean(
    env.square.sandboxApplicationId && env.square.sandboxApplicationSecret,
  );
  const production = Boolean(
    env.square.applicationId && env.square.applicationSecret,
  );
  const forEnvironment =
    environment === "production"
      ? production
      : environment === "sandbox"
        ? sandbox
        : sandbox || production;
  return { sandbox, production, forEnvironment };
}

export function squareOAuthCallbackUrl(): string {
  const base = env.publicApiUrl.replace(/\/$/, "");
  return `${base}/payment-provider-accounts/square/oauth/callback`;
}

export function buildSquareAuthorizeUrl(params: {
  environment: PaymentEnvironment;
  state: string;
}): string {
  const { applicationId } = getSquareAppCredentials(params.environment);
  if (!applicationId) {
    throw new Error(
      `Square OAuth is not configured for ${params.environment}. Set SQUARE_${params.environment === "sandbox" ? "SANDBOX_" : ""}APPLICATION_ID and matching secret.`,
    );
  }
  const { authorizeBase } = squareHosts(params.environment);
  const redirectUri = encodeURIComponent(squareOAuthCallbackUrl());
  return (
    `${authorizeBase}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(applicationId)}` +
    `&scope=${SQUARE_OAUTH_SCOPES}` +
    `&session=false` +
    `&state=${encodeURIComponent(params.state)}` +
    `&redirect_uri=${redirectUri}`
  );
}

export function signSquareOAuthState(
  payload: Omit<SquareOAuthStatePayload, "purpose" | "nonce"> & {
    nonce?: string;
  },
): string {
  const body: SquareOAuthStatePayload = {
    purpose: "square_oauth",
    nonce: payload.nonce || randomBytes(16).toString("hex"),
    environment: payload.environment,
    ownerUserId: payload.ownerUserId,
    initiatedBy: payload.initiatedBy,
    ...(payload.friendlyName ? { friendlyName: payload.friendlyName } : {}),
  };
  return jwt.sign(body, env.jwt.secret, { expiresIn: OAUTH_STATE_TTL_SECONDS });
}

export function verifySquareOAuthState(state: string): SquareOAuthStatePayload {
  const decoded = jwt.verify(state, env.jwt.secret) as SquareOAuthStatePayload;
  if (decoded.purpose !== "square_oauth") {
    throw new Error("Invalid OAuth state");
  }
  return decoded;
}

type ObtainTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  merchant_id?: string;
  token_type?: string;
};

async function callSquareObtainToken(
  environment: PaymentEnvironment,
  body: Record<string, string>,
): Promise<ObtainTokenResponse> {
  const { tokenUrl } = squareHosts(environment);
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": "2025-01-23",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ObtainTokenResponse & {
    message?: string;
    errors?: Array<{ detail?: string }>;
  };
  if (!res.ok) {
    const detail =
      json.errors?.[0]?.detail || json.message || `HTTP ${res.status}`;
    throw new Error(`Square token exchange failed: ${detail}`);
  }
  return json;
}

export async function exchangeSquareAuthorizationCode(params: {
  environment: PaymentEnvironment;
  code: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  merchantId: string;
}> {
  const { applicationId, applicationSecret } = getSquareAppCredentials(
    params.environment,
  );
  if (!applicationId || !applicationSecret) {
    throw new Error("Square OAuth application credentials are not configured");
  }

  const json = await callSquareObtainToken(params.environment, {
    client_id: applicationId,
    client_secret: applicationSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: squareOAuthCallbackUrl(),
  });

  if (!json.access_token || !json.refresh_token || !json.merchant_id) {
    throw new Error("Square did not return access/refresh tokens");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_at ? new Date(json.expires_at) : null,
    merchantId: json.merchant_id,
  };
}

export async function refreshSquareAccessToken(
  account: IPaymentProviderAccount,
): Promise<IPaymentProviderAccount> {
  if (!account.refreshTokenEncrypted) {
    throw new Error("No Square refresh token available for this account");
  }
  const { applicationId, applicationSecret } = getSquareAppCredentials(
    account.environment,
  );
  if (!applicationId || !applicationSecret) {
    throw new Error("Square OAuth application credentials are not configured");
  }

  const refreshToken = decryptCredential(account.refreshTokenEncrypted);
  const json = await callSquareObtainToken(account.environment, {
    client_id: applicationId,
    client_secret: applicationSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  if (!json.access_token) {
    throw new Error("Square refresh did not return an access token");
  }

  account.accessTokenEncrypted = encryptCredential(json.access_token);
  if (json.refresh_token) {
    account.refreshTokenEncrypted = encryptCredential(json.refresh_token);
  }
  account.tokenExpiresAt = json.expires_at ? new Date(json.expires_at) : null;
  await account.save();
  return account;
}

/**
 * Ensure OAuth access tokens are fresh before Square API calls.
 * Manual tokens are returned unchanged.
 */
export async function ensureFreshSquareAccessToken(
  account: IPaymentProviderAccount,
): Promise<IPaymentProviderAccount> {
  if (account.authMethod !== "oauth" || !account.refreshTokenEncrypted) {
    return account;
  }
  const expiresAt = account.tokenExpiresAt
    ? account.tokenExpiresAt.getTime()
    : 0;
  const needsRefresh =
    !expiresAt || expiresAt - Date.now() < REFRESH_SKEW_MS;
  if (!needsRefresh) return account;
  return refreshSquareAccessToken(account);
}

export async function listSquareLocations(params: {
  accessToken: string;
  environment: PaymentEnvironment;
}): Promise<Array<{ id: string; name: string; status?: string }>> {
  const client = new SquareClient({
    token: params.accessToken,
    environment:
      params.environment === "production"
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox,
  });
  const response = await client.locations.list();
  const locations = response.locations ?? [];
  return locations
    .filter((loc) => loc.id)
    .map((loc) => ({
      id: loc.id!,
      name: loc.name || loc.id!,
      status: loc.status,
    }));
}

export async function pickDefaultSquareLocation(params: {
  accessToken: string;
  environment: PaymentEnvironment;
}): Promise<{ id: string; name: string } | null> {
  const locations = await listSquareLocations(params);
  const active = locations.find(
    (l) => !l.status || String(l.status).toUpperCase() === "ACTIVE",
  );
  return active || locations[0] || null;
}

function ownerScopeFilter(ownerUserId: string | null) {
  if (ownerUserId) {
    return { ownerUserRef: new Types.ObjectId(ownerUserId) };
  }
  return {
    $or: [{ ownerUserRef: null }, { ownerUserRef: { $exists: false } }],
  };
}

async function uniqueFriendlyName(
  base: string,
  exceptId?: string,
): Promise<string> {
  let candidate = base.slice(0, 120);
  let suffix = 2;
  for (;;) {
    const conflict = await PaymentProviderAccount.findOne({
      provider: "square",
      friendlyName: candidate,
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    }).lean();
    if (!conflict) return candidate;
    const trimmed = base.slice(0, 110);
    candidate = `${trimmed} (${suffix})`.slice(0, 120);
    suffix += 1;
  }
}

export async function upsertSquareOAuthAccount(params: {
  environment: PaymentEnvironment;
  ownerUserId: string | null;
  initiatedBy: string;
  friendlyName?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  merchantId: string;
  locationId: string;
  applicationId: string;
}): Promise<IPaymentProviderAccount> {
  const existing = await PaymentProviderAccount.findOne({
    provider: "square",
    authMethod: "oauth",
    environment: params.environment,
    ...ownerScopeFilter(params.ownerUserId),
  });

  let label = params.friendlyName?.trim();
  if (!label) {
    if (params.ownerUserId) {
      const owner = await User.findById(params.ownerUserId)
        .select("first_name last_name email")
        .lean();
      const name = owner
        ? `${owner.first_name || ""} ${owner.last_name || ""}`.trim() ||
          owner.email
        : "Owner";
      label = `Square OAuth — ${name}`;
    } else {
      label = "Square OAuth — Global";
    }
  }

  const friendlyName = await uniqueFriendlyName(
    label,
    existing ? String(existing._id) : undefined,
  );

  if (existing) {
    existing.friendlyName = friendlyName;
    existing.isActive = true;
    existing.applicationId = params.applicationId;
    existing.locationId = params.locationId;
    existing.merchantId = params.merchantId;
    existing.accessTokenEncrypted = encryptCredential(params.accessToken);
    existing.refreshTokenEncrypted = encryptCredential(params.refreshToken);
    existing.tokenExpiresAt = params.expiresAt;
    existing.connectedAt = new Date();
    existing.connectedByUserRef = new Types.ObjectId(params.initiatedBy);
    existing.ownerUserRef = params.ownerUserId
      ? new Types.ObjectId(params.ownerUserId)
      : null;
    await existing.save();
    return existing;
  }

  return PaymentProviderAccount.create({
    provider: "square",
    friendlyName,
    environment: params.environment,
    isActive: true,
    isDefault: false,
    ownerUserRef: params.ownerUserId
      ? new Types.ObjectId(params.ownerUserId)
      : null,
    authMethod: "oauth",
    applicationId: params.applicationId,
    locationId: params.locationId,
    merchantId: params.merchantId,
    accessTokenEncrypted: encryptCredential(params.accessToken),
    refreshTokenEncrypted: encryptCredential(params.refreshToken),
    tokenExpiresAt: params.expiresAt,
    connectedAt: new Date(),
    connectedByUserRef: new Types.ObjectId(params.initiatedBy),
  });
}

export async function revokeSquareToken(
  account: IPaymentProviderAccount,
): Promise<void> {
  if (account.authMethod !== "oauth" || !account.accessTokenEncrypted) return;
  const { applicationId, applicationSecret } = getSquareAppCredentials(
    account.environment,
  );
  if (!applicationId || !applicationSecret) return;

  const { revokeUrl } = squareHosts(account.environment);
  try {
    await fetch(revokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": "2025-01-23",
        Authorization: `Client ${applicationSecret}`,
      },
      body: JSON.stringify({
        client_id: applicationId,
        access_token: decryptCredential(account.accessTokenEncrypted),
        revoke_only_access_token: false,
      }),
    });
  } catch (err) {
    console.warn("[square-oauth] revoke failed", err);
  }
}

/** Refresh OAuth tokens that expire within the skew window. */
export async function refreshExpiringSquareOAuthTokens(): Promise<{
  checked: number;
  refreshed: number;
  failed: number;
}> {
  const cutoff = new Date(Date.now() + REFRESH_SKEW_MS);
  const accounts = await PaymentProviderAccount.find({
    provider: "square",
    authMethod: "oauth",
    isActive: true,
    refreshTokenEncrypted: { $exists: true, $ne: null },
    $or: [
      { tokenExpiresAt: null },
      { tokenExpiresAt: { $lte: cutoff } },
    ],
  });

  let refreshed = 0;
  let failed = 0;
  for (const account of accounts) {
    try {
      await refreshSquareAccessToken(account);
      refreshed += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[square-oauth] refresh failed for ${String(account._id)}`,
        err,
      );
    }
  }
  return { checked: accounts.length, refreshed, failed };
}
