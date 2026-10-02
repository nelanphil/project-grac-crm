import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNoteTimeWindow } from "./noteTimeWindow";

describe("parseNoteTimeWindow", () => {
  it("reads morning ranges as AM", () => {
    assert.deepEqual(parseNoteTimeWindow("ASC 8-10"), {
      ok: true,
      startTime: "08:00",
      endTime: "10:00",
    });
    assert.deepEqual(parseNoteTimeWindow("ASC 8-12"), {
      ok: true,
      startTime: "08:00",
      endTime: "12:00",
    });
  });

  it("reads afternoon ranges as PM", () => {
    assert.deepEqual(parseNoteTimeWindow("2-3"), {
      ok: true,
      startTime: "14:00",
      endTime: "15:00",
    });
    assert.deepEqual(parseNoteTimeWindow("12-4"), {
      ok: true,
      startTime: "12:00",
      endTime: "16:00",
    });
  });

  it("places the end hour after the start hour on the same work day", () => {
    assert.deepEqual(parseNoteTimeWindow("11-1"), {
      ok: true,
      startTime: "11:00",
      endTime: "13:00",
    });
    assert.deepEqual(parseNoteTimeWindow("9-5"), {
      ok: true,
      startTime: "09:00",
      endTime: "17:00",
    });
    assert.deepEqual(parseNoteTimeWindow("8-6"), {
      ok: true,
      startTime: "08:00",
      endTime: "18:00",
    });
  });

  it("allows spaces and dashes around the range", () => {
    assert.deepEqual(parseNoteTimeWindow("8 - 10"), {
      ok: true,
      startTime: "08:00",
      endTime: "10:00",
    });
    assert.deepEqual(parseNoteTimeWindow("8–10"), {
      ok: true,
      startTime: "08:00",
      endTime: "10:00",
    });
  });

  it("skips ranges that cannot sit inside 8:00 AM–6:00 PM", () => {
    assert.deepEqual(parseNoteTimeWindow("7-9"), {
      ok: false,
      reason: "outside-work-day",
    });
    assert.deepEqual(parseNoteTimeWindow("6-8"), {
      ok: false,
      reason: "outside-work-day",
    });
    assert.deepEqual(parseNoteTimeWindow("1-12"), {
      ok: false,
      reason: "outside-work-day",
    });
  });

  it("skips text without a single whole-hour range", () => {
    assert.deepEqual(parseNoteTimeWindow("BEFORE 4PM"), {
      ok: false,
      reason: "none",
    });
    assert.deepEqual(parseNoteTimeWindow("after 2:30"), {
      ok: false,
      reason: "none",
    });
    assert.deepEqual(parseNoteTimeWindow("8-10:30"), {
      ok: false,
      reason: "none",
    });
    assert.deepEqual(parseNoteTimeWindow("2:30-4"), {
      ok: false,
      reason: "none",
    });
    assert.deepEqual(parseNoteTimeWindow(""), {
      ok: false,
      reason: "none",
    });
  });

  it("skips more than one range", () => {
    assert.deepEqual(parseNoteTimeWindow("8-10 or 2-3"), {
      ok: false,
      reason: "multiple",
    });
  });

  it("ignores numbers glued to other digits", () => {
    assert.deepEqual(parseNoteTimeWindow("Call 386-631-8982"), {
      ok: false,
      reason: "none",
    });
    assert.deepEqual(parseNoteTimeWindow("part 10-15"), {
      ok: false,
      reason: "none",
    });
  });
});
