import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type InvoiceBlock,
  invoiceBlocksSchema,
} from "../schemas/invoiceTemplate.schema";
import { defaultInvoiceBlocks } from "./defaultInvoiceBlocks";
import {
  renderInvoiceTemplateEmail,
  type InvoiceTemplateEmailDocument,
} from "./invoiceTemplateEmail";

const paidAt = new Date(2026, 0, 15, 12);

function paidInvoice(
  patch: Partial<InvoiceTemplateEmailDocument> = {},
): InvoiceTemplateEmailDocument {
  return {
    number: "INV-1042",
    customerId: 42,
    sourceType: "work_order",
    status: "paid",
    issuedAt: new Date(2026, 0, 1, 12),
    dueDate: new Date(2026, 0, 15, 12),
    paidAt,
    paymentProvider: "square",
    lineItems: [{ description: "Annual service", amountCents: 15000 }],
    amountCents: 16050,
    originalAmountCents: null,
    discountCode: null,
    discountCents: 0,
    taxRatePercent: 7,
    taxCents: 1050,
    customer: {
      name: "Harbor House",
      address: "10 Bay Street",
      city: "Ormond Beach",
      state: "FL",
      zip: "32174",
      phone: "(386) 555-0100",
      email: "harbor@example.com",
    },
    serviceAddress: {
      address: "10 Bay Street",
      city: "Ormond Beach",
      state: "FL",
      zip: "32174",
    },
    workOrderNotes: [],
    ...patch,
  };
}

function withHeadingLabel(blocks: InvoiceBlock[], label: string): InvoiceBlock[] {
  return blocks.map((block) => {
    if (block.type === "heading") return { ...block, label };
    if (block.type !== "columns") return block;
    return {
      ...block,
      left: block.left.map((child) =>
        child.type === "heading" ? { ...child, label } : child,
      ),
      right: block.right.map((child) =>
        child.type === "heading" ? { ...child, label } : child,
      ),
    };
  });
}

describe("renderInvoiceTemplateEmail", () => {
  const blocks = invoiceBlocksSchema.parse(defaultInvoiceBlocks());

  it("fills the current template with the paid invoice", () => {
    const rendered = renderInvoiceTemplateEmail({
      blocks,
      invoice: paidInvoice(),
      unsubscribeUrl: "https://example.com/unsubscribe/?token=abc",
    });
    const paidLabel = paidAt.toLocaleDateString("en-US");

    assert.match(rendered.html, /INV-1042/);
    assert.match(rendered.html, /Annual service/);
    assert.match(rendered.html, /\$150\.00/);
    assert.match(rendered.html, /\$160\.50/);
    assert.match(rendered.html, new RegExp(paidLabel.replace(/\//g, "\\/")));
    assert.match(rendered.html, /Generator Maintenance of Florida/);
    assert.match(rendered.html, /Payment method/);
    assert.match(rendered.html, /square/);
    assert.doesNotMatch(rendered.html, /Service address/);
    assert.match(rendered.text, /Annual service/);
    assert.match(rendered.text, /Generator Maintenance of Florida/);
    assert.match(
      rendered.html,
      /https:\/\/example\.com\/unsubscribe\/\?token=abc/,
    );
    assert.match(rendered.text, /Unsubscribe: https:\/\/example.com\/unsubscribe\/\?token=abc/);
  });

  it("uses the blocks passed in, including a renamed heading", () => {
    const rendered = renderInvoiceTemplateEmail({
      blocks: withHeadingLabel(blocks, "Paid receipt"),
      invoice: paidInvoice(),
    });

    assert.match(rendered.html, /Paid receipt/);
    assert.doesNotMatch(rendered.html, />Invoice</);
    assert.match(rendered.text, /Paid receipt/);
  });

  it("shows a service address only when it differs from the bill-to address", () => {
    const same = renderInvoiceTemplateEmail({
      blocks,
      invoice: paidInvoice(),
    });
    const different = renderInvoiceTemplateEmail({
      blocks,
      invoice: paidInvoice({
        serviceAddress: {
          label: "Pump house",
          address: "88 Canal Road",
          city: "Port Orange",
          state: "FL",
          zip: "32127",
        },
      }),
    });

    assert.doesNotMatch(same.html, /88 Canal Road/);
    assert.match(different.html, /Service address/);
    assert.match(different.html, /Pump house/);
    assert.match(different.html, /88 Canal Road/);
    assert.match(different.text, /88 Canal Road/);
  });

  it("includes notes and a discount when the invoice has them", () => {
    const rendered = renderInvoiceTemplateEmail({
      blocks,
      invoice: paidInvoice({
        originalAmountCents: 16050,
        discountCode: "SAVE10",
        discountCents: 1000,
        amountCents: 15050,
        workOrderNotes: [{ content: "Replaced the battery.\nTested under load." }],
      }),
    });

    assert.match(rendered.html, /Replaced the battery\.<br \/>Tested under load\./);
    assert.match(rendered.html, /SAVE10/);
    assert.match(rendered.html, /−\$10\.00/);
    assert.match(rendered.text, /Replaced the battery\./);
  });

  it("strips unsafe markup from text blocks", () => {
    const rendered = renderInvoiceTemplateEmail({
      blocks: [
        {
          id: "note",
          type: "text",
          align: "left",
          tone: "body",
          html: '<script>alert(1)</script><p>Thanks for paying.</p>',
        },
      ],
      invoice: paidInvoice(),
    });

    assert.doesNotMatch(rendered.html, /<script/i);
    assert.match(rendered.html, /Thanks for paying\./);
  });
});
