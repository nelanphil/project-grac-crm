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
  renewalScheduleEmail: IAutomatedMessageChannel;
  appointmentConfirmationEmail: IAutomatedMessageChannel;
  appointmentConfirmationSms: IAutomatedMessageChannel;
  renewalSchedule: IRenewalScheduleOptions;
  emailDelivery: IAutomatedEmailDelivery;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRenewalScheduleOptions {
  enabled: boolean;
  offerRecommendedDates: boolean;
}

export const AUTOMATED_EMAIL_CHANNELS = [
  "workOrderCompleteEmail",
  "paymentReceivedEmail",
  "paidInvoiceReceiptEmail",
  "mailboxReply",
  "renewalScheduleEmail",
  "appointmentConfirmationEmail",
] as const;

export type AutomatedEmailChannelKey = (typeof AUTOMATED_EMAIL_CHANNELS)[number];

/** Master switch plus one switch per automated email. Missing values stay on. */
export interface IAutomatedEmailDelivery {
  enabled: boolean;
  workOrderCompleteEmail: boolean;
  paymentReceivedEmail: boolean;
  paidInvoiceReceiptEmail: boolean;
  mailboxReply: boolean;
  renewalScheduleEmail: boolean;
  appointmentConfirmationEmail: boolean;
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
    renewalScheduleEmail: { type: channelSchema, default: () => ({}) },
    appointmentConfirmationEmail: { type: channelSchema, default: () => ({}) },
    appointmentConfirmationSms: { type: channelSchema, default: () => ({}) },
    renewalSchedule: {
      type: new Schema<IRenewalScheduleOptions>(
        {
          enabled: { type: Boolean, default: true },
          offerRecommendedDates: { type: Boolean, default: true },
        },
        { _id: false },
      ),
      default: () => ({ enabled: true, offerRecommendedDates: true }),
    },
    emailDelivery: {
      type: new Schema<IAutomatedEmailDelivery>(
        {
          enabled: { type: Boolean, default: true },
          workOrderCompleteEmail: { type: Boolean, default: true },
          paymentReceivedEmail: { type: Boolean, default: true },
          paidInvoiceReceiptEmail: { type: Boolean, default: true },
          mailboxReply: { type: Boolean, default: true },
          renewalScheduleEmail: { type: Boolean, default: true },
          appointmentConfirmationEmail: { type: Boolean, default: true },
        },
        { _id: false },
      ),
      default: () => ({
        enabled: true,
        workOrderCompleteEmail: true,
        paymentReceivedEmail: true,
        paidInvoiceReceiptEmail: true,
        mailboxReply: true,
        renewalScheduleEmail: true,
        appointmentConfirmationEmail: true,
      }),
    },
  },
  { timestamps: true },
);

export const AutomatedMessageSettings =
  mongoose.model<IAutomatedMessageSettings>(
    "AutomatedMessageSettings",
    automatedMessageSettingsSchema,
  );
