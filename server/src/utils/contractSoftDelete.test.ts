import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseContractPeriod } from "./contractDates";
import { shouldExcludeDeletedContracts } from "../models/mongo/Contract";

describe("parseContractPeriod", () => {
  it("accepts an end date after the start date", () => {
    const period = parseContractPeriod("2026-01-01", "2026-12-31");
    assert.equal(period.ok, true);
    if (!period.ok) return;
    assert.equal(period.startDate.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(period.endDate.toISOString(), "2026-12-31T00:00:00.000Z");
  });

  it("rejects a missing date", () => {
    const period = parseContractPeriod("", "2026-12-31");
    assert.deepEqual(period, {
      ok: false,
      message: "Start date and end date are required",
    });
  });

  it("rejects an end date on or before the start date", () => {
    assert.equal(parseContractPeriod("2026-06-01", "2026-06-01").ok, false);
    assert.equal(parseContractPeriod("2026-06-02", "2026-06-01").ok, false);
    const sameDay = parseContractPeriod("2026-06-01", "2026-06-01");
    assert.equal(sameDay.ok, false);
    if (sameDay.ok) return;
    assert.equal(sameDay.message, "End date must be after the start date");
  });
});

describe("shouldExcludeDeletedContracts", () => {
  it("hides deleted contracts by default", () => {
    assert.equal(shouldExcludeDeletedContracts(undefined, {}), true);
    assert.equal(shouldExcludeDeletedContracts({}, { customerId: 4 }), true);
  });

  it("keeps deleted contracts when the caller opts in", () => {
    assert.equal(
      shouldExcludeDeletedContracts({ includeDeleted: true }, {}),
      false,
    );
  });

  it("keeps a filter that already names deletedAt", () => {
    assert.equal(
      shouldExcludeDeletedContracts(undefined, { deletedAt: { $ne: null } }),
      false,
    );
    assert.equal(
      shouldExcludeDeletedContracts(undefined, {
        $or: [{ deletedAt: null }, { temporary: true }],
      }),
      false,
    );
  });
});
