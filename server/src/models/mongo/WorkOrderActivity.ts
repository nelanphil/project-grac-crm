import mongoose, { Schema, Document, Types } from "mongoose";

export const WORK_ORDER_ACTIVITY_ACTIONS = [
  "created",
  "updated",
  "scheduled",
  "assigned",
  "route_locked",
  "note_added",
  "note_updated",
  "note_removed",
  "completed",
  "appointment_canceled",
  "deleted",
  "restored",
  "receipt_sent",
  "paid",
  "reopened",
  "legacy_updated",
] as const;

export type WorkOrderActivityAction = (typeof WORK_ORDER_ACTIVITY_ACTIONS)[number];

export const WORK_ORDER_ACTIVITY_ACTOR_KINDS = ["staff", "system", "customer"] as const;
export type WorkOrderActivityActorKind = (typeof WORK_ORDER_ACTIVITY_ACTOR_KINDS)[number];

export const WORK_ORDER_ACTIVITY_SOURCES = ["crm", "legacy_dump", "job"] as const;
export type WorkOrderActivitySource = (typeof WORK_ORDER_ACTIVITY_SOURCES)[number];

export interface IWorkOrderActivityChange {
  field: string;
  from: string;
  to: string;
}

export interface IWorkOrderActivity extends Document {
  workOrderRef: Types.ObjectId;
  action: WorkOrderActivityAction;
  actorKind: WorkOrderActivityActorKind;
  actorUserId: Types.ObjectId | null;
  actorName: string;
  summary: string;
  changes: IWorkOrderActivityChange[];
  source: WorkOrderActivitySource;
  sourceEventId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const changeSchema = new Schema<IWorkOrderActivityChange>(
  {
    field: { type: String, required: true, trim: true },
    from: { type: String, default: "" },
    to: { type: String, default: "" },
  },
  { _id: false },
);

const workOrderActivitySchema = new Schema<IWorkOrderActivity>(
  {
    workOrderRef: {
      type: Schema.Types.ObjectId,
      ref: "WorkOrder",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: WORK_ORDER_ACTIVITY_ACTIONS,
    },
    actorKind: {
      type: String,
      required: true,
      enum: WORK_ORDER_ACTIVITY_ACTOR_KINDS,
      default: "system",
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorName: { type: String, required: true, trim: true, default: "System" },
    summary: { type: String, required: true, trim: true },
    changes: { type: [changeSchema], default: [] },
    source: {
      type: String,
      required: true,
      enum: WORK_ORDER_ACTIVITY_SOURCES,
      default: "crm",
    },
    sourceEventId: { type: String },
  },
  { timestamps: true },
);

workOrderActivitySchema.index({ workOrderRef: 1, createdAt: -1 });
workOrderActivitySchema.index(
  { sourceEventId: 1 },
  { unique: true, sparse: true },
);

export const WorkOrderActivity = mongoose.model<IWorkOrderActivity>(
  "WorkOrderActivity",
  workOrderActivitySchema,
);
