import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inboxEmailHandle,
  inboxPhoneHandle,
  inboxPreview,
  nextInboxLifecycle,
  InboxLifecycle,
} from "./inboxConversation.service";

describe("inbox handles", () => {
  it("stores a US phone as 10 digits", () => {
    assert.equal(inboxPhoneHandle("+1 (407) 509-4892"), "4075094892");
  });

  it("stores email in lowercase", () => {
    assert.equal(inboxEmailHandle(" Chris@Example.com "), "chris@example.com");
  });

  it("prefers an email subject and a photo placeholder", () => {
    assert.equal(
      inboxPreview({ channel: "email", subject: "Invoice", body: "hello" }),
      "Invoice",
    );
    assert.equal(inboxPreview({ channel: "mms", body: "  " }), "Photo");
    assert.equal(
      inboxPreview({ channel: "voice", body: "Voice message" }),
      "",
    );
  });
});

describe("nextInboxLifecycle", () => {
  const at = new Date("2026-10-26T16:48:00.000Z");
  const closed: InboxLifecycle = {
    status: "closed",
    unreadCount: 0,
    readAt: new Date("2026-10-25T12:00:00.000Z"),
    deletedAt: null,
    blocked: false,
  };

  it("leaves a done chat closed when staff send a newer message", () => {
    const next = nextInboxLifecycle(closed, {
      direction: "outbound",
      at,
      newer: true,
      countUnread: false,
      reopen: true,
    });
    assert.equal(next.status, "closed");
    assert.equal(next.unreadCount, 0);
  });

  it("leaves a done chat closed during backfill", () => {
    const next = nextInboxLifecycle(closed, {
      direction: "outbound",
      at,
      newer: true,
      countUnread: false,
      reopen: false,
    });
    assert.equal(next.status, "closed");
  });

  it("reopens a done chat when the customer writes", () => {
    const next = nextInboxLifecycle(closed, {
      direction: "inbound",
      at,
      newer: true,
      countUnread: true,
      reopen: true,
    });
    assert.equal(next.status, "open");
    assert.equal(next.unreadCount, 1);
    assert.equal(next.readAt, null);
  });

  it("does not reopen or unread a blocked chat", () => {
    const next = nextInboxLifecycle(
      { ...closed, blocked: true },
      {
        direction: "inbound",
        at,
        newer: true,
        countUnread: true,
        reopen: true,
      },
    );
    assert.equal(next.status, "closed");
    assert.equal(next.unreadCount, 0);
    assert.equal(next.blocked, true);
  });

  it("brings a deleted chat back when the customer writes", () => {
    const deletedAt = new Date("2026-10-20T00:00:00.000Z");
    const next = nextInboxLifecycle(
      { ...closed, deletedAt },
      {
        direction: "inbound",
        at,
        newer: true,
        countUnread: true,
        reopen: true,
      },
    );
    assert.equal(next.status, "open");
    assert.equal(next.deletedAt, null);
  });

  it("keeps a deleted chat hidden when staff message", () => {
    const deletedAt = new Date("2026-10-20T00:00:00.000Z");
    const next = nextInboxLifecycle(
      { ...closed, deletedAt },
      {
        direction: "outbound",
        at,
        newer: true,
        countUnread: false,
        reopen: true,
      },
    );
    assert.equal(next.status, "closed");
    assert.equal(next.deletedAt?.toISOString(), deletedAt.toISOString());
  });

  it("keeps a deleted chat hidden during backfill", () => {
    const deletedAt = new Date("2026-10-20T00:00:00.000Z");
    const next = nextInboxLifecycle(
      { ...closed, deletedAt },
      {
        direction: "inbound",
        at,
        newer: true,
        countUnread: true,
        reopen: false,
      },
    );
    assert.equal(next.deletedAt?.toISOString(), deletedAt.toISOString());
    assert.equal(next.status, "closed");
  });
});
