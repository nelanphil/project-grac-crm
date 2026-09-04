import mongoose, { Schema, Document, Types } from "mongoose";

export type EmailCommunicationStatus = "sent" | "failed";

export interface IEmailCommunication extends Document {
  emailAccountRef: Types.ObjectId;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  html: string;
  status: EmailCommunicationStatus;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  customerRef?: Types.ObjectId | null;
  contactRef?: Types.ObjectId | null;
  templateRef?: Types.ObjectId | null;
  createdByUserRef?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailCommunicationSchema = new Schema<IEmailCommunication>(
  {
    emailAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      required: true,
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
      enum: ["sent", "failed"],
      required: true,
      index: true,
    },
    providerMessageId: { type: String, default: null },
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

export const EmailCommunication = mongoose.model<IEmailCommunication>(
  "EmailCommunication",
  emailCommunicationSchema,
);
