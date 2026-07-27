import mongoose, { Schema, Document, Types } from "mongoose";

export type SmsMessageStatus = "queued" | "sent" | "failed";

export interface ISmsMessage extends Document {
  twilioAccountRef: Types.ObjectId;
  fromNumber: string;
  toNumber: string;
  body: string;
  customerRef?: Types.ObjectId | null;
  contactRef?: Types.ObjectId | null;
  templateRef?: Types.ObjectId | null;
  status: SmsMessageStatus;
  twilioSid?: string | null;
  errorMessage?: string | null;
  createdByUserRef?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const smsMessageSchema = new Schema<ISmsMessage>(
  {
    twilioAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "TwilioAccount",
      required: true,
      index: true,
    },
    fromNumber: { type: String, required: true, trim: true },
    toNumber: { type: String, required: true, trim: true },
    body: { type: String, required: true },
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
    status: {
      type: String,
      enum: ["queued", "sent", "failed"],
      required: true,
      index: true,
    },
    twilioSid: { type: String, default: null },
    errorMessage: { type: String, default: null },
    createdByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

export const SmsMessage = mongoose.model<ISmsMessage>(
  "SmsMessage",
  smsMessageSchema,
);
