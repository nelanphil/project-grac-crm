import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  syncWorkOrderInvoice,
  type WorkOrderInvoiceSource,
} from "./invoice.service";

const originalFindOne = Invoice.findOne;
const originalUpdateOne = WorkOrder.updateOne;
const originalCreate = Invoice.create;

afterEach(() => {
  Invoice.findOne = originalFindOne;
  Invoice.create = originalCreate;
  WorkOrder.updateOne = originalUpdateOne;
});

describe("syncWorkOrderInvoice", () => {
  it("leaves a paid invoice and the work order total alone when the ticket is marked unpaid", async () => {
    let lookups = 0;
    let creates = 0;
    let updates = 0;
    Invoice.findOne = (async () => {
      lookups += 1;
      return {
        _id: new Types.ObjectId(),
        number: "GMOF06032491166",
        status: "paid",
        amountCents: 30000,
      };
    }) as typeof Invoice.findOne;
    Invoice.create = (async () => {
      creates += 1;
      throw new Error("created an invoice");
    }) as typeof Invoice.create;
    WorkOrder.updateOne = (async () => {
      updates += 1;
      throw new Error("rewrote the work order");
    }) as typeof WorkOrder.updateOne;

    const wo: WorkOrderInvoiceSource = {
      _id: new Types.ObjectId(),
      customerId: 617,
      paid: false,
      completed: true,
      subtotal: 300,
      taxRate: 0,
      tax: 0,
      taxOverridden: false,
      total: 300,
    };

    const result = await syncWorkOrderInvoice(wo);

    assert.equal(result.action, "skipped");
    assert.equal(result.invoice?.number, "GMOF06032491166");
    assert.equal(wo.total, 300);
    assert.equal(wo.tax, 0);
    assert.equal(lookups, 1);
    assert.equal(creates, 0);
    assert.equal(updates, 0);
  });
});
