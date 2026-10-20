import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  invoiceAvailabilityDay,
  isInvoiceAvailableThroughToday,
  pickLatestAvailableInvoice,
} from "./paymentLinkSelection";

const NOW = new Date("2026-08-14T16:00:00Z");

describe("payment link invoice selection", () => {
  it("treats a date-only due date as that UTC calendar day", () => {
    assert.equal(
      invoiceAvailabilityDay({ dueDate: new Date("2026-08-15T00:00:00Z") }),
      "2026-08-15",
    );
    assert.equal(
      isInvoiceAvailableThroughToday(
        {
          status: "open",
          sourceType: "contract_renewal",
          dueDate: new Date("2026-08-15T00:00:00Z"),
        },
        null,
        NOW,
      ),
      false,
    );
    assert.equal(
      isInvoiceAvailableThroughToday(
        {
          status: "open",
          sourceType: "contract_renewal",
          dueDate: new Date("2026-08-14T00:00:00Z"),
        },
        null,
        NOW,
      ),
      true,
    );
  });

  it("uses the New York calendar day when an invoice has no due date", () => {
    assert.equal(
      isInvoiceAvailableThroughToday(
        {
          status: "open",
          sourceType: "contract_initial",
          issuedAt: new Date("2026-08-15T05:00:00Z"),
        },
        null,
        NOW,
      ),
      false,
    );
  });

  it("hides a work-order invoice until the job is completed and not deleted", () => {
    const invoice = {
      status: "open",
      sourceType: "work_order",
      workOrderRef: "wo-1",
      issuedAt: NOW,
    };
    assert.equal(isInvoiceAvailableThroughToday(invoice, { completed: false }, NOW), false);
    assert.equal(
      isInvoiceAvailableThroughToday(
        invoice,
        { completed: true, deletedAt: NOW },
        NOW,
      ),
      false,
    );
    assert.equal(
      isInvoiceAvailableThroughToday(invoice, { completed: true }, NOW),
      true,
    );
  });

  it("keeps the newest invoice available through today", () => {
    const older = {
      _id: "older",
      status: "open",
      sourceType: "contract_renewal",
      dueDate: new Date("2026-08-01T00:00:00Z"),
      issuedAt: new Date("2026-08-01T15:00:00Z"),
      createdAt: new Date("2026-08-01T15:00:00Z"),
    };
    const future = {
      _id: "future",
      status: "open",
      sourceType: "contract_renewal",
      dueDate: new Date("2026-09-01T00:00:00Z"),
      issuedAt: new Date("2026-08-14T15:00:00Z"),
    };
    const incomplete = {
      _id: "incomplete",
      status: "failed",
      sourceType: "work_order",
      workOrderRef: "wo-open",
      issuedAt: new Date("2026-08-14T18:00:00Z"),
    };
    const latest = {
      _id: "latest",
      status: "open",
      sourceType: "work_order",
      workOrderRef: "wo-done",
      issuedAt: new Date("2026-08-14T17:00:00Z"),
      createdAt: new Date("2026-08-14T17:00:00Z"),
    };
    const picked = pickLatestAvailableInvoice(
      [older, future, incomplete, latest],
      new Map([
        ["wo-open", { completed: false }],
        ["wo-done", { completed: true }],
      ]),
      NOW,
    );
    assert.equal(picked?._id, "latest");
  });
});
