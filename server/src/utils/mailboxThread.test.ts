import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignThreadKeys,
  belongsToThread,
  messageIdLookupValues,
  stripQuotedHtml,
  stripQuotedText,
  threadIdSet,
  withDisplayBodies,
} from "./mailboxThread";
import {
  customerForAddresses,
  resolveMailboxCustomer,
} from "./mailboxCustomers";

const laura = { id: "cust-laura", name: "Laura Cook" };
const other = { id: "cust-other", name: "Other Customer" };

describe("assignThreadKeys", () => {
  it("joins a reply to its parent and leaves a same-subject stranger alone", () => {
    const keys = assignThreadKeys([
      {
        id: "uid:inbox:2",
        messageId: "<reply@example.com>",
        inReplyTo: "<parent@example.com>",
      },
      {
        id: "uid:inbox:1",
        messageId: "<parent@example.com>",
        inReplyTo: "",
      },
      {
        id: "uid:inbox:3",
        messageId: "<other@example.com>",
        inReplyTo: "",
      },
    ]);
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[2], keys[0]);
  });

  it("joins two replies that share a parent missing from the folder window", () => {
    const keys = assignThreadKeys([
      {
        id: "uid:inbox:4",
        messageId: "<a@example.com>",
        inReplyTo: "<parent@example.com>",
      },
      {
        id: "uid:inbox:5",
        messageId: "<b@example.com>",
        inReplyTo: "<parent@example.com>",
      },
    ]);
    assert.equal(keys[0], keys[1]);
  });

  it("does not join messages that only share a subject", () => {
    const keys = assignThreadKeys([
      { id: "uid:inbox:1", messageId: "", inReplyTo: "" },
      { id: "uid:inbox:2", messageId: "", inReplyTo: "" },
    ]);
    assert.notEqual(keys[0], keys[1]);
  });

  it("joins a message to an ancestor listed in References", () => {
    const keys = assignThreadKeys([
      {
        id: "uid:inbox:9",
        messageId: "<child@example.com>",
        inReplyTo: "<mid@example.com>",
        references: ["<parent@example.com>", "<mid@example.com>"],
      },
      {
        id: "uid:sent:3",
        messageId: "<parent@example.com>",
        inReplyTo: "",
      },
    ]);
    assert.equal(keys[0], keys[1]);
  });
});

describe("thread membership", () => {
  it("keeps a parent whose id is the reply's In-Reply-To", () => {
    const ids = threadIdSet([
      {
        messageId: "<reply@example.com>",
        inReplyTo: "<parent@example.com>",
        references: ["<parent@example.com>"],
      },
    ]);
    assert.equal(
      belongsToThread(
        { messageId: "<parent@example.com>", inReplyTo: "", references: [] },
        ids,
      ),
      true,
    );
    assert.equal(
      belongsToThread(
        { messageId: "<stranger@example.com>", inReplyTo: "", references: [] },
        ids,
      ),
      false,
    );
  });

  it("looks up bracketed and bare message ids", () => {
    assert.deepEqual(messageIdLookupValues(["parent@example.com"]), [
      "<parent@example.com>",
      "parent@example.com",
    ]);
  });
});

describe("quote stripping", () => {
  it("drops the On wrote tail and quoted lines", () => {
    const text = [
      "Hey Chris,",
      "",
      "Is this still needed?",
      "",
      "On Sunday, October 11, 2026, Generator Maintenance wrote:",
      "> Annual Service Renewal Reminder",
    ].join("\n");
    assert.equal(
      stripQuotedText(text),
      "Hey Chris,\n\nIs this still needed?",
    );
  });

  it("drops a gmail quote and blockquote from html", () => {
    const html =
      "<p>Hey Chris,</p><div class=\"gmail_quote\">On Sunday wrote:<blockquote>original</blockquote></div>";
    assert.equal(stripQuotedHtml(html), "<p>Hey Chris,</p>");
  });

  it("strips the reply when its parent is in the thread and leaves the parent intact", () => {
    const [parent, reply] = withDisplayBodies([
      {
        id: "parent",
        messageId: "<parent@example.com>",
        inReplyTo: "",
        references: [],
        text: "Original reminder",
        html: "<p>Original reminder</p>",
      },
      {
        id: "reply",
        messageId: "<reply@example.com>",
        inReplyTo: "<parent@example.com>",
        references: ["<parent@example.com>"],
        text: "Thanks\n\nOn Sunday, October 11, 2026, Office wrote:\n> Original reminder",
        html: "<p>Thanks</p><blockquote>Original reminder</blockquote>",
      },
    ]);
    assert.equal(parent.displayHtml, "<p>Original reminder</p>");
    assert.equal(reply.displayText, "Thanks");
    assert.equal(reply.displayHtml, "<p>Thanks</p>");
  });
});

describe("resolveMailboxCustomer", () => {
  it("links a primary email and a contact-only email", () => {
    assert.deepEqual(resolveMailboxCustomer([laura], []), laura);
    assert.deepEqual(resolveMailboxCustomer([], [laura]), laura);
  });

  it("does not link an unknown address or two customers on one address", () => {
    assert.equal(resolveMailboxCustomer([], []), null);
    assert.equal(resolveMailboxCustomer([laura, other], []), null);
    assert.equal(resolveMailboxCustomer([], [laura, other]), null);
  });

  it("prefers the primary customer when a contact points elsewhere", () => {
    assert.deepEqual(resolveMailboxCustomer([laura], [other]), laura);
  });
});

describe("customerForAddresses", () => {
  const matches = new Map([
    ["laura@example.com", laura],
    ["other@example.com", other],
    ["unknown@example.com", null],
  ]);

  it("links when every counterparty address is the same customer", () => {
    assert.deepEqual(
      customerForAddresses(["laura@example.com"], matches),
      laura,
    );
    assert.deepEqual(
      customerForAddresses(
        ["laura@example.com", "laura@example.com"],
        matches,
      ),
      laura,
    );
  });

  it("does not link mixed, unknown, or empty addresses", () => {
    assert.equal(
      customerForAddresses(["laura@example.com", "other@example.com"], matches),
      null,
    );
    assert.equal(customerForAddresses(["unknown@example.com"], matches), null);
    assert.equal(customerForAddresses(["missing@example.com"], matches), null);
    assert.equal(customerForAddresses([], matches), null);
  });
});
