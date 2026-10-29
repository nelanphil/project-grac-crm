import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { Contract, type IContract } from "../models/mongo/Contract";
import { Customer } from "../models/mongo/Customer";
import { CustomerActivity } from "../models/mongo/CustomerActivity";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  foldOfferIntoExistingContract,
  foldedRenewalDueDate,
  OFFER_RENEWAL_VOID_REASON,
} from "./offerRenewalFold";

function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), {
    select: () => query(value),
    sort: () => query(value),
    lean: async () => value,
  });
}

describe("foldedRenewalDueDate", () => {
  it("adds one year when the contract is expired", () => {
    const result = foldedRenewalDueDate(
      new Date("2025-08-05T00:00:00.000Z"),
      new Date("2026-10-29T15:03:47.442Z"),
      12,
    );
    assert.equal(result.extended, true);
    assert.equal(result.dueDate.toISOString(), "2027-10-29T00:00:00.000Z");
  });

  it("adds one year when the contract is due on the payment day", () => {
    const result = foldedRenewalDueDate(
      new Date("2026-10-13T00:00:00.000Z"),
      new Date("2026-10-13T20:07:41.314Z"),
      12,
    );
    assert.equal(result.extended, true);
    assert.equal(result.dueDate.toISOString(), "2027-10-13T00:00:00.000Z");
  });

  it("keeps a due date that already covers the year paid for", () => {
    const juskelis = foldedRenewalDueDate(
      new Date("2027-10-21T00:00:00.000Z"),
      new Date("2026-10-15T15:06:06.368Z"),
      12,
    );
    assert.equal(juskelis.extended, false);
    assert.equal(juskelis.dueDate.toISOString(), "2027-10-21T00:00:00.000Z");

    const amy = foldedRenewalDueDate(
      new Date("2027-10-13T00:00:00.000Z"),
      new Date("2026-10-18T00:45:57.789Z"),
      12,
    );
    assert.equal(amy.extended, false);
    assert.equal(amy.dueDate.toISOString(), "2027-10-13T00:00:00.000Z");
  });

  it("still extends a contract that is only a month from due", () => {
    const result = foldedRenewalDueDate(
      new Date("2026-11-15T00:00:00.000Z"),
      new Date("2026-10-15T00:00:00.000Z"),
      12,
    );
    assert.equal(result.extended, true);
    assert.equal(result.dueDate.toISOString(), "2027-11-15T00:00:00.000Z");
  });
});

