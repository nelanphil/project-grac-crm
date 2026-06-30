import mongoose, { Schema, Document } from "mongoose";

export interface ICustomer extends Document {
  legacyId: number;
  userId: number;
  first: string;
  last: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  atsSerial: string;
  serial: string;
  generatorModel: string;
  lastSvc: Date | null;
  exday: string;
  extime: string;
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
  },
  { timestamps: true }
);

export const Customer = mongoose.model<ICustomer>("Customer", customerSchema);
