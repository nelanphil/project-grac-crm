import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workOrderInvoiceLineItems } from "./invoice.service";
import { computeTicketTotals, normalizeParts } from "./serviceTicket";

describe("agreement line totals", () => {
  it("keeps agreement amounts out of parts and labor", () => {
    const parts = normalizeParts([
      {
        lineType: "product",
        kind: "part",
        partNumber: "BAT",
        description: "Battery",
        quantity: 1,
        unitPrice: 40,
      },
      {
        lineType: "product",
        kind: "labor",
        partNumber: "LAB",
        description: "Labor",
        quantity: 1,
        unitPrice: 75,
      },
      {
        lineType: "agreement",
        contractTemplateRef: "64b0f2c2a1b2c3d4e5f60711",
        description: "Service Contract",
        quantity: 2,
        unitPrice: 100,
      },
      { lineType: "note", description: "Bring filters" },
    ]);

    const totals = computeTicketTotals({
      parts,
      laborHours: 2,
      laborOverridden: false,
    });

    assert.equal(parts[2]?.lineType, "agreement");
    assert.equal(parts[2]?.kind, "part");
    assert.equal(totals.totalParts, 40);
    assert.equal(totals.totalLabor, 75);
    assert.equal(totals.totalAgreements, 200);
    assert.equal(totals.subtotal, 315);
    assert.equal(totals.total, 315);
  });

  it("keeps equipment lines in the parts total and on the invoice", () => {
    const parts = normalizeParts([
      {
        lineType: "product",
        kind: "equipment",
        partNumber: "GEN",
        description: "Generator",
        quantity: 1,
        unitPrice: 900,
      },
      {
        lineType: "product",
        kind: "part",
        partNumber: "BAT",
        description: "Battery",
        quantity: 1,
        unitPrice: 40,
      },
    ]);

    assert.equal(parts[0]?.kind, "equipment");
    const totals = computeTicketTotals({
      parts,
      laborHours: 0,
      laborOverridden: false,
    });
    assert.equal(totals.totalParts, 940);

    const items = workOrderInvoiceLineItems({
      parts: parts.map((part) => ({
        ...part,
        amount: part.amount,
      })),
      totalLabor: 0,
    });
    assert.equal(items[0]?.description, "Equipment · Generator (GEN)");
  });

  it("labels a blank agreement on the invoice as Agreement", () => {
    const items = workOrderInvoiceLineItems({
      parts: [
        {
          lineType: "agreement",
          description: "",
          amount: 50,
          quantity: 1,
        },
      ],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0]?.description, "Agreement");
    assert.equal(items[0]?.amountCents, 5000);
  });

  it("keeps a zero-bill price off the total and the invoice", () => {
    const parts = normalizeParts([
      {
        lineType: "product",
        kind: "part",
        partNumber: "BAT",
        description: "Battery",
        quantity: 2,
        unitPrice: 40,
        amount: 80,
        zeroBill: true,
      },
      {
        lineType: "product",
        kind: "labor",
        partNumber: "LAB",
        description: "Labor",
        quantity: 1,
        unitPrice: 75,
        zeroBill: true,
      },
      {
        lineType: "agreement",
        contractTemplateRef: "64b0f2c2a1b2c3d4e5f60711",
        description: "Service Contract",
        quantity: 1,
        unitPrice: 100,
        zeroBill: true,
      },
      {
        lineType: "product",
        kind: "part",
        partNumber: "FLT",
        description: "Filter",
        quantity: 1,
        unitPrice: 15,
      },
    ]);

    assert.equal(parts[0]?.zeroBill, true);
    assert.equal(parts[0]?.unitPrice, 40);
    assert.equal(parts[0]?.amount, 0);
    assert.equal(parts[1]?.unitPrice, 75);
    assert.equal(parts[1]?.amount, 0);
    assert.equal(parts[2]?.unitPrice, 100);
    assert.equal(parts[2]?.amount, 0);

    const totals = computeTicketTotals({
      parts,
      laborHours: 2,
      laborOverridden: false,
    });
    assert.equal(totals.totalParts, 15);
    assert.equal(totals.totalLabor, 0);
    assert.equal(totals.totalAgreements, 0);
    assert.equal(totals.total, 15);

    const items = workOrderInvoiceLineItems({
      parts,
      totalLabor: totals.totalLabor,
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.description, "Filter (FLT)");
    assert.equal(items[0]?.amountCents, 1500);

    const restored = normalizeParts([
      {
        lineType: "product",
        kind: "part",
        partNumber: "BAT",
        description: "Battery",
        quantity: 2,
        unitPrice: 40,
        zeroBill: false,
      },
    ]);
    assert.equal(restored[0]?.zeroBill, false);
    assert.equal(restored[0]?.unitPrice, 40);
    assert.equal(restored[0]?.amount, 80);
  });
});

describe("invoice line product descriptions", () => {
  it("keeps the product name and puts the catalog description on detail", () => {
    const items = workOrderInvoiceLineItems({
      parts: [
        {
          lineType: "product",
          description: "OIL FILTER",
          partNumber: "OF1",
          quantity: 1,
          amount: 12,
          catalogDescription: "FULL FLOW",
        },
      ],
    });

    assert.equal(items[0]?.description, "OIL FILTER (OF1)");
    assert.equal(items[0]?.detail, "FULL FLOW");
    assert.equal(items[0]?.amountCents, 1200);
  });

  it("omits detail when the product description is blank", () => {
    const items = workOrderInvoiceLineItems({
      parts: [
        {
          lineType: "product",
          description: "OIL FILTER",
          partNumber: "OF1",
          quantity: 1,
          amount: 12,
          catalogDescription: "  ",
        },
      ],
    });

    assert.equal(items[0]?.description, "OIL FILTER (OF1)");
    assert.equal(items[0]?.detail, undefined);
  });
});
