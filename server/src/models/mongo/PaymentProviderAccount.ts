import mongoose, { Schema, Document, Types } from "mongoose";

export const PAYMENT_PROVIDERS = ["square", "stripe", "paypal"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_ENVIRONMENTS = ["sandbox", "production"] as const;
export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENTS)[number];

export const PAYMENT_AUTH_METHODS = ["manual", "oauth"] as const;
export type PaymentAuthMethod = (typeof PAYMENT_AUTH_METHODS)[number];

export interface IPaymentProviderAccount extends Document {
  provider: PaymentProviderName;
  friendlyName: string;
  environment: PaymentEnvironment;
  isActive: boolean;
  /**
   * Default within scope:
   * - ownerUserRef set → default for that owner's customers
   * - ownerUserRef null → global fallback default
   */
  isDefault: boolean;
  /**
   * Territory owner this merchant account is assigned to.
   * Null/absent = global fallback account.
   */
  ownerUserRef?: Types.ObjectId | null;
  /** How credentials were obtained. */
  authMethod: PaymentAuthMethod;
  // Square public
  applicationId?: string;
  locationId?: string;
  merchantId?: string;
  tokenExpiresAt?: Date | null;
  connectedAt?: Date | null;
  connectedByUserRef?: Types.ObjectId | null;
  // Stripe public
  publishableKey?: string;
  // PayPal public
  clientId?: string;
  // Encrypted secrets
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
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
    ownerUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    authMethod: {
      type: String,
      enum: PAYMENT_AUTH_METHODS,
      required: true,
      default: "manual",
    },
    applicationId: { type: String, trim: true },
    locationId: { type: String, trim: true },
    merchantId: { type: String, trim: true, index: true },
    tokenExpiresAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    connectedByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    publishableKey: { type: String, trim: true },
    clientId: { type: String, trim: true },
    accessTokenEncrypted: { type: String },
    refreshTokenEncrypted: { type: String },
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

paymentProviderAccountSchema.index({
  provider: 1,
  ownerUserRef: 1,
  isActive: 1,
  isDefault: -1,
});

export const PaymentProviderAccount = mongoose.model<IPaymentProviderAccount>(
  "PaymentProviderAccount",
  paymentProviderAccountSchema,
);
