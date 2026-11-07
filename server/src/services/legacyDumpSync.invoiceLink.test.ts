import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { syncLegacyBoundInvoiceStatus } from "./legacyDumpSync";

describe("syncLegacyBoundInvoiceStatus", () => {
  it("creates one invoice when a line-item rebuild already stored one and the snapshot is empty", async () => {
    const workOrderId = new Types.ObjectId();
    const customerRef = new Types.ObjectId();
    let stored: {
      _id: Types.ObjectId;
      status: string;
      amountCents: number;
      customerRef: Types.ObjectId;
    } | null = null;
    let creates = 0;
    let updates = 0;

    const models = {
      Invoice: {
        findOne() {
          return {
            select() {
              return { lean: async () => stored };
            },
          };
        },
        async exists() {
          return null;
        },
        async create(doc: {
          status: string;
          amountCents: number;
          customerRef: Types.ObjectId;
        }) {
          creates += 1;
          stored = {
            _id: new Types.ObjectId(),
            status: doc.status,
            amountCents: doc.amountCents,
            customerRef: doc.customerRef,
          };
          return stored;
        },
        async updateOne() {
          updates += 1;
        },
      },
    };

    const wo = {
      _id: workOrderId,
      customerId: 617,
      customerRef,
      number: "789",
      date: new Date("2024-06-04T00:00:00.000Z"),
      descPerform: "ASC",
      parts: [],
      totalLabor: 300,
      miscExp: 0,
      shipping: 0,
    };
    const row = {
      legacyId: 789,
      userId: 1,
      customerId: 617,
      descPerform: "ASC",
      paid: true,
      runHours: 72,
      laborHours: 0,
      date: new Date("2024-06-04T00:00:00.000Z"),
      tech: "CD DH",
      descPerformed: "",
      totalParts: 0,
      totalLabor: 300,
      miscExp: 0,
      subtotal: 300,
      shipping: 0,
      total: 300,
      certify: false,
      completed: true,
    };

    await syncLegacyBoundInvoiceStatus(
      models as never,
      wo,
      row,
      null,
    );
    await syncLegacyBoundInvoiceStatus(
      models as never,
      wo,
      row,
      null,
    );

    assert.equal(creates, 1);
    assert.equal(updates, 0);
    assert.equal(stored?.amountCents, 30000);
    assert.equal(stored?.status, "paid");
  });
});
