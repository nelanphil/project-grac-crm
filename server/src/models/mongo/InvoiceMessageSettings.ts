import mongoose, { Schema, Document, Types } from "mongoose";

export const INVOICE_MESSAGE_SETTINGS_SLUG = "invoice-message";

export interface IInvoiceMessageSettings extends Document {
  slug: string;
  emailTemplateRef: Types.ObjectId | null;
  smsTemplateRef: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceMessageSettingsSchema = new Schema<IInvoiceMessageSettings>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      default: INVOICE_MESSAGE_SETTINGS_SLUG,
    },
    emailTemplateRef: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      default: null,
    },
    smsTemplateRef: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      default: null,
    },
  },
  { timestamps: true },
);

export const InvoiceMessageSettings = mongoose.model<IInvoiceMessageSettings>(
  "InvoiceMessageSettings",
  invoiceMessageSettingsSchema,
);
