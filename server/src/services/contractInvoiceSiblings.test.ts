import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  SUPERSEDED_BY_PAYMENT,
  voidSiblingContractInvoices,
} from "./contractInvoiceSiblings";

function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), {
    select: () => query(value),
    sort: () => query(value),
    lean: async () => value,
  });
}

describe("voidSiblingContractInvoices", () => {
  afterEach(() => mock.restoreAll());

  it("voids the other open offer and keeps the paid invoice", async () => {
    const customerRef = new Types.ObjectId();
    const templateId = new Types.ObjectId();
    const standingId = new Types.ObjectId();
    const offerId = new Types.ObjectId();
    const paidId = new Types.ObjectId();
    const sibling = new Invoice({
      number: "OFFER-1",
      customerId: 42,
      customerRef,
      sourceType: "contract_initial",
      contractRef: offerId,
      status: "open",
      amountCents: 32100,
      metadata: { temporaryContract: true },
    });
    mock.method(sibling, "save", async () => sibling);
    mock.method(Contract, "find", () =>
      query([
        { _id: standingId, temporary: false },
        { _id: offerId, temporary: true },
      ]),
    );
    mock.method(Invoice, "find", () => query([sibling]));
    mock.method(Invoice, "countDocuments", async () => 0);
    mock.method(WorkOrder, "countDocuments", async () => 0);
    const deleted: string[] = [];
    mock.method(Contract, "deleteOne", async (filter: { _id: unknown }) => {
      deleted.push(String(filter._id));
      return { deletedCount: 1 };
    });

    const result = await voidSiblingContractInvoices({
      keepInvoiceId: paidId,
      customerRef,
      customerId: 42,
      templateId,
      contractType: "service",
      paidInvoiceNumber: "RENEW-1",
    });

    assert.deepEqual(result.voidedInvoiceNumbers, ["OFFER-1"]);
    assert.equal(sibling.status, "void");
    assert.equal(sibling.metadata?.voidReason, SUPERSEDED_BY_PAYMENT);
    assert.equal(sibling.metadata?.supersededByInvoiceNumber, "RENEW-1");
    assert.deepEqual(result.deletedOfferContractIds, [String(offerId)]);
    assert.deepEqual(deleted, [String(offerId)]);
  });
});
