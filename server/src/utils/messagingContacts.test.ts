import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepHubContact } from "./messagingContacts";

describe("messaging contact search", () => {
  it("keeps a contact that is not attached to a customer", () => {
    assert.equal(keepHubContact(null, new Set(["abc"])), true);
  });

  it("drops a contact whose customer is deleted or merged", () => {
    assert.equal(keepHubContact({ toString: () => "missing" }, new Set(["abc"])), false);
    assert.equal(keepHubContact({ toString: () => "abc" }, new Set(["abc"])), true);
  });
});
