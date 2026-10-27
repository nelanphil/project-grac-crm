import mongoose, { Schema, Document, Types } from "mongoose";

export const TASK_STATUSES = ["open", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_SOURCES = ["inbox", "manual"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export interface ITask extends Document {
  title: string;
  description: string;
  status: TaskStatus;
  completedAt: Date | null;
  completedByUserRef: Types.ObjectId | null;
  dueAt: Date | null;
  assignedUserRef: Types.ObjectId | null;
  createdByUserRef: Types.ObjectId | null;
  customerRef: Types.ObjectId | null;
  inboxConversationRef: Types.ObjectId | null;
  sourceCommunicationRef: Types.ObjectId | null;
  source: TaskSource;
  lastRemindedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "open",
      index: true,
    },
    completedAt: { type: Date, default: null },
    completedByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    dueAt: { type: Date, default: null },
    assignedUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    inboxConversationRef: {
      type: Schema.Types.ObjectId,
      ref: "InboxConversation",
      default: null,
    },
    sourceCommunicationRef: {
      type: Schema.Types.ObjectId,
      ref: "TwilioCommunication",
      default: null,
    },
    source: {
      type: String,
      enum: TASK_SOURCES,
      default: "manual",
    },
    lastRemindedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

taskSchema.index({ assignedUserRef: 1, status: 1, dueAt: 1 });
taskSchema.index({ customerRef: 1, status: 1 });
taskSchema.index({ inboxConversationRef: 1 });

export const Task = mongoose.model<ITask>("Task", taskSchema);
