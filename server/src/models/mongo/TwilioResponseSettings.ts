import mongoose, { Schema, Document } from "mongoose";

export const TWILIO_RESPONSES_SLUG = "twilio-responses";

export interface ITwilioResponseSettings extends Document {
  slug: string;
  missedCallText: string;
  createdAt: Date;
  updatedAt: Date;
}

const twilioResponseSettingsSchema = new Schema<ITwilioResponseSettings>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: TWILIO_RESPONSES_SLUG,
    },
    missedCallText: {
      type: String,
      default: "",
      maxlength: 1600,
    },
  },
  { timestamps: true },
);

export const TwilioResponseSettings = mongoose.model<ITwilioResponseSettings>(
  "TwilioResponseSettings",
  twilioResponseSettingsSchema,
);
