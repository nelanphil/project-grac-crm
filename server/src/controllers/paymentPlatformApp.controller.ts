import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { PaymentPlatformApp } from "../models/mongo/PaymentPlatformApp";
import {
  paymentPlatformProviderParamSchema,
  savePayPalPlatformAppSchema,
  saveStripePlatformAppSchema,
} from "../schemas/paymentPlatformApp.schema";
import { saveSquareOAuthAppSchema } from "../schemas/paymentProviderAccount.schema";
import { encryptCredential } from "../utils/credentialsCrypto";
import {
  actorFromRequest,
  logNotificationAsync,
} from "../services/notification.service";
import {
  squareOAuthAppPublicPayload,
  upsertSquareOAuthAppCredentials,
} from "../services/squareOAuth.service";
import {
  getPayPalPlatformStatus,
  getStripePlatformStatus,
} from "../services/paymentPlatform.service";

function emptyToUndefined(value: string | undefined | null): string | undefined {
  if (value == null || value.trim() === "") return undefined;
  return value.trim();
}

function validationFailed(
  res: Response,
  fieldErrors: Record<string, string[] | undefined>,
): void {
  const firstDetail = Object.values(fieldErrors)
    .flat()
    .find((msg): msg is string => Boolean(msg));
  res.status(400).json({
    message: firstDetail || "Validation failed",
    errors: fieldErrors,
  });
}

async function stripePublicPayload() {
  const doc = await PaymentPlatformApp.findOne({ provider: "stripe" }).lean();
  const status = await getStripePlatformStatus();
  return {
    ...status,
    productionPublishableKey: doc?.productionPublishableKey ?? "",
    sandboxPublishableKey: doc?.sandboxPublishableKey ?? "",
    productionClientId: doc?.productionClientId ?? "",
    sandboxClientId: doc?.sandboxClientId ?? "",
    hasProductionSecretKey: Boolean(doc?.productionSecretKeyEncrypted),
    hasSandboxSecretKey: Boolean(doc?.sandboxSecretKeyEncrypted),
  };
}

async function paypalPublicPayload() {
  const doc = await PaymentPlatformApp.findOne({ provider: "paypal" }).lean();
  const status = await getPayPalPlatformStatus();
  return {
    ...status,
    productionClientId: doc?.productionClientId ?? "",
    sandboxClientId: doc?.sandboxClientId ?? "",
    hasProductionClientSecret: Boolean(doc?.productionClientSecretEncrypted),
    hasSandboxClientSecret: Boolean(doc?.sandboxClientSecretEncrypted),
  };
}

export async function getPaymentPlatformApps(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const [square, stripe, paypal] = await Promise.all([
    squareOAuthAppPublicPayload(req),
    stripePublicPayload(),
    paypalPublicPayload(),
  ]);
  res.json({ square, stripe, paypal });
}

