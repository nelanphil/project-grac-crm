import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDiscountCents } from "./discount.service";
import { preTaxCents } from "./taxSettings";

describe("percent discounts", () => {
  it("applies the percent to the pre-tax subtotal, not the tax-inclusive total", () => {
    const taxInclusive = 10750;
    const taxCents = 750;
    const eligible = preTaxCents(taxInclusive, taxCents);
    assert.equal(eligible, 10000);
    assert.equal(
      computeDiscountCents({ mode: "percent", value: 10 }, eligible),
      1000,
    );
    assert.notEqual(
      computeDiscountCents({ mode: "percent", value: 10 }, taxInclusive),
      1000,
    );
  });
});
