import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTicketTotals } from "./serviceTicket";
import {
  applyTaxToPreTaxCents,
  computeTaxAmount,
  normalizeTaxRatePercent,
  snapshotDocumentTax,
} from "./taxSettings";

describe("taxSettings", () => {
  it("normalizes rates into a 0–100 percent range", () => {
    assert.equal(normalizeTaxRatePercent(-1), 0);
    assert.equal(normalizeTaxRatePercent("7.5"), 7.5);
    assert.equal(normalizeTaxRatePercent(7.55555), 7.5556);
    assert.equal(normalizeTaxRatePercent(140), 100);
    assert.equal(normalizeTaxRatePercent(undefined), 0);
  });

  it("computes tax on the taxable subtotal", () => {
    assert.equal(computeTaxAmount(100, 7.5), 7.5);
    assert.equal(computeTaxAmount(33.33, 6), 2);
    assert.equal(computeTaxAmount(0, 7.5), 0);
  });

  it("snapshots a stored rate and amount onto an invoice", () => {
    assert.deepEqual(
      snapshotDocumentTax({
        taxRatePercent: 7.5,
        taxDollars: 12.34,
        taxOverridden: true,
      }),
      { taxRatePercent: 7.5, taxCents: 1234, taxOverridden: true },
    );
    assert.equal(
      applyTaxToPreTaxCents(10000, { taxRatePercent: 7.5, taxCents: 750 }),
      10750,
    );
  });

  it("adds computed tax into ticket totals unless overridden", () => {
    const computed = computeTicketTotals({
      parts: [{ amount: 100, kind: "part" }],
      laborHours: 0,
      miscExp: 0,
      shipping: 10,
      taxRate: 7.5,
    });
    assert.equal(computed.subtotal, 100);
    assert.equal(computed.tax, 7.5);
    assert.equal(computed.total, 117.5);

    const overridden = computeTicketTotals({
      parts: [{ amount: 100, kind: "part" }],
      laborHours: 0,
      shipping: 10,
      taxRate: 7.5,
      tax: 4,
      taxOverridden: true,
    });
    assert.equal(overridden.tax, 4);
    assert.equal(overridden.total, 114);
  });
});
