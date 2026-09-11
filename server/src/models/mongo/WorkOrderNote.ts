import mongoose, { Schema, Document, Types } from "mongoose";

export interface IWorkOrderNote extends Document {
  workOrderRef: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  visibleToCustomer: boolean;
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
  },
  { timestamps: true },
);

workOrderNoteSchema.index({ workOrderRef: 1, createdAt: -1 });

export const WorkOrderNote = mongoose.model<IWorkOrderNote>(
  "WorkOrderNote",
  workOrderNoteSchema,
);