describe("foldOfferIntoExistingContract", () => {
  const customerId = new Types.ObjectId();
  const templateId = new Types.ObjectId();
  let existing: IContract;
  let offer: IContract;
  let invoice: IInvoice;
  let openRenewal: IInvoice;
  let standing: IContract[];
  let deleted: string[];

  beforeEach(() => {
    existing = new Contract({
      customerId: 42,
      customerRef: customerId,
      templateId,
      temporary: false,
      durationMonths: 12,
      originalContractDate: new Date("2024-08-16T00:00:00.000Z"),
      contractDate: new Date("2024-08-16T00:00:00.000Z"),
      renewalDueDate: new Date("2025-08-16T00:00:00.000Z"),
      renewals: [],
      description: "Annual Service Contract",
      contractType: "asc",
    });
    existing.createdAt = new Date("2024-08-16T00:00:00.000Z");
    offer = new Contract({
      customerId: 42,
      customerRef: customerId,
      templateId,
      temporary: true,
      durationMonths: 12,
      originalContractDate: null,
      contractDate: null,
      renewalDueDate: null,
      renewals: [],
      description: "Annual Service Contract",
      contractType: "asc",
    });
    offer.createdAt = new Date("2026-10-29T12:00:00.000Z");
    invoice = new Invoice({
      number: "GMOF10292680356",
      customerId: 42,
      customerRef: customerId,
      sourceType: "contract_initial",
      contractRef: offer._id,
      templateRef: templateId,
      status: "paid",
      amountCents: 32100,
      paidAt: new Date("2026-10-29T15:00:00.000Z"),
      metadata: {
        temporaryContract: true,
        durationMonths: 12,
        templateLabel: "Annual Service Contract",
      },
    });
    openRenewal = new Invoice({
      number: "INV-2026-00197",
      customerId: 42,
      customerRef: customerId,
      sourceType: "contract_renewal",
      contractRef: existing._id,
      status: "open",
      amountCents: 32100,
      metadata: {},
    });
    standing = [existing];
    deleted = [];
    mock.method(Contract, "findById", (id: Types.ObjectId) => {
      const found = [offer, existing].find(
        (contract) => String(contract._id) === String(id),
      );
      return Promise.resolve(found ?? null);
    });
    mock.method(Contract, "find", () => query(standing));
    mock.method(Contract, "deleteOne", async (filter: { _id: unknown }) => {
      deleted.push(String(filter._id));
      return { deletedCount: 1 };
    });
    mock.method(Invoice, "find", () => query([openRenewal]));
    mock.method(Invoice, "findOne", () => query(openRenewal));
    mock.method(Invoice, "countDocuments", async () => 0);
    mock.method(WorkOrder, "updateMany", async () => ({ modifiedCount: 0 }));
    mock.method(WorkOrder, "countDocuments", async () => 0);
    mock.method(Customer, "exists", async () => ({ _id: customerId }));
    mock.method(NotificationEvent, "create", async () => ({
      _id: new Types.ObjectId(),
      createdAt: new Date(),
    }));
    mock.method(CustomerActivity, "create", async () => ({
      _id: new Types.ObjectId(),
      customerRef: customerId,
      category: "contract",
      action: "renewed",
      actorKind: "system",
      actorUserId: null,
      actorName: "System",
      entityType: "contract",
      entityId: String(existing._id),
      summary: "Contract renewed",
      changes: [],
      metadata: {},
      source: "crm",
      ip: null,
      backfilled: false,
      createdAt: new Date(),
    }));
    for (const doc of [existing, offer, invoice, openRenewal]) {
      mock.method(doc, "save", async () => doc);
    }
  });

  afterEach(() => mock.restoreAll());

  it("extends the existing contract, voids the open renewal, and removes the offer", async () => {
    const result = await foldOfferIntoExistingContract(invoice);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(result.folded, true);
    assert.equal(result.contractId, String(existing._id));
    assert.deepEqual(result.voidedInvoiceNumbers, ["INV-2026-00197"]);
    assert.equal(result.deletedOfferContractId, String(offer._id));
    assert.equal(
      existing.renewalDueDate?.toISOString(),
      "2027-10-29T00:00:00.000Z",
    );
    assert.equal(existing.renewals.length, 1);
    assert.equal(String(existing.renewals[0]?.invoiceRef), String(invoice._id));
    assert.equal(openRenewal.status, "void");
    assert.equal(openRenewal.metadata?.voidReason, OFFER_RENEWAL_VOID_REASON);
    assert.equal(
      openRenewal.metadata?.supersededByInvoiceNumber,
      "GMOF10292680356",
    );
    assert.equal(invoice.sourceType, "contract_renewal");
    assert.equal(String(invoice.contractRef), String(existing._id));
    assert.deepEqual(deleted, [String(offer._id)]);
  });

  it("does not write during a dry run", async () => {
    const result = await foldOfferIntoExistingContract(invoice, { dryRun: true });
    assert.equal(result.folded, true);
    assert.equal(result.contractId, String(existing._id));
    assert.deepEqual(result.voidedInvoiceNumbers, ["INV-2026-00197"]);
    assert.equal(result.deletedOfferContractId, String(offer._id));
    assert.equal(invoice.sourceType, "contract_initial");
    assert.equal(openRenewal.status, "open");
    assert.equal(existing.renewals.length, 0);
    assert.deepEqual(deleted, []);
  });

  it("promotes the offer when the customer has no earlier contract", async () => {
    standing = [];
    const result = await foldOfferIntoExistingContract(invoice);
    assert.equal(result.folded, false);
    assert.equal(result.promoted, true);
    assert.equal(result.contractId, String(offer._id));
    assert.equal(offer.temporary, false);
    assert.equal(
      offer.renewalDueDate?.toISOString(),
      "2027-10-29T00:00:00.000Z",
    );
    assert.equal(invoice.sourceType, "contract_initial");
    assert.deepEqual(deleted, []);
  });

  it("keeps the renewal date when the older contract already covers the payment", async () => {
    existing.renewalDueDate = new Date("2027-10-21T00:00:00.000Z");
    invoice.paidAt = new Date("2026-10-15T15:06:06.368Z");
    const result = await foldOfferIntoExistingContract(invoice);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(result.folded, true);
    assert.equal(result.extendedRenewal, false);
    assert.equal(result.renewalDueDate, "2027-10-21T00:00:00.000Z");
    assert.equal(existing.renewalDueDate?.toISOString(), "2027-10-21T00:00:00.000Z");
    assert.equal(existing.renewals.length, 0);
    assert.equal(openRenewal.status, "void");
    assert.deepEqual(deleted, [String(offer._id)]);
  });

  it("leaves an already promoted contract when there is no earlier one", async () => {
    standing = [];
    offer.temporary = false;
    offer.renewalDueDate = new Date("2027-10-29T00:00:00.000Z");
    const result = await foldOfferIntoExistingContract(invoice);
    assert.equal(result.folded, false);
    assert.equal(result.promoted, false);
    assert.equal(invoice.sourceType, "contract_initial");
    assert.deepEqual(deleted, []);
  });
});
