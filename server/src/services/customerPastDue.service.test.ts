import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import {
  addPastDue,
  dollarsToCents,
  indexPastDueGroups,
  mergePastDueKeys,
  pastDueForCustomer,
} from "./customerPastDue.service";

describe("dollarsToCents", () => {
  it("rounds work-order dollar totals to cents", () => {
    assert.equal(dollarsToCents(450), 45000);
    assert.equal(dollarsToCents(12.345), 1235);
    assert.equal(dollarsToCents(0), 0);
    assert.equal(dollarsToCents(-10), 0);
  });
});

describe("indexPastDueGroups", () => {
  it("keys rows with a customerRef by ref and leftover rows by legacy id", () => {
    const ref = new Types.ObjectId().toString();
    const map = indexPastDueGroups([
      { customerRef: ref, customerId: 12, count: 1, total: 100 },
      { customerRef: null, customerId: 12, count: 1, total: 50 },
      { customerRef: "", customerId: 99, count: 2, total: 20 },
      { customerRef: ref, customerId: 12, count: 0, total: 10 },
    ]);
    assert.deepEqual(map.get(`ref:${ref}`), { count: 1, totalCents: 10000 });
    assert.deepEqual(map.get("legacy:12"), { count: 1, totalCents: 5000 });
    assert.deepEqual(map.get("legacy:99"), { count: 2, totalCents: 2000 });
  });
});

describe("mergePastDueKeys", () => {
  it("adds ref-only and legacy-only totals without double-counting", () => {
    const ref = new Types.ObjectId().toString();
    const map = indexPastDueGroups([
      { customerRef: ref, customerId: 12, count: 1, total: 100 },
      { customerRef: null, customerId: 12, count: 1, total: 50 },
    ]);
    mergePastDueKeys(map, new Map([[ref, 12]]));
    const merged = { count: 2, totalCents: 15000 };
    assert.deepEqual(map.get(`ref:${ref}`), merged);
    assert.deepEqual(map.get("legacy:12"), merged);
  });
});

describe("pastDueForCustomer", () => {
  it("prefers the ref key and falls back to the legacy id", () => {
    const ref = new Types.ObjectId().toString();
    const map = new Map([
      [`ref:${ref}`, { count: 1, totalCents: 1000 }],
      ["legacy:44", { count: 3, totalCents: 3000 }],
    ]);
    assert.deepEqual(pastDueForCustomer(map, ref, 44), {
      count: 1,
      totalCents: 1000,
    });
    assert.deepEqual(pastDueForCustomer(map, null, 44), {
      count: 3,
      totalCents: 3000,
    });
    assert.equal(pastDueForCustomer(map, "missing", 99), null);
  });
});

describe("addPastDue", () => {
  it("treats a missing current value as zero", () => {
    assert.deepEqual(addPastDue(undefined, { count: 2, totalCents: 500 }), {
      count: 2,
      totalCents: 500,
    });
  });
});
