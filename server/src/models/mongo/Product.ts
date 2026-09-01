import mongoose, { Schema, Document, Types } from "mongoose";

export const PRODUCT_KINDS = ["part", "labor"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export interface IProduct extends Document {
  productCode?: string;
  productNumber: string;
  productAltCode: string;
  partNumber: string;
  name: string;
  manufacturer?: Types.ObjectId;
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
    productCode: { type: String, trim: true, uppercase: true, index: true },
    productNumber: { type: String, default: "", trim: true, uppercase: true },
    productAltCode: { type: String, default: "", trim: true, uppercase: true, index: true },
    partNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, uppercase: true },
    manufacturer: {
      type: Schema.Types.ObjectId,
      ref: "Manufacturer",
      index: true,
    },
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
    notes: { type: String, default: "", trim: true, uppercase: true },
  },
  { timestamps: true },
);

productSchema.index({ name: 1 });
productSchema.index({ active: 1, productCode: 1 });
productSchema.index({ active: 1, partNumber: 1 });

export const Product = mongoose.model<IProduct>("Product", productSchema);
