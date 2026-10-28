import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareWithinDay,
  customerKey,
  desiredMinutes,
  duplicatesFor,
  findDuplicateIds,
  type ScheduleIdentity,
} from "./scheduleDuplicates";

function job(patch: Partial<ScheduleIdentity> & { _id: string }): ScheduleIdentity {
  return {
    customerName: "Ada Lovelace",
    date: "2026-10-28",
    ...patch,
  };
}

describe("customerKey", () => {
  it("prefers the customer record, then the legacy id, then the name", () => {
    assert.equal(
      customerKey(job({ _id: "a", customerRef: "cust-1", customerId: 9 })),
      "ref:cust-1",
    );
    assert.equal(customerKey(job({ _id: "a", customerId: 9 })), "id:9");
    assert.equal(
      customerKey(job({ _id: "a", customerName: "  Ada   Lovelace " })),
      "name:ada lovelace",
    );
    assert.equal(customerKey(job({ _id: "a", customerName: "  " })), "");
  });
});

describe("findDuplicateIds", () => {
  it("flags open work orders for the same customer on the same day", () => {
    const ids = findDuplicateIds([
      job({ _id: "a", customerRef: "cust-1" }),
      job({ _id: "b", customerRef: "cust-1" }),
      job({ _id: "c", customerRef: "cust-2" }),
    ]);
    assert.deepEqual([...ids].sort(), ["a", "b"]);
  });

  it("ignores a different day, completed work, and canceled appointments", () => {
    const ids = findDuplicateIds([
      job({ _id: "a", customerRef: "cust-1", date: "2026-10-28" }),
      job({ _id: "b", customerRef: "cust-1", date: "2026-10-29" }),
      job({ _id: "c", customerRef: "cust-1", completed: true }),
      job({ _id: "d", customerRef: "cust-1", appointmentCanceledAt: "2026-10-28" }),
    ]);
    assert.equal(ids.size, 0);
  });

  it("does not group jobs that have no customer identity", () => {
    const ids = findDuplicateIds([
      job({ _id: "a", customerName: "" }),
      job({ _id: "b", customerName: "   " }),
    ]);
    assert.equal(ids.size, 0);
  });
});

describe("duplicatesFor", () => {
  it("returns the other open jobs for that customer on the target day", () => {
    const jobs = [
      job({ _id: "a", customerRef: "cust-1" }),
      job({ _id: "b", customerRef: "cust-1" }),
      job({ _id: "c", customerRef: "cust-1", date: "2026-10-29" }),
    ];
    assert.deepEqual(
      duplicatesFor(jobs[0]!, "2026-10-28", jobs).map((row) => row._id),
      ["b"],
    );
  });
});

describe("desiredMinutes and compareWithinDay", () => {
  it("reads HH:mm and treats a missing time as last", () => {
    assert.equal(desiredMinutes({ desiredStartTime: "08:30" }), 8 * 60 + 30);
    assert.equal(desiredMinutes({ desiredStartTime: "" }), Number.POSITIVE_INFINITY);
    assert.equal(desiredMinutes({ desiredStartTime: "25:00" }), Number.POSITIVE_INFINITY);
  });

  it("puts unscheduled jobs first, earliest desired time at the top", () => {
    const sorted = [
      job({ _id: "late", desiredStartTime: "15:00" }),
      job({
        _id: "placed",
        scheduledStart: "2026-10-28T13:00:00.000Z",
        desiredStartTime: "07:00",
      }),
      job({ _id: "none" }),
      job({ _id: "early", desiredStartTime: "08:00" }),
    ].sort(compareWithinDay);
    assert.deepEqual(
      sorted.map((row) => row._id),
      ["early", "late", "none", "placed"],
    );
  });
});
