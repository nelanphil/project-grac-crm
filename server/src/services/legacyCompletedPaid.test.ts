import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  legacyWorkOrderStatusPatch,
  matchLegacyWorkOrder,
} from "./legacyDumpSync";
import {
  completedPaidWorkOrderFilter,
  pendingPaymentWorkOrderFilter,
  workOrderMatchesCompletedPaid,
  workOrderMatchesPendingPayment,
} from "./completedPaidReport";
import { legacyOwnerForUserId } from "./legacyLoginOwners";
import {
  ownerWorkOrderMongoFilter,
  resolveFinancialsOwnerRequest,
  workOrderBelongsToOwner,
} from "./financialsOwnerScope";

const dump = {
  paid: true,
  completed: true,
  date: new Date("2026-10-01T00:00:00.000Z"),
  totalParts: 10,
  totalLabor: 75,
  miscExp: 0,
  subtotal: 85,
  shipping: 0,
  total: 85,
};

describe("matchLegacyWorkOrder", () => {
  it("updates the single work order with the same user id", () => {
    assert.deepEqual(matchLegacyWorkOrder({ userId: 1 }, [{ userId: 1 }]), {
      action: "update",
    });
  });

  it("skips when none, two, or a different user id match", () => {
    assert.deepEqual(matchLegacyWorkOrder({ userId: 1 }, []), {
      action: "skip",
      reason: "none",
    });
    assert.deepEqual(
      matchLegacyWorkOrder({ userId: 1 }, [{ userId: 1 }, { userId: 1 }]),
      { action: "skip", reason: "duplicate" },
    );
    assert.deepEqual(matchLegacyWorkOrder({ userId: 1 }, [{ userId: 2 }]), {
      action: "skip",
      reason: "user_mismatch",
    });
  });
});

describe("legacyWorkOrderStatusPatch", () => {
  it("writes nothing when paid, completed, date, and total already match", () => {
    assert.equal(
      legacyWorkOrderStatusPatch(
        {
          paid: true,
          completed: true,
          date: "2026-10-01T00:00:00.000Z",
          total: 85,
        },
        dump,
      ),
      null,
    );
  });

  it("sets the flags, date, dump totals, and clears tax when paid changes", () => {
    const patch = legacyWorkOrderStatusPatch(
      {
        paid: false,
        completed: true,
        date: dump.date,
        total: 90.95,
      },
      dump,
    );
    assert.equal(patch?.paid, true);
    assert.equal(patch?.completed, true);
    assert.equal(patch?.date, dump.date);
    assert.equal(patch?.total, 85);
    assert.equal(patch?.totalLabor, 75);
    assert.equal(patch?.tax, 0);
    assert.equal(patch?.taxRate, 0);
    assert.equal(patch?.taxOverridden, false);
  });

  it("updates the date without rewriting money when the total is unchanged", () => {
    const patch = legacyWorkOrderStatusPatch(
      {
        paid: true,
        completed: true,
        date: new Date("2026-09-01T00:00:00.000Z"),
        total: 85,
      },
      dump,
    );
    assert.equal(
      (patch?.date as Date).toISOString(),
      "2026-10-01T00:00:00.000Z",
    );
    assert.equal(patch?.paid, true);
    assert.equal("total" in (patch ?? {}), false);
    assert.equal("tax" in (patch ?? {}), false);
  });
});