export async function savePaymentPlatformApp(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const providerParsed = paymentPlatformProviderParamSchema.safeParse(
    req.params.provider,
  );
  if (!providerParsed.success) {
    res.status(400).json({ message: "Unknown payment platform" });
    return;
  }

  const provider = providerParsed.data;

  if (provider === "square") {
    const parsed = saveSquareOAuthAppSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      validationFailed(res, parsed.error.flatten().fieldErrors);
      return;
    }
    await upsertSquareOAuthAppCredentials(parsed.data);
    logNotificationAsync({
      entityType: "payment_provider_account",
      action: "updated",
      entityId: "square-oauth",
      summary: "Square OAuth application credentials updated",
      metadata: { authMethod: "oauth", scope: "platform-app", provider },
      ...actorFromRequest(req.user),
    });
    const [square, stripe, paypal] = await Promise.all([
      squareOAuthAppPublicPayload(req),
      stripePublicPayload(),
      paypalPublicPayload(),
    ]);
    res.json({ square, stripe, paypal });
    return;
  }

  if (provider === "stripe") {
    const parsed = saveStripePlatformAppSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      validationFailed(res, parsed.error.flatten().fieldErrors);
      return;
    }
    const data = parsed.data;
    let doc = await PaymentPlatformApp.findOne({ provider: "stripe" });
    if (!doc) {
      doc = new PaymentPlatformApp({ provider: "stripe" });
    }

    if (data.productionPublishableKey !== undefined) {
      doc.productionPublishableKey =
        emptyToUndefined(data.productionPublishableKey) || undefined;
    }
    if (data.sandboxPublishableKey !== undefined) {
      doc.sandboxPublishableKey =
        emptyToUndefined(data.sandboxPublishableKey) || undefined;
    }
    if (data.productionClientId !== undefined) {
      doc.productionClientId =
        emptyToUndefined(data.productionClientId) || undefined;
    }
    if (data.sandboxClientId !== undefined) {
      doc.sandboxClientId = emptyToUndefined(data.sandboxClientId) || undefined;
    }

    const prodSecret = emptyToUndefined(data.productionSecretKey);
    if (prodSecret) {
      doc.productionSecretKeyEncrypted = encryptCredential(prodSecret);
    } else if (data.clearProductionSecretKey) {
      doc.productionSecretKeyEncrypted = undefined;
    }

    const sandboxSecret = emptyToUndefined(data.sandboxSecretKey);
    if (sandboxSecret) {
      doc.sandboxSecretKeyEncrypted = encryptCredential(sandboxSecret);
    } else if (data.clearSandboxSecretKey) {
      doc.sandboxSecretKeyEncrypted = undefined;
    }

    await doc.save();
    logNotificationAsync({
      entityType: "payment_provider_account",
      action: "updated",
      entityId: String(doc._id),
      summary: "Stripe platform credentials updated",
      metadata: { scope: "platform-app", provider },
      ...actorFromRequest(req.user),
    });
    const [square, stripe, paypal] = await Promise.all([
      squareOAuthAppPublicPayload(req),
      stripePublicPayload(),
      paypalPublicPayload(),
    ]);
    res.json({ square, stripe, paypal });
    return;
  }

  const parsed = savePayPalPlatformAppSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationFailed(res, parsed.error.flatten().fieldErrors);
    return;
  }
  const data = parsed.data;
  let doc = await PaymentPlatformApp.findOne({ provider: "paypal" });
  if (!doc) {
    doc = new PaymentPlatformApp({ provider: "paypal" });
  }

  if (data.productionClientId !== undefined) {
    doc.productionClientId =
      emptyToUndefined(data.productionClientId) || undefined;
  }
  if (data.sandboxClientId !== undefined) {
    doc.sandboxClientId = emptyToUndefined(data.sandboxClientId) || undefined;
  }

  const prodSecret = emptyToUndefined(data.productionClientSecret);
  if (prodSecret) {
    doc.productionClientSecretEncrypted = encryptCredential(prodSecret);
  } else if (data.clearProductionClientSecret) {
    doc.productionClientSecretEncrypted = undefined;
  }

  const sandboxSecret = emptyToUndefined(data.sandboxClientSecret);
  if (sandboxSecret) {
    doc.sandboxClientSecretEncrypted = encryptCredential(sandboxSecret);
  } else if (data.clearSandboxClientSecret) {
    doc.sandboxClientSecretEncrypted = undefined;
  }

  await doc.save();
  logNotificationAsync({
    entityType: "payment_provider_account",
    action: "updated",
    entityId: String(doc._id),
    summary: "PayPal platform credentials updated",
    metadata: { scope: "platform-app", provider },
    ...actorFromRequest(req.user),
  });
  const [square, stripe, paypal] = await Promise.all([
    squareOAuthAppPublicPayload(req),
    stripePublicPayload(),
    paypalPublicPayload(),
  ]);
  res.json({ square, stripe, paypal });
}
