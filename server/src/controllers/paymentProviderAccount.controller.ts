import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  IPaymentProviderAccount,
  PaymentProviderAccount,
} from "../models/mongo/PaymentProviderAccount";
import {
  createPaymentProviderAccountSchema,
  updatePaymentProviderAccountSchema,
} from "../schemas/paymentProviderAccount.schema";
import { encryptCredential } from "../utils/credentialsCrypto";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import { env } from "../config/env";

function emptyToUndefined(value: string | undefined | null): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function toPublic(doc: IPaymentProviderAccount | Record<string, unknown>) {
  const d =
    "toObject" in doc && typeof doc.toObject === "function"
      ? (doc as IPaymentProviderAccount).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: d._id,
    provider: d.provider,
    friendlyName: d.friendlyName,
    environment: d.environment,
    isActive: d.isActive ?? true,
    isDefault: d.isDefault ?? false,
    applicationId: d.applicationId ?? null,
    locationId: d.locationId ?? null,
    publishableKey: d.publishableKey ?? null,
    clientId: d.clientId ?? null,
    hasAccessToken: Boolean(d.accessTokenEncrypted),
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
  provider: string,
  exceptId?: string,
): Promise<void> {
  const filter: Record<string, unknown> = { isDefault: true };
  if (exceptId) {
    filter._id = { $ne: exceptId };
  }
  // Only one global default checkout provider at a time
  await PaymentProviderAccount.updateMany(filter, {
    $set: { isDefault: false },
  });
  void provider;
}

function buildWebhookUrls() {
  const base =
    env.publicApiUrl.replace(/\/$/, "") || `http://localhost:${env.port}`;
  return {
    square: `${base}/webhooks/payments/square`,
    stripe: `${base}/webhooks/payments/stripe`,
    paypal: `${base}/webhooks/payments/paypal`,
  };
}

export async function getPaymentProviderWebhookInfo(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  res.json({ webhooks: buildWebhookUrls() });
}

export async function getPaymentProviderAccounts(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  const accounts = await PaymentProviderAccount.find()
    .sort({ provider: 1, friendlyName: 1 })
    .lean();
  res.json({ accounts: accounts.map(toPublic), webhooks: buildWebhookUrls() });
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
    await clearOtherDefaults(data.provider);
  }

  const account = await PaymentProviderAccount.create({
    provider: data.provider,
    friendlyName: data.friendlyName,
    environment: data.environment,
    isActive: data.isActive ?? true,
    isDefault,
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
    metadata: { provider: data.provider, friendlyName: data.friendlyName },
    ...actorFromRequest(req.user),
  });

  res.status(201).json({ account: toPublic(account) });
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

  if (data.environment !== undefined) account.environment = data.environment;
  if (data.isActive !== undefined) account.isActive = data.isActive;

  if (data.isDefault === true) {
    await clearOtherDefaults(account.provider, String(account._id));
    account.isDefault = true;
  } else if (data.isDefault === false) {
    account.isDefault = false;
  }

  if (data.applicationId !== undefined) {
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
    },
    ...actorFromRequest(req.user),
  });

  res.json({ account: toPublic(account) });
}

export async function deletePaymentProviderAccount(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const account = await PaymentProviderAccount.findByIdAndDelete(req.params.id);
  if (!account) {
    res.status(404).json({ message: "Payment provider account not found" });
    return;
  }

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
