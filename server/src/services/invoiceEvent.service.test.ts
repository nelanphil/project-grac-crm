import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { InvoiceEvent } from "../models/mongo/InvoiceEvent";
import {
  inferPaymentMethod,
  paymentSourceEventId,
  recordInvoiceEvent,
} from "./invoiceEvent.service";
import { mergeInvoiceActivity, type MergeActivityInput } from "./invoiceActivity.service";

type Stubbable = {
  exists: (...args: unknown[]) => unknown;
  create: (...args: unknown[]) => unknown;
};

const model = InvoiceEvent as unknown as Stubbable;
const originalExists = model.exists;
const originalCreate = model.create;

afterEach(() => {
  model.exists = originalExists;
  model.create = originalCreate;
});

describe("recordInvoiceEvent", () => {
  it("returns null instead of throwing when the sourceEventId already exists", async () => {
    const created: unknown[] = [];
    model.create = async (doc: unknown) => {
      if (created.length > 0) {
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      }
      created.push(doc);
      return doc;
    };
    const invoiceRef = new Types.ObjectId();
    const input = {
      invoiceRef,
      kind: "payment_failed" as const,
      sourceEventId: paymentSourceEventId(invoiceRef, "square", "pay_1", "failed"),
    };
    assert.ok(await recordInvoiceEvent(input));
    assert.equal(await recordInvoiceEvent(input), null);
    assert.equal(created.length, 1);
  });

  it("skips a repeat open inside the throttle window", async () => {
    let creates = 0;
    let queried = null as Record<string, unknown> | null;
    model.exists = async (filter: unknown) => {
      queried = filter as Record<string, unknown>;
      return { _id: new Types.ObjectId() };
    };
    model.create = async () => {
      creates += 1;
      return {};
    };
    const result = await recordInvoiceEvent({
      invoiceRef: new Types.ObjectId(),
      kind: "viewed",
      actorKind: "customer",
      throttleMs: 15 * 60 * 1000,
    });
    assert.equal(result, null);
    assert.equal(creates, 0);
    assert.equal(queried?.kind, "viewed");
  });

  it("records an open when nothing recent exists", async () => {
    let saved = null as Record<string, unknown> | null;
    model.exists = async () => null;
    model.create = async (doc: unknown) => {
      saved = doc as Record<string, unknown>;
      return doc;
    };
    await recordInvoiceEvent({
      invoiceRef: new Types.ObjectId(),
      kind: "pay_link_opened",
      actorKind: "customer",
      throttleMs: 1000,
    });
    assert.equal(saved?.kind, "pay_link_opened");
    assert.equal(saved?.actorName, "Customer");
  });

  it("ignores an invalid invoice id", async () => {
    assert.equal(await recordInvoiceEvent({ invoiceRef: "nope", kind: "viewed" }), null);
  });
});

describe("paymentSourceEventId", () => {
  it("keys by invoice so one payment can settle several invoices", () => {
    const a = paymentSourceEventId("a1", "square", "pay_1", "paid");
    const b = paymentSourceEventId("b2", "square", "pay_1", "paid");
    assert.notEqual(a, b);
    assert.equal(paymentSourceEventId("a1", "square", "", "paid"), null);
  });
});

describe("inferPaymentMethod", () => {
  const now = new Date("2026-10-28T12:00:00Z");

  it("uses a check recorded moments ago", () => {
    const method = inferPaymentMethod(
      {
        amountCents: 30000,
        offlinePayment: { method: "check", recordedAt: new Date(now.getTime() - 1000) },
        posCharge: null,
      },
      {},
      now,
    );
    assert.equal(method, "check");
  });

  it("treats a recent Tap to Pay charge as tap_to_pay", () => {
    const method = inferPaymentMethod(
      {
        amountCents: 30000,
        offlinePayment: null,
        posCharge: {
          startedAt: new Date(now.getTime() - 60 * 1000),
          locationId: "L1",
          amountCents: 30000,
          status: "confirmed",
        },
      },
      { providerPaymentId: "pay_1" },
      now,
    );
    assert.equal(method, "tap_to_pay");
  });

  it("falls back to card for provider payments and manual for staff marks", () => {
    const invoice = { amountCents: 30000, offlinePayment: null, posCharge: null };
    assert.equal(inferPaymentMethod(invoice, { providerPaymentId: "pay_1" }, now), "card");
    assert.equal(inferPaymentMethod(invoice, {}, now), "manual");
  });
});

