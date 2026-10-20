import mongoose, { Schema, Types } from "mongoose";

export type CheckoutLinkItem = {
  id: string;
  kind: "invoice" | "work_order";
  amountCents: number;
};

export interface ICheckoutLink {
  tokenHash: string;
  customerRef: Types.ObjectId;
  items: CheckoutLinkItem[];
  invoiceOnly: boolean;
  expiresAt: Date;
}

const schema = new Schema<ICheckoutLink>({
  tokenHash: { type: String, required: true, unique: true },
  customerRef: { type: Schema.Types.ObjectId, required: true },
  items: {
    type: [{
      _id: false,
      id: { type: String, required: true },
      kind: { type: String, enum: ["invoice", "work_order"], required: true },
      amountCents: { type: Number, required: true, min: 0 },
    }],
    required: true,
  },
  invoiceOnly: { type: Boolean, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

export const CheckoutLink = mongoose.model<ICheckoutLink>("CheckoutLink", schema);
