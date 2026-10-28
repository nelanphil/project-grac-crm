import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localDateToUtc } from "../utils/scheduleTime";
import {
  blocksForTechnician,
  placeStopsWithoutOverlap,
  scheduleOverlapShouldBlock,
} from "./schedule.service";

const day = "2026-10-28";
const at = (hhmm: string) => localDateToUtc(day, hhmm);

function stop(partial: {
  id: string;
  label: string;
  durationMinutes: number;
  hardLock?: boolean;
  lockedStart?: Date | null;
  desiredStart?: Date | null;
}) {
  return {
    id: partial.id,
    label: partial.label,
    durationMinutes: partial.durationMinutes,
    hardLock: Boolean(partial.hardLock),
    lockedStart: partial.lockedStart ?? null,
    desiredStart: partial.desiredStart ?? null,
    point: null,
  };
}

describe("note times slide instead of stacking", () => {
  it("keeps the first 8:00 appointment and moves the next one", async () => {
    const eight = at("08:00");
    const result = await placeStopsWithoutOverlap({
      ordered: [
        stop({
          id: "dari",
          label: "Dari",
          durationMinutes: 30,
          desiredStart: eight,
        }),
        stop({
          id: "mae",
          label: "Mae",
          durationMinutes: 30,
          desiredStart: eight,
        }),
      ],
      obstacles: [],
      windowStart: eight,
    });
    const byId = new Map(result.placements.map((row) => [row.id, row]));
    assert.equal(byId.get("dari")?.start.toISOString(), eight.toISOString());
    assert.equal(byId.get("mae")?.start.toISOString(), at("08:30").toISOString());
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? "", /Mae moved from .+ to .+ \(overlap\)/);
  });
});

describe("completed visits block time and stay put", () => {
  it("slides an open job past a completed visit without moving it", async () => {
    const eight = at("08:00");
    const result = await placeStopsWithoutOverlap({
      ordered: [
        stop({
          id: "done",
          label: "Lisa",
          durationMinutes: 60,
          hardLock: true,
          lockedStart: eight,
        }),
        stop({
          id: "open",
          label: "Wendall",
          durationMinutes: 30,
          desiredStart: eight,
        }),
      ],
      obstacles: [],
      windowStart: eight,
    });
    const byId = new Map(result.placements.map((row) => [row.id, row]));
    assert.equal(byId.get("done")?.start.toISOString(), eight.toISOString());
    assert.equal(byId.get("done")?.end.toISOString(), at("09:00").toISOString());
    assert.equal(byId.get("open")?.start.toISOString(), at("09:00").toISOString());
    assert.match(result.warnings.join(" "), /Wendall moved from .+ to .+ \(overlap\)/);
  });
});

describe("shared crew visits", () => {
  it("blocks every assigned technician, including when the visit is completed", () => {
    const shared = {
      id: "shared",
      assigneeIds: ["tech-a", "tech-b"],
      start: at("08:00"),
      end: at("09:00"),
      label: "Shared visit",
      canceled: false,
    };
    assert.equal(blocksForTechnician([shared], "tech-a").length, 1);
    assert.equal(blocksForTechnician([shared], "tech-b").length, 1);
    assert.equal(blocksForTechnician([shared], "tech-c").length, 0);
    assert.equal(
      blocksForTechnician([{ ...shared, canceled: true }], "tech-a").length,
      0,
    );
    assert.equal(
      blocksForTechnician(
        [{ ...shared, assigneeIds: ["tech-a"], label: "Completed" }],
        "tech-a",
      ).length,
      1,
    );
  });
});

describe("paid on a completed overlapping job", () => {
  it("does not reject the save when the appointment is already complete", () => {
    const start = at("08:00");
    const end = at("08:30");
    assert.equal(
      scheduleOverlapShouldBlock({
        completed: true,
        previousStart: start,
        nextStart: start,
        previousEnd: end,
        nextEnd: end,
        previousCrew: ["tech-a"],
        nextCrew: ["tech-a"],
      }),
      false,
    );
    assert.equal(
      scheduleOverlapShouldBlock({
        completed: false,
        previousStart: start,
        nextStart: start,
        previousEnd: end,
        nextEnd: end,
        previousCrew: ["tech-a"],
        nextCrew: ["tech-a"],
      }),
      false,
    );
    assert.equal(
      scheduleOverlapShouldBlock({
        completed: false,
        previousStart: start,
        nextStart: at("09:00"),
        previousEnd: end,
        nextEnd: at("09:30"),
        previousCrew: ["tech-a"],
        nextCrew: ["tech-a"],
      }),
      true,
    );
  });
});

describe("hard locks", () => {
  it("refuses two locked visits that occupy the same time", async () => {
    const eight = at("08:00");
    await assert.rejects(
      () =>
        placeStopsWithoutOverlap({
          ordered: [
            stop({
              id: "a",
              label: "Locked A",
              durationMinutes: 60,
              hardLock: true,
              lockedStart: eight,
            }),
            stop({
              id: "b",
              label: "Locked B",
              durationMinutes: 30,
              hardLock: true,
              lockedStart: eight,
            }),
          ],
          obstacles: [],
          windowStart: eight,
        }),
      /Locked B overlaps Locked A/,
    );
  });
});
