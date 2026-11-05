import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  foldDuplicateServiceContracts,
  pickKeptServiceContract,
} from "./foldServiceContracts";

function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), {
    select: () => query(value),
    sort: () => query(value),
    lean: async () => value,
  });
}

describe("pickKeptServiceContract", () => {
  it("keeps the contract with the later due date", () => {
    const older = new Contract({
      customerId: 1,
      contractType: "service",
      renewalDueDate: new Date("2026-05-07T00:00:00.000Z"),
    });
    const newer = new Contract({
      customerId: 1,
      contractType: "service",
      renewalDueDate: new Date("2027-10-14T00:00:00.000Z"),
    });
    assert.equal(pickKeptServiceContract([older, newer]), newer);
  });
});

describe("foldDuplicateServiceContracts", () => {
  afterEach(() => mock.restoreAll());

  it("soft-deletes the extra contract and remaps invoices", async () => {
    const customerRef = new Types.ObjectId();
    const kept = new Contract({
      customerId: 2710,
      customerRef,
      contractType: "service",
      originalContractDate: new Date("2025-11-05T00:00:00.000Z"),
      contractDate: new Date("2025-11-05T00:00:00.000Z"),
      lastRenewalDate: new Date("2026-10-14T00:00:00.000Z"),
      renewalDueDate: new Date("2027-10-14T00:00:00.000Z"),
      renewals: [],
    });
    const extra = new Contract({
      customerId: 2710,
      customerRef,
      contractType: "service",
      originalContractDate: new Date("2024-05-07T00:00:00.000Z"),
      contractDate: new Date("2024-05-07T00:00:00.000Z"),
      lastRenewalDate: new Date("2024-05-07T00:00:00.000Z"),
      renewalDueDate: new Date("2025-05-07T00:00:00.000Z"),
      renewals: [],
    });
    mock.method(kept, "save", async () => kept);
    mock.method(extra, "save", async () => extra);
    mock.method(Contract, "find", () => query([kept, extra]));
    mock.method(Invoice, "find", () => query([]));
    mock.method(Invoice, "updateMany", async () => ({ modifiedCount: 1 }));
    mock.method(WorkOrder, "updateMany", async () => ({ modifiedCount: 0 }));

    const result = await foldDuplicateServiceContracts({ customerRef });
    assert.equal(result.keptId, String(kept._id));
    assert.deepEqual(result.foldedIds, [String(extra._id)]);
    assert.ok(extra.deletedAt);
    assert.equal(
      kept.originalContractDate?.toISOString(),
      "2024-05-07T00:00:00.000Z",
    );
    assert.equal(
      kept.renewalDueDate?.toISOString(),
      "2027-10-14T00:00:00.000Z",
    );
  });
});
