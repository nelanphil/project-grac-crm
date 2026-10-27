import mongoose, { Schema, Document } from "mongoose";

export const DEFAULT_GROK_MODEL = "grok-4";

export interface IXaiCredentials extends Document {
  apiKeyEncrypted: string;
  modelName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const xaiCredentialsSchema = new Schema<IXaiCredentials>(
  {
    apiKeyEncrypted: { type: String, required: true },
    modelName: { type: String, trim: true, default: DEFAULT_GROK_MODEL },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const XaiCredentials = mongoose.model<IXaiCredentials>(
  "XaiCredentials",
  xaiCredentialsSchema,
);
