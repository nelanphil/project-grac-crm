import mongoose, { Schema, Document } from "mongoose";

export const DISCOUNT_MODES = ["percent", "amount"] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];

export const DISCOUNT_APPLIES_TO = ["work_order", "contract"] as const;
export type DiscountAppliesTo = (typeof DISCOUNT_APPLIES_TO)[number];

export interface IDiscountCode extends Document {
  code: string;
  label: string;
  mode: DiscountMode;
  /** Percent 1–100, or fixed off in cents. */
  value: number;
  active: boolean;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxRedemptionsPerCustomer: number | null;
  minSubtotalCents: number | null;
  /** Empty means every payable item. */
  appliesTo: DiscountAppliesTo[];
  createdAt: Date;
  updatedAt: Date;
}

const discountCodeSchema = new Schema<IDiscountCode>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    label: { type: String, default: "", trim: true },
    mode: {
      type: String,
      enum: DISCOUNT_MODES,
      required: true,
    },
    value: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, default: null, index: true },
    maxRedemptions: { type: Number, default: null, min: 1 },
    redemptionCount: { type: Number, default: 0, min: 0 },
    maxRedemptionsPerCustomer: { type: Number, default: null, min: 1 },
    minSubtotalCents: { type: Number, default: null, min: 1 },
    appliesTo: {
      type: [String],
      enum: DISCOUNT_APPLIES_TO,
      default: [],
    },
  },
  { timestamps: true },
);

discountCodeSchema.index({ active: 1, expiresAt: 1 });

export const DiscountCode = mongoose.model<IDiscountCode>(
  "DiscountCode",
  discountCodeSchema,
);
