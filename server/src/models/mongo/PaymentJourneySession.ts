import mongoose, { Schema, Document, Types } from "mongoose";

export const JOURNEY_ENTRIES = ["checkout", "pay", "invoice_view", "complete"] as const;
export type JourneyEntry = (typeof JOURNEY_ENTRIES)[number];

export const JOURNEY_EVENT_TYPES = [
  "step",
  "route",
  "click",
  "api",
  "console",
  "error",
  "lifecycle",
] as const;
export type JourneyEventType = (typeof JOURNEY_EVENT_TYPES)[number];

export const JOURNEY_OUTCOMES = [
  "redirected_to_square",
  "paid",
  "failed",
  "error",
] as const;
export type JourneyOutcome = (typeof JOURNEY_OUTCOMES)[number];

export const JOURNEY_MAX_EVENTS = 300;
export const JOURNEY_RETENTION_SECONDS = 90 * 24 * 60 * 60;

export interface IJourneyEvent {
  t: Date;
  type: JourneyEventType;
  detail: string;
  meta?: {
    status?: number;
    durationMs?: number;
    message?: string;
  } | null;
}

export interface IPaymentJourneySession extends Document {
  sessionId: string;
  entry: JourneyEntry;
  pages: JourneyEntry[];
  invoiceRefs: Types.ObjectId[];
  customerRef?: Types.ObjectId | null;
  userAgent: string;
  device: string;
  ip?: string | null;
  startedAt: Date;
  lastEventAt: Date;
  outcome?: JourneyOutcome | null;
  lastError?: string | null;
  eventCount: number;
  events: IJourneyEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const journeyEventSchema = new Schema<IJourneyEvent>(
  {
    t: { type: Date, required: true },
    type: { type: String, enum: JOURNEY_EVENT_TYPES, required: true },
    detail: { type: String, default: "" },
    meta: {
      type: new Schema(
        {
          status: { type: Number },
          durationMs: { type: Number },
          message: { type: String },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { _id: false },
);

const paymentJourneySessionSchema = new Schema<IPaymentJourneySession>(
  {
    sessionId: { type: String, required: true, unique: true },
    entry: { type: String, enum: JOURNEY_ENTRIES, required: true },
    pages: { type: [String], enum: JOURNEY_ENTRIES, default: [] },
    invoiceRefs: {
      type: [{ type: Schema.Types.ObjectId, ref: "Invoice" }],
      default: [],
    },
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    userAgent: { type: String, default: "" },
    device: { type: String, default: "" },
    ip: { type: String, default: null },
    startedAt: { type: Date, required: true },
    lastEventAt: { type: Date, required: true },
    outcome: { type: String, enum: JOURNEY_OUTCOMES, default: null },
    lastError: { type: String, default: null },
    eventCount: { type: Number, default: 0 },
    events: { type: [journeyEventSchema], default: [] },
  },
  { timestamps: true },
);

paymentJourneySessionSchema.index({ invoiceRefs: 1, startedAt: -1 });
paymentJourneySessionSchema.index(
  { lastEventAt: 1 },
  { expireAfterSeconds: JOURNEY_RETENTION_SECONDS },
);

export const PaymentJourneySession = mongoose.model<IPaymentJourneySession>(
  "PaymentJourneySession",
  paymentJourneySessionSchema,
);
