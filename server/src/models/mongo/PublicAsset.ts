import mongoose, { Schema, Document } from "mongoose";

export interface IPublicAsset extends Document {
  slug: string;
  title: string;
  mimeType: string;
  provider: string;
  publicUrl: string;
  publicId: string;
  isActive: boolean;
  uploadedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const publicAssetSchema = new Schema<IPublicAsset>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      required: true,
      default: "cloudinary",
    },
    publicUrl: {
      type: String,
      required: true,
      trim: true,
    },
    publicId: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    uploadedBy: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true },
);

publicAssetSchema.index({ isActive: 1, createdAt: -1 });

export const PublicAsset = mongoose.model<IPublicAsset>(
  "PublicAsset",
  publicAssetSchema,
);
