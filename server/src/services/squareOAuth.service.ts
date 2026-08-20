import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { Request } from "express";
import { SquareClient, SquareEnvironment } from "square";
import { Types } from "mongoose";
import { env } from "../config/env";
import {
  IPaymentProviderAccount,
  PaymentEnvironment,
  PaymentProviderAccount,
} from "../models/mongo/PaymentProviderAccount";
import {
  SQUARE_OAUTH_APP_SLUG,
  SquareOAuthApp,
} from "../models/mongo/SquareOAuthApp";
import { User } from "../models/mongo/User";
import { encryptCredential, decryptCredential } from "../utils/credentialsCrypto";
import { resolvePublicApiBase } from "../utils/publicUrl";

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
  /** Exact redirect_uri used in Authorize; must match ObtainToken. */
  redirectUri: string;
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

type SquareAppCredentialPair = {
  applicationId: string;
  applicationSecret: string;
  source: "env" | "control-panel" | "none";
};

async function loadStoredSquareOAuthApp() {
  return SquareOAuthApp.findOne({ slug: SQUARE_OAUTH_APP_SLUG }).lean();
}

/** Square OAuth Application Secret (not an access token / Credentials secret). */
export function isSquareOAuthApplicationSecret(
  secret: string,
  environment: PaymentEnvironment,
): boolean {
  const value = secret.trim();
  if (!value || /^EAAA/i.test(value)) return false;
  return environment === "sandbox"
    ? /^sandbox-sq0csb-/i.test(value)
    : /^sq0csp-/i.test(value);
}

function pairIfValidOAuthSecret(
  applicationId: string,
  applicationSecret: string,
  environment: PaymentEnvironment,
  source: "env" | "control-panel",
): SquareAppCredentialPair | null {
  if (!applicationId?.trim() || !applicationSecret?.trim()) return null;
  if (!isSquareOAuthApplicationSecret(applicationSecret, environment)) {
    return null;
  }
  return {
    applicationId: applicationId.trim(),
    applicationSecret: applicationSecret.trim(),
    source,
  };
}

export async function getSquareAppCredentials(
  environment: PaymentEnvironment,
): Promise<SquareAppCredentialPair> {
  if (environment === "sandbox") {
    const fromEnv = pairIfValidOAuthSecret(
      env.square.sandboxApplicationId,
      env.square.sandboxApplicationSecret,
      "sandbox",
      "env",
    );
    if (fromEnv) return fromEnv;
    const stored = await loadStoredSquareOAuthApp();
    if (
      stored?.sandboxApplicationId &&
      stored.sandboxApplicationSecretEncrypted
    ) {
      const fromStore = pairIfValidOAuthSecret(
        stored.sandboxApplicationId,
        decryptCredential(stored.sandboxApplicationSecretEncrypted),
        "sandbox",
        "control-panel",
      );
      if (fromStore) return fromStore;
    }
    return { applicationId: "", applicationSecret: "", source: "none" };
  }

  const fromEnv = pairIfValidOAuthSecret(
    env.square.applicationId,
    env.square.applicationSecret,
    "production",
    "env",
  );
  if (fromEnv) return fromEnv;
  const stored = await loadStoredSquareOAuthApp();
  if (
    stored?.productionApplicationId &&
    stored.productionApplicationSecretEncrypted
  ) {
    const fromStore = pairIfValidOAuthSecret(
      stored.productionApplicationId,
      decryptCredential(stored.productionApplicationSecretEncrypted),
      "production",
      "control-panel",
    );
    if (fromStore) return fromStore;
  }
  return { applicationId: "", applicationSecret: "", source: "none" };
}

export async function isSquareOAuthConfigured(
  environment?: PaymentEnvironment,
): Promise<{
  sandbox: boolean;
  production: boolean;
  forEnvironment: boolean;
  sandboxSource: "env" | "control-panel" | "none";
  productionSource: "env" | "control-panel" | "none";
}> {
  const sandboxCreds = await getSquareAppCredentials("sandbox");
  const productionCreds = await getSquareAppCredentials("production");
  const sandbox = Boolean(
    sandboxCreds.applicationId && sandboxCreds.applicationSecret,
  );
  const production = Boolean(
    productionCreds.applicationId && productionCreds.applicationSecret,
  );
  const forEnvironment =
    environment === "production"
      ? production
      : environment === "sandbox"
        ? sandbox
        : sandbox || production;
  return {
    sandbox,
    production,
    forEnvironment,
    sandboxSource: sandboxCreds.source,
    productionSource: productionCreds.source,
  };
}

