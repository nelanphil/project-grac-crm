import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toProperCase } from "./formatName";
import { createCustomerContactNestedSchema } from "../schemas/customer.schema";
import {
  portalCreateContactSchema,
  updateCustomerContactSchema,
} from "../schemas/customerSite.schema";

describe("toProperCase", () => {
  it("returns empty for blank values", () => {
    assert.equal(toProperCase(""), "");
    assert.equal(toProperCase("   "), "");
    assert.equal(toProperCase(null), "");
    assert.equal(toProperCase(undefined), "");
  });

  it("title-cases each word", () => {
    assert.equal(toProperCase("JOHN DOE"), "John Doe");
    assert.equal(toProperCase("mary-jane"), "Mary-Jane");
    assert.equal(toProperCase("  jane   smith "), "Jane   Smith");
  });

  it("leaves an already title-cased name unchanged aside from trim", () => {
    assert.equal(toProperCase("Jane Smith"), "Jane Smith");
  });
});

describe("person name schemas", () => {
  it("title-cases contact names on create and keeps omitted updates unset", () => {
    const created = createCustomerContactNestedSchema.parse({
      first: "JOHN",
      last: "DOE",
    });
    assert.equal(created.first, "John");
    assert.equal(created.last, "Doe");

    const updated = updateCustomerContactSchema.parse({ phone: "555" });
    assert.equal(updated.first, undefined);
    assert.equal(updated.last, undefined);

    const renamed = updateCustomerContactSchema.parse({ first: "MARY JANE" });
    assert.equal(renamed.first, "Mary Jane");
    assert.equal(renamed.last, undefined);
  });

  it("title-cases a required portal first name", () => {
    const created = portalCreateContactSchema.parse({
      first: "ALEX",
      last: "",
    });
    assert.equal(created.first, "Alex");
    assert.equal(created.last, "");
  });
});
