import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergePersistedRouteLocks,
  routeLockSurvivesChange,
  routeLockedForAppliedStop,
} from "./schedule.service";

const noon = new Date("2026-10-27T16:00:00.000Z");
const later = new Date("2026-10-27T17:30:00.000Z");

describe("apply route locks", () => {
  it("saves a lock only for stops that are locked", () => {
    const locks = mergePersistedRouteLocks(
      [
        { id: "a", routeLocked: false, scheduledStart: noon },
        { id: "b", routeLocked: false, scheduledStart: noon },
      ],
      new Map([["b", noon]]),
    );
    assert.equal(routeLockedForAppliedStop("a", locks), false);
    assert.equal(routeLockedForAppliedStop("b", locks), true);
  });

  it("keeps a persisted lock when the client omits it", () => {
    const locks = mergePersistedRouteLocks(
      [
        { id: "a", routeLocked: true, scheduledStart: noon },
        { id: "b", routeLocked: false, scheduledStart: noon },
      ],
      new Map(),
    );
    assert.equal(locks.get("a")?.toISOString(), noon.toISOString());
    assert.equal(locks.has("b"), false);
  });

  it("lets a client lock time replace the stored arrival", () => {
    const locks = mergePersistedRouteLocks(
      [{ id: "a", routeLocked: true, scheduledStart: noon }],
      new Map([["a", later]]),
    );
    assert.equal(locks.get("a")?.toISOString(), later.toISOString());
  });

  it("ignores a persisted flag that has no start time", () => {
    const locks = mergePersistedRouteLocks(
      [{ id: "a", routeLocked: true, scheduledStart: null }],
      new Map(),
    );
    assert.equal(locks.has("a"), false);
  });
});

describe("route lock retention", () => {
  it("clears the lock when the appointment is removed", () => {
    assert.equal(
      routeLockSurvivesChange({
        hadScheduledStart: true,
        hasScheduledStart: false,
        technicianChanged: false,
        dateChanged: false,
      }),
      false,
    );
  });

  it("clears the lock when the technician or day changes", () => {
    assert.equal(
      routeLockSurvivesChange({
        hadScheduledStart: true,
        hasScheduledStart: true,
        technicianChanged: true,
        dateChanged: false,
      }),
      false,
    );
    assert.equal(
      routeLockSurvivesChange({
        hadScheduledStart: true,
        hasScheduledStart: true,
        technicianChanged: false,
        dateChanged: true,
      }),
      false,
    );
  });

  it("keeps the lock when the stop stays with the same technician and day", () => {
    assert.equal(
      routeLockSurvivesChange({
        hadScheduledStart: true,
        hasScheduledStart: true,
        technicianChanged: false,
        dateChanged: false,
      }),
      true,
    );
  });
});
