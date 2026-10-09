import mongoose, { Connection, Schema, Document, Types } from "mongoose";

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
  /** True until promoted from a converted lead into a full customer record. */
  isTemporary: boolean;
  /** Lead this customer was created from via conversion, if any. */
  leadRef?: Types.ObjectId | null;
  /** Soft delete — excluded from default lists when set. */
  deletedAt: Date | null;
  /** Unguessable public checkout capability key. Generated lazily. */
  checkoutKey?: string | null;
  /** Short public code for SMS payment links. Maps to checkoutKey. */
  payCode?: string | null;
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
    isTemporary: { type: Boolean, default: false, index: true },
    leadRef: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    deletedAt: { type: Date, default: null, index: true },
    checkoutKey: { type: String },
    payCode: { type: String },
  },
  { timestamps: true },
);

/**
 * Unique only when a real code is present. Null and "" are omitted from the
 * index so many customers can exist without a checkout key or pay code.
 * Sparse unique indexes still index an explicit null, which is what made
 * legacy imports fail with E11000 on payCode_1.
 */
const optionalUniqueCodeFields = ["checkoutKey", "payCode"] as const;

for (const field of optionalUniqueCodeFields) {
  customerSchema.index(
    { [field]: 1 },
    {
      unique: true,
      name: `${field}_1`,
      partialFilterExpression: { [field]: { $gt: "" } },
    },
  );
}

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

type ListedIndex = {
  name?: string;
  unique?: boolean;
  partialFilterExpression?: Record<string, { $gt?: unknown }>;
};

function isDesiredOptionalUniqueIndex(index: ListedIndex | undefined, field: string): boolean {
  if (!index?.unique) return false;
  return index.partialFilterExpression?.[field]?.$gt === "";
}

/**
 * Replace a sparse unique index that treats null as a value. Clears stored
 * nulls and empty strings, then drops payCode_1 / checkoutKey_1 when they are
 * not already the partial unique index.
 */
export async function ensureCustomerOptionalUniqueIndexes(
  conn: Connection,
): Promise<void> {
  const col = conn.collection("customers");
  let indexes: ListedIndex[] = [];
  try {
    indexes = (await col.indexes()) as ListedIndex[];
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 26) throw err;
  }

  for (const field of optionalUniqueCodeFields) {
    await col.updateMany(
      { $or: [{ [field]: { $type: "null" } }, { [field]: "" }] },
      { $unset: { [field]: "" } },
    );

    const name = `${field}_1`;
    const existing = indexes.find((index) => index.name === name);
    if (isDesiredOptionalUniqueIndex(existing, field)) continue;

    if (existing?.name) {
      await col.dropIndex(existing.name);
    }
    await col.createIndex(
      { [field]: 1 },
      {
        unique: true,
        name,
        partialFilterExpression: { [field]: { $gt: "" } },
      },
    );
    console.log(
      `[customers] Rebuilt unique index ${name} so empty values are not unique.`,
    );
  }
}
