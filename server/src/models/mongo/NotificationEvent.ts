import mongoose, { Schema, Document, Types } from "mongoose";

export const NOTIFICATION_ENTITY_TYPES = [
  "customer",
  "contact",
  "address",
  "equipment",
  "work_order",
  "contract",
  "customer_note",
  "user",
  "role",
  "twilio_account",
  "contract_template",
  "lead",
] as const;

export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export const OPERATIONAL_ENTITY_TYPES: NotificationEntityType[] = [
  "customer",
  "contact",
  "address",
  "equipment",
  "work_order",
  "contract",
  "customer_note",
];

export const NOTIFICATION_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "merged",
  "renewed",
] as const;

export type NotificationAction = (typeof NOTIFICATION_ACTIONS)[number];

export type NotificationActorType = "user" | "system";

export interface INotificationEvent extends Document {
  entityType: NotificationEntityType;
  action: NotificationAction;
  actorType: NotificationActorType;
  actorUserId: Types.ObjectId | null;
  actorName: string;
  customerRef: Types.ObjectId | null;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationEventSchema = new Schema<INotificationEvent>(
  {
    entityType: {
      type: String,
      required: true,
      enum: NOTIFICATION_ENTITY_TYPES,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: NOTIFICATION_ACTIONS,
    },
    actorType: {
      type: String,
      required: true,
      enum: ["user", "system"],
      default: "system",
    },
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorName: { type: String, required: true, trim: true },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    entityId: { type: String, required: true },
    summary: { type: String, required: true, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

notificationEventSchema.index({ createdAt: -1 });
notificationEventSchema.index({ customerRef: 1, createdAt: -1 });
notificationEventSchema.index({ entityType: 1, createdAt: -1 });

export const NotificationEvent = mongoose.model<INotificationEvent>(
  "NotificationEvent",
  notificationEventSchema
);
