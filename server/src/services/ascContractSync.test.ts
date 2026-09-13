import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  invoiceContainsAscProduct,
  isAscProductCode,
  lineContainsAscProduct,
  textMentionsAscProduct,
  workOrderContainsAscProduct,
} from "../utils/ascProduct";
import {
  deriveAscContractDates,
  pickLatestAscOccurrence,
  standingFromLatestAscDate,
} from "./ascContractSync";

describe("ASC product detection", () => {
  it("accepts ASC and ACS product codes", () => {
    assert.equal(isAscProductCode("ASC"), true);
    assert.equal(isAscProductCode("acs"), true);
    assert.equal(isAscProductCode("ASC "), true);
    assert.equal(isAscProductCode("BAT26R"), false);
    assert.equal(isAscProductCode(""), false);
  });

  it("matches ASC mentions without catching Cascade-style words", () => {
    assert.equal(textMentionsAscProduct("ASC $300 PLUS PARTS"), true);
    assert.equal(textMentionsAscProduct("Annual Service Contract"), true);
    assert.equal(textMentionsAscProduct("ACS 8-10"), true);
    assert.equal(textMentionsAscProduct("Cascade generator"), false);
    assert.equal(textMentionsAscProduct("oil change only"), false);
  });

  it("detects the ASC product on work-order lines or job text", () => {
    assert.equal(
      workOrderContainsAscProduct({
        parts: [
          {
            lineType: "product",
            partNumber: "ASC",
            description: "ANNUAL SERVICE",
          },
        ],
        descPerform: "Tune up",
      }),
      true,
    );
    assert.equal(
      workOrderContainsAscProduct(
        {
          parts: [
            {
              lineType: "product",
              partNumber: "LABOR",
              productRef: "prod-asc",
            },
          ],
        },
        new Set(["prod-asc"]),
      ),
      true,
    );
    assert.equal(
      workOrderContainsAscProduct({
        parts: [],
        descPerform: "ASC soon",
      }),
      true,
    );
    assert.equal(
      workOrderContainsAscProduct({
        parts: [{ lineType: "note", description: "ASC reminder" }],
        descPerform: "Battery replacement",
      }),
      false,
    );
    assert.equal(
      lineContainsAscProduct({ lineType: "note", partNumber: "ASC" }),
      false,
    );
  });

  it("detects ASC on invoice line items", () => {
    assert.equal(
      invoiceContainsAscProduct({
        lineItems: [{ description: "ANNUAL SERVICE (ASC)" }],
      }),
      true,
    );
    assert.equal(
      invoiceContainsAscProduct({
        lineItems: [{ description: "Battery 26R" }],
      }),
      false,
    );
  });
});

describe("latest ASC occurrence", () => {
  it("prefers the newest date across work orders and invoices", () => {
    const latest = pickLatestAscOccurrence([
      {
        kind: "work_order",
        date: new Date("2024-06-01"),
        legacyId: 10,
        id: "wo-old",
      },
      {
        kind: "invoice",
        date: new Date("2025-08-15"),
        id: "inv-new",
      },
      {
        kind: "work_order",
        date: new Date("2025-03-01"),
        legacyId: 99,
        id: "wo-mid",
      },
    ]);
    assert.equal(latest?.id, "inv-new");
    assert.equal(latest?.kind, "invoice");
  });

  it("breaks same-day ties with the later work order", () => {
    const latest = pickLatestAscOccurrence([
      {
        kind: "invoice",
        date: new Date("2026-04-02"),
        id: "inv",
      },
      {
        kind: "work_order",
        date: new Date("2026-04-02"),
        legacyId: 12,
        id: "wo-12",
      },
      {
        kind: "work_order",
        date: new Date("2026-04-02"),
        legacyId: 40,
        id: "wo-40",
      },
    ]);
    assert.equal(latest?.id, "wo-40");
  });

  it("ignores undated rows", () => {
    assert.equal(
      pickLatestAscOccurrence([{ kind: "work_order", date: null, id: "none" }]),
      null,
    );
  });
});

describe("ASC contract dates", () => {
  it("sets last renewal to the latest ASC date and due date 12 months later", () => {
    const derived = deriveAscContractDates(null, new Date("2026-03-20"));
    assert.ok(derived);
    assert.equal(derived.lastRenewalDate.toISOString().slice(0, 10), "2026-03-20");
    assert.equal(derived.renewalDueDate.toISOString().slice(0, 10), "2027-03-20");
    assert.equal(derived.contractDate.toISOString().slice(0, 10), "2026-03-20");
    assert.equal(derived.changed, true);
  });

  it("keeps the original contract date when a newer ASC job is imported", () => {
    const derived = deriveAscContractDates(
      {
        originalContractDate: new Date("2023-04-01"),
        contractDate: new Date("2023-04-01"),
        lastRenewalDate: null,
        renewalDueDate: new Date("2024-04-01"),
        durationMonths: 12,
      },
      new Date("2026-02-10"),
    );
    assert.ok(derived);
    assert.equal(derived.originalContractDate.toISOString().slice(0, 10), "2023-04-01");
    assert.equal(derived.contractDate.toISOString().slice(0, 10), "2023-04-01");
    assert.equal(derived.lastRenewalDate.toISOString().slice(0, 10), "2026-02-10");
    assert.equal(derived.renewalDueDate.toISOString().slice(0, 10), "2027-02-10");
    assert.equal(derived.changed, true);
  });

  it("is a no-op when dates already match the latest ASC job", () => {
    const derived = deriveAscContractDates(
      {
        originalContractDate: new Date("2026-02-10"),
        contractDate: new Date("2026-02-10"),
        lastRenewalDate: new Date("2026-02-10"),
        renewalDueDate: new Date("2027-02-10"),
        durationMonths: 12,
      },
      new Date("2026-02-10"),
    );
    assert.ok(derived);
    assert.equal(derived.changed, false);
  });

  it("marks a customer active when the latest ASC is within the last year", () => {
    assert.equal(
      standingFromLatestAscDate(
        new Date("2026-03-01"),
        new Date("2026-09-13"),
      ),
      "active",
    );
    assert.equal(
      standingFromLatestAscDate(
        new Date("2024-03-01"),
        new Date("2026-09-13"),
      ),
      "expired",
    );
    assert.equal(
      standingFromLatestAscDate(
        new Date("2025-09-20"),
        new Date("2026-09-13"),
      ),
      "due_soon",
    );
  });
});
