import mongoose, { Schema, Document } from "mongoose";

export const EMAIL_UNSUBSCRIBE_SOURCES = [
  "",
  "one_click",
  "preferences_page",
  "settings",
] as const;

export type EmailUnsubscribeSource = (typeof EMAIL_UNSUBSCRIBE_SOURCES)[number];

export interface IEmailPreference extends Document {
  email: string;
  generalNotifications: boolean;
  billingAlerts: boolean;
  /** Recipient's mail app hides the branded layout; send the simple one. */
  simpleFormat: boolean;
  /** Set when a channel is turned off. Cleared once both channels are on. */
  unsubscribedAt: Date | null;
  unsubscribeSource: EmailUnsubscribeSource;
  createdAt: Date;
  updatedAt: Date;
}

const emailPreferenceSchema = new Schema<IEmailPreference>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    generalNotifications: { type: Boolean, default: true },
    billingAlerts: { type: Boolean, default: true },
    simpleFormat: { type: Boolean, default: false },
    unsubscribedAt: { type: Date, default: null },
    unsubscribeSource: {
      type: String,
      enum: EMAIL_UNSUBSCRIBE_SOURCES,
      default: "",
    },
  },
  { timestamps: true },
);

export const EmailPreference = mongoose.model<IEmailPreference>(
  "EmailPreference",
  emailPreferenceSchema,
);
