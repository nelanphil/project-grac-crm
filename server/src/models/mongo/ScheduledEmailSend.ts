import mongoose, { Schema, Document, Types } from "mongoose";
import type { EmailChrome } from "../../utils/emailChrome";

export const SCHEDULED_EMAIL_STATUSES = [
  "scheduled",
  "sending",
  "sent",
  "cancelled",
  "failed",
] as const;

export type ScheduledEmailStatus = (typeof SCHEDULED_EMAIL_STATUSES)[number];

export type ScheduledEmailSummary = {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
};

export interface IScheduledEmailSend extends Document {
  contactIds: string[];
  subject: string;
  body: string;
  emailChrome?: EmailChrome | null;
  templateRef?: Types.ObjectId | null;
  emailAccountRef: Types.ObjectId;
  fromName: string;
  replyTo?: string | null;
  emailsPerSecond: number;
  renewalYear?: number | null;
  renewalMonth?: number | null;
  includePaymentLink: boolean;
  scheduledAt: Date;
  status: ScheduledEmailStatus;
  createdByUserRef?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  errorMessage?: string | null;
  summary?: ScheduledEmailSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledEmailSendSchema = new Schema<IScheduledEmailSend>(
  {
    contactIds: {
      type: [String],
      required: true,
      validate: {
        validator: (ids: string[]) => ids.length > 0 && ids.length <= 200,
        message: "contactIds must have 1–200 recipients",
      },
    },
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
    emailChrome: { type: Schema.Types.Mixed, default: undefined },
    templateRef: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      default: null,
    },
    emailAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      required: true,
      index: true,
    },
    fromName: { type: String, required: true, trim: true },
    replyTo: { type: String, default: null, trim: true, lowercase: true },
    emailsPerSecond: { type: Number, default: 2, min: 1, max: 10 },
    renewalYear: { type: Number, default: null },
    renewalMonth: { type: Number, default: null },
    includePaymentLink: { type: Boolean, default: false },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: SCHEDULED_EMAIL_STATUSES,
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
        skipped: { type: Number, required: true },
        failed: { type: Number, required: true },
      },
      default: null,
      _id: false,
    },
  },
  { timestamps: true },
);

scheduledEmailSendSchema.index({ status: 1, scheduledAt: 1 });
scheduledEmailSendSchema.index({ createdAt: -1 });

export const ScheduledEmailSend = mongoose.model<IScheduledEmailSend>(
  "ScheduledEmailSend",
  scheduledEmailSendSchema,
);
