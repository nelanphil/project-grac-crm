import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveChannelCopy } from "../utils/automatedMessageCopy";
import type { InvoiceTemplateEmailDocument } from "../utils/invoiceTemplateEmail";
import {
  automatedTestPayUrl,
  automatedTestViewUrl,
  composeAutomatedMessageTest,
  type AutomatedTestRenderers,
} from "./automatedMessageTest.service";

const fallback = { subject: "Fallback subject", body: "Fallback body" };

function renderers(): AutomatedTestRenderers & {
  documents: InvoiceTemplateEmailDocument[];
  widgets: InvoiceTemplateEmailDocument[];
} {
  const documents: InvoiceTemplateEmailDocument[] = [];
  const widgets: InvoiceTemplateEmailDocument[] = [];
  return {
    documents,
    widgets,
    renderDocument: async (input) => {
      documents.push(input.invoice);
      return {
        html: `DOC:${input.invoice.status}:${input.invoice.number}:${input.viewUrl ?? ""}`,
        text: `DOC:${input.invoice.status}`,
      };
    },
    renderWidget: async (invoice) => {
      widgets.push(invoice);
      return {
        html: `WIDGET:${invoice.status}:${invoice.number}`,
        text: `WIDGET:${invoice.status}`,
      };
    },
  };
}

