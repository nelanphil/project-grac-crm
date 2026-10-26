import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inboxEmailHandle,
  inboxPhoneHandle,
  inboxPreview,
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
