import mongoose, { Schema, Document, Types } from "mongoose";

export interface IVoiceAgentPresence extends Document {
  userRef: Types.ObjectId;
  accountSid: string;
  identity: string;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const voiceAgentPresenceSchema = new Schema<IVoiceAgentPresence>(
  {
    userRef: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    accountSid: { type: String, required: true, trim: true },
    identity: { type: String, required: true, trim: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

voiceAgentPresenceSchema.index({ userRef: 1, accountSid: 1 }, { unique: true });
voiceAgentPresenceSchema.index({ accountSid: 1, lastSeenAt: -1 });
/** Drop browsers that stop heartbeating. Lookups also filter on lastSeenAt. */
voiceAgentPresenceSchema.index(
  { lastSeenAt: 1 },
  { expireAfterSeconds: 3 * 60 },
);

export const VoiceAgentPresence = mongoose.model<IVoiceAgentPresence>(
  "VoiceAgentPresence",
  voiceAgentPresenceSchema,
);
