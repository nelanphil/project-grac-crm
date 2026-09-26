import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSentMailbox,
  snippetFromPartialSource,
} from "./imapMailbox";

describe("resolveSentMailbox", () => {
  it("prefers the special-use Sent flag", () => {
    const path = resolveSentMailbox([
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "[Gmail]/Sent Mail", specialUse: "\\Sent", name: "Sent Mail" },
      { path: "Sent", name: "Sent" },
    ]);
    assert.equal(path, "[Gmail]/Sent Mail");
  });

  it("falls back to known folder paths", () => {
    const path = resolveSentMailbox([
      { path: "INBOX", name: "INBOX" },
      { path: "INBOX.Sent", name: "Sent" },
    ]);
    assert.equal(path, "INBOX.Sent");
  });

  it("returns null when no Sent folder is listed", () => {
    assert.equal(
      resolveSentMailbox([{ path: "INBOX", name: "INBOX" }]),
      null,
    );
  });
});

describe("snippetFromPartialSource", () => {
  it("reads plain text after the headers", () => {
    const source = Buffer.from(
      "Subject: Hi\r\n\r\nHello from the mailbox.\r\nSecond line.",
    );
    assert.equal(snippetFromPartialSource(source), "Hello from the mailbox. Second line.");
  });

  it("strips a simple html body", () => {
    const source = Buffer.from(
      "Content-Type: text/html\r\n\r\n<p>Renewal <strong>due</strong> Friday.</p>",
    );
    assert.equal(snippetFromPartialSource(source), "Renewal due Friday.");
  });

  it("returns empty for an empty buffer", () => {
    assert.equal(snippetFromPartialSource(Buffer.alloc(0)), "");
  });
});
