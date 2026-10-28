import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import {
  bodyIsVisible,
  emailPlainText,
  ensureVisibleBody,
  quotableHtml,
  wrapEmailDocument,
} from "./safeEmailHtml";
import { buildReplyEmail } from "./mailboxReply";
import { ReplyTargetError, resolveReplyTarget } from "./inboxReplyTarget";

const marketingEmail = `<!DOCTYPE html><html><head><title>Promo</title>
<style>body{display:none} .x{color:red}</style></head>
<body class="x"><!--[if mso]><p>Outlook only</p><![endif]-->
<div style="display:none;max-height:0">Hidden preheader</div>
<p id="main" class="x">I want to book an appointment.</p>
<script>alert(1)</script></body></html>`;

const original = {
  html: marketingEmail,
  text: "",
  from: [{ name: "Jane", address: "jane@example.com" }],
  to: [{ name: "", address: "office@example.com" }],
  date: "2026-10-28T14:00:00.000Z",
  subject: "Service",
};

describe("quotableHtml", () => {
  it("keeps body text and drops styles, head, comments, scripts and hidden parts", () => {
    const html = quotableHtml(marketingEmail);
    assert.match(html, /I want to book an appointment\./);
    assert.doesNotMatch(html, /<style|display:none|<head|<title|Promo|Outlook only|alert|<script/i);
    assert.doesNotMatch(html, /Hidden preheader/);
    assert.doesNotMatch(html, /class=|id=/);
    assert.doesNotMatch(html, /<html|<body/i);
  });
});

describe("emailPlainText", () => {
  it("drops CSS and keeps link URLs", () => {
    const text = emailPlainText(
      '<style>p{color:red}</style><p>Pay here: <a href="https://pay.example.com/x?a=1&amp;b=2">invoice</a></p><p>Tom &amp; Co</p>',
    );
    assert.equal(text, "Pay here: invoice (https://pay.example.com/x?a=1&b=2)\nTom & Co");
  });
});

describe("ensureVisibleBody", () => {
  const body = "<p>See you Tuesday at 9.</p>";

  it("keeps the preferred layout when the message is visible", () => {
    const result = ensureVisibleBody(body, (simple) => (simple ? "simple" : `<div>${body}</div>`));
    assert.deepEqual(result, { html: `<div>${body}</div>`, simple: false, fallback: false });
  });

  it("falls back to the simple layout when the message would be hidden", () => {
    const result = ensureVisibleBody(body, (simple) =>
      simple ? `<div>${body}</div>` : `<div style="display:none">${body}</div>`,
    );
    assert.equal(result.simple, true);
    assert.equal(result.fallback, true);
    assert.equal(bodyIsVisible(result.html, body), true);
  });
});

describe("buildReplyEmail", () => {
  const bodyHtml = "<p>See you Tuesday at 9.</p>";

  it("builds a full document with a quoted, cleaned original and a readable text part", () => {
    const email = buildReplyEmail({
      bodyHtml,
      useBrandTemplate: true,
      quote: { mode: "reply", original },
    });
    assert.equal(email.format, "branded");
    assert.equal(email.fallback, false);
    assert.ok(email.html.startsWith("<!DOCTYPE html>"));
    assert.doesNotMatch(email.html, /<style|display:none/);
    assert.match(email.text, /^See you Tuesday at 9\./);
    assert.match(email.text, /Generator Maintenance of Florida/);
    assert.match(email.text, /Jane <jane@example\.com> wrote:\n> I want to book an appointment\./);
    assert.doesNotMatch(email.text, /color:red|display/);
  });

  it("uses the simple layout when the recipient prefers it", () => {
    const email = buildReplyEmail({ bodyHtml, useBrandTemplate: true, simpleFormat: true });
    assert.equal(email.format, "simple");
    assert.doesNotMatch(email.html, /<table/);
    assert.match(email.html, /See you Tuesday/);
  });

  it("never returns an empty text part", () => {
    const email = buildReplyEmail({ bodyHtml: "<p>Hi</p>", useBrandTemplate: false });
    assert.equal(email.format, "plain");
    assert.equal(email.text, "Hi");
    assert.equal(wrapEmailDocument("x").includes("<body"), true);
  });
});

describe("resolveReplyTarget", () => {
  const picked = { id: "picked" };
  const latest = { id: "latest" };
  const inConversation = new Types.ObjectId();
  const lookup = {
    byId: async (id: Types.ObjectId) => (id.equals(inConversation) ? picked : null),
    latestInbound: async () => latest,
  };

  it("uses the chosen email from this conversation", async () => {
    assert.equal(await resolveReplyTarget(String(inConversation), lookup), picked);
  });

  it("returns no target for a new email", async () => {
    assert.equal(await resolveReplyTarget("new", lookup), null);
  });

  it("falls back to the latest inbound email", async () => {
    assert.equal(await resolveReplyTarget(undefined, lookup), latest);
    assert.equal(await resolveReplyTarget("", lookup), latest);
  });

  it("rejects emails from other conversations and malformed ids", async () => {
    await assert.rejects(
      resolveReplyTarget(String(new Types.ObjectId()), lookup),
      (err: unknown) => err instanceof ReplyTargetError && err.status === 404,
    );
    await assert.rejects(
      resolveReplyTarget("nope", lookup),
      (err: unknown) => err instanceof ReplyTargetError && err.status === 400,
    );
  });
});
