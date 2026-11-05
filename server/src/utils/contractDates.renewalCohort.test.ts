import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listRenewalStatus,
  renewalCohortFilterForMonth,
  renewalCohortStatus,
  renewalOutreachFilterForMonth,
} from "./contractDates";

describe("renewal cohort month", () => {
  it("includes this month, earlier anniversaries, and next year's renewed due date", () => {
    const filter = renewalCohortFilterForMonth(2026, 10);
    const or = filter.$or as Array<Record<string, unknown>>;
    assert.equal(or.length, 3);

    const due = or[0].renewalDueDate as { $gte: Date; $lt: Date };
    assert.equal(due.$gte.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(due.$lt.toISOString(), "2026-11-01T00:00:00.000Z");

    const renewed = or[2].renewalDueDate as { $gte: Date; $lt: Date };
    assert.equal(renewed.$gte.toISOString(), "2027-10-01T00:00:00.000Z");
    assert.equal(renewed.$lt.toISOString(), "2027-11-01T00:00:00.000Z");
    assert.deepEqual(or[2].lastRenewalDate, { $exists: true, $ne: null });
  });

  it("labels a rolled-forward contract as renewed and a past anniversary as overdue", () => {
    const scope = { year: 2026, month: 10 };
    const today = new Date("2026-10-29T12:00:00.000Z");
    assert.equal(
      renewalCohortStatus(
        new Date("2027-10-12T00:00:00.000Z"),
        new Date("2026-10-12T00:00:00.000Z"),
        scope,
        today,
      ),
      "renewed",
    );
    assert.equal(
      renewalCohortStatus(
        new Date("2026-10-31T00:00:00.000Z"),
        null,
        scope,
        today,
      ),
      "due",
    );
    assert.equal(
      renewalCohortStatus(
        new Date("2025-10-04T00:00:00.000Z"),
        new Date("2024-10-04T00:00:00.000Z"),
        scope,
        today,
      ),
      "overdue",
    );
    assert.equal(
      renewalCohortStatus(
        new Date("2026-10-01T00:00:00.000Z"),
        null,
        scope,
        today,
      ),
      "overdue",
    );
  });

  it("leaves already-renewed contracts out of the outreach audience", () => {
    const filter = renewalOutreachFilterForMonth(2026, 11);
    const or = filter.$or as Array<Record<string, unknown>>;
    assert.equal(or.length, 2);
    const due = or[0].renewalDueDate as { $gte: Date; $lt: Date };
    assert.equal(due.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(due.$lt.toISOString(), "2026-12-01T00:00:00.000Z");
    assert.equal(JSON.stringify(filter).includes("lastRenewalDate"), false);
  });
});

describe("list renewal status", () => {
  const today = new Date("2026-11-05T15:00:00.000Z");

  it("marks a past date overdue", () => {
    assert.equal(
      listRenewalStatus(
        new Date("2026-11-04T00:00:00.000Z"),
        new Date("2025-11-04T00:00:00.000Z"),
        today,
      ),
      "overdue",
    );
  });

  it("marks a date still in this month as due", () => {
    assert.equal(
      listRenewalStatus(
        new Date("2026-11-20T00:00:00.000Z"),
        new Date("2025-11-20T00:00:00.000Z"),
        today,
      ),
      "due",
    );
  });

  it("marks a recorded renewal in a later month as renewed", () => {
    assert.equal(
      listRenewalStatus(
        new Date("2027-11-04T00:00:00.000Z"),
        new Date("2026-11-04T00:00:00.000Z"),
        today,
      ),
      "renewed",
    );
  });

  it("marks a first term with no renewal on file as due", () => {
    assert.equal(
      listRenewalStatus(new Date("2027-03-01T00:00:00.000Z"), null, today),
      "due",
    );
  });
});
