import mongoose, { Document, Schema } from "mongoose";
import {
  invoiceBlocksSchema,
  type InvoiceBlock,
} from "../../schemas/invoiceTemplate.schema";
import {
  DEFAULT_INVOICE_TEMPLATE_NAME,
  defaultInvoiceBlocks,
} from "../../utils/defaultInvoiceBlocks";

export interface IInvoiceTemplate extends Document {
  name: string;
  isDefault: boolean;
  blocks: InvoiceBlock[];
  createdAt: Date;
  updatedAt: Date;
}

const invoiceTemplateSchema = new Schema<IInvoiceTemplate>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    isDefault: { type: Boolean, default: false },
    blocks: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true },
);

invoiceTemplateSchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

export const InvoiceTemplate = mongoose.model<IInvoiceTemplate>(
  "InvoiceTemplate",
  invoiceTemplateSchema,
);

function seededBlocks(): InvoiceBlock[] {
  return invoiceBlocksSchema.parse(defaultInvoiceBlocks());
}
export async function ensureDefaultInvoiceTemplate(): Promise<IInvoiceTemplate> {
  const existingDefault = await InvoiceTemplate.findOne({ isDefault: true });
  if (existingDefault) return existingDefault;

  const count = await InvoiceTemplate.countDocuments();
  if (count === 0) {
    return InvoiceTemplate.create({
      name: DEFAULT_INVOICE_TEMPLATE_NAME,
      isDefault: true,
      blocks: seededBlocks(),
    });
  }

  const first = await InvoiceTemplate.findOne().sort({ createdAt: 1 });
  if (!first) {
    return InvoiceTemplate.create({
      name: DEFAULT_INVOICE_TEMPLATE_NAME,
      isDefault: true,
      blocks: seededBlocks(),
    });
  }

  first.isDefault = true;
  await first.save();
  return first;
}

export async function seedInvoiceTemplates(): Promise<void> {
  await ensureDefaultInvoiceTemplate();
  console.log("Invoice templates seeded");
}
