import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastContactBlock } from "./customerContacts";

describe("last contact rule", () => {
  it("lets a customer keep extra contacts", () => {
    assert.equal(lastContactBlock(2, "detach"), null);
    assert.equal(lastContactBlock(3, "delete"), null);
  });

  it("refuses to detach or delete the only contact", () => {
    assert.match(lastContactBlock(1, "detach") ?? "", /keep at least one contact/);
    assert.match(lastContactBlock(1, "delete") ?? "", /last contact/);
  });
});
