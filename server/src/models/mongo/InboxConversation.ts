import mongoose, { Schema, Document, Types } from "mongoose";

export const INBOX_CHANNELS = ["sms", "mms", "voice", "email"] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number];

export const INBOX_HANDLE_KINDS = ["phone", "email"] as const;
export type InboxHandleKind = (typeof INBOX_HANDLE_KINDS)[number];

export type InboxDirection = "inbound" | "outbound";
export type InboxConversationStatus = "open" | "closed";

export interface IInboxConversation extends Document {
  customerRef: Types.ObjectId | null;
  /** Digits (phone) or lowercase email. Set even when the row is tied to a customer. */
  handle: string;
  handleKind: InboxHandleKind;
  displayName: string;
  lastMessageAt: Date | null;
  lastPreview: string;
  lastChannel: InboxChannel | null;
  lastDirection: InboxDirection | null;
  unreadCount: number;
  readAt: Date | null;
  readByUserRef: Types.ObjectId | null;
  status: InboxConversationStatus;
  closedAt: Date | null;
  closedByUserRef: Types.ObjectId | null;
  pinnedAt: Date | null;
  pinnedByUserRef: Types.ObjectId | null;
  blocked: boolean;
  deletedAt: Date | null;
  /** Messages at or before this time stay hidden after a deleted chat comes back. */
  historyFrom: Date | null;
  ourNumber: string;
  emailAccountRef: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const inboxConversationSchema = new Schema<IInboxConversation>(
  {
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    handle: { type: String, required: true, trim: true },
    handleKind: {
      type: String,
      enum: INBOX_HANDLE_KINDS,
      required: true,
    },
    displayName: { type: String, default: "", trim: true },
    lastMessageAt: { type: Date, default: null },
    lastPreview: { type: String, default: "" },
    lastChannel: {
      type: String,
      enum: INBOX_CHANNELS,
    },
    lastDirection: {
      type: String,
      enum: ["inbound", "outbound"],
    },
    unreadCount: { type: Number, default: 0 },
    readAt: { type: Date, default: null },
    readByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
    closedAt: { type: Date, default: null },
    closedByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pinnedAt: { type: Date, default: null },
    pinnedByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    blocked: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    historyFrom: { type: Date, default: null },
    ourNumber: { type: String, default: "" },
    emailAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      default: null,
    },
  },
  { timestamps: true },
);

inboxConversationSchema.index(
  { customerRef: 1 },
  {
    unique: true,
    partialFilterExpression: { customerRef: { $type: "objectId" } },
  },
);
inboxConversationSchema.index(
  { handle: 1, handleKind: 1 },
  {
    unique: true,
    partialFilterExpression: { customerRef: null },
  },
);
inboxConversationSchema.index({ status: 1, lastMessageAt: -1 });
inboxConversationSchema.index({ status: 1, lastChannel: 1, lastMessageAt: -1 });

export const InboxConversation = mongoose.model<IInboxConversation>(
  "InboxConversation",
  inboxConversationSchema,
);
