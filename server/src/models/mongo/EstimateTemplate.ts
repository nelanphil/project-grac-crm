import mongoose, { Schema, Document, Types } from "mongoose";
import { IEstimatePart } from "./Estimate";

export interface IEstimateTemplate extends Document {
  name: string;
  descPerform: string;
  laborHours: number;
  parts: IEstimatePart[];
  isDefault: boolean;
  createdBy: Types.ObjectId | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const estimateTemplatePartSchema = new Schema<IEstimatePart>(
  {
    productRef: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    lineType: { type: String, enum: ["product", "note"], default: "product" },
    kind: { type: String, enum: ["part", "labor"], default: "part" },
    partNumber: { type: String, default: "" },
    description: { type: String, default: "" },
    quantity: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    listPrice: { type: Number, default: 0 },
    priceOverridden: { type: Boolean, default: false },
    amount: { type: Number, default: 0 },
  },
  { _id: false },
);

const estimateTemplateSchema = new Schema<IEstimateTemplate>(
  {
    name: { type: String, required: true, trim: true },
    descPerform: { type: String, default: "" },
    laborHours: { type: Number, default: 0 },
    parts: { type: [estimateTemplatePartSchema], default: [] },
    isDefault: { type: Boolean, default: false, index: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

estimateTemplateSchema.index({ deletedAt: 1, name: 1 });
estimateTemplateSchema.index(
  { isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true, deletedAt: null },
  },
);

export const EstimateTemplate = mongoose.model<IEstimateTemplate>(
  "EstimateTemplate",
  estimateTemplateSchema,
);
