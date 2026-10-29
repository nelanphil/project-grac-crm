import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateRenewalScheduleChoice,
  recommendedDatesEmailHtml,
  renewalOfferDateLabel,
} from "./renewalScheduleChoice";

const now = new Date("2026-10-29T15:00:00.000Z");
const expiresAt = new Date("2026-11-28T15:00:00.000Z");
const offered = ["2026-11-03", "2026-11-05", "2026-11-10"];

function choose(
  overrides: Partial<Parameters<typeof evaluateRenewalScheduleChoice>[0]> = {},
) {
  return evaluateRenewalScheduleChoice({
    now,
    expiresAt,
    offeredDates: offered,
    requestedDate: "2026-11-03",
    today: "2026-10-29",
    workOrderScheduled: false,
    ...overrides,
  });
}

describe("evaluateRenewalScheduleChoice", () => {
  it("accepts an offered future date", () => {
    assert.deepEqual(choose(), { ok: true });
  });

  it("rejects a date that was not offered", () => {
    assert.deepEqual(choose({ requestedDate: "2026-11-04" }), {
      ok: false,
      reason: "invalid_date",
    });
  });

  it("rejects an expired link", () => {
    assert.deepEqual(
      choose({ now: new Date("2026-12-01T15:00:00.000Z"), expiresAt }),
      { ok: false, reason: "expired" },
    );
    assert.deepEqual(choose({ expiresAt: null }), {
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a visit that is already scheduled", () => {
    assert.deepEqual(choose({ workOrderScheduled: true }), {
      ok: false,
      reason: "already_scheduled",
    });
  });

  it("rejects an offered date that is already in the past", () => {
    assert.deepEqual(
      choose({ requestedDate: "2026-11-03", today: "2026-11-04" }),
      { ok: false, reason: "past" },
    );
  });
});

describe("recommendedDatesEmailHtml", () => {
  it("builds a confirm link for each date and is empty when there are none", () => {
    assert.equal(
      recommendedDatesEmailHtml({
        pageUrl: "https://crm.example.com/schedule-renewal",
        token: "abc",
        dates: [],
      }),
      "",
    );
    const html = recommendedDatesEmailHtml({
      pageUrl: "https://crm.example.com/schedule-renewal/",
      token: "abc",
      dates: ["2026-11-03"],
    });
    assert.match(html, /href="https:\/\/crm\.example\.com\/schedule-renewal\?token=abc&amp;date=2026-11-03"/);
    assert.match(html, new RegExp(renewalOfferDateLabel("2026-11-03")));
    assert.doesNotMatch(html, /<script/);
  });
});
