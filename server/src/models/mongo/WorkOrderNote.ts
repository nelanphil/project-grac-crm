import mongoose, { Schema, Document, Types } from "mongoose";

export interface IReminderCompletion {
  userId: Types.ObjectId;
  completedAt: Date;
}

export interface IWorkOrderNote extends Document {
  workOrderRef: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  visibleToCustomer: boolean;
  isReminder: boolean;
  mentionUserIds: Types.ObjectId[];
  reminderCompletions: IReminderCompletion[];
  createdAt: Date;
  updatedAt: Date;
}

const workOrderNoteSchema = new Schema<IWorkOrderNote>(
  {
    workOrderRef: {
      type: Schema.Types.ObjectId,
      ref: "WorkOrder",
      required: true,
      index: true,
    },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true },
    visibleToCustomer: { type: Boolean, default: true, index: true },
    isReminder: { type: Boolean, default: false, index: true },
    mentionUserIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    reminderCompletions: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          completedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

workOrderNoteSchema.index({ workOrderRef: 1, createdAt: -1 });
workOrderNoteSchema.index({ authorId: 1, isReminder: 1, createdAt: -1 });
workOrderNoteSchema.index({ mentionUserIds: 1, isReminder: 1, createdAt: -1 });

export const WorkOrderNote = mongoose.model<IWorkOrderNote>(
  "WorkOrderNote",
  workOrderNoteSchema,
);
