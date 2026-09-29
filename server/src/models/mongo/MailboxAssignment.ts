import mongoose, { Schema, Document, Types } from "mongoose";

export type MailboxAssignmentFolder = "inbox" | "sent";

export interface IMailboxAssignment extends Document {
  emailAccountRef: Types.ObjectId;
  /** RFC Message-ID, or `uid:{folder}:{uid}` when the message has none. */
  messageId: string;
  folder: MailboxAssignmentFolder;
  uid: number;
  subject: string;
  userRefs: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const mailboxAssignmentSchema = new Schema<IMailboxAssignment>(
  {
    emailAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      required: true,
    },
    messageId: { type: String, required: true, trim: true },
    folder: {
      type: String,
      enum: ["inbox", "sent"],
      required: true,
    },
    uid: { type: Number, required: true },
    subject: { type: String, default: "" },
    userRefs: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
  },
  { timestamps: true },
);

mailboxAssignmentSchema.index(
  { emailAccountRef: 1, messageId: 1 },
  { unique: true },
);

export const MailboxAssignment = mongoose.model<IMailboxAssignment>(
  "MailboxAssignment",
  mailboxAssignmentSchema,
);
