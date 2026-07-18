import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICustomerNote extends Document {
  customerRef: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const customerNoteSchema = new Schema<ICustomerNote>(
  {
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

customerNoteSchema.index({ customerRef: 1, createdAt: -1 });

export const CustomerNote = mongoose.model<ICustomerNote>("CustomerNote", customerNoteSchema);