describe("composeAutomatedMessageTest", () => {
  it("renders a payment-received email from the paid invoice", async () => {
    const fake = renderers();
    const resolved = resolveChannelCopy({
      kind: "receipt-email",
      saved: {
        mode: "custom",
        subject: "Payment received for invoice {{invoice_number}}",
        body: "",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest(
      {
        channel: "paymentReceivedEmail",
        resolved,
        recipient: "ada@example.com",
      },
      fake,
    );
    assert.equal(composed.invoiceStatus, "paid");
    assert.equal(composed.paymentUrl, null);
    assert.equal(fake.documents.length, 1);
    assert.equal(fake.documents[0]?.status, "paid");
    assert.equal(fake.widgets.length, 0);
    assert.equal(composed.subject, "[Test] Payment received for invoice INV-1042");
    assert.match(composed.html, /^DOC:paid:INV-1042:$/);
  });

  it("renders a paid-invoice receipt email from the paid invoice and a view link", async () => {
    const fake = renderers();
    const resolved = resolveChannelCopy({
      kind: "receipt-email",
      saved: {
        mode: "custom",
        subject: "Invoice {{invoice_number}}",
        body: "",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest(
      {
        channel: "paidInvoiceReceiptEmail",
        resolved,
        recipient: "ada@example.com",
      },
      fake,
    );
    assert.equal(composed.invoiceStatus, "paid");
    assert.equal(composed.paymentUrl, null);
    assert.equal(fake.documents[0]?.status, "paid");
    assert.equal(
      composed.html,
      `DOC:paid:INV-1042:${automatedTestViewUrl()}`,
    );
  });

  it("renders a template receipt with the paid invoice widget", async () => {
    const fake = renderers();
    const resolved = resolveChannelCopy({
      kind: "receipt-email",
      saved: { mode: "template", subject: "ignored", body: "ignored" },
      selectedTemplate: {
        subject: "Paid {{invoice_number}}",
        body: "<p>Hi {{first_name}},</p><p>{{invoice}}</p>",
      },
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest(
      {
        channel: "paymentReceivedEmail",
        resolved,
        recipient: "ada@example.com",
      },
      fake,
    );
    assert.equal(fake.documents.length, 0);
    assert.equal(fake.widgets[0]?.status, "paid");
    assert.match(composed.html, /WIDGET:paid:INV-1042/);
    assert.equal(composed.paymentUrl, null);
    assert.match(composed.text, /Jordan/);
  });

  it("renders a work-order email from the open invoice and a sample pay link", async () => {
    const fake = renderers();
    const resolved = resolveChannelCopy({
      kind: "email",
      saved: {
        mode: "custom",
        subject: "Invoice {{invoice_number}}",
        body: "<p>Hi {{first_name}},</p><p>{{invoice}}</p>",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest(
      {
        channel: "workOrderCompleteEmail",
        resolved,
        recipient: "ada@example.com",
      },
      fake,
    );
    assert.equal(composed.invoiceStatus, "open");
    assert.equal(composed.paymentUrl, automatedTestPayUrl());
    assert.equal(fake.documents.length, 0);
    assert.equal(fake.widgets[0]?.status, "open");
    assert.equal(composed.html.includes("WIDGET:open:INV-1042"), true);
    assert.equal(composed.html.includes(automatedTestPayUrl()), true);
    assert.equal(composed.subject, "[Test] Invoice INV-1042");
  });

  it("appends a sample pay link to a work-order text that omits the token", async () => {
    const resolved = resolveChannelCopy({
      kind: "sms",
      saved: {
        mode: "custom",
        subject: "",
        body: "Hi {{first_name}}, invoice {{invoice_number}} is ready.",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest({
      channel: "workOrderCompleteSms",
      resolved,
      recipient: "8135550100",
    });
    assert.equal(composed.paymentUrl, automatedTestPayUrl());
    assert.equal(composed.smsBody.includes("Jordan"), true);
    assert.equal(composed.smsBody.includes("INV-1042"), true);
    assert.equal(
      composed.smsBody.includes(`Pay: ${automatedTestPayUrl()}`),
      true,
    );
  });

  it("sends the paid-invoice text without a payment link", async () => {
    const resolved = resolveChannelCopy({
      kind: "sms",
      saved: {
        mode: "custom",
        subject: "",
        body: "Hi {{first_name}}, thank you for your payment. View or download invoice {{invoice_number}}: {{invoice_view_url}}",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest({
      channel: "paidInvoiceReceiptSms",
      resolved,
      recipient: "8135550100",
    });
    assert.equal(composed.paymentUrl, null);
    assert.equal(composed.invoiceStatus, null);
    assert.equal(composed.smsBody.includes("INV-1042"), true);
    assert.equal(composed.smsBody.includes(automatedTestViewUrl()), true);
    assert.equal(composed.smsBody.includes("Pay:"), false);
  });

  it("wraps a mailbox reply around a sample quoted message", async () => {
    const resolved = resolveChannelCopy({
      kind: "mailbox",
      saved: {
        mode: "custom",
        subject: "",
        body: "<p>Hi {{first_name}}, we received your email.</p>",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest({
      channel: "mailboxReply",
      resolved,
      recipient: "ada@example.com",
    });
    assert.equal(composed.subject, "Re: [Test] Generator service");
    assert.equal(composed.paymentUrl, null);
    assert.equal(composed.invoiceStatus, null);
    assert.match(composed.html, /Hi Jordan, we received your email/);
    assert.match(
      composed.html,
      /Can you confirm the service appointment for the generator\?/,
    );
    assert.match(composed.html, /wrote:/);
  });

  it("drops the test label for a customer-facing email and mailbox reply", async () => {
    const email = resolveChannelCopy({
      kind: "email",
      saved: {
        mode: "custom",
        subject: "Invoice {{invoice_number}}",
        body: "<p>Hi {{first_name}},</p>",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const composed = await composeAutomatedMessageTest(
      {
        channel: "workOrderCompleteEmail",
        resolved: email,
        recipient: "ada@example.com",
        testLabel: false,
      },
      renderers(),
    );
    assert.equal(composed.subject, "Invoice INV-1042");

    const mailbox = resolveChannelCopy({
      kind: "mailbox",
      saved: {
        mode: "custom",
        subject: "",
        body: "<p>Hi {{first_name}}, we received your email.</p>",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const reply = await composeAutomatedMessageTest({
      channel: "mailboxReply",
      resolved: mailbox,
      recipient: "ada@example.com",
      testLabel: false,
    });
    assert.equal(reply.subject, "Re: Generator service");
  });

  it("leaves the renewal date spot blank when recommended dates are off", async () => {
    const resolved = resolveChannelCopy({
      kind: "email",
      saved: {
        mode: "custom",
        subject: "Let's schedule your {{contract_type}} visit",
        body: "<p>Hi {{first_name}},</p>{{recommended_dates}}",
      },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback,
    });
    const hidden = await composeAutomatedMessageTest({
      channel: "renewalScheduleEmail",
      resolved,
      recipient: "ada@example.com",
      testLabel: false,
      includeRecommendedDates: false,
    });
    assert.equal(hidden.subject, "Let's schedule your ASC visit");
    assert.equal(hidden.html.includes("Choose this day"), false);

    const shown = await composeAutomatedMessageTest({
      channel: "renewalScheduleEmail",
      resolved,
      recipient: "ada@example.com",
      testLabel: false,
      includeRecommendedDates: true,
    });
    assert.equal(shown.subject, "Let's schedule your ASC visit");
    assert.match(shown.html, /Choose this day/);
  });
});
