import mongoose, { Schema, Document, Types } from "mongoose";

export const ACTIVITY_CATEGORIES = [
  "account",
  "contact",
  "address",
  "equipment",
  "work_order",
  "contract",
  "estimate",
  "invoice",
  "payment",
  "communication",
  "note",
  "auth",
  "portal",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_ACTOR_KINDS = ["staff", "customer", "system"] as const;
export type ActivityActorKind = (typeof ACTIVITY_ACTOR_KINDS)[number];

export const ACTIVITY_SOURCES = ["crm", "portal", "webhook", "job"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export interface IActivityChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ICustomerActivity extends Document {
  customerRef: Types.ObjectId;
  category: ActivityCategory;
  action: string;
  actorKind: ActivityActorKind;
  actorUserId: Types.ObjectId | null;
  actorName: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  changes: IActivityChange[];
  metadata: Record<string, unknown>;
  source: ActivitySource;
  ip: string | null;
  /** Stable id so backfill and webhook retries do not insert duplicates. */
  sourceEventId?: string | null;
  backfilled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const changeSchema = new Schema<IActivityChange>(
  {
    field: { type: String, required: true, trim: true },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const customerActivitySchema = new Schema<ICustomerActivity>(
  {
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      enum: ACTIVITY_CATEGORIES,
    },
    action: { type: String, required: true, trim: true },
    actorKind: {
      type: String,
      required: true,
      enum: ACTIVITY_ACTOR_KINDS,
      default: "system",
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorName: { type: String, required: true, trim: true, default: "System" },
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
    summary: { type: String, required: true, trim: true },
    changes: { type: [changeSchema], default: [] },
    metadata: { type: Schema.Types.Mixed, default: {} },
    source: {
      type: String,
      required: true,
      enum: ACTIVITY_SOURCES,
      default: "crm",
    },
    ip: { type: String, default: null },
    sourceEventId: { type: String },
    backfilled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

customerActivitySchema.index({ customerRef: 1, createdAt: -1, _id: -1 });
customerActivitySchema.index({ createdAt: -1, _id: -1 });
customerActivitySchema.index({ customerRef: 1, category: 1, createdAt: -1 });
customerActivitySchema.index(
  { sourceEventId: 1 },
  { unique: true, sparse: true },
);

export const CustomerActivity = mongoose.model<ICustomerActivity>(
  "CustomerActivity",
  customerActivitySchema,
);
