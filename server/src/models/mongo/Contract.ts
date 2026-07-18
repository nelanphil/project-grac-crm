import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRenewalEvent {
  renewedAt: Date;
  durationMonths: number;
  previousDueDate: Date;
  newDueDate: Date;
  wasLate: boolean;
  workOrderRef?: Types.ObjectId;
  notes?: string;
  userId?: number;
  createdAt: Date;
}

export interface IContract extends Document {
  customerId: number;
  customerRef?: Types.ObjectId;
  addressRef?: Types.ObjectId | null;
  equipmentRef?: Types.ObjectId | null;
  templateId?: Types.ObjectId | null;
  originalContractDate: Date | null;
  contractDate: Date | null;
  durationMonths: number;
  renewalDueDate: Date | null;
  lastRenewalDate: Date | null;
  renewals: IRenewalEvent[];
  description: string;
  contractType: string | null;
  sourceWorkOrderRef?: Types.ObjectId;
  userId?: number;
  createdAt: Date;
  updatedAt: Date;
}

const renewalEventSchema = new Schema<IRenewalEvent>(
  {
    renewedAt: { type: Date, required: true },
    durationMonths: { type: Number, required: true, min: 1 },
    previousDueDate: { type: Date, required: true },
    newDueDate: { type: Date, required: true },
    wasLate: { type: Boolean, required: true },
    workOrderRef: { type: Schema.Types.ObjectId, ref: "WorkOrder" },
    notes: { type: String, default: "" },
    userId: { type: Number },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const contractSchema = new Schema<IContract>(
  {
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
    templateId: { type: Schema.Types.ObjectId, ref: "ContractTemplate", default: null },
    originalContractDate: { type: Date, default: null },
    contractDate: { type: Date, default: null },
    durationMonths: { type: Number, default: 12, min: 1 },
    renewalDueDate: { type: Date, default: null },
    lastRenewalDate: { type: Date, default: null },
    renewals: { type: [renewalEventSchema], default: [] },
    description: { type: String, default: "" },
    contractType: { type: String, default: null },
    sourceWorkOrderRef: { type: Schema.Types.ObjectId, ref: "WorkOrder" },
    userId: { type: Number },
  },
  { timestamps: true },
);

contractSchema.index({ customerId: 1, contractDate: -1 });
contractSchema.index({ customerRef: 1 });
contractSchema.index({ renewalDueDate: 1 });
contractSchema.index({ templateId: 1 });

export const Contract = mongoose.model<IContract>("Contract", contractSchema);
