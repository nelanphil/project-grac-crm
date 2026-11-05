import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickLatestAvailableInvoice } from "../services/paymentLinkSelection";
import {
  checkoutAmountBesidePriorAsc,
  priorUnpaidAscForCustomer,
} from "./ascUnpaidRenewals";

const customer = "cust-1";

describe("prior unpaid ASC before the renewal due date", () => {
  it("keeps only this customer's tickets dated before the due date", () => {
    const summary = priorUnpaidAscForCustomer(
      [
        {
          _id: "wo-early",
          legacyId: 2487,
          date: "2025-03-03",
          total: 125,
          customerRef: customer,
        },
        {
          _id: "wo-later",
          number: "WO-2025-00002",
          date: "2025-09-01",
          total: 320.5,
          customerRef: customer,
        },
        {
          _id: "wo-due-day",
          number: "WO-2026-00010",
          date: "2026-10-01",
          total: 320,
          customerRef: customer,
        },
        {
          _id: "wo-other",
          number: "WO-2025-00099",
          date: "2025-04-01",
          total: 200,
          customerRef: "cust-2",
        },
        {
          _id: "wo-undated",
          number: "WO-2024-00001",
          date: null,
          total: 100,
          customerRef: customer,
        },
      ],
      customer,
      "2026-10-01",
    );

    assert.ok(summary);
    assert.equal(summary.count, 2);
    assert.equal(summary.totalCents, 44550);
    assert.deepEqual(
      summary.workOrders.map((row) => row.number),
      ["2487", "WO-2025-00002"],
    );
    assert.equal(summary.workOrders[0]?.date, "2025-03-03");
    assert.equal(summary.workOrders[0]?.totalCents, 12500);
  });

  it("returns null when every unpaid ASC ticket is the renewal now due", () => {
    assert.equal(
      priorUnpaidAscForCustomer(
        [
          {
            _id: "wo-current",
            number: "WO-2026-00010",
            date: "2026-10-12",
            total: 320,
            customerRef: customer,
          },
        ],
        customer,
        new Date("2026-10-01T00:00:00.000Z"),
      ),
      null,
    );
  });

  it("returns null without a customer or a due date", () => {
    const ticket = [
      {
        _id: "wo-early",
        number: "2487",
        date: "2025-03-03",
        total: 125,
        customerRef: customer,
      },
    ];
    assert.equal(priorUnpaidAscForCustomer(ticket, "", "2026-10-01"), null);
    assert.equal(priorUnpaidAscForCustomer(ticket, customer, null), null);
  });

  it("keeps the link total on the latest invoice and reports prior ASC beside it", () => {
    const now = new Date("2026-11-05T15:00:00.000Z");
    const picked = pickLatestAvailableInvoice(
      [
        {
          _id: "older",
          status: "open",
          sourceType: "contract_renewal",
          dueDate: new Date("2025-11-04T00:00:00.000Z"),
          issuedAt: new Date("2025-11-04T15:00:00.000Z"),
          amountCents: 12500,
        },
        {
          _id: "current",
          status: "open",
          sourceType: "contract_renewal",
          dueDate: new Date("2026-11-04T00:00:00.000Z"),
          issuedAt: new Date("2026-11-04T15:00:00.000Z"),
          amountCents: 32000,
        },
      ],
      new Map(),
      now,
    );
    const prior = priorUnpaidAscForCustomer(
      [
        {
          _id: "wo-early",
          number: "2487",
          date: "2025-11-04",
          total: 125,
          customerRef: customer,
        },
      ],
      customer,
      "2026-11-04",
    );
    const shown = checkoutAmountBesidePriorAsc(
      picked?.amountCents ?? null,
      prior,
    );

    assert.equal(picked?._id, "current");
    assert.equal(shown.paymentLinkAmountCents, 32000);
    assert.equal(shown.priorAscUnpaid?.count, 1);
    assert.equal(shown.priorAscUnpaid?.totalCents, 12500);
    assert.notEqual(
      shown.paymentLinkAmountCents,
      (shown.paymentLinkAmountCents ?? 0) +
        (shown.priorAscUnpaid?.totalCents ?? 0),
    );
  });
});
