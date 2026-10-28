import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseKeptDuplicate,
  duplicateWorkOrderScore,
  legacyRowCalendarDay,
  matchCrmWorkOrderForLegacyRow,
  mergeLegacyDescPerform,
  type CrmLinkCandidate,
} from "./legacyDumpSync";

const customerRef = "cust-1";

function candidate(overrides: Partial<CrmLinkCandidate> = {}): CrmLinkCandidate {
  return {
    _id: "crm-1",
    customerRef,
    legacyId: null,
    date: new Date("2026-10-28T04:00:00.000Z"),
    scheduledStart: null,
    deletedAt: null,
    appointmentCanceledAt: null,
    ...overrides,
  };
}

describe("matchCrmWorkOrderForLegacyRow", () => {
  const siteRow = { date: new Date("2026-10-28T00:00:00.000Z") };

  it("skips the site row when the customer already has a job that day", () => {
    const match = candidate();
    const decision = matchCrmWorkOrderForLegacyRow(siteRow, customerRef, [
      match,
      candidate({
        _id: "other-customer",
        customerRef: "cust-2",
      }),
      candidate({
        _id: "other-day",
        date: new Date("2026-10-27T04:00:00.000Z"),
      }),
    ]);
    assert.equal(decision.action, "skip");
    if (decision.action === "skip") assert.equal(decision.matches[0]?._id, "crm-1");
  });

  it("treats a New York midnight CRM date as the same day as a UTC-midnight site date", () => {
    assert.equal(
      legacyRowCalendarDay(new Date("2026-10-28T04:00:00.000Z")),
      "2026-10-28",
    );
    assert.equal(
      legacyRowCalendarDay(new Date("2026-10-28T00:00:00.000Z")),
      "2026-10-28",
    );
    const winterSite = { date: new Date("2026-01-15T00:00:00.000Z") };
    const decision = matchCrmWorkOrderForLegacyRow(winterSite, customerRef, [
      candidate({ date: new Date("2026-01-15T05:00:00.000Z") }),
    ]);
    assert.equal(decision.action, "skip");
  });

  it("does not match a scheduled start that falls on the previous New York day", () => {
    const decision = matchCrmWorkOrderForLegacyRow(siteRow, customerRef, [
      candidate({
        date: null,
        scheduledStart: new Date("2026-10-28T03:30:00.000Z"),
      }),
    ]);
    assert.deepEqual(decision, { action: "none" });
  });

  it("does not match a winter date stored an hour before New York midnight", () => {
    const decision = matchCrmWorkOrderForLegacyRow(
      { date: new Date("2026-01-15T00:00:00.000Z") },
      customerRef,
      [candidate({ date: new Date("2026-01-15T04:00:00.000Z") })],
    );
    assert.deepEqual(decision, { action: "none" });
  });

  it("ignores canceled and deleted jobs", () => {
    const decision = matchCrmWorkOrderForLegacyRow(siteRow, customerRef, [
      candidate({ _id: "canceled", appointmentCanceledAt: new Date() }),
      candidate({ _id: "deleted", deletedAt: new Date() }),
    ]);
    assert.deepEqual(decision, { action: "none" });
  });

  it("skips when the only job that day already came from the site", () => {
    const decision = matchCrmWorkOrderForLegacyRow(siteRow, customerRef, [
      candidate({ _id: "imported", legacyId: 6339 }),
    ]);
    assert.equal(decision.action, "skip");
  });

  it("skips when several jobs already share the day", () => {
    const decision = matchCrmWorkOrderForLegacyRow(siteRow, customerRef, [
      candidate({ _id: "a" }),
      candidate({ _id: "b" }),
    ]);
    assert.equal(decision.action, "skip");
    if (decision.action === "skip") {
      assert.deepEqual(
        decision.matches.map((match) => match._id),
        ["a", "b"],
      );
    }
  });

  it("returns none when the row has no date or customer", () => {
    assert.deepEqual(
      matchCrmWorkOrderForLegacyRow({ date: null }, customerRef, [candidate()]),
      { action: "none" },
    );
    assert.deepEqual(
      matchCrmWorkOrderForLegacyRow(siteRow, "  ", [candidate()]),
      { action: "none" },
    );
  });
});

describe("mergeLegacyDescPerform", () => {
  it("fills a blank CRM description and appends different site text", () => {
    assert.equal(mergeLegacyDescPerform("", "ASC\r\nDO A TEST"), "ASC\nDO A TEST");
    assert.equal(
      mergeLegacyDescPerform("Already noted", "ASC"),
      "Already noted\nASC",
    );
  });

  it("leaves the CRM text alone when the site text is blank or already included", () => {
    assert.equal(mergeLegacyDescPerform("ASC", "  "), null);
    assert.equal(mergeLegacyDescPerform("ASC do a test", "asc   do a test"), null);
    assert.equal(mergeLegacyDescPerform("ASC do a test today", "ASC"), null);
  });
});

describe("chooseKeptDuplicate", () => {
  it("keeps the scheduled CRM copy over a blank site copy", () => {
    const crm = {
      legacyId: null as number | null,
      scheduledStart: new Date("2026-10-28T14:00:00.000Z"),
      total: 321,
      parts: [{ lineType: "product", amount: 321, unitPrice: 321 }],
      hasInvoice: true,
    };
    const site = {
      legacyId: 6339,
      scheduledStart: null,
      total: 0,
      parts: [],
      hasInvoice: false,
    };
    const choice = chooseKeptDuplicate(crm, site, duplicateWorkOrderScore);
    assert.equal(choice.kept, crm);
    assert.equal(choice.dropped, site);
    assert.equal(choice.reason, "score 4 over 0");
  });

  it("keeps the scheduled site copy when the CRM copy is empty", () => {
    const crm = {
      legacyId: null as number | null,
      scheduledStart: null,
      total: 0,
      parts: [],
      hasInvoice: false,
    };
    const site = {
      legacyId: 6247,
      scheduledStart: new Date("2026-10-29T18:00:00.000Z"),
      total: 0,
      parts: [],
      hasInvoice: false,
    };
    const choice = chooseKeptDuplicate(crm, site, duplicateWorkOrderScore);
    assert.equal(choice.kept, site);
    assert.equal(choice.reason, "score 1 over 0");
  });

  it("keeps the CRM copy when the scores tie", () => {
    const crm = { legacyId: null as number | null, label: "crm" };
    const site = { legacyId: 1, label: "site" };
    const choice = chooseKeptDuplicate(crm, site, () => 2);
    assert.equal(choice.kept, crm);
    assert.equal(choice.reason, "tie, keep CRM copy");
  });
});