describe("completedPaidWorkOrderFilter", () => {
  const octoberStart = new Date("2026-10-01T00:00:00.000Z");
  const novemberStart = new Date("2026-11-01T00:00:00.000Z");

  it("requires both flags and an exclusive end on the work-order date", () => {
    const filter = completedPaidWorkOrderFilter(octoberStart, novemberStart);
    assert.equal(filter.completed, true);
    assert.equal(filter.paid, true);
    assert.equal("createdAt" in filter, false);
    const date = filter.date as { $gte: Date; $lt: Date };
    assert.equal(date.$gte.toISOString(), octoberStart.toISOString());
    assert.equal(date.$lt.toISOString(), novemberStart.toISOString());
  });

  it("includes a completed paid ticket inside the month and excludes the next month", () => {
    const inside = {
      completed: true,
      paid: true,
      date: new Date("2026-10-21T00:00:00.000Z"),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const nextMonth = {
      completed: true,
      paid: true,
      date: novemberStart,
    };
    assert.equal(
      workOrderMatchesCompletedPaid(inside, octoberStart, novemberStart),
      true,
    );
    assert.equal(
      workOrderMatchesCompletedPaid(nextMonth, octoberStart, novemberStart),
      false,
    );
  });

  it("does not include a ticket whose createdAt is in the month when the work-order date is not", () => {
    const createdInOctober = {
      completed: true,
      paid: true,
      date: new Date("2026-09-15T00:00:00.000Z"),
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
    };
    assert.equal(
      workOrderMatchesCompletedPaid(
        createdInOctober,
        octoberStart,
        novemberStart,
      ),
      false,
    );
    assert.equal(
      workOrderMatchesCompletedPaid(
        { completed: false, paid: true, date: octoberStart },
        octoberStart,
        novemberStart,
      ),
      false,
    );
  });
});

describe("pending payment (pp.php)", () => {
  it("is completed and unpaid with no date or amount condition", () => {
    assert.deepEqual(pendingPaymentWorkOrderFilter(), {
      completed: true,
      paid: false,
    });
  });

  it("includes completed unpaid tickets at any date, including $0", () => {
    assert.equal(
      workOrderMatchesPendingPayment({ completed: true, paid: false }),
      true,
    );
    assert.equal(
      workOrderMatchesPendingPayment({ completed: true, paid: false, total: 0 }),
      true,
    );
  });

  it("excludes paid tickets and tickets that are not completed", () => {
    assert.equal(
      workOrderMatchesPendingPayment({ completed: true, paid: true }),
      false,
    );
    assert.equal(
      workOrderMatchesPendingPayment({ completed: false, paid: false }),
      false,
    );
  });

  it("limits an owner's list to that website login", () => {
    const owned = new Set<string>();
    const tickets = [
      { userId: 1, completed: true, paid: false },
      { userId: 2, completed: true, paid: false },
      { userId: 1, completed: true, paid: true },
    ];
    const christopher = tickets.filter(
      (ticket) =>
        workOrderMatchesPendingPayment(ticket) &&
        workOrderBelongsToOwner(ticket, 1, owned),
    );
    assert.equal(christopher.length, 1);
    assert.equal(christopher[0]?.userId, 1);
  });
});

describe("legacyOwnerForUserId", () => {
  it("assigns website user 1 to Christopher and user 2 to Dustin", () => {
    assert.deepEqual(legacyOwnerForUserId(1), {
      legacyUserId: 1,
      firstName: "Christopher",
      lastName: "Hatton",
    });
    assert.deepEqual(legacyOwnerForUserId(2), {
      legacyUserId: 2,
      firstName: "Dustin",
      lastName: "Hatton",
    });
    assert.equal(legacyOwnerForUserId(6), null);
  });
});

describe("owner financials scope", () => {
  const christopher = "christopher-id";
  const dustin = "dustin-id";

  it("keeps a mapped login on that owner and native tickets on the customer owner", () => {
    const owned = new Set(["customer-a"]);
    assert.equal(
      workOrderBelongsToOwner({ userId: 1, customerRef: "other" }, 1, owned),
      true,
    );
    assert.equal(
      workOrderBelongsToOwner({ userId: 2, customerRef: "customer-a" }, 1, owned),
      false,
    );
    assert.equal(
      workOrderBelongsToOwner({ userId: null, customerRef: "customer-a" }, 1, owned),
      true,
    );
    assert.equal(
      workOrderBelongsToOwner({ customerRef: "customer-a" }, null, owned),
      true,
    );
    assert.deepEqual(ownerWorkOrderMongoFilter(1, []), { userId: 1 });
    const both = ownerWorkOrderMongoFilter(2, ["customer-a"]) as {
      $or: Array<Record<string, unknown>>;
    };
    assert.deepEqual(both.$or[0], { userId: 2 });
  });

  it("lets admin roles and admin job roles choose an owner", () => {
    assert.deepEqual(
      resolveFinancialsOwnerRequest({
        roles: ["admin"],
        territoryOwner: true,
        selfId: christopher,
        requestedOwnerId: dustin,
      }),
      { canChoose: true, ownerId: dustin },
    );
    assert.deepEqual(
      resolveFinancialsOwnerRequest({
        roles: ["agent"],
        jobRoleLabels: ["Super Admin"],
        territoryOwner: false,
        selfId: christopher,
        requestedOwnerId: "",
      }),
      { canChoose: true, ownerId: null },
    );
    assert.deepEqual(
      resolveFinancialsOwnerRequest({
        roles: ["manager"],
        jobRoleSlugs: ["administrator"],
        territoryOwner: false,
        selfId: dustin,
        requestedOwnerId: christopher,
      }),
      { canChoose: true, ownerId: christopher },
    );
  });

  it("forces a territory owner who is not an admin onto their own book", () => {
    assert.deepEqual(
      resolveFinancialsOwnerRequest({
        roles: ["agent"],
        jobRoleSlugs: ["territory-owner"],
        territoryOwner: true,
        selfId: dustin,
        requestedOwnerId: christopher,
      }),
      { canChoose: false, ownerId: dustin },
    );
    assert.deepEqual(
      resolveFinancialsOwnerRequest({
        roles: ["agent"],
        territoryOwner: false,
        selfId: dustin,
        requestedOwnerId: christopher,
      }),
      { canChoose: false, ownerId: null },
    );
  });
});
