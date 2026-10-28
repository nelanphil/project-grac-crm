import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simpleParser } from "mailparser";
import {
  EmailAttachmentError,
  MAX_EMAIL_ATTACHMENT_BYTES,
  isBlockedAttachmentName,
  prepareEmailAttachments,
  sanitizeAttachmentFilename,
  unpackMultipartPayload,
} from "./emailAttachments";
import { buildRfc822Message } from "./mailboxReply";

const baseMessage = {
  from: "GMF <office@example.com>",
  to: ["customer@example.com"],
  cc: [],
  subject: "Your estimate",
  text: "See attached.",
  html: "<p>See attached.</p>",
  date: new Date("2026-10-28T14:00:00.000Z"),
};

function upload(name: string, content = "hello", mimetype = "application/pdf") {
  const buffer = Buffer.from(content);
  return { originalname: name, buffer, mimetype, size: buffer.length };
}

describe("buildRfc822Message attachments", () => {
  it("keeps a plain multipart/alternative message when nothing is attached", () => {
    const raw = buildRfc822Message(baseMessage).toString("utf8");
    assert.match(raw, /Content-Type: multipart\/alternative; boundary=/);
    assert.doesNotMatch(raw, /multipart\/mixed/);
    assert.doesNotMatch(raw, /Content-Disposition: attachment/);
  });

  it("wraps the body in multipart/mixed and round-trips the files", async () => {
    const raw = buildRfc822Message({
      ...baseMessage,
      attachments: [
        { filename: "estimate.pdf", content: Buffer.from("%PDF-1.4 test"), contentType: "application/pdf" },
        { filename: "générateur.png", content: Buffer.from([1, 2, 3]), contentType: "image/png" },
      ],
    });
    assert.match(raw.toString("utf8"), /Content-Type: multipart\/mixed; boundary=/);

    const parsed = await simpleParser(raw);
    assert.equal(parsed.text?.trim(), "See attached.");
    assert.match(String(parsed.html), /See attached\./);
    assert.deepEqual(
      parsed.attachments.map((file) => [file.filename, file.contentType, file.content.toString("hex")]),
      [
        ["estimate.pdf", "application/pdf", Buffer.from("%PDF-1.4 test").toString("hex")],
        ["générateur.png", "image/png", "010203"],
      ],
    );
  });
});

describe("prepareEmailAttachments", () => {
  it("cleans file names and keeps safe content types", () => {
    const [file] = prepareEmailAttachments([upload('../../evil"\r\nname.pdf', "x", "bad type\r\nX: y")]);
    assert.equal(file.filename, "evilname.pdf");
    assert.equal(file.contentType, "application/octet-stream");
  });

  it("rejects blocked file types, too many files, and oversized totals", () => {
    assert.throws(() => prepareEmailAttachments([upload("setup.EXE")]), EmailAttachmentError);
    assert.throws(
      () => prepareEmailAttachments(Array.from({ length: 11 }, (_, i) => upload(`f${i}.txt`))),
      EmailAttachmentError,
    );
    const big = { ...upload("big.pdf"), size: MAX_EMAIL_ATTACHMENT_BYTES + 1 };
    assert.throws(() => prepareEmailAttachments([big]), EmailAttachmentError);
  });

  it("only blocks by extension", () => {
    assert.equal(isBlockedAttachmentName("report.js"), true);
    assert.equal(isBlockedAttachmentName("js"), false);
    assert.equal(isBlockedAttachmentName("invoice.pdf"), false);
    assert.equal(sanitizeAttachmentFilename(""), "attachment");
  });
});

describe("unpackMultipartPayload", () => {
  it("restores JSON fields, including arrays and booleans", () => {
    const body = unpackMultipartPayload({
      payload: JSON.stringify({
        to: ["a@example.com", "b@example.com"],
        useBrandTemplate: false,
        includeQuoted: true,
        subject: "Hi",
      }),
    });
    assert.deepEqual(body.to, ["a@example.com", "b@example.com"]);
    assert.equal(body.useBrandTemplate, false);
    assert.equal(body.includeQuoted, true);
    assert.equal(body.subject, "Hi");
  });

  it("passes plain bodies through and rejects malformed payloads", () => {
    assert.deepEqual(unpackMultipartPayload({ subject: "Hi" }), { subject: "Hi" });
    assert.throws(() => unpackMultipartPayload({ payload: "{oops" }), EmailAttachmentError);
    assert.throws(() => unpackMultipartPayload({ payload: "[1,2]" }), EmailAttachmentError);
  });
});
