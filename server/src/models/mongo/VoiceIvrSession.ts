import mongoose, { Schema, Document, Types } from "mongoose";

export type VoiceIvrStep =
  | "menu"
  | "gather_name"
  | "offer_slots"
  | "confirm_slot";

export interface IVoiceIvrOfferedSlot {
  start: Date;
  end: Date;
  assignedUserRef: string;
  spokenLabel: string;
}

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
  offeredSlots: IVoiceIvrOfferedSlot[];
  selectedSlotIndex: number | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const offeredSlotSchema = new Schema<IVoiceIvrOfferedSlot>(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    assignedUserRef: { type: String, required: true },
    spokenLabel: { type: String, required: true },
  },
  { _id: false },
);

const voiceIvrSessionSchema = new Schema<IVoiceIvrSession>(
  {
    callSid: { type: String, required: true, unique: true, index: true },
    accountSid: { type: String, required: true, index: true },
    step: {
      type: String,
      enum: ["menu", "gather_name", "offer_slots", "confirm_slot"],
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
    offeredSlots: { type: [offeredSlotSchema], default: [] },
    selectedSlotIndex: { type: Number, default: null },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

export const VoiceIvrSession = mongoose.model<IVoiceIvrSession>(
  "VoiceIvrSession",
  voiceIvrSessionSchema,
);
