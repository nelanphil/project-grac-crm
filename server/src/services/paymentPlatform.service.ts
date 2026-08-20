import { PaymentPlatformApp } from "../models/mongo/PaymentPlatformApp";
import { isSquareOAuthConfigured } from "./squareOAuth.service";

export type PlatformReadyStatus = {
  sandbox: boolean;
  production: boolean;
  configured: boolean;
};

export type PaymentPlatformsReady = {
  square: PlatformReadyStatus;
  stripe: PlatformReadyStatus;
  paypal: PlatformReadyStatus;
};

export async function getStripePlatformStatus(): Promise<PlatformReadyStatus> {
  const doc = await PaymentPlatformApp.findOne({ provider: "stripe" }).lean();
  const sandbox = Boolean(
    doc?.sandboxPublishableKey?.trim() && doc?.sandboxSecretKeyEncrypted,
  );
  const production = Boolean(
    doc?.productionPublishableKey?.trim() && doc?.productionSecretKeyEncrypted,
  );
  return { sandbox, production, configured: sandbox || production };
}

export async function getPayPalPlatformStatus(): Promise<PlatformReadyStatus> {
  const doc = await PaymentPlatformApp.findOne({ provider: "paypal" }).lean();
  const sandbox = Boolean(
    doc?.sandboxClientId?.trim() && doc?.sandboxClientSecretEncrypted,
  );
  const production = Boolean(
    doc?.productionClientId?.trim() && doc?.productionClientSecretEncrypted,
  );
  return { sandbox, production, configured: sandbox || production };
}

export async function getPaymentPlatformsReady(): Promise<PaymentPlatformsReady> {
  const square = await isSquareOAuthConfigured();
  const [stripe, paypal] = await Promise.all([
    getStripePlatformStatus(),
    getPayPalPlatformStatus(),
  ]);
  return {
    square: {
      sandbox: square.sandbox,
      production: square.production,
      configured: square.sandbox || square.production,
    },
    stripe,
    paypal,
  };
}
