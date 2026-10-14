import mongoose, { Schema, Document } from "mongoose";

export interface IQuoCredentials extends Document {
  apiKeyEncrypted: string;
  label?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const quoCredentialsSchema = new Schema<IQuoCredentials>(
  {
    apiKeyEncrypted: {
      type: String,
      required: true,
    },
    label: {
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

export const QuoCredentials = mongoose.model<IQuoCredentials>(
  "QuoCredentials",
  quoCredentialsSchema,
);
