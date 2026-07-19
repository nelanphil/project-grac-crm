import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICustomerContact extends Document {
  customerRef: Types.ObjectId;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
  /** Linked auth user (provisioned from contact email). */
  userRef?: Types.ObjectId | null;
  /** Legacy customer id this contact originated from (migration/merge). */
  legacyCustomerId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerContactSchema = new Schema<ICustomerContact>(
  {
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    first: { type: String, default: "" },
    last: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    label: { type: String, default: "" },
    isPrimary: { type: Boolean, default: false, index: true },
    userRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    legacyCustomerId: { type: Number, default: null, index: true },
  },
  { timestamps: true }
);

customerContactSchema.index({ customerRef: 1, isPrimary: -1 });

export const CustomerContact = mongoose.model<ICustomerContact>(
  "CustomerContact",
  customerContactSchema
);
