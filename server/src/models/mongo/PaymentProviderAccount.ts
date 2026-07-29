import mongoose, { Schema, Document } from "mongoose";

export const PAYMENT_PROVIDERS = ["square", "stripe", "paypal"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_ENVIRONMENTS = ["sandbox", "production"] as const;
export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENTS)[number];

export interface IPaymentProviderAccount extends Document {
  provider: PaymentProviderName;
  friendlyName: string;
  environment: PaymentEnvironment;
  isActive: boolean;
  isDefault: boolean;
  // Square public
  applicationId?: string;
  locationId?: string;
  // Stripe public
  publishableKey?: string;
  // PayPal public
  clientId?: string;
  // Encrypted secrets
  accessTokenEncrypted?: string;
  webhookSignatureKeyEncrypted?: string;
  secretKeyEncrypted?: string;
  webhookSecretEncrypted?: string;
  clientSecretEncrypted?: string;
  webhookIdEncrypted?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentProviderAccountSchema = new Schema<IPaymentProviderAccount>(
  {
    provider: {
      type: String,
      enum: PAYMENT_PROVIDERS,
      required: true,
      index: true,
    },
    friendlyName: {
      type: String,
      required: true,
      trim: true,
    },
    environment: {
      type: String,
      enum: PAYMENT_ENVIRONMENTS,
      required: true,
      default: "sandbox",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    applicationId: { type: String, trim: true },
    locationId: { type: String, trim: true },
    publishableKey: { type: String, trim: true },
    clientId: { type: String, trim: true },
    accessTokenEncrypted: { type: String },
    webhookSignatureKeyEncrypted: { type: String },
    secretKeyEncrypted: { type: String },
    webhookSecretEncrypted: { type: String },
    clientSecretEncrypted: { type: String },
    webhookIdEncrypted: { type: String },
  },
  { timestamps: true },
);

paymentProviderAccountSchema.index(
  { provider: 1, friendlyName: 1 },
  { unique: true },
);

export const PaymentProviderAccount = mongoose.model<IPaymentProviderAccount>(
  "PaymentProviderAccount",
  paymentProviderAccountSchema,
);
