import mongoose, { Schema, Document, Types } from "mongoose";
import { CommunicationChannel, CommunicationDirection } from "./TwilioCommunication";

export type MessageThreadStatus = "open" | "closed";

export interface IMessageThread extends Document {
  contactRef: Types.ObjectId;
  customerRef: Types.ObjectId | null;
  twilioAccountRef: Types.ObjectId;
  accountSid: string;
  ourNumber: string;
  contactPhoneSnapshot: string;
  status: MessageThreadStatus;
  startedByUserRef: Types.ObjectId | null;
  closedAt: Date | null;
  closedByUserRef: Types.ObjectId | null;
  lastMessageAt: Date | null;
  lastMessageDirection: CommunicationDirection | null;
  lastMessageChannel: CommunicationChannel | null;
  lastMessagePreview: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const messageThreadSchema = new Schema<IMessageThread>(
  {
    contactRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerContact",
      required: true,
      index: true,
    },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    twilioAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "TwilioAccount",
      required: true,
      index: true,
    },
    accountSid: { type: String, required: true, trim: true },
    ourNumber: { type: String, required: true, trim: true },
    contactPhoneSnapshot: { type: String, default: "" },
    status: {
      type: String,
      enum: ["open", "closed"],
      required: true,
      default: "open",
    },
    startedByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    closedAt: { type: Date, default: null },
    closedByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastMessageAt: { type: Date, default: null },
    lastMessageDirection: {
      type: String,
      enum: ["outbound", "inbound"],
      default: null,
    },
    lastMessageChannel: {
      type: String,
      enum: ["sms", "mms", "voice"],
      default: null,
    },
    lastMessagePreview: { type: String, default: "" },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

messageThreadSchema.index({ contactRef: 1, ourNumber: 1, status: 1 });
messageThreadSchema.index(
  { contactRef: 1, ourNumber: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);
messageThreadSchema.index({ customerRef: 1, lastMessageAt: -1 });
messageThreadSchema.index({ contactRef: 1, lastMessageAt: -1 });
messageThreadSchema.index({ twilioAccountRef: 1, lastMessageAt: -1 });

export const MessageThread = mongoose.model<IMessageThread>(
  "MessageThread",
  messageThreadSchema,
);
