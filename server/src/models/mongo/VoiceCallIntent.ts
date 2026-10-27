import mongoose, { Schema, Document, Types } from "mongoose";

export interface IVoiceCallIntent extends Document {
  userRef: Types.ObjectId;
  twilioAccountRef: Types.ObjectId;
  accountSid: string;
  fromNumber: string;
  toNumber: string;
  contactRef: Types.ObjectId | null;
  customerRef: Types.ObjectId | null;
  threadRef: Types.ObjectId | null;
  conversationRef: Types.ObjectId | null;
  twilioCallSid: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const voiceCallIntentSchema = new Schema<IVoiceCallIntent>(
  {
    userRef: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    twilioAccountRef: {
      type: Schema.Types.ObjectId,
      ref: "TwilioAccount",
      required: true,
    },
    accountSid: { type: String, required: true },
    fromNumber: { type: String, required: true },
    toNumber: { type: String, required: true },
    contactRef: { type: Schema.Types.ObjectId, ref: "CustomerContact", default: null },
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    threadRef: { type: Schema.Types.ObjectId, ref: "MessageThread", default: null },
    conversationRef: {
      type: Schema.Types.ObjectId,
      ref: "InboxConversation",
      default: null,
    },
    twilioCallSid: { type: String, default: "" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

voiceCallIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VoiceCallIntent = mongoose.model<IVoiceCallIntent>(
  "VoiceCallIntent",
  voiceCallIntentSchema,
);
