import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerContact, InvoiceItem } from "@/lib/api";
import {
  hasValidContactEmail,
  invoiceEmailBodyHtml,
  invoiceEmailSubject,
  isInvoicePayable,
  messagingContactFromInvoice,
  pickInvoiceEmailContact,
} from "./invoiceEmailHtml";

function contact(partial: Partial<CustomerContact> & { _id: string }): CustomerContact {
  return {
    customerRef: "cust-1",
    first: "Ada",
    last: "Lovelace",
    phone: "",
    email: "",
    label: "",
    isPrimary: false,
    userRef: null,
    legacyCustomerId: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

const invoice = {
  _id: "inv-1",
  number: "INV-100",
  customerId: 1,
  customerRef: "cust-1",
  sourceType: "manual",
  contractRef: null,
  workOrderRef: null,
  templateRef: null,
  lineItems: [
    { description: "Annual service", amountCents: 25000 },
    { description: "Filter <special>", amountCents: 1500 },
  ],
  amountCents: 25000,
  originalAmountCents: 26500,
  discountCode: "SAVE",
  discountCents: 1500,
  currency: "usd",
  status: "open",
  dueDate: "2026-10-01T00:00:00.000Z",
  issuedAt: "2026-09-01T00:00:00.000Z",
  paidAt: null,
  paymentProvider: null,
  providerCheckoutId: null,
  providerOrderId: null,
  providerPaymentId: null,
  hasPayLink: false,
  payTokenExpiresAt: null,
  metadata: {},
  createdAt: "",
  updatedAt: "",
  customer: {
    name: "Ada Lovelace",
    accountNumber: 1,
    address: "1 Main St",
    city: "Orlando",
    state: "FL",
    zip: "32801",
    phone: "3866318982",
    email: "ada@example.com",
  },
} as InvoiceItem;

describe("invoiceEmailHtml", () => {
  it("builds a subject from the invoice number", () => {
    assert.equal(invoiceEmailSubject(invoice), "Invoice INV-100");
  });

  it("embeds invoice details without tables and escapes HTML", () => {
    const html = invoiceEmailBodyHtml(invoice);
    assert.match(html, /Hi \{\{first_name\}\}/);
    assert.match(html, /<h2>Invoice INV-100<\/h2>/);
    assert.match(html, /Annual service/);
    assert.match(html, /Filter &lt;special&gt;/);
    assert.doesNotMatch(html, /<table/);
    assert.match(html, /Total due:/);
    assert.match(html, /Discount SAVE/);
    assert.match(html, /Tax/);
    assert.match(html, /Subtotal:/);
  });

  it("includes visible work order notes without HTML injection", () => {
    const html = invoiceEmailBodyHtml({
      ...invoice,
      workOrderNotes: [
        {
          _id: "n1",
          workOrderRef: "wo-1",
          content: "Replaced filter <script>",
          visibleToCustomer: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    assert.match(html, /<p><strong>Notes<\/strong><\/p>/);
    assert.match(html, /Replaced filter &lt;script&gt;/);
  });

  it("treats open and failed invoices as payable", () => {
    assert.equal(isInvoicePayable({ status: "open" }), true);
    assert.equal(isInvoicePayable({ status: "failed" }), true);
    assert.equal(isInvoicePayable({ status: "paid" }), false);
  });

  it("picks the preferred or primary contact with a valid email", () => {
    assert.equal(hasValidContactEmail("not-an-email"), false);
    const contacts = [
      contact({ _id: "c1", email: "bad", isPrimary: true }),
      contact({ _id: "c2", email: "second@example.com" }),
      contact({ _id: "c3", email: "primary@example.com", isPrimary: true }),
    ];
    assert.equal(pickInvoiceEmailContact(contacts)?._id, "c3");
    assert.equal(pickInvoiceEmailContact(contacts, "c2")?._id, "c2");
  });

  it("maps a customer contact onto a messaging recipient", () => {
    const selected = messagingContactFromInvoice(
      contact({
        _id: "c3",
        email: "primary@example.com",
        isPrimary: true,
      }),
      invoice,
    );
    assert.equal(selected.email, "primary@example.com");
    assert.equal(selected.customer.accountName, "Ada Lovelace");
    assert.equal(selected.hasPayableInvoice, true);
  });
});
