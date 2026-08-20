import mongoose, { Schema, Document } from "mongoose";

export const PAYMENT_PLATFORM_PROVIDERS = ["stripe", "paypal"] as const;
export type PaymentPlatformProvider = (typeof PAYMENT_PLATFORM_PROVIDERS)[number];

/**
 * Platform (product-level) Stripe/PayPal application credentials.
 * Distinct from per-owner PaymentProviderAccount seller tokens.
 * Square stays on SquareOAuthApp.
 */
export interface IPaymentPlatformApp extends Document {
  provider: PaymentPlatformProvider;
  // Stripe
  productionPublishableKey?: string;
  productionSecretKeyEncrypted?: string;
  productionClientId?: string;
  sandboxPublishableKey?: string;
  sandboxSecretKeyEncrypted?: string;
  sandboxClientId?: string;
  // PayPal
  productionClientSecretEncrypted?: string;
  sandboxClientSecretEncrypted?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentPlatformAppSchema = new Schema<IPaymentPlatformApp>(
  {
    provider: {
      type: String,
      required: true,
      unique: true,
      enum: PAYMENT_PLATFORM_PROVIDERS,
    },
    productionPublishableKey: { type: String, trim: true },
    productionSecretKeyEncrypted: { type: String },
    productionClientId: { type: String, trim: true },
    sandboxPublishableKey: { type: String, trim: true },
    sandboxSecretKeyEncrypted: { type: String },
    sandboxClientId: { type: String, trim: true },
    productionClientSecretEncrypted: { type: String },
    sandboxClientSecretEncrypted: { type: String },
  },
  { timestamps: true },
);

export const PaymentPlatformApp = mongoose.model<IPaymentPlatformApp>(
  "PaymentPlatformApp",
  paymentPlatformAppSchema,
);
