import mongoose, { Schema, Document, Types } from "mongoose";
import {
  PAYMENT_PROVIDERS,
  PaymentProviderName,
} from "./PaymentProviderAccount";

export const INVOICE_SOURCE_TYPES = [
  "contract_renewal",
  "contract_initial",
  "work_order",
] as const;
export type InvoiceSourceType = (typeof INVOICE_SOURCE_TYPES)[number];

export const INVOICE_STATUSES = [
  "draft",
  "open",
  "paid",
  "void",
  "failed",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const OFFLINE_PAYMENT_METHODS = ["check", "cash"] as const;
export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

export interface IOfflinePayment {
  method: OfflinePaymentMethod;
  checkNumber?: string | null;
  proofUrl?: string | null;
  recordedByUserId?: Types.ObjectId | null;
  recordedByName?: string | null;
  recordedAt?: Date | null;
}

export interface PublicOfflinePayment {
  method: OfflinePaymentMethod;
  checkNumber: string | null;
  proofUrl: string | null;
  recordedByUserId: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
}

export function toPublicOfflinePayment(
  value: IOfflinePayment | null | undefined,
): PublicOfflinePayment | null {
  if (!value || (value.method !== "check" && value.method !== "cash")) return null;
  const recordedAt =
    value.recordedAt instanceof Date
      ? value.recordedAt
      : value.recordedAt
        ? new Date(value.recordedAt)
        : null;
  return {
    method: value.method,
    checkNumber: value.checkNumber?.trim() || null,
    proofUrl: value.proofUrl?.trim() || null,
    recordedByUserId: value.recordedByUserId
      ? String(value.recordedByUserId)
      : null,
    recordedByName: value.recordedByName?.trim() || null,
    recordedAt:
      recordedAt && !Number.isNaN(recordedAt.getTime())
        ? recordedAt.toISOString()
        : null,
  };
}

export const POS_CHARGE_STATUSES = [
  "pending",
  "confirmed",
  "failed",
  "needs_review",
] as const;
export type PosChargeStatus = (typeof POS_CHARGE_STATUSES)[number];

/** A Square Tap to Pay charge started from the CRM, kept until Square confirms it. */
export interface IPosCharge {
  startedAt: Date;
  accountRef?: Types.ObjectId | null;
  locationId: string;
  amountCents: number;
  transactionId?: string | null;
  status: PosChargeStatus;
  lastCheckedAt?: Date | null;
  reviewReason?: string | null;
}

export interface IInvoiceLineItem {
  description: string;
  amountCents: number;
}

export interface IInvoice extends Document {
  number: string;
  customerId: number;
  customerRef?: Types.ObjectId;
  sourceType: InvoiceSourceType;
  contractRef?: Types.ObjectId | null;
  workOrderRef?: Types.ObjectId | null;
  templateRef?: Types.ObjectId | null;
  lineItems: IInvoiceLineItem[];
  amountCents: number;
  originalAmountCents?: number | null;
  discountCode?: string | null;
  discountCents?: number;
  taxRatePercent: number;
  taxCents: number;
  taxOverridden: boolean;
  currency: string;
  status: InvoiceStatus;
  dueDate: Date | null;
  issuedAt: Date;
  paidAt: Date | null;
  /** Set while a customer payment receipt email is claimed or sent. */
  paymentReceiptSentAt: Date | null;
  /** Set while the customer payment receipt text is claimed or sent. */
  paymentReceiptTextSentAt: Date | null;
  posCharge?: IPosCharge | null;
  paymentProvider: PaymentProviderName | null;
  paymentProviderAccountRef?: Types.ObjectId | null;
  providerCheckoutId?: string | null;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  payTokenHash?: string | null;
  payTokenExpiresAt?: Date | null;
  /** Unguessable token for a permanent, read-only public invoice page. Absent until minted. */
  viewToken?: string | null;
  offlinePayment?: IOfflinePayment | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const lineItemSchema = new Schema<IInvoiceLineItem>(
  {
    description: { type: String, required: true },
    amountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema<IInvoice>(
  {
    number: { type: String, required: true, unique: true },
    customerId: { type: Number, required: true, index: true },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      index: true,
    },
    sourceType: {
      type: String,
      enum: INVOICE_SOURCE_TYPES,
      required: true,
      index: true,
    },
    contractRef: {
      type: Schema.Types.ObjectId,
      ref: "Contract",
      default: null,
      index: true,
    },
    workOrderRef: {
      type: Schema.Types.ObjectId,
      ref: "WorkOrder",
      default: null,
      index: true,
    },
    templateRef: {
      type: Schema.Types.ObjectId,
      ref: "ContractTemplate",
      default: null,
    },
    lineItems: { type: [lineItemSchema], default: [] },
    amountCents: { type: Number, required: true, min: 0 },
    originalAmountCents: { type: Number, default: null, min: 0 },
    discountCode: { type: String, default: null, trim: true, uppercase: true },
    discountCents: { type: Number, default: 0, min: 0 },
    taxRatePercent: { type: Number, default: 0, min: 0, max: 100 },
    taxCents: { type: Number, default: 0, min: 0 },
    taxOverridden: { type: Boolean, default: false },
    currency: { type: String, default: "USD" },
    status: {
      type: String,
      enum: INVOICE_STATUSES,
      default: "open",
      index: true,
    },
    dueDate: { type: Date, default: null },
    issuedAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null },
    paymentReceiptSentAt: { type: Date, default: null },
    paymentReceiptTextSentAt: { type: Date, default: null },
    posCharge: {
      type: new Schema<IPosCharge>(
        {
          startedAt: { type: Date, required: true },
          accountRef: {
            type: Schema.Types.ObjectId,
            ref: "PaymentProviderAccount",
            default: null,
          },
          locationId: { type: String, default: "" },
          amountCents: { type: Number, required: true, min: 0 },
          transactionId: { type: String, default: null },
          status: {
            type: String,
            enum: POS_CHARGE_STATUSES,
            default: "pending",
          },
          lastCheckedAt: { type: Date, default: null },
          reviewReason: { type: String, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    paymentProvider: {
      type: String,
      enum: PAYMENT_PROVIDERS,
      default: undefined,
    },
    paymentProviderAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "PaymentProviderAccount",
      default: null,
    },
    providerCheckoutId: { type: String, default: null },
    providerOrderId: { type: String, default: null, index: true },
    providerPaymentId: { type: String, default: null, index: true },
    payTokenHash: { type: String, default: null, index: true },
    payTokenExpiresAt: { type: Date, default: null },
    viewToken: { type: String, unique: true, sparse: true },
    offlinePayment: {
      type: new Schema<IOfflinePayment>(
        {
          method: {
            type: String,
            enum: OFFLINE_PAYMENT_METHODS,
            required: true,
          },
          checkNumber: { type: String, default: null },
          proofUrl: { type: String, default: null },
          recordedByUserId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null,
          },
          recordedByName: { type: String, default: null },
          recordedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

invoiceSchema.index({ customerRef: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ contractRef: 1, sourceType: 1, status: 1 });
invoiceSchema.index(
  { "posCharge.status": 1, "posCharge.startedAt": -1 },
  { partialFilterExpression: { "posCharge.status": { $exists: true } } },
);
invoiceSchema.index({ "posCharge.transactionId": 1 }, { sparse: true });

export const Invoice = mongoose.model<IInvoice>("Invoice", invoiceSchema);
