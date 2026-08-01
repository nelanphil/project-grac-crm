import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICustomer extends Document {
  legacyId: number;
  userId: number;
  /** Durable customer record name; independent of primary-contact sync. */
  accountName: string;
  first: string;
  last: string;
  /** Denormalized primary site — kept in sync with primary CustomerAddress. */
  address: string;
  city: string;
  state: string;
  zip: string;
  /** Denormalized primary county — kept in sync with primary CustomerAddress. */
  county: string;
  /** Territory owner resolved from primary site location. */
  ownerUserRef?: Types.ObjectId | null;
  phone: string;
  /** Denormalized digits-only phone for indexed duplicate detection. */
  phoneDigits: string;
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
  /** Soft delete — excluded from default lists when set. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    legacyId: { type: Number, index: true },
    userId: { type: Number, index: true },
    accountName: { type: String, default: "", index: true },
    first: { type: String, default: "" },
    last: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    zip: { type: String, default: "" },
    county: { type: String, default: "", index: true },
    ownerUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    phone: { type: String, default: "" },
    phoneDigits: { type: String, default: "", index: true },
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
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

// Indexes to support server-side sorting/searching of the customer list.
customerSchema.index({ last: 1, first: 1 });
customerSchema.index({ first: 1, last: 1 });
customerSchema.index({ address: 1 });
customerSchema.index({ city: 1 });
customerSchema.index({ state: 1 });
customerSchema.index({ zip: 1 });
customerSchema.index({ phone: 1 });

export const Customer = mongoose.model<ICustomer>("Customer", customerSchema);

/** Active (non–soft-deleted) customers only. */
export const activeCustomerFilter = { deletedAt: null } as const;
