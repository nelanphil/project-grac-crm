import mongoose, { Schema, Document } from "mongoose";

/**
 * Platform Square application credentials used to run the OAuth code flow
 * for seller (owner) Connect. Distinct from per-owner PaymentProviderAccount
 * seller tokens.
 */
export interface ISquareOAuthApp extends Document {
  slug: string;
  productionApplicationId?: string;
  productionApplicationSecretEncrypted?: string;
  sandboxApplicationId?: string;
  sandboxApplicationSecretEncrypted?: string;
  createdAt: Date;
  updatedAt: Date;
}

const squareOAuthAppSchema = new Schema<ISquareOAuthApp>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: "square-oauth",
    },
    productionApplicationId: { type: String, trim: true },
    productionApplicationSecretEncrypted: { type: String },
    sandboxApplicationId: { type: String, trim: true },
    sandboxApplicationSecretEncrypted: { type: String },
  },
  { timestamps: true },
);

export const SquareOAuthApp = mongoose.model<ISquareOAuthApp>(
  "SquareOAuthApp",
  squareOAuthAppSchema,
);

export const SQUARE_OAUTH_APP_SLUG = "square-oauth";
