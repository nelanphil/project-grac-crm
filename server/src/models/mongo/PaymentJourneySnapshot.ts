import mongoose, { Schema, Document, Types } from "mongoose";
import { JOURNEY_RETENTION_SECONDS } from "./PaymentJourneySession";

export const JOURNEY_SNAPSHOTS_PER_VISIT = 4;
export const JOURNEY_SNAPSHOT_MAX_BYTES = 300 * 1024;

export interface IPaymentJourneySnapshot extends Document {
  sessionId: string;
  invoiceRefs: Types.ObjectId[];
  step: string;
  takenAt: Date;
  mime: string;
  data: Buffer;
  width: number;
  height: number;
  createdAt: Date;
  updatedAt: Date;
}

const paymentJourneySnapshotSchema = new Schema<IPaymentJourneySnapshot>(
  {
    sessionId: { type: String, required: true },
    invoiceRefs: {
      type: [{ type: Schema.Types.ObjectId, ref: "Invoice" }],
      default: [],
    },
    step: { type: String, required: true },
    takenAt: { type: Date, required: true },
    mime: { type: String, default: "image/jpeg" },
    data: { type: Buffer, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { timestamps: true },
);

paymentJourneySnapshotSchema.index({ sessionId: 1, takenAt: 1 });
paymentJourneySnapshotSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: JOURNEY_RETENTION_SECONDS },
);

export const PaymentJourneySnapshot = mongoose.model<IPaymentJourneySnapshot>(
  "PaymentJourneySnapshot",
  paymentJourneySnapshotSchema,
);
