import mongoose, { Schema, Document, Types } from "mongoose";
import {
  ACTIVITY_ACTOR_KINDS,
  ACTIVITY_SOURCES,
  ActivityActorKind,
  ActivitySource,
} from "./CustomerActivity";

export const INVOICE_CONTACT_EVENT_KINDS = [
  "viewed",
  "pay_link_opened",
  "checkout_started",
] as const;

export const INVOICE_PAYMENT_EVENT_KINDS = [
  "payment_succeeded",
  "payment_failed",
  "payment_canceled",
  "payment_needs_review",
] as const;

export const INVOICE_EVENT_KINDS = [
  ...INVOICE_CONTACT_EVENT_KINDS,
  ...INVOICE_PAYMENT_EVENT_KINDS,
] as const;
export type InvoiceEventKind = (typeof INVOICE_EVENT_KINDS)[number];

export const INVOICE_PAYMENT_METHODS = [
  "card",
  "tap_to_pay",
  "card_present",
  "card_keyed",
  "card_online",
  "wallet",
  "check",
  "cash",
  "manual",
  "zero_total",
] as const;
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];

export const INVOICE_PAYMENT_CHANNELS = ["in_person", "online"] as const;
export type InvoicePaymentChannel = (typeof INVOICE_PAYMENT_CHANNELS)[number];

/** What the provider reported about how the payment was taken. */
export interface IInvoicePaymentDetail {
  channel?: InvoicePaymentChannel | null;
  entryMethod?: string | null;
  cardBrand?: string | null;
  last4?: string | null;
  wallet?: string | null;
  squareProduct?: string | null;
  receiptUrl?: string | null;
  label: string;
  fetchedAt: Date;
}

export interface IInvoiceEvent extends Document {
  invoiceRef: Types.ObjectId;
  customerRef?: Types.ObjectId | null;
  kind: InvoiceEventKind;
  method?: InvoicePaymentMethod | null;
  provider?: string | null;
  amountCents?: number | null;
  reason?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  paymentDetail?: IInvoicePaymentDetail | null;
  actorKind: ActivityActorKind;
  actorUserId?: Types.ObjectId | null;
  actorName: string;
  source: ActivitySource;
  /** Stable id so webhook retries do not insert duplicates. */
  sourceEventId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentDetailSchema = new Schema<IInvoicePaymentDetail>(
  {
    channel: { type: String, enum: INVOICE_PAYMENT_CHANNELS, default: null },
    entryMethod: { type: String, default: null },
    cardBrand: { type: String, default: null },
    last4: { type: String, default: null },
    wallet: { type: String, default: null },
    squareProduct: { type: String, default: null },
    receiptUrl: { type: String, default: null },
    label: { type: String, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { _id: false },
);

const invoiceEventSchema = new Schema<IInvoiceEvent>(
  {
    invoiceRef: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    kind: { type: String, enum: INVOICE_EVENT_KINDS, required: true },
    method: { type: String, enum: INVOICE_PAYMENT_METHODS, default: null },
    provider: { type: String, default: null },
    amountCents: { type: Number, default: null },
    reason: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    providerOrderId: { type: String, default: null },
    paymentDetail: { type: paymentDetailSchema, default: null },
    actorKind: {
      type: String,
      enum: ACTIVITY_ACTOR_KINDS,
      default: "system",
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorName: { type: String, default: "System", trim: true },
    source: { type: String, enum: ACTIVITY_SOURCES, default: "crm" },
    sourceEventId: { type: String },
  },
  { timestamps: true },
);

invoiceEventSchema.index({ invoiceRef: 1, createdAt: -1 });
invoiceEventSchema.index({ invoiceRef: 1, kind: 1, createdAt: -1 });
invoiceEventSchema.index({ sourceEventId: 1 }, { unique: true, sparse: true });

export const InvoiceEvent = mongoose.model<IInvoiceEvent>(
  "InvoiceEvent",
  invoiceEventSchema,
);
