import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeLastOutboundContacts } from "./lastContact";

describe("last outbound contact", () => {
  it("keeps the newest attempt and maps sms, mms, and voice", () => {
    const merged = mergeLastOutboundContacts(
      [
        {
          customerId: "cust-a",
          at: new Date("2026-10-01T15:00:00.000Z"),
          channel: "sms",
          status: "delivered",
        },
        {
          customerId: "cust-a",
          at: new Date("2026-10-14T15:00:00.000Z"),
          channel: "voice",
          status: "no-answer",
        },
        {
          customerId: "cust-b",
          at: new Date("2026-09-02T15:00:00.000Z"),
          channel: "mms",
          status: "failed",
        },
      ],
      [
        {
          customerId: "cust-a",
          at: new Date("2026-10-10T15:00:00.000Z"),
          status: "sent",
        },
        {
          customerId: "cust-c",
          at: new Date("2026-08-01T15:00:00.000Z"),
          status: "failed",
        },
      ],
    );

    assert.equal(merged.get("cust-a")?.method, "call");
    assert.equal(merged.get("cust-a")?.status, "no-answer");
    assert.equal(
      merged.get("cust-a")?.at.toISOString(),
      "2026-10-14T15:00:00.000Z",
    );
    assert.equal(merged.get("cust-b")?.method, "text");
    assert.equal(merged.get("cust-b")?.status, "failed");
    assert.equal(merged.get("cust-c")?.method, "email");
    assert.equal(merged.get("cust-c")?.status, "failed");
  });
});
