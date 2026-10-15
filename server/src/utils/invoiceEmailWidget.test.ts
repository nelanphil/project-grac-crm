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

  it("omits the widget when the email has the token and no invoice", () => {
    const wrapped = buildStaffOutboundEmail({
      subject: "Hello",
      bodyText: "<p>Hi Ada,</p><p>{{invoice}}</p>",
    });

    assert.match(wrapped.html, /Hi Ada/);
    assert.doesNotMatch(wrapped.html, /\{\{\s*invoice\s*\}\}/);
    assert.doesNotMatch(wrapped.html, /Annual service/);
  });
});
