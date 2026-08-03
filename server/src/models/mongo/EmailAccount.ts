import mongoose, { Schema, Document } from "mongoose";

export const EMAIL_ACCOUNT_ROLES = [
  "general_notifications",
  "billing_notifications",
] as const;

export type EmailAccountRole = (typeof EMAIL_ACCOUNT_ROLES)[number];

export interface IEmailAccount extends Document {
  friendlyName: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordEncrypted: string;
  fromName: string;
  fromEmail: string;
  isActive: boolean;
  roles: EmailAccountRole[];
  createdAt: Date;
  updatedAt: Date;
}

const emailAccountSchema = new Schema<IEmailAccount>(
  {
    friendlyName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    host: {
      type: String,
      required: true,
      trim: true,
    },
    port: {
      type: Number,
      required: true,
      default: 587,
    },
    secure: {
      type: Boolean,
      default: false,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    passwordEncrypted: {
      type: String,
      required: true,
    },
    fromName: {
      type: String,
      required: true,
      trim: true,
    },
    fromEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    roles: {
      type: [String],
      enum: EMAIL_ACCOUNT_ROLES,
      default: [],
      index: true,
    },
  },
  { timestamps: true }
);

export const EmailAccount = mongoose.model<IEmailAccount>(
  "EmailAccount",
  emailAccountSchema
);
