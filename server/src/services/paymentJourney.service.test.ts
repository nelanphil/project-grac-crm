import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IJourneyEvent } from "../models/mongo/PaymentJourneySession";
import { journeyBatchSchema } from "../schemas/paymentJourney.schema";
import {
  deriveJourneyOutcome,
  describeDevice,
  sanitizeJourneyEvents,
  summarizeJourney,
} from "./paymentJourney.service";
import { foldOpensIntoVisits, type InvoiceContactEntry } from "./invoiceActivity.service";

function step(detail: string, type: IJourneyEvent["type"] = "step"): IJourneyEvent {
  return { t: new Date(), type, detail, meta: null };
}

describe("deriveJourneyOutcome", () => {
  it("marks a redirect to Square", () => {
    const result = deriveJourneyOutcome({}, [step("cart_loaded"), step("redirect_to_square")]);
    assert.equal(result.outcome, "redirected_to_square");
  });

  it("keeps paid once confirmed even if later steps fail", () => {
    const result = deriveJourneyOutcome({}, [
      step("payment_confirmed"),
      step("confirm_error: timeout"),
    ]);
    assert.equal(result.outcome, "paid");
    assert.equal(result.lastError, "confirm_error: timeout");
  });

  it("records an error step and a later retry that redirects", () => {
    const first = deriveJourneyOutcome({}, [
      step("checkout_start_failed: Amount must be greater than zero"),
    ]);
    assert.equal(first.outcome, "error");
    const second = deriveJourneyOutcome(first, [step("redirect_to_square")]);
    assert.equal(second.outcome, "redirected_to_square");
    assert.equal(second.lastError, "checkout_start_failed: Amount must be greater than zero");
  });

  it("notes failed API calls without changing the outcome", () => {
    const result = deriveJourneyOutcome({}, [
      {
        t: new Date(),
        type: "api",
        detail: "POST /checkout/q_x/session 409",
        meta: { status: 409, message: "Checkout changed" },
      },
    ]);
    assert.equal(result.outcome, null);
    assert.equal(result.lastError, "Checkout changed");
  });

  it("does not treat a rejected discount as a broken visit", () => {
    const result = deriveJourneyOutcome({}, [step("discount_rejected: Code expired")]);
    assert.equal(result.outcome, null);
    assert.equal(result.lastError, "discount_rejected: Code expired");
  });
});

describe("sanitizeJourneyEvents", () => {
  it("clips long details and replaces wild client clocks", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const [event] = sanitizeJourneyEvents(
      [{ t: 1, type: "click", detail: "x".repeat(900), meta: { durationMs: 12.6 } }],
      now,
    );
    assert.equal(event.detail.length, 500);
    assert.equal(event.t.getTime(), now.getTime());
    assert.equal(event.meta?.durationMs, 13);
  });
});

describe("journeyBatchSchema", () => {
  it("requires a link reference", () => {
    const result = journeyBatchSchema.safeParse({
      sessionId: "abcdefghijklmnop1234",
      entry: "checkout",
      link: {},
      events: [],
    });
    assert.equal(result.success, false);
  });

  it("rejects more than 50 events per batch", () => {
    const result = journeyBatchSchema.safeParse({
      sessionId: "abcdefghijklmnop1234",
      entry: "checkout",
      link: { checkoutKey: "q_abc" },
      events: Array.from({ length: 51 }, () => ({ t: Date.now(), type: "click", detail: "a" })),
    });
    assert.equal(result.success, false);
  });
});

describe("summarizeJourney", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const base = {
    sessionId: "abcdefghijklmnop1234",
    entry: "checkout" as const,
    startedAt: new Date("2026-10-28T11:00:00Z"),
  };

  it("calls an idle visit with no terminal step abandoned", () => {
    const summary = summarizeJourney(
      { ...base, lastEventAt: new Date("2026-10-28T11:05:00Z") },
      now,
    );
    assert.equal(summary.outcome, "abandoned");
    assert.equal(summary.durationMs, 5 * 60 * 1000);
  });

  it("calls a recent visit active", () => {
    const summary = summarizeJourney(
      { ...base, lastEventAt: new Date("2026-10-28T11:55:00Z") },
      now,
    );
    assert.equal(summary.outcome, "active");
  });
});

describe("describeDevice", () => {
  it("reads an iPhone Safari user agent", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    assert.equal(describeDevice(ua), "Phone · iOS · Safari");
  });
});

describe("foldOpensIntoVisits", () => {
  const contact = (kind: InvoiceContactEntry["kind"], createdAt: string): InvoiceContactEntry => ({
    id: `${kind}:${createdAt}`,
    kind,
    to: null,
    subject: null,
    preview: null,
    status: null,
    error: null,
    actorName: "Customer",
    createdAt,
    inferred: false,
  });

  it("drops opens inside a recorded visit and keeps emails and outside opens", () => {
    const contacts = [
      contact("pay_link_opened", "2026-10-28T11:00:30Z"),
      contact("email", "2026-10-28T11:00:40Z"),
      contact("viewed", "2026-10-28T09:00:00Z"),
    ];
    const kept = foldOpensIntoVisits(contacts, [
      { startedAt: "2026-10-28T11:00:00Z", lastEventAt: "2026-10-28T11:03:00Z" },
    ]);
    assert.deepEqual(
      kept.map((entry) => entry.kind),
      ["email", "viewed"],
    );
  });
});
