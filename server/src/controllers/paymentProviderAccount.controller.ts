import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  IPaymentProviderAccount,
  PaymentProviderAccount,
} from "../models/mongo/PaymentProviderAccount";
import { User } from "../models/mongo/User";
import {
  createPaymentProviderAccountSchema,
  saveSquareOAuthAppSchema,
  startSquareOAuthSchema,
  updatePaymentProviderAccountSchema,
} from "../schemas/paymentProviderAccount.schema";
import { encryptCredential } from "../utils/credentialsCrypto";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  resolveClientBaseUrl,
  resolvePublicApiBase,
} from "../utils/publicUrl";
import {
  buildSquareAuthorizeUrl,
  exchangeSquareAuthorizationCode,
  getSquareAppCredentials,
  isSquareOAuthConfigured,
  pickDefaultSquareLocation,
  revokeSquareToken,
  signSquareOAuthState,
  squareOAuthAppPublicPayload,
  squareOAuthCallbackUrl,
  upsertSquareOAuthAccount,
  upsertSquareOAuthAppCredentials,
  verifySquareOAuthState,
} from "../services/squareOAuth.service";
import { getPaymentPlatformsReady } from "../services/paymentPlatform.service";

function emptyToUndefined(value: string | undefined | null): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function isOrgAdmin(role?: string): boolean {
  return role === "admin" || role === "super-admin";
}

function ownerScopeFilter(ownerUserId: string | null) {
  if (ownerUserId) {
    return { ownerUserRef: new Types.ObjectId(ownerUserId) };
  }
  return {
    $or: [{ ownerUserRef: null }, { ownerUserRef: { $exists: false } }],
  };
}

