import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WORK_ORDER_FIELD_UPDATE_WINDOW_MS,
  classifyWorkOrderOrigin,
  planFieldUpdate,
  snapshotWorkOrderFields,
} from "./workOrderActivity.service";

const actor = "a".repeat(24);
const now = new Date("2026-10-29T14:00:00.000Z");

describe("classifyWorkOrderOrigin", () => {
  it("treats a numbered work order with no legacy id as created in the CRM", () => {
    assert.equal(classifyWorkOrderOrigin({ number: "WO1001" }), "user");
  });

  it("treats a legacy id without a CRM number as a dump import", () => {
    assert.equal(classifyWorkOrderOrigin({ legacyId: 55 }), "legacy_import");
  });

  it("treats a CRM number plus a legacy id as linked", () => {
    assert.equal(
      classifyWorkOrderOrigin({ legacyId: 55, number: "WO1001" }),
      "legacy_linked",
    );
  });

  it("treats legacyLinkedAt as linked even when a stored origin says user", () => {
    assert.equal(
      classifyWorkOrderOrigin({
        origin: "user",
        number: "WO1001",
        legacyId: 55,
        legacyLinkedAt: new Date(),
      }),
      "legacy_linked",
    );
  });

  it("keeps a stored origin when the legacy fields do not say otherwise", () => {
    assert.equal(
      classifyWorkOrderOrigin({ origin: "legacy_import", number: "" }),
      "legacy_import",
    );
  });
});

describe("planFieldUpdate", () => {
  it("records a diff when a tracked field changes", () => {
    const plan = planFieldUpdate({
      before: snapshotWorkOrderFields({ descPerform: "Inspect" }),
      after: snapshotWorkOrderFields({ descPerform: "Repair the transfer switch" }),
      actorUserId: actor,
      now,
      recent: null,
    });
    assert.equal(plan.kind, "insert");
    if (plan.kind !== "insert") return;
    assert.deepEqual(plan.changes, [
      {
        field: "Work to perform",
        from: "Inspect",
        to: "Repair the transfer switch",
      },
    ]);
  });

  it("skips an unchanged save", () => {
    const snap = snapshotWorkOrderFields({ descPerform: "Inspect", total: 120 });
    const plan = planFieldUpdate({
      before: snap,
      after: snap,
      actorUserId: actor,
      now,
      recent: null,
    });
    assert.equal(plan.kind, "skip");
  });

  it("updates the open line instead of adding a second row for the same fields", () => {
    const first = planFieldUpdate({
      before: snapshotWorkOrderFields({ descPerform: "Inspect" }),
      after: snapshotWorkOrderFields({ descPerform: "Repair" }),
      actorUserId: actor,
      now,
      recent: null,
    });
    assert.equal(first.kind, "insert");
    if (first.kind !== "insert") return;

    const repeat = planFieldUpdate({
      before: snapshotWorkOrderFields({ descPerform: "Repair" }),
      after: snapshotWorkOrderFields({ descPerform: "Repair and test" }),
      actorUserId: actor,
      now: new Date(now.getTime() + 60_000),
      recent: {
        actorUserId: actor,
        fields: first.changes.map((change) => change.field),
        createdAt: now,
        changes: first.changes,
      },
    });
    assert.equal(repeat.kind, "update");
    if (repeat.kind !== "update") return;
    assert.equal(repeat.changes[0]?.from, "Inspect");
    assert.equal(repeat.changes[0]?.to, "Repair and test");
  });

  it("adds a new row when the same fields are edited after the window", () => {
    const plan = planFieldUpdate({
      before: snapshotWorkOrderFields({ descPerform: "Repair" }),
      after: snapshotWorkOrderFields({ descPerform: "Repair and test" }),
      actorUserId: actor,
      now: new Date(now.getTime() + WORK_ORDER_FIELD_UPDATE_WINDOW_MS + 1),
      recent: {
        actorUserId: actor,
        fields: ["Work to perform"],
        createdAt: now,
        changes: [{ field: "Work to perform", from: "Inspect", to: "Repair" }],
      },
    });
    assert.equal(plan.kind, "insert");
  });

  it("adds a new row when a different field changes inside the window", () => {
    const plan = planFieldUpdate({
      before: snapshotWorkOrderFields({ descPerform: "Repair", customerName: "Ada" }),
      after: snapshotWorkOrderFields({ descPerform: "Repair", customerName: "Grace" }),
      actorUserId: actor,
      now: new Date(now.getTime() + 60_000),
      recent: {
        actorUserId: actor,
        fields: ["Work to perform"],
        createdAt: now,
        changes: [{ field: "Work to perform", from: "Inspect", to: "Repair" }],
      },
    });
    assert.equal(plan.kind, "insert");
    if (plan.kind !== "insert") return;
    assert.equal(plan.changes[0]?.field, "Customer");
  });
});
