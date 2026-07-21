import mongoose, { Schema, Document, Types } from "mongoose";

export interface INotificationRead extends Document {
  userId: Types.ObjectId;
  eventId: Types.ObjectId;
  readAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificationReadSchema = new Schema<INotificationRead>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "NotificationEvent",
      required: true,
      index: true,
    },
    readAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

notificationReadSchema.index({ userId: 1, eventId: 1 }, { unique: true });

export const NotificationRead = mongoose.model<INotificationRead>(
  "NotificationRead",
  notificationReadSchema
);
