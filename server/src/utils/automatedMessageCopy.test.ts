import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyInvoiceTokens,
  formatMailboxReplyHtml,
  resolveChannelCopy,
} from "./automatedMessageCopy";
import { renderMessageTemplate } from "./messageTemplate";

const fallback = {
  subject: "Invoice {{invoice_number}}",
  body: "<p>Hi {{first_name}},</p><p>{{invoice}}</p>",
};

describe("resolveChannelCopy", () => {
  it("uses a live template when that mode is saved", () => {
    const resolved = resolveChannelCopy({
      kind: "email",
      saved: { mode: "template", subject: "Custom", body: "<p>Custom</p>" },
      selectedTemplate: {
        subject: "Template subject",
        body: "<p>Template body</p>",
        emailChrome: {
          headerHtml: "<div>Header</div>",
          footerHtml: "<div>Footer</div>",
          unsubscribeNote: "Note",
        },
      },
      legacyTemplate: { subject: "Legacy", body: "<p>Legacy</p>" },
      fallback,
    });
    assert.equal(resolved.subject, "Template subject");
    assert.equal(resolved.body, "<p>Template body</p>");
    assert.equal(resolved.emailChrome?.headerHtml, "<div>Header</div>");
    assert.equal(resolved.useInvoiceDocument, false);
  });

  it("uses custom wording and ignores a selected template", () => {
    const resolved = resolveChannelCopy({
      kind: "sms",
      saved: { mode: "custom", subject: "", body: "Thanks {{first_name}}" },
      selectedTemplate: { subject: "", body: "Template text" },
      legacyTemplate: { subject: "", body: "Legacy text" },
      fallback: { subject: "", body: "Fallback text" },
    });
    assert.equal(resolved.body, "Thanks {{first_name}}");
    assert.equal(resolved.useInvoiceDocument, false);
  });

  it("falls back to custom wording when the saved template is missing", () => {
    const resolved = resolveChannelCopy({
      kind: "email",
      saved: {
        mode: "template",
        subject: "Kept subject",
        body: "<p>Kept body</p>",
      },
      selectedTemplate: null,
      legacyTemplate: { subject: "Legacy", body: "<p>Legacy</p>" },
      fallback,
    });
    assert.equal(resolved.subject, "Kept subject");
    assert.equal(resolved.body, "<p>Kept body</p>");
  });

  it("uses the original copy when a missing template has no custom wording", () => {
    const resolved = resolveChannelCopy({
      kind: "sms",
      saved: { mode: "template", subject: "", body: "   " },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback: { subject: "", body: "Original text" },
    });
    assert.equal(resolved.body, "Original text");
  });

  it("keeps the invoice default template until automated settings are saved", () => {
    const resolved = resolveChannelCopy({
      kind: "email",
      saved: null,
      selectedTemplate: null,
      legacyTemplate: {
        subject: "Default template",
        body: "<p>From the invoice default</p>",
      },
      fallback,
    });
    assert.equal(resolved.subject, "Default template");
    assert.equal(resolved.body, "<p>From the invoice default</p>");
  });

  it("uses the hardcoded copy when nothing has been saved", () => {
    const resolved = resolveChannelCopy({
      kind: "mailbox",
      saved: null,
      selectedTemplate: null,
      legacyTemplate: { subject: "Ignored", body: "<p>Ignored</p>" },
      fallback: { subject: "", body: "<p>Thanks for your email.</p>" },
    });
    assert.equal(resolved.body, "<p>Thanks for your email.</p>");
  });

  it("keeps the invoice document for a custom receipt subject", () => {
    const resolved = resolveChannelCopy({
      kind: "receipt-email",
      saved: { mode: "custom", subject: "Paid {{invoice_number}}", body: "" },
      selectedTemplate: null,
      legacyTemplate: null,
      fallback: { subject: "Invoice {{invoice_number}}", body: "" },
    });
    assert.equal(resolved.subject, "Paid {{invoice_number}}");
    assert.equal(resolved.body, "");
    assert.equal(resolved.useInvoiceDocument, true);
  });

  it("sends a receipt template's subject and body instead of the invoice document", () => {
    const resolved = resolveChannelCopy({
      kind: "receipt-email",
      saved: { mode: "template", subject: "Paid", body: "" },
      selectedTemplate: {
        subject: "Payment received",
        body: "<p>{{invoice}}</p>",
      },
      legacyTemplate: null,
      fallback: { subject: "Invoice {{invoice_number}}", body: "" },
    });
    assert.equal(resolved.subject, "Payment received");
    assert.equal(resolved.body, "<p>{{invoice}}</p>");
    assert.equal(resolved.useInvoiceDocument, false);
  });
});

describe("applyInvoiceTokens", () => {
  const due = new Date(2026, 9, 28, 12, 0, 0);

  it("fills invoice number, total, due date, and view url", () => {
    const sms = applyInvoiceTokens(
      "Invoice {{invoice_number}} for {{invoice_total}}. Due {{due_date}}. {{invoice_view_url}}",
      {
        number: "INV-88",
        amountCents: 15050,
        dueDate: due,
        viewUrl: "https://example.com/invoice/?t=abc",
      },
    );
    assert.match(sms, /Invoice INV-88/);
    assert.match(sms, /\$150\.50/);
    assert.match(sms, /Due Oct 28, 2026/);
    assert.match(sms, /https:\/\/example\.com\/invoice\/\?t=abc/);
  });

  it("drops an empty due sentence and escapes html values", () => {
    const html = applyInvoiceTokens(
      "<p>Invoice <strong>{{invoice_number}}</strong>. Due {{due_date}}.</p>",
      { number: "A&B", amountCents: 100, dueDate: null, viewUrl: "" },
    );
    assert.equal(html, "<p>Invoice <strong>A&amp;B</strong>.</p>");
  });
});

describe("empty greeting", () => {
  it("removes a blank Hi greeting from text and html", () => {
    assert.equal(
      renderMessageTemplate("Hi {{first_name}}, thank you.", { first_name: "" }),
      "thank you.",
    );
    assert.equal(
      renderMessageTemplate("Hi {{first_name}}, thank you.", {
        first_name: "Ada",
      }),
      "Hi Ada, thank you.",
    );
    assert.equal(
      renderMessageTemplate("<p>Hi {{first_name}},</p><p>Thanks.</p>", {
        first_name: "",
      }),
      "<p>Thanks.</p>",
    );
  });
});

describe("formatMailboxReplyHtml", () => {
  it("wraps plain text and strips scripts from html", () => {
    assert.equal(formatMailboxReplyHtml("Thanks\nsoon"), "<p>Thanks<br />soon</p>");
    assert.equal(
      formatMailboxReplyHtml("<p>Thanks</p><script>alert(1)</script>"),
      "<p>Thanks</p>",
    );
  });
});
