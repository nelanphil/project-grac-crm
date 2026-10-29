import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renewalCohortFilterForMonth,
  renewalCohortStatus,
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
});
