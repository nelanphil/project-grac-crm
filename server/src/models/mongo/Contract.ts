import mongoose, { Query, Schema, Document, Types } from "mongoose";
import { ContractProductDiscountOverride } from "../../utils/productDiscounts";
import { contractProductDiscountsSchema } from "./productDiscounts";

export interface IRenewalEvent {
  renewedAt: Date;
  durationMonths: number;
  previousDueDate: Date;
  newDueDate: Date;
  wasLate: boolean;
  workOrderRef?: Types.ObjectId;
  invoiceRef?: Types.ObjectId;
  amountCents?: number;
  paymentProvider?: string;
  providerPaymentId?: string;
  notes?: string;
  userId?: number;
  createdAt: Date;
}

export interface IContract extends Document {
  customerId: number;
  customerRef?: Types.ObjectId;
  addressRef?: Types.ObjectId | null;
  equipmentRef?: Types.ObjectId | null;
  templateId?: Types.ObjectId | null;
  originalContractDate: Date | null;
  contractDate: Date | null;
  durationMonths: number;
  renewalDueDate: Date | null;
  lastRenewalDate: Date | null;
  renewals: IRenewalEvent[];
  description: string;
  contractType: string | null;
  productDiscounts: ContractProductDiscountOverride;
  sourceWorkOrderRef?: Types.ObjectId;
  userId?: number;
  /** Hidden offer created so an email can include a payment link. Cleared when paid. */
  temporary: boolean;
  deletedAt: Date | null;
  deletedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const renewalEventSchema = new Schema<IRenewalEvent>(
  {
    renewedAt: { type: Date, required: true },
    durationMonths: { type: Number, required: true, min: 1 },
    previousDueDate: { type: Date, required: true },
    newDueDate: { type: Date, required: true },
    wasLate: { type: Boolean, required: true },
    workOrderRef: { type: Schema.Types.ObjectId, ref: "WorkOrder" },
    invoiceRef: { type: Schema.Types.ObjectId, ref: "Invoice" },
    amountCents: { type: Number },
    paymentProvider: { type: String },
    providerPaymentId: { type: String },
    notes: { type: String, default: "" },
    userId: { type: Number },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const contractSchema = new Schema<IContract>(
  {
    customerId: { type: Number, index: true, required: true },
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer" },
    addressRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerAddress",
      default: null,
      index: true,
    },
    equipmentRef: {
      type: Schema.Types.ObjectId,
      ref: "Equipment",
      default: null,
      index: true,
    },
    templateId: { type: Schema.Types.ObjectId, ref: "ContractTemplate", default: null },
    originalContractDate: { type: Date, default: null },
    contractDate: { type: Date, default: null },
    durationMonths: { type: Number, default: 12, min: 1 },
    renewalDueDate: { type: Date, default: null },
    lastRenewalDate: { type: Date, default: null },
    renewals: { type: [renewalEventSchema], default: [] },
    description: { type: String, default: "" },
    contractType: { type: String, default: null },
    productDiscounts: {
      type: contractProductDiscountsSchema,
      default: () => ({ override: false }),
    },
    sourceWorkOrderRef: { type: Schema.Types.ObjectId, ref: "WorkOrder" },
    userId: { type: Number },
    temporary: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: String, default: null },
  },
  { timestamps: true },
);

/** Active (non–soft-deleted) contracts. `{ deletedAt: null }` also matches missing fields. */
export const activeContractFilter = { deletedAt: null } as const;

/** True when a query filter already names deletedAt, including inside $and / $or / $nor. */
export function filterMentionsDeletedAt(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => filterMentionsDeletedAt(entry));
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "deletedAt")) return true;
  return ["$and", "$or", "$nor"].some((key) => filterMentionsDeletedAt(record[key]));
}

/**
 * Soft-deleted contracts stay hidden unless the caller opts in with
 * `includeDeleted` or already filters on `deletedAt`.
 */
export function shouldExcludeDeletedContracts(
  options: { includeDeleted?: boolean } | undefined,
  filter: unknown,
): boolean {
  if (options?.includeDeleted) return false;
  if (filterMentionsDeletedAt(filter)) return false;
  return true;
}

function hideSoftDeletedContracts(this: Query<unknown, IContract>) {
  if (!shouldExcludeDeletedContracts(this.getOptions(), this.getFilter())) return;
  this.where(activeContractFilter);
}

contractSchema.pre("find", hideSoftDeletedContracts);
contractSchema.pre("findOne", hideSoftDeletedContracts);
contractSchema.pre("countDocuments", hideSoftDeletedContracts);
contractSchema.pre("updateOne", hideSoftDeletedContracts);
contractSchema.pre("updateMany", hideSoftDeletedContracts);
contractSchema.pre("findOneAndUpdate", hideSoftDeletedContracts);

export function includingDeletedContracts<Q extends Query<unknown, IContract>>(
  query: Q,
): Q {
  query.setOptions({ includeDeleted: true });
  return query;
}

contractSchema.index({ customerId: 1, contractDate: -1 });
contractSchema.index({ customerRef: 1 });
contractSchema.index({ renewalDueDate: 1 });
contractSchema.index({ templateId: 1 });
contractSchema.index(
  { customerRef: 1, templateId: 1 },
  { unique: true, partialFilterExpression: { temporary: true } },
);

export const Contract = mongoose.model<IContract>("Contract", contractSchema);
