import mongoose, { Schema, Document, Types } from "mongoose";

export interface INote extends Document {
  leadId: Types.ObjectId;
  authorId: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<INote>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
    authorId: { type: Number, required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

export const Note = mongoose.model<INote>("Note", noteSchema);
