import mongoose, { Schema, Document } from "mongoose";

export const PRODUCT_KINDS = ["part", "labor"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export interface IProduct extends Document {
  productCode?: string;
  productNumber: string;
  productAltCode: string;
  partNumber: string;
  name: string;
  kind: ProductKind;
  listPrice: number;
  unitPrice: number;
  cost: number;
  strikeThroughPrice: number;
  active: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    productCode: { type: String, trim: true, index: true },
    productNumber: { type: String, default: "", trim: true },
    productAltCode: { type: String, default: "", trim: true, index: true },
    partNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: PRODUCT_KINDS,
      default: "part",
      index: true,
    },
    listPrice: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    cost: { type: Number, default: 0, min: 0 },
    strikeThroughPrice: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

productSchema.index({ name: 1 });
productSchema.index({ active: 1, productCode: 1 });
productSchema.index({ active: 1, partNumber: 1 });

export const Product = mongoose.model<IProduct>("Product", productSchema);
