import mongoose, { Schema, Document, Types } from "mongoose";

export const DISCOUNT_REDEMPTION_STATUSES = [
  "pending",
  "redeemed",
  "released",
] as const;
export type DiscountRedemptionStatus =
  (typeof DISCOUNT_REDEMPTION_STATUSES)[number];

export interface IDiscountAllocation {
  invoiceRef: Types.ObjectId;
  discountCents: number;
}

export interface IDiscountRedemption extends Document {
  discountCodeRef: Types.ObjectId;
  code: string;
  customerRef: Types.ObjectId;
  invoiceRefs: Types.ObjectId[];
  allocations: IDiscountAllocation[];
  discountCents: number;
  subtotalCents: number;
  status: DiscountRedemptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const allocationSchema = new Schema<IDiscountAllocation>(
  {
    invoiceRef: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    discountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const discountRedemptionSchema = new Schema<IDiscountRedemption>(
  {
    discountCodeRef: {
      type: Schema.Types.ObjectId,
      ref: "DiscountCode",
      required: true,
      index: true,
    },
    code: { type: String, required: true, trim: true, uppercase: true },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    invoiceRefs: {
      type: [{ type: Schema.Types.ObjectId, ref: "Invoice" }],
      default: [],
    },
    allocations: { type: [allocationSchema], default: [] },
    discountCents: { type: Number, required: true, min: 0 },
    subtotalCents: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: DISCOUNT_REDEMPTION_STATUSES,
      default: "pending",
      index: true,
    },
  },
  { timestamps: true },
);

discountRedemptionSchema.index({ discountCodeRef: 1, status: 1, createdAt: -1 });
discountRedemptionSchema.index({ customerRef: 1, discountCodeRef: 1, status: 1 });
discountRedemptionSchema.index({ invoiceRefs: 1, status: 1 });

export const DiscountRedemption = mongoose.model<IDiscountRedemption>(
  "DiscountRedemption",
  discountRedemptionSchema,
);
