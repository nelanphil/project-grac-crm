import mongoose, { Schema, Document, Types } from "mongoose";
import { TicketContractDiscount } from "../../utils/productDiscounts";
import { ticketContractDiscountSchema } from "./productDiscounts";

export interface IWorkOrderPart {
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

export interface IWorkOrder extends Document {
  legacyId: number;
  number?: string;
  userId: number;
  customerId: number; // references Customer.legacyId
  customerRef?: Types.ObjectId; // resolved Customer _id (optional virtual join)
  addressRef?: Types.ObjectId | null;
  equipmentRef?: Types.ObjectId | null;
  estimateRef?: Types.ObjectId | null;
  contractRef?: Types.ObjectId | null;
  contractDiscount?: TicketContractDiscount | null;
  descPerform: string;
  paid: boolean;
  runHours: number;
  laborHours: number;
  date: Date | null;
  tech: string;
  assignedUserRef?: Types.ObjectId | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  estimatedMinutes: number;
  appointmentCanceledAt: Date | null;
  appointmentCanceledBy?: Types.ObjectId | null;
  descPerformed: string;
  parts: IWorkOrderPart[];
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
  certify: boolean;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const workOrderPartSchema = new Schema<IWorkOrderPart>(
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

const workOrderSchema = new Schema<IWorkOrder>(
  {
    legacyId: { type: Number, index: true },
    number: { type: String, default: undefined, index: true, sparse: true },
    userId: { type: Number, index: true },
    customerId: { type: Number, index: true, required: true },
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer" },
    addressRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerAddress",
      default: null,
      index: true,
    },
    equipmentRef: {
      type: Schema.Types.ObjectId,
      ref: "Equipment",
      default: null,
      index: true,
    },
    estimateRef: {
      type: Schema.Types.ObjectId,
      ref: "Estimate",
      default: null,
      index: true,
    },
    contractRef: {
      type: Schema.Types.ObjectId,
      ref: "Contract",
      default: null,
    },
    contractDiscount: {
      type: ticketContractDiscountSchema,
      default: null,
    },
    descPerform: { type: String, default: "" },
    paid: { type: Boolean, default: false },
    runHours: { type: Number, default: 0 },
    laborHours: { type: Number, default: 0 },
    date: { type: Date, default: null },
    tech: { type: String, default: "" },
    assignedUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    scheduledStart: { type: Date, default: null, index: true },
    scheduledEnd: { type: Date, default: null },
    estimatedMinutes: { type: Number, default: 60 },
    appointmentCanceledAt: { type: Date, default: null, index: true },
    appointmentCanceledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    descPerformed: { type: String, default: "" },
    parts: { type: [workOrderPartSchema], default: [] },
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
    certify: { type: Boolean, default: false },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

workOrderSchema.index({ customerId: 1, date: -1 });
workOrderSchema.index({ assignedUserRef: 1, scheduledStart: 1 });
workOrderSchema.index({ number: 1 }, { unique: true, sparse: true });
workOrderSchema.index({ completed: 1, paid: 1, date: -1 });

export const WorkOrder = mongoose.model<IWorkOrder>(
  "WorkOrder",
  workOrderSchema,
);