function baseInput(overrides: Partial<MergeActivityInput> = {}): MergeActivityInput {
  return {
    invoice: {
      _id: "inv1",
      status: "open",
      paidAt: null,
      amountCents: 32100,
      paymentProvider: null,
      providerPaymentId: null,
    },
    emails: [],
    texts: [],
    inferredEmails: [],
    inferredTexts: [],
    events: [],
    paidActivity: null,
    userNames: new Map(),
    ...overrides,
  };
}

describe("mergeInvoiceActivity", () => {
  it("sorts contacts newest first and tags inferred matches", () => {
    const staffId = new Types.ObjectId();
    const activity = mergeInvoiceActivity(
      baseInput({
        emails: [
          {
            _id: "e1",
            toEmail: "ada@example.com",
            subject: "Invoice GMOF1",
            body: "Pay here",
            status: "sent",
            createdByUserRef: staffId,
            createdAt: new Date("2026-10-28T10:00:00Z"),
          },
        ],
        inferredTexts: [
          {
            _id: "t1",
            channel: "sms",
            toNumber: "+13865550100",
            body: "Invoice GMOF1 is ready",
            status: "delivered",
            createdAt: new Date("2026-10-28T09:00:00Z"),
          },
        ],
        events: [
          {
            _id: "v1",
            kind: "viewed",
            actorName: "Customer",
            createdAt: new Date("2026-10-28T11:00:00Z"),
          },
        ],
        userNames: new Map([[String(staffId), "Pat Nelan"]]),
      }),
    );
    assert.deepEqual(
      activity.contacts.map((entry) => entry.kind),
      ["viewed", "email", "sms"],
    );
    assert.equal(activity.contacts[1].actorName, "Pat Nelan");
    assert.equal(activity.contacts[2].inferred, true);
    assert.equal(activity.contacts[2].actorName, "System");
  });

  it("does not list the same message twice when linked and matched", () => {
    const row = {
      _id: "e1",
      toEmail: "ada@example.com",
      subject: "Invoice GMOF1",
      status: "sent",
      createdAt: new Date("2026-10-28T10:00:00Z"),
    };
    const activity = mergeInvoiceActivity(
      baseInput({ emails: [row], inferredEmails: [row] }),
    );
    assert.equal(activity.contacts.length, 1);
    assert.equal(activity.contacts[0].inferred, false);
  });

  it("splits payment events from contact events", () => {
    const activity = mergeInvoiceActivity(
      baseInput({
        events: [
          {
            _id: "p1",
            kind: "payment_failed",
            method: "card",
            provider: "square",
            amountCents: 32100,
            reason: "CARD_DECLINED",
            createdAt: new Date("2026-10-28T10:00:00Z"),
          },
          {
            _id: "c1",
            kind: "checkout_started",
            createdAt: new Date("2026-10-28T09:59:00Z"),
          },
        ],
      }),
    );
    assert.equal(activity.payments.length, 1);
    assert.equal(activity.payments[0].reason, "CARD_DECLINED");
    assert.equal(activity.contacts.length, 1);
    assert.equal(activity.contacts[0].kind, "checkout_started");
  });

  it("adds an inferred success for an old paid invoice with no events", () => {
    const paidAt = new Date("2026-10-01T15:00:00Z");
    const activity = mergeInvoiceActivity(
      baseInput({
        invoice: {
          _id: "inv1",
          status: "paid",
          paidAt,
          amountCents: 32100,
          paymentProvider: null,
          providerPaymentId: null,
          offlinePayment: { method: "check", checkNumber: "1042", recordedByName: "Pat" },
        },
      }),
    );
    assert.equal(activity.payments.length, 1);
    const [entry] = activity.payments;
    assert.equal(entry.kind, "payment_succeeded");
    assert.equal(entry.method, "check");
    assert.equal(entry.reason, "Check #1042");
    assert.equal(entry.actorName, "Pat");
    assert.equal(entry.inferred, true);
    assert.equal(entry.createdAt, paidAt.toISOString());
  });

  it("skips the inferred success when a real one was recorded", () => {
    const activity = mergeInvoiceActivity(
      baseInput({
        invoice: {
          _id: "inv1",
          status: "paid",
          paidAt: new Date(),
          amountCents: 32100,
          paymentProvider: "square",
          providerPaymentId: "pay_1",
        },
        events: [
          {
            _id: "p1",
            kind: "payment_succeeded",
            method: "card",
            createdAt: new Date(),
          },
        ],
      }),
    );
    assert.equal(activity.payments.length, 1);
    assert.equal(activity.payments[0].inferred, false);
  });
});
