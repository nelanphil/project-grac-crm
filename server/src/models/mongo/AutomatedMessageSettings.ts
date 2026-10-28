import mongoose, { Schema, Document, Types } from "mongoose";

export const AUTOMATED_MESSAGE_SETTINGS_SLUG = "automated-messages";
export const AUTOMATED_MESSAGE_MODES = ["template", "custom"] as const;
export type AutomatedMessageMode = (typeof AUTOMATED_MESSAGE_MODES)[number];

export interface IAutomatedMessageChannel {
  mode: AutomatedMessageMode;
  templateRef: Types.ObjectId | null;
  subject: string;
  body: string;
}

export interface IAutomatedMessageSettings extends Document {
  slug: string;
  configured: boolean;
  workOrderCompleteEmail: IAutomatedMessageChannel;
  workOrderCompleteSms: IAutomatedMessageChannel;
  paymentReceivedEmail: IAutomatedMessageChannel;
  paidInvoiceReceiptEmail: IAutomatedMessageChannel;
  paidInvoiceReceiptSms: IAutomatedMessageChannel;
  mailboxReply: IAutomatedMessageChannel;
  createdAt: Date;
  updatedAt: Date;
}

const channelSchema = new Schema<IAutomatedMessageChannel>(
  {
    mode: {
      type: String,
      enum: AUTOMATED_MESSAGE_MODES,
      default: "custom",
    },
    templateRef: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      default: null,
    },
    subject: { type: String, default: "", maxlength: 200 },
    body: { type: String, default: "", maxlength: 25000 },
  },
  { _id: false },
);

const automatedMessageSettingsSchema = new Schema<IAutomatedMessageSettings>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: AUTOMATED_MESSAGE_SETTINGS_SLUG,
    },
    configured: { type: Boolean, default: false },
    workOrderCompleteEmail: { type: channelSchema, default: () => ({}) },
    workOrderCompleteSms: { type: channelSchema, default: () => ({}) },
    paymentReceivedEmail: { type: channelSchema, default: () => ({}) },
    paidInvoiceReceiptEmail: { type: channelSchema, default: () => ({}) },
    paidInvoiceReceiptSms: { type: channelSchema, default: () => ({}) },
    mailboxReply: { type: channelSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const AutomatedMessageSettings =
  mongoose.model<IAutomatedMessageSettings>(
    "AutomatedMessageSettings",
    automatedMessageSettingsSchema,
  );
