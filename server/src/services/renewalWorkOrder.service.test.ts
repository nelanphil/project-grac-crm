import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  invoiceNeedsRenewalReportRow,
  isRenewalVisitScheduled,
  performRenewalWorkOrderEnsure,
  runRenewalWorkOrderSideEffect,
  type RenewalWorkOrderGateway,
} from "./renewalWorkOrder.service";

const paidAt = new Date("2026-03-01T15:00:00.000Z");

describe("isRenewalVisitScheduled", () => {
  it("treats a missing work order as unscheduled", () => {
    assert.equal(isRenewalVisitScheduled(null), false);
    assert.equal(isRenewalVisitScheduled(undefined), false);
  });

  it("treats a work order with no date as unscheduled", () => {
    assert.equal(
      isRenewalVisitScheduled({ date: null, scheduledStart: null }),
      false,
    );
  });

  it("treats a ticket date or a dispatch time as scheduled", () => {
    assert.equal(
      isRenewalVisitScheduled({ date: new Date("2026-11-03T00:00:00.000Z") }),
      true,
    );
    assert.equal(
      isRenewalVisitScheduled({
        scheduledStart: new Date("2026-11-03T14:00:00.000Z"),
      }),
      true,
    );
  });

  it("ignores a deleted work order", () => {
    assert.equal(
      isRenewalVisitScheduled({
        date: new Date("2026-11-03T00:00:00.000Z"),
        deletedAt: new Date("2026-11-01T00:00:00.000Z"),
      }),
      false,
    );
  });
});

describe("invoiceNeedsRenewalReportRow", () => {
  const open = {
    sourceType: "contract_renewal",
    status: "paid",
    serviceWorkOrderRef: null,
    dismissedAt: null,
    referenceAt: paidAt,
    laterWorkOrderCreatedAt: null,
  };

  it("includes a paid renewal with no later work order", () => {
    assert.equal(invoiceNeedsRenewalReportRow(open), true);
  });

  it("includes a paid new contract with no later work order", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({ ...open, sourceType: "contract_initial" }),
      true,
    );
  });

  it("skips invoices that are not contracts", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({ ...open, sourceType: "work_order" }),
      false,
    );
  });

  it("excludes a renewal once a work order exists for that customer after payment", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        laterWorkOrderCreatedAt: new Date("2026-03-02T15:00:00.000Z"),
      }),
      false,
    );
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        laterWorkOrderCreatedAt: paidAt,
      }),
      false,
    );
  });

  it("keeps a renewal when the only later work order is before the payment", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        laterWorkOrderCreatedAt: new Date("2026-02-01T15:00:00.000Z"),
      }),
      true,
    );
  });

  it("keeps dismissed renewals out of the report", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        dismissedAt: new Date("2026-03-03T15:00:00.000Z"),
      }),
      false,
    );
  });

  it("skips renewals that already have a linked work order", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        serviceWorkOrderRef: "wo-1",
      }),
      false,
    );
  });

  it("includes a linked work order that still needs a date", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        serviceWorkOrderRef: "wo-1",
        linkedWorkOrderScheduled: false,
        laterWorkOrderCreatedAt: new Date("2026-03-02T15:00:00.000Z"),
      }),
      true,
    );
  });

  it("skips a linked work order that already has a date", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        serviceWorkOrderRef: "wo-1",
        linkedWorkOrderScheduled: true,
      }),
      false,
    );
  });

  it("skips a linked work order that is already completed", () => {
    assert.equal(
      invoiceNeedsRenewalReportRow({
        ...open,
        serviceWorkOrderRef: "wo-1",
        linkedWorkOrderScheduled: false,
        linkedWorkOrderCompleted: true,
      }),
      false,
    );
  });
});

describe("performRenewalWorkOrderEnsure", () => {
  function memoryGateway(sourceType = "contract_renewal"): {
    gateway: RenewalWorkOrderGateway;
    created: string[];
    discarded: string[];
    ref: () => string | null;
  } {
    let linked: string | null = null;
    const created: string[] = [];
    const discarded: string[] = [];
    let seq = 0;
    const gateway: RenewalWorkOrderGateway = {
      async loadInvoice() {
        return {
          status: "paid",
          sourceType,
          serviceWorkOrderRef: linked,
          dismissed: false,
        };
      },
      async loadExistingWorkOrder(id) {
        return { id, number: `WO-${id}` };
      },
      async createWorkOrder() {
        seq += 1;
        const id = `new-${seq}`;
        created.push(id);
        return { id, number: `WO-${id}` };
      },
      async linkIfUnset(_invoiceId, workOrderId) {
        if (linked) return false;
        linked = workOrderId;
        return true;
      },
      async readLinkedRef() {
        return linked;
      },
      async discardWorkOrder(id) {
        discarded.push(id);
      },
    };
    return { gateway, created, discarded, ref: () => linked };
  }

  it("creates one work order when called twice", async () => {
    const memory = memoryGateway();
    const first = await performRenewalWorkOrderEnsure("inv", memory.gateway);
    const second = await performRenewalWorkOrderEnsure("inv", memory.gateway);
    assert.equal(first?.created, true);
    assert.equal(second?.created, false);
    assert.equal(second?.workOrderId, first?.workOrderId);
    assert.deepEqual(memory.created, [first?.workOrderId]);
    assert.deepEqual(memory.discarded, []);
  });

  it("keeps the winning work order when two creates race", async () => {
    const memory = memoryGateway();
    const [left, right] = await Promise.all([
      performRenewalWorkOrderEnsure("inv", memory.gateway),
      performRenewalWorkOrderEnsure("inv", memory.gateway),
    ]);
    const ids = [left?.workOrderId, right?.workOrderId];
    assert.equal(ids.filter((id) => id === memory.ref()).length, 2);
    assert.equal(memory.created.length, 2);
    assert.equal(memory.discarded.length, 1);
    assert.notEqual(memory.discarded[0], memory.ref());
  });

  it("creates a work order for a paid new contract", async () => {
    const memory = memoryGateway("contract_initial");
    const result = await performRenewalWorkOrderEnsure("inv", memory.gateway);
    assert.equal(result?.created, true);
    assert.deepEqual(memory.created, [result?.workOrderId]);
  });

  it("does not create a work order for a work-order invoice", async () => {
    const memory = memoryGateway("work_order");
    const result = await performRenewalWorkOrderEnsure("inv", memory.gateway);
    assert.equal(result, null);
    assert.deepEqual(memory.created, []);
  });
});

describe("runRenewalWorkOrderSideEffect", () => {
  it("lets payment succeed when work order creation throws", async () => {
    await assert.doesNotReject(() =>
      runRenewalWorkOrderSideEffect(async () => {
        throw new Error("service type missing");
      }),
    );
  });
});
