import mongoose, { Schema, Document, Types } from "mongoose";

export const SMS_OPT_OUT_SOURCES = [
  "",
  "keyword",
  "staff_confirmed",
  "settings",
] as const;

export type SmsOptOutSource = (typeof SMS_OPT_OUT_SOURCES)[number];

export interface ISmsPreference extends Document {
  /** Last 10 digits of the mobile number. */
  phoneDigits: string;
  /** False after STOP, a confirmed opt-out, or the customer turning texts off. */
  textNotifications: boolean;
  optedOutAt: Date | null;
  optOutSource: SmsOptOutSource;
  optOutMessageRef: Types.ObjectId | null;
  optedOutByUserRef: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const smsPreferenceSchema = new Schema<ISmsPreference>(
  {
    phoneDigits: { type: String, required: true, unique: true, index: true },
    textNotifications: { type: Boolean, default: true },
    optedOutAt: { type: Date, default: null },
    optOutSource: {
      type: String,
      enum: SMS_OPT_OUT_SOURCES,
      default: "",
    },
    optOutMessageRef: {
      type: Schema.Types.ObjectId,
      ref: "TwilioCommunication",
      default: null,
    },
    optedOutByUserRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

export const SmsPreference = mongoose.model<ISmsPreference>(
  "SmsPreference",
  smsPreferenceSchema,
);
