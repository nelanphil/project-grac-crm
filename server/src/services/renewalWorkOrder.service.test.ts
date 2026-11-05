import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coveringVisitSince,
  invoiceNeedsRenewalReportRow,
  isBlankRenewalWorkOrder,
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

  function withCoveringVisit(memory: ReturnType<typeof memoryGateway>): {
    claims: Map<string, string>;
    linkedExisting: string[];
  } {
    const claims = new Map<string, string>();
    const linkedExisting: string[] = [];
    Object.assign(memory.gateway, {
      async findCoveringWorkOrder() {
        return claims.has("visit") && claims.get("visit") !== "inv"
          ? null
          : { id: "visit", number: "WO-visit" };
      },
      async claimWorkOrder(workOrderId: string, invoiceId: string) {
        const owner = claims.get(workOrderId);
        if (owner && owner !== invoiceId) return false;
        claims.set(workOrderId, invoiceId);
        return true;
      },
      async releaseWorkOrder(workOrderId: string, invoiceId: string) {
        if (claims.get(workOrderId) === invoiceId) claims.delete(workOrderId);
      },
      async afterLinkExisting(workOrderId: string) {
        linkedExisting.push(workOrderId);
      },
    } satisfies Partial<RenewalWorkOrderGateway>);
    return { claims, linkedExisting };
  }

  it("links the customer's existing ASC visit instead of creating one", async () => {
    const memory = memoryGateway();
    const visit = withCoveringVisit(memory);
    const result = await performRenewalWorkOrderEnsure("inv", memory.gateway);
    assert.deepEqual(result, {
      workOrderId: "visit",
      number: "WO-visit",
      created: false,
    });
    assert.equal(memory.ref(), "visit");
    assert.deepEqual(memory.created, []);
    assert.deepEqual(visit.linkedExisting, ["visit"]);
    assert.equal(visit.claims.get("visit"), "inv");
  });

  it("creates a work order when another renewal already claimed the visit", async () => {
    const memory = memoryGateway();
    const visit = withCoveringVisit(memory);
    visit.claims.set("visit", "other-inv");
    memory.gateway.findCoveringWorkOrder = async () => ({
      id: "visit",
      number: "WO-visit",
    });
    const result = await performRenewalWorkOrderEnsure("inv", memory.gateway);
    assert.equal(result?.created, true);
    assert.deepEqual(memory.created, [result?.workOrderId]);
    assert.equal(visit.claims.get("visit"), "other-inv");
    assert.deepEqual(visit.linkedExisting, []);
  });

  it("links the visit once when two payments race", async () => {
    const memory = memoryGateway();
    const visit = withCoveringVisit(memory);
    const [left, right] = await Promise.all([
      performRenewalWorkOrderEnsure("inv", memory.gateway),
      performRenewalWorkOrderEnsure("inv", memory.gateway),
    ]);
    assert.equal(left?.workOrderId, "visit");
    assert.equal(right?.workOrderId, "visit");
    assert.deepEqual(memory.created, []);
    assert.deepEqual(visit.linkedExisting, ["visit"]);
    assert.equal(visit.claims.get("visit"), "inv");
  });

  it("releases the visit when the invoice was linked to another work order first", async () => {
    const memory = memoryGateway();
    const visit = withCoveringVisit(memory);
    const linkIfUnset = memory.gateway.linkIfUnset;
    memory.gateway.linkIfUnset = async (invoiceId, workOrderId) => {
      await linkIfUnset(invoiceId, "staff-linked");
      return linkIfUnset(invoiceId, workOrderId);
    };
    const result = await performRenewalWorkOrderEnsure("inv", memory.gateway);
    assert.equal(result?.workOrderId, "staff-linked");
    assert.equal(visit.claims.has("visit"), false);
  });
});

describe("coveringVisitSince", () => {
  it("looks back 90 days from when the invoice was issued", () => {
    const since = coveringVisitSince({
      issuedAt: new Date("2026-10-13T18:20:23.000Z"),
      paidAt: new Date("2026-10-18T00:45:57.000Z"),
    });
    assert.equal(since?.toISOString(), "2026-07-15T18:20:23.000Z");
  });

  it("covers a visit done before the renewal link was paid", () => {
    const since = coveringVisitSince({
      issuedAt: new Date("2026-10-13T18:20:23.000Z"),
    });
    assert.ok(since && new Date("2026-09-24T04:00:00.000Z") >= since);
  });

  it("does not cover last year's visit", () => {
    const since = coveringVisitSince({
      issuedAt: new Date("2026-10-13T18:20:00.000Z"),
    });
    assert.ok(since && new Date("2025-10-13T04:00:00.000Z") < since);
  });

  it("falls back to the payment time, then creation time", () => {
    const paidOnly = coveringVisitSince({ paidAt: new Date("2026-04-01T00:00:00.000Z") });
    assert.equal(paidOnly?.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(coveringVisitSince({}), null);
  });
});

describe("isBlankRenewalWorkOrder", () => {
  const blank = {
    renewalInvoiceRef: "inv",
    date: null,
    scheduledStart: null,
    completed: false,
    deletedAt: null,
    parts: [],
    assignedUserRef: null,
    assignedUserRefs: [],
  };

  it("accepts the untouched work order this invoice created", () => {
    assert.equal(isBlankRenewalWorkOrder(blank, "inv"), true);
  });

  it("rejects a work order made for another invoice or none", () => {
    assert.equal(isBlankRenewalWorkOrder(blank, "other"), false);
    assert.equal(
      isBlankRenewalWorkOrder({ ...blank, renewalInvoiceRef: null }, "inv"),
      false,
    );
  });

  it("rejects a work order staff already worked on", () => {
    const date = new Date("2026-11-03T00:00:00.000Z");
    assert.equal(isBlankRenewalWorkOrder({ ...blank, date }, "inv"), false);
    assert.equal(isBlankRenewalWorkOrder({ ...blank, scheduledStart: date }, "inv"), false);
    assert.equal(isBlankRenewalWorkOrder({ ...blank, completed: true }, "inv"), false);
    assert.equal(isBlankRenewalWorkOrder({ ...blank, parts: [{}] }, "inv"), false);
    assert.equal(isBlankRenewalWorkOrder({ ...blank, assignedUserRef: "tech" }, "inv"), false);
    assert.equal(isBlankRenewalWorkOrder({ ...blank, assignedUserRefs: ["tech"] }, "inv"), false);
    assert.equal(isBlankRenewalWorkOrder({ ...blank, deletedAt: date }, "inv"), false);
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
