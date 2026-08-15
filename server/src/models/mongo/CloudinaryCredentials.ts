import mongoose, { Schema, Document } from "mongoose";

export interface ICloudinaryCredentials extends Document {
  cloudName: string;
  apiKeyEncrypted: string;
  apiSecretEncrypted: string;
  uploadPreset?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const cloudinaryCredentialsSchema = new Schema<ICloudinaryCredentials>(
  {
    cloudName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    apiKeyEncrypted: {
      type: String,
      required: true,
    },
    apiSecretEncrypted: {
      type: String,
      required: true,
    },
    uploadPreset: {
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

export const CloudinaryCredentials = mongoose.model<ICloudinaryCredentials>(
  "CloudinaryCredentials",
  cloudinaryCredentialsSchema,
);
