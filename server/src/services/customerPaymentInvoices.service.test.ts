import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import {
  selectPaymentInvoices,
  type PaymentInvoiceRow,
} from "./customerPaymentInvoices.service";

function invoice(
  partial: Partial<PaymentInvoiceRow> & Pick<PaymentInvoiceRow, "number" | "status">,
): PaymentInvoiceRow {
  return {
    _id: partial._id ?? new Types.ObjectId(),
    number: partial.number,
    status: partial.status,
    amountCents: partial.amountCents ?? 1000,
    paidAt: partial.paidAt ?? null,
    issuedAt: partial.issuedAt ?? new Date("2026-10-29T14:00:00Z"),
    createdAt: partial.createdAt ?? new Date("2026-10-29T14:00:00Z"),
    updatedAt: partial.updatedAt,
  };
}

describe("selectPaymentInvoices", () => {
  it("keeps paid, failed, and attempted invoices and drops ones that were only opened", () => {
    const viewed = invoice({ number: "VIEW", status: "open" });
    const paid = invoice({
      number: "PAID",
      status: "paid",
      paidAt: new Date("2026-10-29T21:37:00Z"),
    });
    const attempted = invoice({ number: "TRY", status: "open" });
    const failed = invoice({
      number: "FAIL",
      status: "failed",
      updatedAt: new Date("2026-10-29T20:00:00Z"),
    });
    const visited = invoice({ number: "VISIT", status: "open" });

    const result = selectPaymentInvoices(
      [viewed, paid, attempted, failed, visited],
      new Map([[String(attempted._id), new Date("2026-10-29T21:00:00Z")]]),
      new Map([[String(visited._id), new Date("2026-10-29T21:10:00Z")]]),
    );

    assert.deepEqual(
      result.map((row) => row.number),
      ["PAID", "VISIT", "TRY", "FAIL"],
    );
  });

  it("uses the latest payment activity time", () => {
    const paid = invoice({
      number: "PAID",
      status: "paid",
      paidAt: new Date("2026-10-29T21:00:00Z"),
      issuedAt: new Date("2026-10-29T14:00:00Z"),
    });
    const result = selectPaymentInvoices(
      [paid],
      new Map(),
      new Map([[String(paid._id), new Date("2026-10-29T21:32:00Z")]]),
    );
    assert.equal(result[0]?.latestAt, new Date("2026-10-29T21:32:00Z").toISOString());
  });
});
