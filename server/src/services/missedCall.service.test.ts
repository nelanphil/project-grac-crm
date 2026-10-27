import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MISSED_CALL_COOLDOWN_MS,
  MISSED_CALL_TEXT,
  decideMissedCallText,
} from "./missedCall.service";

const now = new Date("2026-10-27T18:00:00.000Z");

function eligible(overrides: Partial<Parameters<typeof decideMissedCallText>[0]> = {}) {
  return decideMissedCallText({
    answeredAt: null,
    missedCallTextSentAt: null,
    callerBlocked: false,
    callerE164: "+17328419642",
    lineSmsCapable: true,
    recentTextAt: null,
    now,
    ...overrides,
  });
}

describe("missed-call text", () => {
  it("uses the generator follow-up message", () => {
    assert.equal(
      MISSED_CALL_TEXT,
      "Hey, sorry we missed your call. It is very important to us, please leave a message regarding your generator status or issue and we will get right back to you. Feel free to text back here as well\n\nThanks!",
    );
  });

  it("sends once for an unanswered call", () => {
    assert.deepEqual(eligible(), { send: true });
  });

  it("does not send when the call was already answered", () => {
    assert.deepEqual(eligible({ answeredAt: now }), {
      send: false,
      reason: "answered",
    });
  });

  it("does not send a second text for the same call", () => {
    assert.deepEqual(eligible({ missedCallTextSentAt: now }), {
      send: false,
      reason: "already-sent",
    });
  });

  it("skips blocked callers", () => {
    assert.deepEqual(eligible({ callerBlocked: true }), {
      send: false,
      reason: "blocked",
    });
  });

  it("skips anonymous or invalid caller ids", () => {
    assert.deepEqual(eligible({ callerE164: null }), {
      send: false,
      reason: "anonymous",
    });
  });

  it("skips lines that cannot text", () => {
    assert.deepEqual(eligible({ lineSmsCapable: false }), {
      send: false,
      reason: "no-sms",
    });
  });

  it("waits fifteen minutes before texting the same caller again", () => {
    const recent = new Date(now.getTime() - MISSED_CALL_COOLDOWN_MS + 1000);
    assert.deepEqual(eligible({ recentTextAt: recent }), {
      send: false,
      reason: "cooldown",
    });
    const expired = new Date(now.getTime() - MISSED_CALL_COOLDOWN_MS);
    assert.deepEqual(eligible({ recentTextAt: expired }), { send: true });
  });
});
