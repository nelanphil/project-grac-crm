import mongoose, { Schema, Document } from "mongoose";

export interface IGoogleCredentials extends Document {
  slug: string;
  label: string;
  apiKeyEncrypted: string;
  /** Optional Maps JavaScript API key for browser (referrer-restricted). */
  mapsBrowserApiKeyEncrypted?: string;
  projectId?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const googleCredentialsSchema = new Schema<IGoogleCredentials>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: "google",
    },
    label: {
      type: String,
      required: true,
      trim: true,
      default: "Google Address Validation API",
    },
    apiKeyEncrypted: {
      type: String,
      required: true,
    },
    mapsBrowserApiKeyEncrypted: {
      type: String,
      default: undefined,
    },
    projectId: {
      type: String,
      trim: true,
      default: undefined,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

export const GoogleCredentials = mongoose.model<IGoogleCredentials>(
  "GoogleCredentials",
  googleCredentialsSchema,
);
