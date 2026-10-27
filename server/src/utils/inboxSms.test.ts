import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_INBOX_MEDIA,
  MAX_INBOX_SCHEDULE_MS,
  inboxSendPreview,
  normalizeInboxMediaUrls,
  parseInboxScheduledAt,
  scheduledMessageRoute,
  InboxSmsInputError,
} from "./inboxSms";
import { ScheduledAtError } from "./scheduledEmail";

const CLOUDINARY =
  "https://res.cloudinary.com/demo/image/upload/v1/inbox-mms/photo.jpg";

describe("parseInboxScheduledAt", () => {
  it("accepts a time inside the next year", () => {
    const iso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(parseInboxScheduledAt(iso).toISOString(), iso);
  });

  it("rejects a non-string", () => {
    assert.throws(
      () => parseInboxScheduledAt(Date.now()),
      (err: unknown) =>
        err instanceof ScheduledAtError && err.message === "Invalid scheduledAt",
    );
  });

  it("rejects times less than 1 minute ahead", () => {
    const iso = new Date(Date.now() + 10_000).toISOString();
    assert.throws(
      () => parseInboxScheduledAt(iso),
      (err: unknown) =>
        err instanceof ScheduledAtError && err.message.includes("1 minute"),
    );
  });

  it("rejects times more than a year out", () => {
    const iso = new Date(Date.now() + MAX_INBOX_SCHEDULE_MS + 24 * 60 * 60 * 1000).toISOString();
    assert.throws(
      () => parseInboxScheduledAt(iso),
      (err: unknown) =>
        err instanceof ScheduledAtError &&
        err.message === "Scheduled time must be within the next year",
    );
  });
});

describe("scheduledMessageRoute", () => {
  it("sends inbox rows through the conversation and leaves campaigns alone", () => {
    assert.equal(scheduledMessageRoute({}), "campaign");
    assert.equal(scheduledMessageRoute({ inboxConversationRef: null }), "campaign");
    assert.equal(
      scheduledMessageRoute({ inboxConversationRef: "664f1b2c3d4e5f6789012345" }),
      "inbox",
    );
  });
});

describe("inboxSendPreview", () => {
  it("uses the text, or an attachment placeholder when the text is empty", () => {
    assert.equal(inboxSendPreview("  hello  ", 1), "hello");
    assert.equal(inboxSendPreview("   ", 2), "[Attachment]");
    assert.equal(inboxSendPreview("", 0), "");
  });
});

describe("normalizeInboxMediaUrls", () => {
  it("keeps uploaded Cloudinary links and drops duplicates", () => {
    assert.deepEqual(normalizeInboxMediaUrls(null), []);
    assert.deepEqual(normalizeInboxMediaUrls([CLOUDINARY, ` ${CLOUDINARY} `]), [
      CLOUDINARY,
    ]);
  });

  it("rejects links Twilio would have to fetch from somewhere else", () => {
    assert.throws(
      () => normalizeInboxMediaUrls(["https://example.com/a.jpg"]),
      (err: unknown) => err instanceof InboxSmsInputError,
    );
    assert.throws(
      () => normalizeInboxMediaUrls(["http://res.cloudinary.com/demo/a.jpg"]),
      (err: unknown) => err instanceof InboxSmsInputError,
    );
    assert.throws(
      () => normalizeInboxMediaUrls(Array.from({ length: MAX_INBOX_MEDIA + 1 }, () => CLOUDINARY + "?n=1")),
      (err: unknown) => err instanceof InboxSmsInputError,
    );
  });
});
