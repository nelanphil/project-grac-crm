import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribeToken";

describe("unsubscribeToken", () => {
  it("round-trips email and channel", () => {
    const token = mintUnsubscribeToken("Jordan.Lee@Example.com", "billing");
    const parsed = verifyUnsubscribeToken(token);
    assert.deepEqual(parsed, {
      email: "jordan.lee@example.com",
      channel: "billing",
    });
  });

  it("defaults channel to general", () => {
    const token = mintUnsubscribeToken("a@b.com");
    assert.equal(verifyUnsubscribeToken(token)?.channel, "general");
  });

  it("rejects tampered tokens", () => {
    const token = mintUnsubscribeToken("a@b.com");
    const [payload] = token.split(".");
    assert.equal(verifyUnsubscribeToken(`${payload}.aaaa`), null);
    assert.equal(verifyUnsubscribeToken("not-a-token"), null);
    assert.equal(verifyUnsubscribeToken(""), null);
  });
});
