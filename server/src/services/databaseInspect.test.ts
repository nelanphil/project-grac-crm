import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeIdentifier,
  InspectError,
  redactValue,
} from "./databaseInspect";

describe("databaseInspect helpers", () => {
  it("accepts safe identifiers and rejects others", () => {
    assert.equal(assertSafeIdentifier("customers"), "customers");
    assert.throws(() => assertSafeIdentifier("customers;drop"), InspectError);
    assert.throws(() => assertSafeIdentifier("db.users"), InspectError);
  });

  it("redacts sensitive keys", () => {
    const redacted = redactValue({
      email: "a@b.com",
      passwordHash: "secret",
      nested: { apiKey: "abc", name: "ok" },
    }) as Record<string, unknown>;
    assert.equal(redacted.email, "a@b.com");
    assert.equal(redacted.passwordHash, "***");
    assert.deepEqual(redacted.nested, { apiKey: "***", name: "ok" });
  });
});
