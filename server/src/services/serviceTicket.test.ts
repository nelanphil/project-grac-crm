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
});
