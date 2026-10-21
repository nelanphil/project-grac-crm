import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  legacyWorkOrderStatusPatch,
  matchLegacyWorkOrder,
} from "./legacyDumpSync";
import {
  completedPaidWorkOrderFilter,
  workOrderMatchesCompletedPaid,
} from "./completedPaidReport";

const dump = {
  paid: true,
  completed: true,
  date: new Date("2026-10-01T00:00:00.000Z"),
  totalParts: 10,
  totalLabor: 75,
  miscExp: 0,
  subtotal: 85,
  shipping: 0,
  total: 85,
};

describe("matchLegacyWorkOrder", () => {
  it("updates the single work order with the same user id", () => {
    assert.deepEqual(matchLegacyWorkOrder({ userId: 1 }, [{ userId: 1 }]), {
      action: "update",
    });
  });

  it("skips when none, two, or a different user id match", () => {
    assert.deepEqual(matchLegacyWorkOrder({ userId: 1 }, []), {
      action: "skip",
      reason: "none",
    });
    assert.deepEqual(
      matchLegacyWorkOrder({ userId: 1 }, [{ userId: 1 }, { userId: 1 }]),
      { action: "skip", reason: "duplicate" },
    );
    assert.deepEqual(matchLegacyWorkOrder({ userId: 1 }, [{ userId: 2 }]), {
      action: "skip",
      reason: "user_mismatch",
    });
  });
});

describe("legacyWorkOrderStatusPatch", () => {
  it("writes nothing when paid, completed, date, and total already match", () => {
    assert.equal(
      legacyWorkOrderStatusPatch(
        {
          paid: true,
          completed: true,
          date: "2026-10-01T00:00:00.000Z",
          total: 85,
        },
        dump,
      ),
      null,
    );
  });

  it("sets the flags, date, dump totals, and clears tax when paid changes", () => {
    const patch = legacyWorkOrderStatusPatch(
      {
        paid: false,
        completed: true,
        date: dump.date,
        total: 90.95,
      },
      dump,
    );
    assert.equal(patch?.paid, true);
    assert.equal(patch?.completed, true);
    assert.equal(patch?.date, dump.date);
    assert.equal(patch?.total, 85);
    assert.equal(patch?.totalLabor, 75);
    assert.equal(patch?.tax, 0);
    assert.equal(patch?.taxRate, 0);
    assert.equal(patch?.taxOverridden, false);
  });

  it("updates the date without rewriting money when the total is unchanged", () => {
    const patch = legacyWorkOrderStatusPatch(
      {
        paid: true,
        completed: true,
        date: new Date("2026-09-01T00:00:00.000Z"),
        total: 85,
      },
      dump,
    );
    assert.equal(
      (patch?.date as Date).toISOString(),
      "2026-10-01T00:00:00.000Z",
    );
    assert.equal(patch?.paid, true);
    assert.equal("total" in (patch ?? {}), false);
    assert.equal("tax" in (patch ?? {}), false);
  });
});

describe("completedPaidWorkOrderFilter", () => {
  const octoberStart = new Date("2026-10-01T00:00:00.000Z");
  const novemberStart = new Date("2026-11-01T00:00:00.000Z");

  it("requires both flags and an exclusive end on the work-order date", () => {
    const filter = completedPaidWorkOrderFilter(octoberStart, novemberStart);
    assert.equal(filter.completed, true);
    assert.equal(filter.paid, true);
    assert.equal("createdAt" in filter, false);
    const date = filter.date as { $gte: Date; $lt: Date };
    assert.equal(date.$gte.toISOString(), octoberStart.toISOString());
    assert.equal(date.$lt.toISOString(), novemberStart.toISOString());
  });

  it("includes a completed paid ticket inside the month and excludes the next month", () => {
    const inside = {
      completed: true,
      paid: true,
      date: new Date("2026-10-21T00:00:00.000Z"),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const nextMonth = {
      completed: true,
      paid: true,
      date: novemberStart,
    };
    assert.equal(
      workOrderMatchesCompletedPaid(inside, octoberStart, novemberStart),
      true,
    );
    assert.equal(
      workOrderMatchesCompletedPaid(nextMonth, octoberStart, novemberStart),
      false,
    );
  });

  it("does not include a ticket whose createdAt is in the month when the work-order date is not", () => {
    const createdInOctober = {
      completed: true,
      paid: true,
      date: new Date("2026-09-15T00:00:00.000Z"),
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
    };
    assert.equal(
      workOrderMatchesCompletedPaid(
        createdInOctober,
        octoberStart,
        novemberStart,
      ),
      false,
    );
    assert.equal(
      workOrderMatchesCompletedPaid(
        { completed: false, paid: true, date: octoberStart },
        octoberStart,
        novemberStart,
      ),
      false,
    );
  });
});
