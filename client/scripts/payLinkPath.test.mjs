import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { payCodeFromPath } from "./payLinkPath.mjs";

describe("payCodeFromPath", () => {
  it("extracts a short pay code with or without a trailing slash", () => {
    assert.equal(payCodeFromPath("/p/Ab12Cd34"), "Ab12Cd34");
    assert.equal(payCodeFromPath("/p/Ab12_d-3/"), "Ab12_d-3");
  });

  it("ignores other paths", () => {
    assert.equal(payCodeFromPath("/p/"), null);
    assert.equal(payCodeFromPath("/checkout/"), null);
    assert.equal(payCodeFromPath("/p/Ab12Cd34/extra"), null);
  });
});
