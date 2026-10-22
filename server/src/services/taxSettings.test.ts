import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTicketTotals } from "./serviceTicket";
import {
  applyTaxToPreTaxCents,
  companyTaxForUnpaidWorkOrder,
  contractChargeFromPreTaxCents,
  computeTaxAmount,
  DEFAULT_TAX_RATE_PERCENT,
  effectiveTaxRatePercent,
  invoiceEligibleForCompanyTaxRate,
  normalizeTaxRatePercent,
  preTaxCents,
  recomputeUnpaidInvoiceTax,
  snapshotDocumentTax,
} from "./taxSettings";

describe("taxSettings", () => {
  it("defaults a missing company rate to 7%", () => {
    assert.equal(DEFAULT_TAX_RATE_PERCENT, 7);
    assert.equal(effectiveTaxRatePercent(undefined), 7);
    assert.equal(effectiveTaxRatePercent(null), 7);
    assert.equal(effectiveTaxRatePercent(0), 7);
    assert.equal(effectiveTaxRatePercent(-3), 7);
    assert.equal(effectiveTaxRatePercent(8), 8);
  });

  it("prices a catalog charge with the company rate or the 7% fallback", () => {
    assert.deepEqual(contractChargeFromPreTaxCents(10000, 0), {
      taxRatePercent: 7,
      taxCents: 700,
      amountCents: 10700,
    });
    assert.deepEqual(contractChargeFromPreTaxCents(10000, 8), {
      taxRatePercent: 8,
      taxCents: 800,
      amountCents: 10800,
    });
  });

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
    assert.equal(preTaxCents(10750, 750), 10000);
    assert.equal(preTaxCents(10000, 0), 10000);
    assert.equal(preTaxCents(500, 800), 0);
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

  it("recalculates a contract invoice from the pre-tax total", () => {
    assert.deepEqual(
      recomputeUnpaidInvoiceTax(
        {
          status: "open",
          amountCents: 10750,
          taxCents: 750,
          taxRatePercent: 7.5,
        },
        8,
      ),
      { taxRatePercent: 8, taxCents: 800, amountCents: 10800 },
    );
  });

  it("keeps a discount fixed while the tax-inclusive total changes", () => {
    assert.deepEqual(
      recomputeUnpaidInvoiceTax(
        {
          status: "open",
          originalAmountCents: 10750,
          amountCents: 9750,
          discountCents: 1000,
          taxCents: 750,
          taxRatePercent: 7.5,
        },
        8,
      ),
      {
        taxRatePercent: 8,
        taxCents: 800,
        originalAmountCents: 10800,
        amountCents: 9800,
      },
    );
  });

  it("applies the company rate to a work order stored at 0%", () => {
    assert.deepEqual(
      companyTaxForUnpaidWorkOrder(
        {
          paid: false,
          subtotal: 320,
          shipping: 0,
          taxRate: 0,
          tax: 0,
          total: 320,
        },
        DEFAULT_TAX_RATE_PERCENT,
      ),
      { taxRate: 7, tax: 22.4, total: 342.4 },
    );
    assert.deepEqual(
      recomputeUnpaidInvoiceTax(
        {
          status: "open",
          amountCents: 32000,
          taxCents: 0,
          taxRatePercent: 0,
          workOrder: {
            paid: false,
            subtotal: 320,
            shipping: 0,
            taxRate: 0,
            tax: 0,
            total: 320,
          },
        },
        7,
      ),
      {
        taxRatePercent: 7,
        taxCents: 2240,
        amountCents: 34240,
        workOrder: { taxRate: 7, tax: 22.4, total: 342.4 },
      },
    );
  });

  it("taxes a work order on subtotal and leaves shipping untaxed", () => {
    const next = recomputeUnpaidInvoiceTax(
      {
        status: "open",
        amountCents: 11750,
        taxCents: 750,
        taxRatePercent: 7.5,
        workOrder: {
          paid: false,
          subtotal: 100,
          shipping: 10,
          taxRate: 7.5,
          tax: 7.5,
          total: 117.5,
        },
      },
      8,
    );
    assert.deepEqual(next, {
      taxRatePercent: 8,
      taxCents: 800,
      amountCents: 11800,
      workOrder: { taxRate: 8, tax: 8, total: 118 },
    });
  });

  it("leaves paid, void, and manually overridden invoices unchanged", () => {
    const priced = {
      amountCents: 10750,
      taxCents: 750,
      taxRatePercent: 7.5,
    };
    assert.equal(invoiceEligibleForCompanyTaxRate({ status: "paid" }), false);
    assert.equal(invoiceEligibleForCompanyTaxRate({ status: "void" }), false);
    assert.equal(
      invoiceEligibleForCompanyTaxRate({
        status: "open",
        taxOverridden: true,
      }),
      false,
    );
    assert.equal(
      invoiceEligibleForCompanyTaxRate({
        status: "open",
        workOrder: { taxOverridden: true },
      }),
      false,
    );
    assert.equal(
      invoiceEligibleForCompanyTaxRate({
        status: "open",
        workOrder: { paid: true },
      }),
      false,
    );
    assert.equal(invoiceEligibleForCompanyTaxRate({ status: "draft" }), true);
    assert.equal(invoiceEligibleForCompanyTaxRate({ status: "failed" }), true);
    assert.equal(recomputeUnpaidInvoiceTax({ status: "paid", ...priced }, 8), null);
    assert.equal(recomputeUnpaidInvoiceTax({ status: "void", ...priced }, 8), null);
    assert.equal(
      recomputeUnpaidInvoiceTax(
        { status: "open", taxOverridden: true, ...priced },
        8,
      ),
      null,
    );
    assert.equal(
      recomputeUnpaidInvoiceTax(
        {
          status: "open",
          ...priced,
          workOrder: { taxOverridden: true, subtotal: 100, shipping: 0 },
        },
        8,
      ),
      null,
    );
  });

  it("skips an invoice that already matches the new rate", () => {
    assert.equal(
      recomputeUnpaidInvoiceTax(
        {
          status: "failed",
          amountCents: 10800,
          taxCents: 800,
          taxRatePercent: 8,
        },
        8,
      ),
      null,
    );
  });
});
