import mongoose, { Schema, Document, Types } from "mongoose";

export interface IMailboxAutoReply extends Document {
  emailAccountRef: Types.ObjectId;
  messageId: string;
  uid: number;
  subject: string;
  toEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

const mailboxAutoReplySchema = new Schema<IMailboxAutoReply>(
  {
    emailAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      required: true,
    },
    messageId: { type: String, required: true, trim: true },
    uid: { type: Number, required: true },
    subject: { type: String, default: "" },
    toEmail: { type: String, default: "", trim: true, lowercase: true },
  },
  { timestamps: true },
);

mailboxAutoReplySchema.index(
  { emailAccountRef: 1, messageId: 1 },
  { unique: true },
);

export const MailboxAutoReply = mongoose.model<IMailboxAutoReply>(
  "MailboxAutoReply",
  mailboxAutoReplySchema,
);
