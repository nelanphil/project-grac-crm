import mongoose, { Schema, Document, Types } from "mongoose";

export const SCHEDULED_MESSAGE_STATUSES = [
  "scheduled",
  "sending",
  "sent",
  "cancelled",
  "failed",
] as const;

export type ScheduledMessageStatus =
  (typeof SCHEDULED_MESSAGE_STATUSES)[number];

export type ScheduledMessageSummary = {
  total: number;
  sent: number;
  failed: number;
};

export interface IScheduledMessageSend extends Document {
  contactIds: string[];
  body: string;
  templateRef?: Types.ObjectId | null;
  twilioAccountRef: Types.ObjectId;
  fromNumber: string;
  mediaUrls: string[];
  /** Set when this row is a single text scheduled from an inbox conversation. */
  inboxConversationRef?: Types.ObjectId | null;
  contactRef?: Types.ObjectId | null;
  toNumber?: string;
  renewalYear?: number | null;
  renewalMonth?: number | null;
  includePaymentLink: boolean;
  invoiceRef?: Types.ObjectId | null;
  expectedAmountCents?: number;
  offerContractTemplateId?: Types.ObjectId | null;
  offerContractOverrides: {
    contactId: string;
    contractTemplateId: Types.ObjectId | null;
  }[];
  scheduledAt: Date;
  status: ScheduledMessageStatus;
  createdByUserRef?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  errorMessage?: string | null;
  summary?: ScheduledMessageSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledMessageSendSchema = new Schema<IScheduledMessageSend>(
  {
    contactIds: {
      type: [String],
      required: true,
      validate: {
        validator(this: IScheduledMessageSend, ids: string[]) {
          if (!Array.isArray(ids) || ids.length > 200) return false;
          if (ids.length > 0) return true;
          return Boolean(this.inboxConversationRef);
        },
        message: "contactIds must have 1–200 recipients",
      },
    },
    body: {
      type: String,
      default: "",
      validate: {
        validator(this: IScheduledMessageSend, value: string) {
          if (typeof value === "string" && value.trim()) return true;
          if (Array.isArray(this.mediaUrls) && this.mediaUrls.length > 0) return true;
          return Boolean(this.templateRef);
        },
        message: "Message body is empty",
      },
    },
    templateRef: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      default: null,
    },
    twilioAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "TwilioAccount",
      required: true,
      index: true,
    },
    fromNumber: { type: String, required: true, trim: true },
    mediaUrls: { type: [String], default: [] },
    inboxConversationRef: {
      type: Schema.Types.ObjectId,
      ref: "InboxConversation",
      default: null,
    },
    contactRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerContact",
      default: null,
    },
    toNumber: { type: String, default: "", trim: true },
    renewalYear: { type: Number, default: null },
    renewalMonth: { type: Number, default: null },
    includePaymentLink: { type: Boolean, default: false },
    invoiceRef: { type: Schema.Types.ObjectId, ref: "Invoice", default: null },
    expectedAmountCents: { type: Number, min: 0 },
    offerContractTemplateId: {
      type: Schema.Types.ObjectId,
      ref: "ContractTemplate",
      default: null,
    },
    offerContractOverrides: {
      type: [
        {
          contactId: { type: String, required: true },
          contractTemplateId: {
            type: Schema.Types.ObjectId,
            ref: "ContractTemplate",
            default: null,
          },
        },
      ],
      default: [],
    },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: SCHEDULED_MESSAGE_STATUSES,
      required: true,
      default: "scheduled",
      index: true,
    },
    createdByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelledAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
    summary: {
      type: {
        total: { type: Number, required: true },
        sent: { type: Number, required: true },
        failed: { type: Number, required: true },
      },
      default: null,
      _id: false,
    },
  },
  { timestamps: true },
);

scheduledMessageSendSchema.index({ status: 1, scheduledAt: 1 });
scheduledMessageSendSchema.index({ createdAt: -1 });
scheduledMessageSendSchema.index({
  inboxConversationRef: 1,
  status: 1,
  scheduledAt: 1,
});

export const ScheduledMessageSend = mongoose.model<IScheduledMessageSend>(
  "ScheduledMessageSend",
  scheduledMessageSendSchema,
);
