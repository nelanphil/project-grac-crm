import mongoose, { Schema, Document } from "mongoose";

export interface ISmsOptIn extends Document {
  phoneDigits: string;
  phone: string;
  source: string;
  consentedAt: Date;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const smsOptInSchema = new Schema<ISmsOptIn>(
  {
    phoneDigits: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true },
    source: { type: String, required: true },
    consentedAt: { type: Date, required: true },
    ip: { type: String, default: null },
  },
  { timestamps: true },
);

export const SmsOptIn = mongoose.model<ISmsOptIn>("SmsOptIn", smsOptInSchema);
