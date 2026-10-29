import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStaffOutboundEmail } from "./emailTemplates";
import { renderMessageTemplate } from "./messageTemplate";

describe("invoice email widget", () => {
  it("leaves {{invoice}} in place while replacing other tokens", () => {
    const rendered = renderMessageTemplate(
      "<p>Hi {{first_name}},</p><p>{{invoice}}</p>",
      { first_name: "Ada", invoice: "<table>should-not-inject</table>" },
    );
    assert.equal(
      rendered,
      "<p>Hi Ada,</p><p>{{invoice}}</p>",
    );
  });

  it("inserts the invoice card after body sanitization", () => {
    const wrapped = buildStaffOutboundEmail({
      subject: "Invoice {{invoice}}",
      bodyText:
        "<p>Hi Ada,</p><table><tr><td>stripped</td></tr></table><p>{{invoice}}</p>",
      invoiceWidget: {
        html: "<table><tr><td>Annual service</td></tr></table>",
        text: "Annual service — $150.00",
      },
    });

    assert.equal(wrapped.subject, "Invoice");
    assert.match(wrapped.html, /Hi Ada/);
    assert.match(wrapped.html, /<td>Annual service<\/td>/);
    assert.doesNotMatch(wrapped.html, /<td>stripped<\/td>/);
    assert.doesNotMatch(wrapped.html, /\{\{\s*invoice\s*\}\}/);
    assert.match(wrapped.text, /Annual service — \$150\.00/);
  });

  it("inserts calendar tiles after body sanitization", () => {
    const wrapped = buildStaffOutboundEmail({
      subject: "Let's schedule",
      bodyText:
        "<p>Choose a day.</p><p>{{recommended_dates}}</p><table><tr><td>stripped</td></tr></table>",
      recommendedDates: {
        html: '<table><tr><td style="background-color:#f36c21;">NOV</td></tr></table>',
        text: "Tuesday, November 3: https://example.com/schedule-renewal?token=abc&date=2026-11-03",
      },
    });
    assert.match(wrapped.html, /background-color:#f36c21/);
    assert.match(wrapped.html, />NOV</);
    assert.doesNotMatch(wrapped.html, /<td>stripped<\/td>/);
    assert.doesNotMatch(wrapped.html, /\{\{\s*recommended_dates\s*\}\}/);
    assert.match(wrapped.text, /Tuesday, November 3: https:\/\/example\.com\/schedule-renewal/);
  });

  it("removes the recommended dates token when no dates are passed", () => {
    const wrapped = buildStaffOutboundEmail({
      subject: "Schedule {{recommended_dates}}",
      bodyText: "<p>Call us.</p><p>{{recommended_dates}}</p>",
    });
    assert.equal(wrapped.subject, "Schedule");
    assert.doesNotMatch(wrapped.html, /\{\{\s*recommended_dates\s*\}\}/);
    assert.doesNotMatch(wrapped.text, /\{\{\s*recommended_dates\s*\}\}/);
    assert.match(wrapped.html, /Call us/);
  });

  it("omits the widget when the email has the token and no invoice", () => {
    const wrapped = buildStaffOutboundEmail({
      subject: "Hello",
      bodyText: "<p>Hi Ada,</p><p>{{invoice}}</p>",
    });

    assert.match(wrapped.html, /Hi Ada/);
    assert.doesNotMatch(wrapped.html, /\{\{\s*invoice\s*\}\}/);
    assert.doesNotMatch(wrapped.html, /Annual service/);
  });

  it("uses the same invoice-only link and quoted amount in HTML and plain text", () => {
    const url = "https://example.test/checkout/?c=q_invoice-only";
    const wrapped = buildStaffOutboundEmail({
      subject: "Invoice CURRENT",
      bodyText: "Hi Ryan,\n\nPlease pay {{payment_link}}",
      paymentUrl: url,
      paymentSummary: "Invoice total: $363.80",
      paymentButtonLabel: "Pay this invoice",
      invoiceWidget: { html: "<table><tr><td>$363.80</td></tr></table>", text: "$363.80" },
    });
    assert.match(wrapped.html, /Pay this invoice/);
    assert.match(wrapped.html, /Invoice total: \$363\.80/);
    assert.ok(wrapped.html.includes(url));
    assert.ok(wrapped.text.includes(url));
    assert.match(wrapped.text, /Invoice total: \$363\.80/);
    assert.doesNotMatch(wrapped.html, /684\.80|321\.00/);
  });
});
