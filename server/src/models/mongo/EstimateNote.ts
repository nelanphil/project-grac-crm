import mongoose, { Schema, Document, Types } from "mongoose";
import { IReminderCompletion } from "./WorkOrderNote";

export interface IEstimateNote extends Document {
  estimateRef: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  visibleToCustomer: boolean;
  isReminder: boolean;
  mentionUserIds: Types.ObjectId[];
  reminderCompletions: IReminderCompletion[];
  createdAt: Date;
  updatedAt: Date;
}

const estimateNoteSchema = new Schema<IEstimateNote>(
  {
    estimateRef: {
      type: Schema.Types.ObjectId,
      ref: "Estimate",
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

estimateNoteSchema.index({ estimateRef: 1, createdAt: -1 });
estimateNoteSchema.index({ authorId: 1, isReminder: 1, createdAt: -1 });
estimateNoteSchema.index({ mentionUserIds: 1, isReminder: 1, createdAt: -1 });

export const EstimateNote = mongoose.model<IEstimateNote>(
  "EstimateNote",
  estimateNoteSchema,
);
