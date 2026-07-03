import mongoose, { Schema, Document, Types } from "mongoose";

export interface IWorkOrder extends Document {
  legacyId: number;
  userId: number;
  customerId: number; // references Customer.legacyId
  customerRef?: Types.ObjectId; // resolved Customer _id (optional virtual join)
  descPerform: string;
  paid: boolean;
  runHours: number;
  laborHours: number;
  date: Date | null;
  tech: string;
  descPerformed: string;
  totalParts: number;
  totalLabor: number;
  miscExp: number;
  subtotal: number;
  shipping: number;
  total: number;
  certify: boolean;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const workOrderSchema = new Schema<IWorkOrder>(
  {
    legacyId: { type: Number, index: true },
    userId: { type: Number, index: true },
    customerId: { type: Number, index: true, required: true },
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer" },
    descPerform: { type: String, default: "" },
    paid: { type: Boolean, default: false },
    runHours: { type: Number, default: 0 },
    laborHours: { type: Number, default: 0 },
    date: { type: Date, default: null },
    tech: { type: String, default: "" },
    descPerformed: { type: String, default: "" },
    totalParts: { type: Number, default: 0 },
    totalLabor: { type: Number, default: 0 },
    miscExp: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    certify: { type: Boolean, default: false },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Allow lookup by customer's legacy SQL id
workOrderSchema.index({ customerId: 1, date: -1 });

export const WorkOrder = mongoose.model<IWorkOrder>(
  "WorkOrder",
  workOrderSchema,
);
