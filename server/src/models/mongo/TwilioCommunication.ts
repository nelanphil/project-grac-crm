import mongoose, { Schema, Document, Types } from "mongoose";

export type CommunicationChannel = "sms" | "mms" | "voice";
export type CommunicationDirection = "outbound" | "inbound";
export type CommunicationStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "received"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "canceled";

export interface ITwilioCommunication extends Document {
  twilioAccountRef: Types.ObjectId;
  accountSid: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  status: CommunicationStatus;
  fromNumber: string;
  toNumber: string;
  body: string;
  mediaUrls: string[];
  durationSeconds?: number | null;
  twilioSid?: string | null;
  customerRef?: Types.ObjectId | null;
  contactRef?: Types.ObjectId | null;
  threadRef?: Types.ObjectId | null;
  templateRef?: Types.ObjectId | null;
  createdByUserRef?: Types.ObjectId | null;
  errorMessage?: string | null;
  rawStatus?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const twilioCommunicationSchema = new Schema<ITwilioCommunication>(
  {
    twilioAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "TwilioAccount",
      required: true,
      index: true,
    },
    accountSid: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["sms", "mms", "voice"],
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["outbound", "inbound"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "queued",
        "sent",
        "delivered",
        "failed",
        "received",
        "ringing",
        "in-progress",
        "completed",
        "busy",
        "no-answer",
        "canceled",
      ],
      required: true,
      index: true,
    },
    fromNumber: { type: String, required: true, trim: true },
    toNumber: { type: String, required: true, trim: true },
    body: { type: String, default: "" },
    mediaUrls: { type: [String], default: [] },
    durationSeconds: { type: Number, default: null },
    twilioSid: { type: String, default: null },
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
    threadRef: {
      type: Schema.Types.ObjectId,
      ref: "MessageThread",
      default: null,
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
    errorMessage: { type: String, default: null },
    rawStatus: { type: String, default: null },
  },
  { timestamps: true },
);

twilioCommunicationSchema.index({ twilioAccountRef: 1, createdAt: -1 });
twilioCommunicationSchema.index({ accountSid: 1, createdAt: -1 });
twilioCommunicationSchema.index(
  { accountSid: 1, twilioSid: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { twilioSid: { $type: "string" } },
  },
);
twilioCommunicationSchema.index({ customerRef: 1, createdAt: -1 });
twilioCommunicationSchema.index({ contactRef: 1, createdAt: -1 });
twilioCommunicationSchema.index({ fromNumber: 1, toNumber: 1, createdAt: -1 });
twilioCommunicationSchema.index({ threadRef: 1, createdAt: 1 });

export const TwilioCommunication = mongoose.model<ITwilioCommunication>(
  "TwilioCommunication",
  twilioCommunicationSchema,
);
