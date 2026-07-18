import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICustomerAddress extends Document {
  customerRef: Types.ObjectId;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
  /** Legacy customer id this site originated from (migration/merge). */
  legacyCustomerId?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerAddressSchema = new Schema<ICustomerAddress>(
  {
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    label: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    zip: { type: String, default: "" },
    isPrimary: { type: Boolean, default: false, index: true },
    legacyCustomerId: { type: Number, default: null, index: true },
  },
  { timestamps: true }
);

customerAddressSchema.index({ customerRef: 1, isPrimary: -1 });

export const CustomerAddress = mongoose.model<ICustomerAddress>(
  "CustomerAddress",
  customerAddressSchema
);
