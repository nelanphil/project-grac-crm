import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICustomer extends Document {
  legacyId: number;
  userId: number;
  first: string;
  last: string;
  /** Denormalized primary site — kept in sync with primary CustomerAddress. */
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  /** Denormalized primary equipment — kept in sync with primary site equipment. */
  atsSerial: string;
  serial: string;
  generatorModel: string;
  lastSvc: Date | null;
  exday: string;
  extime: string;
  /** Set when this customer was merged into another; excluded from default lists. */
  mergedIntoRef?: Types.ObjectId | null;
  mergedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    legacyId: { type: Number, index: true },
    userId: { type: Number, index: true },
    first: { type: String, default: "" },
    last: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    zip: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "", index: true },
    atsSerial: { type: String, default: "" },
    serial: { type: String, default: "" },
    generatorModel: { type: String, default: "" },
    lastSvc: { type: Date, default: null },
    exday: { type: String, default: "" },
    extime: { type: String, default: "" },
    mergedIntoRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    mergedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Customer = mongoose.model<ICustomer>("Customer", customerSchema);
