import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  earliestStartMs,
  noteTimeTagMessage,
  parseNoteTimeTags,
} from "./noteTimeTags";

describe("parseNoteTimeTags", () => {
  it("reads one clock tag as the desired start", () => {
    assert.deepEqual(parseNoteTimeTags("Please come @8:00AM"), {
      ok: true,
      desiredStartTime: "08:00",
      desiredStartBy: "",
    });
    assert.deepEqual(parseNoteTimeTags("@8am"), {
      ok: true,
      desiredStartTime: "08:00",
      desiredStartBy: "",
    });
    assert.deepEqual(parseNoteTimeTags("@8:30 PM"), {
      ok: true,
      desiredStartTime: "20:30",
      desiredStartBy: "",
    });
  });

  it("reads two tags as a start window", () => {
    assert.deepEqual(parseNoteTimeTags("@8:00AM @10:00AM"), {
      ok: true,
      desiredStartTime: "08:00",
      desiredStartBy: "10:00",
    });
    assert.deepEqual(parseNoteTimeTags("between @11:00AM and @1:00PM"), {
      ok: true,
      desiredStartTime: "11:00",
      desiredStartBy: "13:00",
    });
  });

  it("ignores staff tags and phone numbers", () => {
    assert.deepEqual(parseNoteTimeTags("@Jane Doe call 386-631-8982"), {
      ok: false,
      reason: "none",
    });
  });

  it("rejects a third tag or a window that does not move forward", () => {
    assert.equal(
      parseNoteTimeTags("@8:00AM @10:00AM @2:00PM").ok,
      false,
    );
    assert.equal(
      noteTimeTagMessage("@8:00AM @10:00AM @2:00PM"),
      "A note can set one start time or a start window.",
    );
    assert.equal(
      noteTimeTagMessage("@10:00AM @8:00AM"),
      "The second time must be later than the first.",
    );
    assert.equal(noteTimeTagMessage("@8:00AM @8:00AM"), "The second time must be later than the first.");
  });
});

describe("earliestStartMs", () => {
  const hour = (h: number, m = 0) => Date.UTC(2020, 0, 1, h, m);

  it("keeps an exact start when that instant is open", () => {
    assert.equal(
      earliestStartMs({
        earliest: hour(8),
        latest: hour(8),
        durationMs: 30 * 60_000,
        windowStart: hour(8),
        windowEnd: hour(17),
        busy: [],
      }),
      hour(8),
    );
  });

  it("moves to the first open instant inside a start window", () => {
    assert.equal(
      earliestStartMs({
        earliest: hour(8),
        latest: hour(10),
        durationMs: 30 * 60_000,
        windowStart: hour(8),
        windowEnd: hour(17),
        busy: [{ start: hour(8), end: hour(9) }],
      }),
      hour(9),
    );
  });

  it("returns null when the visit cannot start inside the window", () => {
    assert.equal(
      earliestStartMs({
        earliest: hour(8),
        latest: hour(9),
        durationMs: 60 * 60_000,
        windowStart: hour(8),
        windowEnd: hour(17),
        busy: [{ start: hour(8), end: hour(10) }],
      }),
      null,
    );
  });
});
