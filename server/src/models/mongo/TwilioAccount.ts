import mongoose, { Schema, Document } from "mongoose";
import {
  normalizeStoredPhoneLine,
  TwilioPhoneLine,
} from "../../utils/twilioPhoneLines";

export interface ITwilioAccount extends Document {
  accountSid: string;
  friendlyName: string;
  authTokenEncrypted: string;
  testAccountSid?: string;
  testAuthTokenEncrypted?: string;
  phoneNumbers: TwilioPhoneLine[];
  isActive: boolean;
  /** Twilio <Say> voice used for IVR, voicemail, and outbound calls. */
  sayVoice: string;
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
    testAccountSid: {
      type: String,
      trim: true,
      default: undefined,
    },
    testAuthTokenEncrypted: {
      type: String,
      default: undefined,
    },
    phoneNumbers: {
      type: [
        new Schema(
          {
            phoneNumber: { type: String, required: true, trim: true },
            label: { type: String, trim: true, default: "" },
            twilioFriendlyName: { type: String, trim: true, default: "" },
            incomingSid: { type: String, trim: true, default: "" },
            sms: { type: Boolean, default: false },
            mms: { type: Boolean, default: false },
            voice: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sayVoice: {
      type: String,
      trim: true,
      default: "Polly.Joanna",
    },
  },
  { timestamps: true },
);

export const TwilioAccount = mongoose.model<ITwilioAccount>(
  "TwilioAccount",
  twilioAccountSchema,
);

let phoneLineMigration: Promise<void> | null = null;

/** Convert legacy `phoneNumbers: string[]` docs before mongoose casts them. */
export function ensureTwilioPhoneLineShape(): Promise<void> {
  if (!phoneLineMigration) {
    phoneLineMigration = migrateTwilioPhoneNumberStrings().catch((err) => {
      phoneLineMigration = null;
      throw err;
    });
  }
  return phoneLineMigration;
}

async function migrateTwilioPhoneNumberStrings(): Promise<void> {
  const col = TwilioAccount.collection;
  const cursor = col.find({ "phoneNumbers.0": { $type: "string" } });
  for await (const doc of cursor) {
    const raw = Array.isArray(doc.phoneNumbers) ? doc.phoneNumbers : [];
    const phoneNumbers = raw
      .map((entry) => normalizeStoredPhoneLine(entry))
      .filter((line): line is TwilioPhoneLine => Boolean(line));
    await col.updateOne({ _id: doc._id }, { $set: { phoneNumbers } });
  }
}
