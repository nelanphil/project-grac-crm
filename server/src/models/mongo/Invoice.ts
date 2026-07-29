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
  currency: string;
  status: InvoiceStatus;
  dueDate: Date | null;
  issuedAt: Date;
  paidAt: Date | null;
  paymentProvider: PaymentProviderName | null;
  paymentProviderAccountRef?: Types.ObjectId | null;
  providerCheckoutId?: string | null;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  payTokenHash?: string | null;
  payTokenExpiresAt?: Date | null;
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
    number: { type: String, required: true, unique: true, index: true },
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
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

invoiceSchema.index({ customerRef: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ contractRef: 1, sourceType: 1, status: 1 });

export const Invoice = mongoose.model<IInvoice>("Invoice", invoiceSchema);
