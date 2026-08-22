import mongoose, { Schema, Document, Types } from "mongoose";

export const ESTIMATE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "converted",
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export interface IEstimatePart {
  productRef?: Types.ObjectId | null;
  lineType: "product" | "note";
  kind: "part" | "labor";
  partNumber: string;
  description: string;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  priceOverridden: boolean;
  amount: number;
}

export interface IEstimate extends Document {
  number: string;
  status: EstimateStatus;
  customerId: number;
  customerRef?: Types.ObjectId;
  addressRef?: Types.ObjectId | null;
  equipmentRef?: Types.ObjectId | null;
  workOrderRef?: Types.ObjectId | null;
  descPerform: string;
  laborHours: number;
  date: Date | null;
  tech: string;
  parts: IEstimatePart[];
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerZip: string;
  customerPhone: string;
  customerEmail: string;
  workPhone: string;
  serialNumber: string;
  generatorModel: string;
  exerciseDay: string;
  exerciseTime: string;
  totalParts: number;
  totalLabor: number;
  laborOverridden: boolean;
  miscExp: number;
  subtotal: number;
  shipping: number;
  total: number;
  signatureDataUrl: string;
  signedAt: Date | null;
  signedByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const estimatePartSchema = new Schema<IEstimatePart>(
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

const estimateSchema = new Schema<IEstimate>(
  {
    number: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ESTIMATE_STATUSES,
      default: "draft",
      index: true,
    },
    customerId: { type: Number, index: true, required: true },
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    addressRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerAddress",
      default: null,
    },
    equipmentRef: {
      type: Schema.Types.ObjectId,
      ref: "Equipment",
      default: null,
    },
    workOrderRef: {
      type: Schema.Types.ObjectId,
      ref: "WorkOrder",
      default: null,
      index: true,
    },
    descPerform: { type: String, default: "" },
    laborHours: { type: Number, default: 0 },
    date: { type: Date, default: null },
    tech: { type: String, default: "" },
    parts: { type: [estimatePartSchema], default: [] },
    customerName: { type: String, default: "" },
    customerAddress: { type: String, default: "" },
    customerCity: { type: String, default: "" },
    customerZip: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    customerEmail: { type: String, default: "" },
    workPhone: { type: String, default: "" },
    serialNumber: { type: String, default: "" },
    generatorModel: { type: String, default: "" },
    exerciseDay: { type: String, default: "" },
    exerciseTime: { type: String, default: "" },
    totalParts: { type: Number, default: 0 },
    totalLabor: { type: Number, default: 0 },
    laborOverridden: { type: Boolean, default: false },
    miscExp: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    signatureDataUrl: { type: String, default: "" },
    signedAt: { type: Date, default: null },
    signedByName: { type: String, default: "" },
  },
  { timestamps: true },
);

estimateSchema.index({ customerRef: 1, status: 1, createdAt: -1 });
estimateSchema.index({ date: -1 });

export const Estimate = mongoose.model<IEstimate>("Estimate", estimateSchema);
