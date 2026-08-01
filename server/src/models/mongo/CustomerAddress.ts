import mongoose, { Schema, Document, Types } from "mongoose";

export type CustomerAddressPropertyType = "residential" | "commercial";

export interface ICustomerAddress extends Document {
  customerRef: Types.ObjectId;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  /** County name without "County" suffix when known. */
  county: string;
  /** When true, geocode/re-normalize must not overwrite county. */
  countyManual: boolean;
  isPrimary: boolean;
  propertyType: CustomerAddressPropertyType;
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
    county: { type: String, default: "", index: true },
    countyManual: { type: Boolean, default: false },
    isPrimary: { type: Boolean, default: false, index: true },
    propertyType: {
      type: String,
      enum: ["residential", "commercial"],
      default: "residential",
    },
    legacyCustomerId: { type: Number, default: null, index: true },
  },
  { timestamps: true }
);

customerAddressSchema.index({ customerRef: 1, isPrimary: -1 });

export const CustomerAddress = mongoose.model<ICustomerAddress>(
  "CustomerAddress",
  customerAddressSchema
);