export function squareOAuthCallbackUrl(req?: Request): string {
  const base = resolvePublicApiBase(req);
  return `${base}/payment-provider-accounts/square/oauth/callback`;
}

function emptyToUndefined(value: string | undefined | null): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

export async function upsertSquareOAuthAppCredentials(data: {
  productionApplicationId?: string;
  productionApplicationSecret?: string;
  sandboxApplicationId?: string;
  sandboxApplicationSecret?: string;
  clearProductionApplicationSecret?: boolean;
  clearSandboxApplicationSecret?: boolean;
}): Promise<void> {
  let doc = await SquareOAuthApp.findOne({ slug: SQUARE_OAUTH_APP_SLUG });
  if (!doc) {
    doc = new SquareOAuthApp({ slug: SQUARE_OAUTH_APP_SLUG });
  }

  if (data.productionApplicationId !== undefined) {
    doc.productionApplicationId =
      emptyToUndefined(data.productionApplicationId) || undefined;
  }
  if (data.sandboxApplicationId !== undefined) {
    doc.sandboxApplicationId =
      emptyToUndefined(data.sandboxApplicationId) || undefined;
  }

  const prodSecret = emptyToUndefined(data.productionApplicationSecret);
  if (prodSecret) {
    doc.productionApplicationSecretEncrypted = encryptCredential(prodSecret);
  } else if (data.clearProductionApplicationSecret) {
    doc.productionApplicationSecretEncrypted = undefined;
  }

  const sandboxSecret = emptyToUndefined(data.sandboxApplicationSecret);
  if (sandboxSecret) {
    doc.sandboxApplicationSecretEncrypted = encryptCredential(sandboxSecret);
  } else if (data.clearSandboxApplicationSecret) {
    doc.sandboxApplicationSecretEncrypted = undefined;
  }

  await doc.save();
}

export async function squareOAuthAppPublicPayload(req?: Request) {
  const status = await isSquareOAuthConfigured();
  const stored = await SquareOAuthApp.findOne({
    slug: SQUARE_OAUTH_APP_SLUG,
  }).lean();
  return {
    ...status,
    callbackUrl: squareOAuthCallbackUrl(req),
    app: {
      productionApplicationId: stored?.productionApplicationId ?? "",
      sandboxApplicationId: stored?.sandboxApplicationId ?? "",
      hasProductionApplicationSecret: status.production,
      hasSandboxApplicationSecret: status.sandbox,
      envConfigured: {
        production: status.productionSource === "env",
        sandbox: status.sandboxSource === "env",
      },
    },
  };
}

export async function buildSquareAuthorizeUrl(params: {
  environment: PaymentEnvironment;
  state: string;
  redirectUri: string;
}): Promise<string> {
  const { applicationId } = await getSquareAppCredentials(params.environment);
  if (!applicationId) {
    throw new Error(
      `Square OAuth is not configured for ${params.environment}. Add Application ID + secret in Admin Panel → Payment platforms, or set SQUARE_${params.environment === "sandbox" ? "SANDBOX_" : ""}APPLICATION_ID and matching secret.`,
    );
  }
  const { authorizeBase } = squareHosts(params.environment);
  return (
    `${authorizeBase}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(applicationId)}` +
    `&scope=${SQUARE_OAUTH_SCOPES}` +
    `&session=false` +
    `&state=${encodeURIComponent(params.state)}` +
    `&redirect_uri=${encodeURIComponent(params.redirectUri)}`
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
    redirectUri: payload.redirectUri,
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
    const notAuthorized =
      /not\s*authorized/i.test(detail) || res.status === 401;
    if (notAuthorized) {
      throw new Error(
        "Square token exchange failed: Not Authorized. Use the Production Application Secret from Square Developer Dashboard → your app → OAuth (not Credentials, and not an access token), then save it under Admin Panel → Payment platforms and try Sign in with Square again.",
      );
    }
    throw new Error(`Square token exchange failed: ${detail}`);
  }
  return json;
}

export async function exchangeSquareAuthorizationCode(params: {
  environment: PaymentEnvironment;
  code: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  merchantId: string;
}> {
  const { applicationId, applicationSecret } = await getSquareAppCredentials(
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
    redirect_uri: params.redirectUri,
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
  const { applicationId, applicationSecret } = await getSquareAppCredentials(
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
  const { applicationId, applicationSecret } = await getSquareAppCredentials(
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
