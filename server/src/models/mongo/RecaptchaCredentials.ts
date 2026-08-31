import mongoose, { Schema, Document } from "mongoose";

export const RECAPTCHA_SLUG = "recaptcha";
export const RECAPTCHA_VERSIONS = ["v2", "v3"] as const;
export type RecaptchaVersion = (typeof RECAPTCHA_VERSIONS)[number];

export interface IRecaptchaCredentials extends Document {
  slug: string;
  siteKey: string;
  secretKeyEncrypted: string;
  version: RecaptchaVersion;
  minScore: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const recaptchaCredentialsSchema = new Schema<IRecaptchaCredentials>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: RECAPTCHA_SLUG,
    },
    siteKey: {
      type: String,
      required: true,
      trim: true,
    },
    secretKeyEncrypted: {
      type: String,
      required: true,
    },
    version: {
      type: String,
      enum: RECAPTCHA_VERSIONS,
      default: "v2",
    },
    minScore: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

export const RecaptchaCredentials = mongoose.model<IRecaptchaCredentials>(
  "RecaptchaCredentials",
  recaptchaCredentialsSchema,
);
