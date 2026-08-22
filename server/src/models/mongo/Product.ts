import mongoose, { Schema, Document } from "mongoose";

export interface IProduct extends Document {
  partNumber: string;
  name: string;
  unitPrice: number;
  active: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    partNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    unitPrice: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

productSchema.index({ name: 1 });
productSchema.index({ active: 1, partNumber: 1 });

export const Product = mongoose.model<IProduct>("Product", productSchema);
