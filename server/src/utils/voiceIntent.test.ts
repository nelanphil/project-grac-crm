import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateVoiceIntent, voiceIdentity } from "./voiceIntent";

const userId = "507f1f77bcf86cd799439011";
const now = new Date("2026-10-26T16:00:00.000Z");

function intent(overrides: Partial<Parameters<typeof evaluateVoiceIntent>[0]> = {}) {
  return evaluateVoiceIntent({
    userId,
    expiresAt: new Date(now.getTime() + 60_000),
    twilioCallSid: "",
    identity: voiceIdentity(userId),
    callSid: "CA123",
    now,
    ...overrides,
  });
}

describe("voice call intents", () => {
  it("accepts a fresh intent for the user who started it", () => {
    assert.deepEqual(intent(), { ok: true, replay: false });
  });

  it("rejects another user's identity", () => {
    const decision = intent({ identity: voiceIdentity("someone-else") });
    assert.equal(decision.ok, false);
  });

  it("rejects an unused expired intent", () => {
    const decision = intent({ expiresAt: new Date(now.getTime() - 1) });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.match(decision.message, /expired/);
  });

  it("allows Twilio to retry the same call after the intent is bound", () => {
    const decision = intent({
      twilioCallSid: "CA123",
      expiresAt: new Date(now.getTime() - 1),
    });
    assert.deepEqual(decision, { ok: true, replay: true });
  });

  it("rejects a second call using the same intent", () => {
    const decision = intent({ twilioCallSid: "CA-other" });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.match(decision.message, /already used/);
  });
});
