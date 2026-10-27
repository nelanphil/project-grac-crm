import mongoose, { Schema, Document, Types } from "mongoose";
import { InboxHandleKind, INBOX_HANDLE_KINDS } from "./InboxConversation";

export interface IInboxBlock extends Document {
  handle: string;
  handleKind: InboxHandleKind;
  blockedByUserRef: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const inboxBlockSchema = new Schema<IInboxBlock>(
  {
    handle: { type: String, required: true, trim: true },
    handleKind: {
      type: String,
      enum: INBOX_HANDLE_KINDS,
      required: true,
    },
    blockedByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

inboxBlockSchema.index({ handle: 1, handleKind: 1 }, { unique: true });

export const InboxBlock = mongoose.model<IInboxBlock>("InboxBlock", inboxBlockSchema);
