import mongoose, { Schema, Document } from "mongoose";

export const TAX_SETTINGS_SLUG = "tax";

export interface ITaxSettings extends Document {
  slug: string;
  ratePercent: number;
  createdAt: Date;
  updatedAt: Date;
}

const taxSettingsSchema = new Schema<ITaxSettings>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: TAX_SETTINGS_SLUG,
    },
    ratePercent: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  { timestamps: true },
);

export const TaxSettings = mongoose.model<ITaxSettings>(
  "TaxSettings",
  taxSettingsSchema,
);
