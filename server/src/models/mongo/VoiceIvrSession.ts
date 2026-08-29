import mongoose, { Schema, Document, Types } from "mongoose";

export type VoiceIvrStep =
  | "menu"
  | "gather_name"
  | "gather_address"
  | "gather_days"
  | "confirm_days";

export interface IVoiceIvrSession extends Document {
  callSid: string;
  accountSid: string;
  step: VoiceIvrStep;
  fromNumber: string;
  toNumber: string;
  customerRef?: Types.ObjectId | null;
  contactRef?: Types.ObjectId | null;
  isNewCustomer: boolean;
  speechName: string;
  speechAddress: string;
  preferredDays: string;
  gatherRetries: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const voiceIvrSessionSchema = new Schema<IVoiceIvrSession>(
  {
    callSid: { type: String, required: true, unique: true, index: true },
    accountSid: { type: String, required: true, index: true },
    step: {
      type: String,
      enum: [
        "menu",
        "gather_name",
        "gather_address",
        "gather_days",
        "confirm_days",
      ],
      default: "menu",
    },
    fromNumber: { type: String, default: "" },
    toNumber: { type: String, default: "" },
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    contactRef: {
      type: Schema.Types.ObjectId,
      ref: "CustomerContact",
      default: null,
    },
    isNewCustomer: { type: Boolean, default: false },
    speechName: { type: String, default: "" },
    speechAddress: { type: String, default: "" },
    preferredDays: { type: String, default: "" },
    gatherRetries: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

export const VoiceIvrSession = mongoose.model<IVoiceIvrSession>(
  "VoiceIvrSession",
  voiceIvrSessionSchema,
);
