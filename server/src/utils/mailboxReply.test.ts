import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignmentMessageKey,
  composeReplyHtml,
  defaultRecipients,
  newlyTaggedUserIds,
  replySubject,
  shouldSendReceiptReply,
  threadingHeaders,
} from "./mailboxReply";

const own = "billing@example.com";
const from = [{ name: "Chris", address: "chris@example.com" }];
const to = [
  { name: "Billing", address: "billing@example.com" },
  { name: "Phillip", address: "phillip@example.com" },
];
const cc = [{ name: "Office", address: "office@example.com" }];

describe("defaultRecipients", () => {
  it("replies to the sender and drops our own address", () => {
    assert.deepEqual(
      defaultRecipients({
        mode: "reply",
        folder: "inbox",
        from,
        to,
        cc,
        ownAddress: own,
      }),
      { to: ["chris@example.com"], cc: [] },
    );
  });

  it("replies to the original recipients when the open folder is Sent", () => {
    assert.deepEqual(
      defaultRecipients({
        mode: "reply",
        folder: "sent",
        from,
        to,
        cc,
        ownAddress: own,
      }),
      { to: ["phillip@example.com"], cc: [] },
    );
  });

  it("reply-all keeps the other recipients on Cc", () => {
    assert.deepEqual(
      defaultRecipients({
        mode: "replyAll",
        folder: "inbox",
        from,
        to,
        cc,
        ownAddress: own,
      }),
      {
        to: ["chris@example.com"],
        cc: ["phillip@example.com", "office@example.com"],
      },
    );
  });

  it("forward starts with an empty recipient list", () => {
    assert.deepEqual(
      defaultRecipients({
        mode: "forward",
        folder: "inbox",
        from,
        to,
        cc,
        ownAddress: own,
      }),
      { to: [], cc: [] },
    );
  });
});

describe("replySubject", () => {
  it("prefixes Re and Fwd once", () => {
    assert.equal(replySubject("Service renewal", "reply"), "Re: Service renewal");
    assert.equal(replySubject("Re: Service renewal", "replyAll"), "Re: Service renewal");
    assert.equal(replySubject("Service renewal", "forward"), "Fwd: Service renewal");
    assert.equal(replySubject("Fwd: Service renewal", "forward"), "Fwd: Service renewal");
  });
});

describe("newlyTaggedUserIds", () => {
  it("notifies only people who were just added, and skips the actor", () => {
    assert.deepEqual(
      newlyTaggedUserIds(["a", "b"], ["a", "b", "c", "me"], "me"),
      ["c"],
    );
  });

  it("does not notify when the set is unchanged", () => {
    assert.deepEqual(newlyTaggedUserIds(["a"], ["a"], "me"), []);
  });
});

describe("threadingHeaders", () => {
  it("sets In-Reply-To and appends the original id to References", () => {
    assert.deepEqual(
      threadingHeaders({
        messageId: "abc@example.com",
        references: ["<parent@example.com>"],
      }),
      {
        "In-Reply-To": "<abc@example.com>",
        References: "<parent@example.com> <abc@example.com>",
      },
    );
  });
});

describe("assignmentMessageKey", () => {
  it("prefers Message-ID and falls back to folder plus uid", () => {
    assert.equal(
      assignmentMessageKey("<abc@example.com>", "inbox", 4),
      "<abc@example.com>",
    );
    assert.equal(assignmentMessageKey("", "sent", 9), "uid:sent:9");
  });
});

describe("shouldSendReceiptReply", () => {
  const enabledAt = new Date("2026-09-29T12:00:00.000Z");
  const base = {
    enabledAt,
    messageDate: "2026-09-29T12:05:00.000Z",
    from: [{ address: "phillip@example.com" }],
    ownAddresses: ["no-reply@genmaintoffl.com"],
    subject: "Service renewal",
  };

  it("sends for mail that arrives after the switch is turned on", () => {
    assert.equal(shouldSendReceiptReply(base), true);
  });

  it("skips mail that was already in the inbox", () => {
    assert.equal(
      shouldSendReceiptReply({
        ...base,
        messageDate: "2026-09-29T11:59:00.000Z",
      }),
      false,
    );
  });

  it("skips our own address, mailer-daemon, and bounce notices", () => {
    assert.equal(
      shouldSendReceiptReply({
        ...base,
        from: [{ address: "no-reply@genmaintoffl.com" }],
      }),
      false,
    );
    assert.equal(
      shouldSendReceiptReply({
        ...base,
        from: [{ address: "MAILER-DAEMON@mail.privateemail.com" }],
      }),
      false,
    );
    assert.equal(
      shouldSendReceiptReply({
        ...base,
        subject: "Undelivered Mail Returned to Sender",
      }),
      false,
    );
  });
});

describe("composeReplyHtml", () => {
  it("quotes the original body", () => {
    const html = composeReplyHtml({
      mode: "reply",
      bodyHtml: "<p>See you then.</p>",
      original: {
        html: "",
        text: "I want to book an appointment.",
        from,
        to,
        date: "2026-09-29T11:56:00.000Z",
        subject: "Service renewal",
      },
    });
    assert.match(html, /See you then/);
    assert.match(html, /wrote:/);
    assert.match(html, /I want to book an appointment/);
  });

  it("adds a forwarded header", () => {
    const html = composeReplyHtml({
      mode: "forward",
      bodyHtml: "<p>FYI</p>",
      original: {
        html: "<p>Original</p>",
        text: "Original",
        from,
        to,
        date: null,
        subject: "Service renewal",
      },
    });
    assert.match(html, /Forwarded message/);
    assert.match(html, /Service renewal/);
    assert.match(html, /Original/);
  });
});
