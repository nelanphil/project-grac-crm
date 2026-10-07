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
  renewalYear?: number | null;
  renewalMonth?: number | null;
  includePaymentLink: boolean;
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
        validator: (ids: string[]) => ids.length > 0 && ids.length <= 200,
        message: "contactIds must have 1–200 recipients",
      },
    },
    body: { type: String, required: true },
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
    renewalYear: { type: Number, default: null },
    renewalMonth: { type: Number, default: null },
    includePaymentLink: { type: Boolean, default: false },
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

export const ScheduledMessageSend = mongoose.model<IScheduledMessageSend>(
  "ScheduledMessageSend",
  scheduledMessageSendSchema,
);
