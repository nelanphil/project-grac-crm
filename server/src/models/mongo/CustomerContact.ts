import mongoose, { Schema, Document, Types } from "mongoose";
import {
  canonicalPhoneDigits,
  normalizePhoneDigits,
} from "../../utils/customerSites";

export interface ICustomerContact extends Document {
  /** Null when the person is not attached to a customer. */
  customerRef: Types.ObjectId | null;
  first: string;
  last: string;
  phone: string;
  /** Canonical digits for exact phone lookup. Empty when the phone is blank. */
  phoneDigits: string;
  email: string;
  label: string;
  isPrimary: boolean;
  /** Linked auth user (provisioned from contact email). */
  userRef?: Types.ObjectId | null;
  /** Legacy customer id this contact originated from (migration/merge). */
  legacyCustomerId?: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerContactSchema = new Schema<ICustomerContact>(
  {
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    first: { type: String, default: "" },
    last: { type: String, default: "" },
    phone: { type: String, default: "" },
    phoneDigits: { type: String, default: "", index: true },
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
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

customerContactSchema.index({ customerRef: 1, isPrimary: -1 });

/** US 10-digit form when possible, otherwise every digit. Empty for a blank phone. */
export function contactPhoneDigits(phone: string | null | undefined): string {
  return canonicalPhoneDigits(phone) || normalizePhoneDigits(phone);
}

customerContactSchema.pre("save", function syncPhoneDigits() {
  this.phoneDigits = contactPhoneDigits(this.phone);
});

export const activeContactFilter = { deletedAt: null } as const;

export const CustomerContact = mongoose.model<ICustomerContact>(
  "CustomerContact",
  customerContactSchema
);
