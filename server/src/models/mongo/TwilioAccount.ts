import mongoose, { Schema, Document } from "mongoose";

export interface ITwilioAccount extends Document {
  accountSid: string;
  friendlyName: string;
  authTokenEncrypted: string;
  testAuthTokenEncrypted?: string;
  phoneNumbers: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const twilioAccountSchema = new Schema<ITwilioAccount>(
  {
    accountSid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    friendlyName: {
      type: String,
      required: true,
      trim: true,
    },
    authTokenEncrypted: {
      type: String,
      required: true,
    },
    testAuthTokenEncrypted: {
      type: String,
      default: undefined,
    },
    phoneNumbers: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export const TwilioAccount = mongoose.model<ITwilioAccount>(
  "TwilioAccount",
  twilioAccountSchema
);