function toPublic(
  doc: IPaymentProviderAccount | Record<string, unknown>,
  owner?: {
    _id: unknown;
    first_name?: string;
    last_name?: string;
    email?: string;
  } | null,
) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IPaymentProviderAccount).toObject()
      : (doc as Record<string, unknown>);

  const ownerUserRef = d.ownerUserRef ? String(d.ownerUserRef) : null;

  return {
    _id: d._id,
    provider: d.provider,
    friendlyName: d.friendlyName,
    environment: d.environment,
    isActive: d.isActive ?? true,
    isDefault: d.isDefault ?? false,
    ownerUserRef,
    owner: owner
      ? {
          _id: String(owner._id),
          first_name: owner.first_name || "",
          last_name: owner.last_name || "",
          email: owner.email || "",
        }
      : null,
    authMethod: d.authMethod || "manual",
    applicationId: d.applicationId ?? null,
    locationId: d.locationId ?? null,
    merchantId: d.merchantId ?? null,
    tokenExpiresAt: d.tokenExpiresAt ?? null,
    connectedAt: d.connectedAt ?? null,
    publishableKey: d.publishableKey ?? null,
    clientId: d.clientId ?? null,
    hasAccessToken: Boolean(d.accessTokenEncrypted),
    hasRefreshToken: Boolean(d.refreshTokenEncrypted),
    hasWebhookSignatureKey: Boolean(d.webhookSignatureKeyEncrypted),
    hasSecretKey: Boolean(d.secretKeyEncrypted),
    hasWebhookSecret: Boolean(d.webhookSecretEncrypted),
    hasClientSecret: Boolean(d.clientSecretEncrypted),
    hasWebhookId: Boolean(d.webhookIdEncrypted),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function clearOtherDefaults(
  ownerUserId: string | null,
  exceptId?: string,
): Promise<void> {
  const filter: Record<string, unknown> = {
    isDefault: true,
    ...ownerScopeFilter(ownerUserId),
  };
  if (exceptId) {
    filter._id = { $ne: exceptId };
  }
  await PaymentProviderAccount.updateMany(filter, {
    $set: { isDefault: false },
  });
}

function buildWebhookUrls(req?: AuthRequest) {
  const base = resolvePublicApiBase(req);
  return {
    square: `${base}/webhooks/payments/square`,
    stripe: `${base}/webhooks/payments/stripe`,
    paypal: `${base}/webhooks/payments/paypal`,
  };
}

async function squareOAuthStatusPayload(req?: AuthRequest) {
  return squareOAuthAppPublicPayload(req);
}

async function resolveOwnerUserIdForWrite(
  req: AuthRequest,
  requested: string | null | undefined,
): Promise<{ ownerUserId: string | null; error?: string }> {
  if (req.user?.role === "owner") {
    return { ownerUserId: req.user.id };
  }
  if (!isOrgAdmin(req.user?.role)) {
    return { ownerUserId: null, error: "Forbidden" };
  }
  if (requested === undefined) {
    return { ownerUserId: null };
  }
  if (requested === null || requested === "") {
    return { ownerUserId: null };
  }
  const owner = await User.findById(requested).select("role").lean();
  if (!owner || owner.role !== "owner") {
    return { ownerUserId: null, error: "ownerUserId must reference an owner user" };
  }
  return { ownerUserId: requested };
}

async function assertCanAccessAccount(
  req: AuthRequest,
  account: IPaymentProviderAccount,
): Promise<boolean> {
  if (isOrgAdmin(req.user?.role)) return true;
  if (req.user?.role === "owner") {
    return (
      Boolean(account.ownerUserRef) &&
      String(account.ownerUserRef) === req.user.id
    );
  }
  return false;
}

export async function getPaymentProviderWebhookInfo(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  res.json({
    webhooks: buildWebhookUrls(req),
    squareOAuth: await squareOAuthStatusPayload(req),
  });
}

export async function getPaymentProviderAccounts(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.user?.role === "owner") {
    filter.ownerUserRef = new Types.ObjectId(req.user.id);
  }

  const accounts = await PaymentProviderAccount.find(filter)
    .sort({ provider: 1, friendlyName: 1 })
    .lean();

  const ownerIds = [
    ...new Set(
      accounts
        .map((a) => (a.ownerUserRef ? String(a.ownerUserRef) : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const owners = ownerIds.length
    ? await User.find({ _id: { $in: ownerIds } })
        .select("first_name last_name email")
        .lean()
    : [];
  const ownerMap = new Map(owners.map((o) => [String(o._id), o]));

  res.json({
    accounts: accounts.map((a) =>
      toPublic(
        a,
        a.ownerUserRef ? ownerMap.get(String(a.ownerUserRef)) : null,
      ),
    ),
    webhooks: buildWebhookUrls(req),
    squareOAuth: await squareOAuthStatusPayload(req),
    platforms: await getPaymentPlatformsReady(),
  });
}

export async function createPaymentProviderAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = createPaymentProviderAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parsed.data;
  const ownerResolved = await resolveOwnerUserIdForWrite(
    req,
    data.ownerUserId === undefined ? undefined : data.ownerUserId,
  );
  if (ownerResolved.error) {
    res.status(400).json({ message: ownerResolved.error });
    return;
  }
  // Owners always assign to themselves; admins may omit for global.
  const ownerUserId =
    req.user?.role === "owner"
      ? req.user.id
      : data.ownerUserId === undefined
        ? null
        : ownerResolved.ownerUserId;

  const conflict = await PaymentProviderAccount.findOne({
    provider: data.provider,
    friendlyName: data.friendlyName,
  });
  if (conflict) {
    res.status(409).json({
      message: `A ${data.provider} account named "${data.friendlyName}" already exists`,
    });
    return;
  }

  const isDefault = data.isDefault ?? false;
  if (isDefault) {
    await clearOtherDefaults(ownerUserId);
  }

  const account = await PaymentProviderAccount.create({
    provider: data.provider,
    friendlyName: data.friendlyName,
    environment: data.environment,
    isActive: data.isActive ?? true,
    isDefault,
    ownerUserRef: ownerUserId ? new Types.ObjectId(ownerUserId) : null,
    authMethod: "manual",
    applicationId: emptyToUndefined(data.applicationId),
    locationId: emptyToUndefined(data.locationId),
    publishableKey: emptyToUndefined(data.publishableKey),
    clientId: emptyToUndefined(data.clientId),
    accessTokenEncrypted: emptyToUndefined(data.accessToken)
      ? encryptCredential(data.accessToken!)
      : undefined,
    webhookSignatureKeyEncrypted: emptyToUndefined(data.webhookSignatureKey)
      ? encryptCredential(data.webhookSignatureKey!)
      : undefined,
    secretKeyEncrypted: emptyToUndefined(data.secretKey)
      ? encryptCredential(data.secretKey!)
      : undefined,
    webhookSecretEncrypted: emptyToUndefined(data.webhookSecret)
      ? encryptCredential(data.webhookSecret!)
      : undefined,
    clientSecretEncrypted: emptyToUndefined(data.clientSecret)
      ? encryptCredential(data.clientSecret!)
      : undefined,
    webhookIdEncrypted: emptyToUndefined(data.webhookId)
      ? encryptCredential(data.webhookId!)
      : undefined,
  });

  logNotificationAsync({
    entityType: "payment_provider_account",
    action: "created",
    entityId: String(account._id),
    summary: `${data.provider} account ${data.friendlyName} created`,
    metadata: {
      provider: data.provider,
      friendlyName: data.friendlyName,
      ownerUserId,
    },
    ...actorFromRequest(req.user),
  });

  const owner = ownerUserId
    ? await User.findById(ownerUserId)
        .select("first_name last_name email")
        .lean()
    : null;

  res.status(201).json({ account: toPublic(account, owner) });
}

export async function updatePaymentProviderAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = updatePaymentProviderAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const account = await PaymentProviderAccount.findById(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Payment provider account not found" });
    return;
  }

  if (!(await assertCanAccessAccount(req, account))) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  const data = parsed.data;

  if (data.friendlyName !== undefined) {
    const conflict = await PaymentProviderAccount.findOne({
      provider: account.provider,
      friendlyName: data.friendlyName,
      _id: { $ne: account._id },
    });
    if (conflict) {
      res.status(409).json({
        message: `A ${account.provider} account named "${data.friendlyName}" already exists`,
      });
      return;
    }
    account.friendlyName = data.friendlyName;
  }

  if (data.environment !== undefined) {
    if (account.authMethod === "oauth") {
      res.status(400).json({
        message:
          "Cannot change environment on an OAuth-connected account. Reconnect via Square OAuth instead.",
      });
      return;
    }
    account.environment = data.environment;
  }
  if (data.isActive !== undefined) account.isActive = data.isActive;

  if (data.ownerUserId !== undefined) {
    if (req.user?.role === "owner") {
      // Owners cannot reassign away from themselves
      account.ownerUserRef = new Types.ObjectId(req.user.id);
    } else {
      const ownerResolved = await resolveOwnerUserIdForWrite(
        req,
        data.ownerUserId,
      );
      if (ownerResolved.error) {
        res.status(400).json({ message: ownerResolved.error });
        return;
      }
      account.ownerUserRef = ownerResolved.ownerUserId
        ? new Types.ObjectId(ownerResolved.ownerUserId)
        : null;
    }
  }

  const scopeOwnerId = account.ownerUserRef
    ? String(account.ownerUserRef)
    : null;

  if (data.isDefault === true) {
    await clearOtherDefaults(scopeOwnerId, String(account._id));
    account.isDefault = true;
  } else if (data.isDefault === false) {
    account.isDefault = false;
  }

  if (data.applicationId !== undefined) {
    if (account.authMethod === "oauth") {
      res.status(400).json({
        message: "Application ID is managed by Square OAuth and cannot be edited",
      });
      return;
    }
    account.applicationId = emptyToUndefined(data.applicationId);
  }
  if (data.locationId !== undefined) {
    account.locationId = emptyToUndefined(data.locationId);
  }
  if (data.publishableKey !== undefined) {
    account.publishableKey = emptyToUndefined(data.publishableKey);
  }
  if (data.clientId !== undefined) {
    account.clientId = emptyToUndefined(data.clientId);
  }

  const accessToken = emptyToUndefined(data.accessToken);
  if (accessToken) {
    if (account.authMethod === "oauth") {
      res.status(400).json({
        message:
          "Access token is managed by Square OAuth. Reconnect to refresh credentials.",
      });
      return;
    }
    account.accessTokenEncrypted = encryptCredential(accessToken);
  }
  const webhookSignatureKey = emptyToUndefined(data.webhookSignatureKey);
  if (webhookSignatureKey) {
    account.webhookSignatureKeyEncrypted =
      encryptCredential(webhookSignatureKey);
  }
  const secretKey = emptyToUndefined(data.secretKey);
  if (secretKey) {
    account.secretKeyEncrypted = encryptCredential(secretKey);
  }
  const webhookSecret = emptyToUndefined(data.webhookSecret);
  if (webhookSecret) {
    account.webhookSecretEncrypted = encryptCredential(webhookSecret);
  }
  const clientSecret = emptyToUndefined(data.clientSecret);
  if (clientSecret) {
    account.clientSecretEncrypted = encryptCredential(clientSecret);
  }
  const webhookId = emptyToUndefined(data.webhookId);
  if (webhookId) {
    account.webhookIdEncrypted = encryptCredential(webhookId);
  }

  await account.save();

  logNotificationAsync({
    entityType: "payment_provider_account",
    action: "updated",
    entityId: String(account._id),
    summary: `${account.provider} account ${account.friendlyName} updated`,
    metadata: {
      provider: account.provider,
      friendlyName: account.friendlyName,
      ownerUserId: account.ownerUserRef ? String(account.ownerUserRef) : null,
    },
    ...actorFromRequest(req.user),
  });

  const owner = account.ownerUserRef
    ? await User.findById(account.ownerUserRef)
        .select("first_name last_name email")
        .lean()
    : null;

  res.json({ account: toPublic(account, owner) });
}

export async function deletePaymentProviderAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const account = await PaymentProviderAccount.findById(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Payment provider account not found" });
    return;
  }

  if (!(await assertCanAccessAccount(req, account))) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  if (account.provider === "square" && account.authMethod === "oauth") {
    await revokeSquareToken(account);
  }

  await account.deleteOne();

  logNotificationAsync({
    entityType: "payment_provider_account",
    action: "deleted",
    entityId: String(account._id),
    summary: `${account.provider} account ${account.friendlyName} deleted`,
    metadata: {
      provider: account.provider,
      friendlyName: account.friendlyName,
    },
    ...actorFromRequest(req.user),
  });

  res.json({ message: "Payment provider account deleted" });
}

export async function startSquareOAuth(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const parsed = startSquareOAuthSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      message: "Validation failed",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { environment, friendlyName } = parsed.data;
  const oauthStatus = await isSquareOAuthConfigured(environment);
  if (!oauthStatus.forEnvironment) {
    res.status(503).json({
      message: `Square OAuth is not configured for ${environment}. Add the Square Application ID and secret in Admin Panel → Payment platforms, or set SQUARE_${environment === "sandbox" ? "SANDBOX_" : ""}APPLICATION_ID and the matching secret on the API server.`,
    });
    return;
  }

  let ownerUserId: string | null = null;
  if (req.user?.role === "owner") {
    ownerUserId = req.user.id;
  } else if (isOrgAdmin(req.user?.role)) {
    const resolved = await resolveOwnerUserIdForWrite(
      req,
      parsed.data.ownerUserId === undefined ? null : parsed.data.ownerUserId,
    );
    if (resolved.error) {
      res.status(400).json({ message: resolved.error });
      return;
    }
    ownerUserId = resolved.ownerUserId;
  } else {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  const redirectUri = squareOAuthCallbackUrl(req);
  if (
    process.env.NODE_ENV === "production" &&
    /localhost|127\.0\.0\.1/i.test(redirectUri)
  ) {
    res.status(503).json({
      message:
        "PUBLIC_API_URL must be set to your deployed API origin before Square OAuth can run in production (callback cannot use localhost).",
    });
    return;
  }

  const state = signSquareOAuthState({
    environment,
    ownerUserId,
    initiatedBy: req.user!.id,
    friendlyName,
    redirectUri,
  });

  const authorizeUrl = await buildSquareAuthorizeUrl({
    environment,
    state,
    redirectUri,
  });
  res.json({ authorizeUrl, callbackUrl: redirectUri });
}

export async function saveSquareOAuthApp(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  if (req.user?.role !== "super-admin") {
    res.status(403).json({
      message: "Only a super-admin can configure Square OAuth app credentials",
    });
    return;
  }

  const parsed = saveSquareOAuthAppSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const firstDetail = Object.values(fieldErrors)
      .flat()
      .find((msg): msg is string => Boolean(msg));
    res.status(400).json({
      message: firstDetail || "Validation failed",
      errors: fieldErrors,
    });
    return;
  }

  await upsertSquareOAuthAppCredentials(parsed.data);

  logNotificationAsync({
    entityType: "payment_provider_account",
    action: "updated",
    entityId: "square-oauth",
    summary: "Square OAuth application credentials updated",
    metadata: { authMethod: "oauth", scope: "platform-app" },
    ...actorFromRequest(req.user),
  });

  res.json({ squareOAuth: await squareOAuthStatusPayload(req) });
}

/**
 * Public Square redirect target. Validates signed state, stores tokens, redirects to Control Panel.
 */
export async function squareOAuthCallback(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const clientBase = resolveClientBaseUrl();
  const redirect = (status: "success" | "error", message?: string) => {
    const params = new URLSearchParams({
      tab: "payments",
      square_oauth: status,
    });
    if (message) params.set("message", message);
    const path = `/dashboard/control-panel?${params.toString()}`;
    if (!clientBase) {
      res
        .status(status === "success" ? 200 : 400)
        .type("html")
        .send(
          `<p>Square OAuth ${status}.${message ? ` ${message}` : ""}</p><p>Set CLIENT_URL on the API server, then return to Control Panel.</p>`,
        );
      return;
    }
    res.redirect(`${clientBase}${path}`);
  };

  try {
    const error = typeof req.query.error === "string" ? req.query.error : null;
    if (error) {
      const desc =
        typeof req.query.error_description === "string"
          ? req.query.error_description
          : error;
      redirect("error", desc);
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
      redirect("error", "Missing authorization code from Square");
      return;
    }

    const payload = verifySquareOAuthState(state);
    const redirectUri =
      payload.redirectUri || squareOAuthCallbackUrl(req);
    const tokens = await exchangeSquareAuthorizationCode({
      environment: payload.environment,
      code,
      redirectUri,
    });
    const { applicationId } = await getSquareAppCredentials(
      payload.environment,
    );
    const location = await pickDefaultSquareLocation({
      accessToken: tokens.accessToken,
      environment: payload.environment,
    });
    if (!location) {
      redirect(
        "error",
        "Square account has no locations. Create a location in Square then reconnect.",
      );
      return;
    }

    const account = await upsertSquareOAuthAccount({
      environment: payload.environment,
      ownerUserId: payload.ownerUserId,
      initiatedBy: payload.initiatedBy,
      friendlyName: payload.friendlyName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      merchantId: tokens.merchantId,
      locationId: location.id,
      applicationId,
    });

    logNotificationAsync({
      entityType: "payment_provider_account",
      action: "created",
      entityId: String(account._id),
      summary: `Square OAuth connected (${account.friendlyName})`,
      metadata: {
        provider: "square",
        authMethod: "oauth",
        ownerUserId: payload.ownerUserId,
        merchantId: tokens.merchantId,
      },
      ...actorFromRequest({ id: payload.initiatedBy }),
    });

    redirect("success", `Connected ${account.friendlyName}`);
  } catch (err) {
    console.error("[square-oauth] callback failed", err);
    redirect(
      "error",
      err instanceof Error ? err.message : "Square OAuth failed",
    );
  }
}
