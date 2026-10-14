import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICustomerNote extends Document {
  customerRef: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  /** Null until any staff member opens the note. Missing on notes created before view tracking. */
  viewedAt?: Date | null;
  viewedByUserRef?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerNoteSchema = new Schema<ICustomerNote>(
  {
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true },
    // No schema default: older notes omit the field and must not alert.
    // New notes set this to null until someone opens them.
    viewedAt: { type: Date },
    viewedByUserRef: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

customerNoteSchema.index({ customerRef: 1, createdAt: -1 });
customerNoteSchema.index({ customerRef: 1, viewedAt: 1 });

export const CustomerNote = mongoose.model<ICustomerNote>("CustomerNote", customerNoteSchema);
