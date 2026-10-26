import mongoose, { Schema, Document, Types } from "mongoose";

export type EmailCommunicationStatus = "sent" | "failed" | "received";
export type EmailCommunicationDirection = "inbound" | "outbound";

export interface IEmailAttachment {
  filename: string;
  size: number;
  contentType: string;
  partId: string;
}

export interface IEmailCommunication extends Document {
  emailAccountRef: Types.ObjectId;
  direction: EmailCommunicationDirection;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  html: string;
  status: EmailCommunicationStatus;
  providerMessageId?: string | null;
  /** Normalized Message-ID, used to upsert mailbox copies. */
  messageId: string;
  inReplyTo: string;
  references: string[];
  imapUid?: number | null;
  mailboxFolder: string;
  receivedAt?: Date | null;
  attachments: IEmailAttachment[];
  errorMessage?: string | null;
  customerRef?: Types.ObjectId | null;
  contactRef?: Types.ObjectId | null;
  templateRef?: Types.ObjectId | null;
  createdByUserRef?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailAttachmentSchema = new Schema<IEmailAttachment>(
  {
    filename: { type: String, default: "" },
    size: { type: Number, default: 0 },
    contentType: { type: String, default: "" },
    partId: { type: String, default: "" },
  },
  { _id: false },
);

const emailCommunicationSchema = new Schema<IEmailCommunication>(
  {
    emailAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound"],
      default: "outbound",
      index: true,
    },
    fromName: { type: String, required: true, trim: true },
    fromEmail: { type: String, required: true, trim: true, lowercase: true },
    toEmail: { type: String, required: true, trim: true, lowercase: true },
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
    html: { type: String, default: "" },
    status: {
      type: String,
      enum: ["sent", "failed", "received"],
      required: true,
      index: true,
    },
    providerMessageId: { type: String, default: null },
    messageId: { type: String, default: "" },
    inReplyTo: { type: String, default: "" },
    references: { type: [String], default: [] },
    imapUid: { type: Number, default: null },
    mailboxFolder: { type: String, default: "" },
    receivedAt: { type: Date, default: null },
    attachments: { type: [emailAttachmentSchema], default: [] },
    errorMessage: { type: String, default: null },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    contactRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerContact",
      default: null,
      index: true,
    },
    templateRef: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      default: null,
    },
    createdByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

emailCommunicationSchema.index({ createdAt: -1 });
emailCommunicationSchema.index(
  { emailAccountRef: 1, messageId: 1 },
  {
    unique: true,
    partialFilterExpression: { messageId: { $type: "string", $gt: "" } },
  },
);

export const EmailCommunication = mongoose.model<IEmailCommunication>(
  "EmailCommunication",
  emailCommunicationSchema,
);
