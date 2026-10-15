import { Types } from "mongoose";
import { Invoice } from "../models/mongo/Invoice";
import { ensureDefaultInvoiceTemplate } from "../models/mongo/InvoiceTemplate";
import {
  invoiceBlocksSchema,
  sanitizeInvoiceBlocks,
} from "../schemas/invoiceTemplate.schema";
import { loadInvoiceEmailContext } from "./paymentReceipt.service";
import {
  renderInvoiceTemplateFragment,
  type InvoiceTemplateEmailDocument,
} from "../utils/invoiceTemplateEmail";

export class InvoiceWidgetError extends Error {
  status: number;
  constructor(message: string, status = 404) {
    super(message);
    this.name = "InvoiceWidgetError";
    this.status = status;
  }
}

/** Matches the invoice shown in the template editor when no invoice is selected. */
export const SAMPLE_INVOICE_EMAIL_DOCUMENT: InvoiceTemplateEmailDocument = {
  number: "INV-1042",
  customerId: 1001,
  sourceType: "work_order",
  status: "open",
  issuedAt: "2026-03-15T00:00:00.000Z",
  dueDate: "2026-04-15T00:00:00.000Z",
  paidAt: null,
  paymentProvider: "square",
  lineItems: [
    { description: "Annual generator maintenance", amountCents: 18900 },
    { description: "Air filter", amountCents: 4200 },
  ],
  amountCents: 20600,
  originalAmountCents: 23100,
  discountCode: "SPRING",
  discountCents: 2500,
  taxRatePercent: 0,
  taxCents: 0,
  customer: {
    name: "Jordan Hale",
    address: "18 Palm Court",
    city: "Orlando",
    state: "FL",
    zip: "32801",
    phone: "(407) 555-0148",
    email: "jordan@example.com",
  },
  serviceAddress: {
    label: "Lake house",
    address: "420 Shoreline Drive",
    city: "Winter Park",
    state: "FL",
    zip: "32789",
  },
  workOrderNotes: [
    {
      content: "Replaced the air filter. Next service is due in 12 months.",
    },
  ],
};

async function renderDefaultInvoiceWidget(
  invoice: InvoiceTemplateEmailDocument,
): Promise<{ html: string; text: string }> {
  const template = await ensureDefaultInvoiceTemplate();
  const parsed = invoiceBlocksSchema.safeParse(template.blocks);
  if (!parsed.success) {
    throw new InvoiceWidgetError("Default invoice template is invalid", 500);
  }
  return renderInvoiceTemplateFragment({
    blocks: sanitizeInvoiceBlocks(parsed.data),
    invoice,
  });
}

/**
 * HTML for {{invoice}}. A real invoice id is required to send.
 * Preview with no invoice uses the sample document.
 * A send with the token and no invoice omits the widget.
 */
export async function resolveInvoiceWidget(input: {
  invoiceId?: string | null;
  sampleFallback: boolean;
}): Promise<{ html: string; text: string }> {
  const invoiceId = input.invoiceId?.trim();
  if (invoiceId) {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new InvoiceWidgetError("Invoice not found", 404);
    }
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      throw new InvoiceWidgetError("Invoice not found", 404);
    }
    const { document } = await loadInvoiceEmailContext(invoice);
    return renderDefaultInvoiceWidget(document);
  }
  if (input.sampleFallback) {
    return renderDefaultInvoiceWidget(SAMPLE_INVOICE_EMAIL_DOCUMENT);
  }
  return { html: "", text: "" };
}
