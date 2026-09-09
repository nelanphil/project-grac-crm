import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_SCHEDULE_LEAD_MS,
  parseFutureScheduledAt,
  ScheduledAtError,
} from "./scheduledEmail";

describe("parseFutureScheduledAt", () => {
  it("accepts an ISO time at least 1 minute ahead", () => {
    const iso = new Date(Date.now() + MIN_SCHEDULE_LEAD_MS + 5_000).toISOString();
    const parsed = parseFutureScheduledAt(iso);
    assert.equal(parsed.toISOString(), iso);
  });

  it("rejects invalid dates", () => {
    assert.throws(
      () => parseFutureScheduledAt("not-a-date"),
      (err: unknown) =>
        err instanceof ScheduledAtError && err.message === "Invalid scheduledAt",
    );
  });

  it("rejects times less than 1 minute ahead", () => {
    const iso = new Date(Date.now() + 10_000).toISOString();
    assert.throws(
      () => parseFutureScheduledAt(iso),
      (err: unknown) =>
        err instanceof ScheduledAtError && err.message.includes("1 minute"),
    );
  });
});
