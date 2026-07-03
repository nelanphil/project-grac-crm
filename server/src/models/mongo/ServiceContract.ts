import mongoose, { Schema, Document, Types } from "mongoose";

export interface IServiceContract extends Document {
  customerId: number;
  customerRef?: Types.ObjectId;
  contractDate: Date | null;
  description: string;
  sourceWorkOrderRef?: Types.ObjectId;
  userId?: number;
  createdAt: Date;
  updatedAt: Date;
}

const serviceContractSchema = new Schema<IServiceContract>(
  {
    customerId: { type: Number, index: true, required: true },
    customerRef: { type: Schema.Types.ObjectId, ref: "Customer" },
    contractDate: { type: Date, default: null },
    description: { type: String, default: "" },
    sourceWorkOrderRef: { type: Schema.Types.ObjectId, ref: "WorkOrder" },
    userId: { type: Number },
  },
  { timestamps: true },
);

serviceContractSchema.index({ customerId: 1, contractDate: -1 });
serviceContractSchema.index({ customerRef: 1 });

export const ServiceContract = mongoose.model<IServiceContract>(
  "ServiceContract",
  serviceContractSchema,
);
