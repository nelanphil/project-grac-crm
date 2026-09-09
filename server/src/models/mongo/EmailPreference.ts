import mongoose, { Schema, Document } from "mongoose";

export interface IEmailPreference extends Document {
  email: string;
  generalNotifications: boolean;
  billingAlerts: boolean;
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
  },
  { timestamps: true },
);

export const EmailPreference = mongoose.model<IEmailPreference>(
  "EmailPreference",
  emailPreferenceSchema,
);
