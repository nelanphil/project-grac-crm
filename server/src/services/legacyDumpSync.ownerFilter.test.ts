import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectOwnerLegacyDumpRows } from "./legacyDumpSync";

const customers = [
  { legacyId: 10, userId: 1 },
  { legacyId: 11, userId: 2 },
  { legacyId: 12, userId: 3 },
  { legacyId: 13, userId: 0 },
];

const workOrders = [
  { userId: 1, customerId: 10 },
  { userId: 3, customerId: 12 },
  { userId: 4, customerId: 99 },
  { userId: 2, customerId: 11 },
];

describe("selectOwnerLegacyDumpRows", () => {
  it("drops non-owner customers and their work orders when a customer dump is present", () => {
    const selected = selectOwnerLegacyDumpRows(customers, workOrders, true);
    assert.deepEqual(
      selected.customers.map((row) => row.legacyId),
      [10, 11],
    );
    assert.deepEqual(
      selected.workOrders.map((row) => row.customerId),
      [10, 99, 11],
    );
    assert.equal(selected.customersSkippedNonOwner, 2);
    assert.equal(selected.workOrdersSkippedNonOwner, 1);
  });

  it("drops work orders by user id when no customer dump was uploaded", () => {
    const selected = selectOwnerLegacyDumpRows([], workOrders, false);
    assert.deepEqual(
      selected.workOrders.map((row) => row.customerId),
      [10, 11],
    );
    assert.equal(selected.customersSkippedNonOwner, 0);
    assert.equal(selected.workOrdersSkippedNonOwner, 2);
  });
});
