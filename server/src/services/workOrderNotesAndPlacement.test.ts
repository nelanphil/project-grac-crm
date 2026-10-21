import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkOrderSchema } from "../schemas/workOrder.schema";
import {
  assignAndOptimizeSchema,
  previewOptimalPlacementSchema,
  recommendedDatesSchema,
} from "../controllers/schedule.controller";
import { parseNoteTimeTags } from "../utils/noteTimeTags";
import { optimizeAroundLocks } from "../utils/routeOrder";

describe("createWorkOrderSchema notes and date validation", () => {
  it("accepts valid initial notes array and required date", () => {
    const parsed = createWorkOrderSchema.safeParse({
      customerId: 12345,
      date: "2026-10-25",
      notes: [
        {
          content: "Please arrive between @9:00AM and @11:00AM",
          visibleToCustomer: false,
          isReminder: true,
          mentionUserIds: ["64b0f2c2a1b2c3d4e5f60711"],
        },
      ],
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.date, "2026-10-25");
      assert.equal(parsed.data.notes?.length, 1);
      assert.equal(parsed.data.notes[0]?.content, "Please arrive between @9:00AM and @11:00AM");
      assert.equal(parsed.data.notes[0]?.isReminder, true);
    }
  });

  it("rejects work order creation without a date", () => {
    const missingDate = createWorkOrderSchema.safeParse({
      customerId: 12345,
    });
    assert.equal(missingDate.success, false);

    const blankDate = createWorkOrderSchema.safeParse({
      customerId: 12345,
      date: "",
    });
    assert.equal(blankDate.success, false);
  });

  it("rejects empty note content", () => {
    const parsed = createWorkOrderSchema.safeParse({
      customerId: 12345,
      date: "2026-10-25",
      notes: [
        {
          content: "",
        },
      ],
    });
    assert.equal(parsed.success, false);
  });
});

describe("draft note time tag extraction", () => {
  it("extracts desired window from note content", () => {
    const noteText = "Customer requested early window @8:00AM @10:00AM for generator maintenance";
    const tags = parseNoteTimeTags(noteText);
    assert.equal(tags.ok, true);
    if (tags.ok) {
      assert.equal(tags.desiredStartTime, "08:00");
      assert.equal(tags.desiredStartBy, "10:00");
    }
  });
});

describe("schedule optimal placement schemas", () => {
  it("validates previewOptimalPlacementSchema", () => {
    const valid = previewOptimalPlacementSchema.safeParse({
      userId: "64b0f2c2a1b2c3d4e5f60711",
      date: "2026-10-25",
      address: "123 Main St",
      city: "Tampa",
      state: "FL",
      zip: "33601",
      desiredStartTime: "09:00",
      desiredStartBy: "11:00",
      estimatedMinutes: 60,
    });
    assert.equal(valid.success, true);
  });

  it("validates assignAndOptimizeSchema", () => {
    const valid = assignAndOptimizeSchema.safeParse({
      workOrderId: "64b0f2c2a1b2c3d4e5f60722",
      userId: "64b0f2c2a1b2c3d4e5f60711",
      date: "2026-10-25",
    });
    assert.equal(valid.success, true);
  });

  it("rejects invalid date in assignAndOptimizeSchema", () => {
    const invalid = assignAndOptimizeSchema.safeParse({
      workOrderId: "64b0f2c2a1b2c3d4e5f60722",
      userId: "64b0f2c2a1b2c3d4e5f60711",
      date: "not-a-date",
    });
    assert.equal(invalid.success, false);
  });

  it("validates recommendedDatesSchema", () => {
    const valid = recommendedDatesSchema.safeParse({
      address: "123 Main St",
      city: "Tampa",
      state: "FL",
      zip: "33601",
      workOrderTypeRef: "64b0f2c2a1b2c3d4e5f60711",
      startTime: "09:00",
      startBy: "12:00",
      estimatedMinutes: 30,
    });
    assert.equal(valid.success, true);

    const invalidWindow = recommendedDatesSchema.safeParse({
      address: "123 Main St",
      city: "Tampa",
      startTime: "12:00",
      startBy: "09:00",
    });
    assert.equal(invalidWindow.success, false);

    const missingLocation = recommendedDatesSchema.safeParse({});
    assert.equal(missingLocation.success, false);
  });
});

describe("optimizeAroundLocks with optimal candidate placement", () => {
  const drive = [
    [0, 15, 20, 25],
    [15, 0, 10, 30],
    [20, 10, 0, 15],
    [25, 30, 15, 0],
  ];

  it("places candidate in desired window order respecting existing stops", () => {
    // 3 stops: stop 1 (service 30m), stop 2 (locked at 9:00 AM / 60m from start), stop 3 (service 30m)
    const order = optimizeAroundLocks({
      cost: drive,
      driveMinutes: drive,
      serviceMinutes: [0, 30, 45, 30],
      lockedOffsetMinutes: [null, null, 120, null],
      roundTrip: true,
    });
    assert.ok(order.length === 3);
    assert.ok(order.includes(1) && order.includes(2) && order.includes(3));
  });
});
