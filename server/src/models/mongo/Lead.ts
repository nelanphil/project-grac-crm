import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILead extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  country?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  smsConsent?: boolean;
  homeType?: "single_family" | "other";
  interestedInFinancing?: boolean;
  marketingConsent?: boolean;
  status: "new" | "contacted" | "qualified" | "lost" | "won";
  source?: string;
  assignedTo?: string;
  metadata?: Record<string, unknown>;
  /** Customer this lead was linked/converted to, once converted. */
  customerRef: Types.ObjectId | null;
  /** True when conversion matched an existing customer instead of creating one. */
  matchedExisting: boolean;
  convertedAt: Date | null;
  /** Soft delete \u2014 excluded from default lists when set. */
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema = new Schema<ILead>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    country: { type: String },
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },
    smsConsent: { type: Boolean, default: false },
    homeType: {
      type: String,
      enum: ["single_family", "other"],
    },
    interestedInFinancing: { type: Boolean },
    marketingConsent: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "lost", "won"],
      default: "new",
    },
    source: { type: String },
    assignedTo: { type: String },
    metadata: { type: Schema.Types.Mixed },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    matchedExisting: { type: Boolean, default: false },
    convertedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

export const Lead = mongoose.model<ILead>("Lead", leadSchema);

/** Active (non\u2013soft-deleted) leads only. */
export const activeLeadFilter = { deletedAt: null } as const;
