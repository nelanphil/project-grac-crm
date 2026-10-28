import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { Invoice } from "../models/mongo/Invoice";
import { InvoiceEvent } from "../models/mongo/InvoiceEvent";
import {
  JOURNEY_SNAPSHOT_MAX_BYTES,
  PaymentJourneySnapshot,
} from "../models/mongo/PaymentJourneySnapshot";
import { describeSquarePayment } from "../payments/paymentDetail";
import { journeySnapshotSchema } from "../schemas/paymentJourney.schema";
import {
  backfillSquarePaymentEvent,
  resetPaymentBackfillCache,
  type InvoiceForActivity,
} from "./invoiceActivity.service";
import { squarePaymentLookup, toInvoicePaymentDetail } from "./invoicePaymentDetail.service";
import { ingestJourneySnapshot } from "./paymentJourney.service";

describe("describeSquarePayment", () => {
  it("reads a contactless payment in the Square app as Tap to Pay", () => {
    const result = describeSquarePayment({
      squareProduct: "SQUARE_POS",
      sourceType: "CARD",
      entryMethod: "CONTACTLESS",
      cardBrand: "VISA",
      last4: "8089",
    });
    assert.equal(result.method, "tap_to_pay");
    assert.equal(result.channel, "in_person");
    assert.equal(result.label, "Tap to Pay · Visa ending 8089 · Square Point of Sale app");
  });

  it("reads a card typed on the payment link as an online card", () => {
    const result = describeSquarePayment({
      squareProduct: "ECOMMERCE_API",
      sourceType: "CARD",
      entryMethod: "KEYED",
      cardBrand: "MASTERCARD",
      last4: "4444",
    });
    assert.equal(result.method, "card_online");
    assert.equal(result.channel, "online");
    assert.equal(result.label, "Card typed online · Mastercard ending 4444 · Payment link");
  });

  it("reads Apple Pay as a wallet and notes when it was tapped in person", () => {
    const online = describeSquarePayment({ squareProduct: "ECOMMERCE_API", sourceType: "WALLET" });
    assert.equal(online.method, "wallet");
    assert.equal(online.channel, "online");
    const tapped = describeSquarePayment({
      squareProduct: "SQUARE_POS",
      sourceType: "CARD",
      entryMethod: "CONTACTLESS",
      wallet: "APPLE_PAY",
    });
    assert.equal(tapped.method, "wallet");
    assert.match(tapped.label, /^Apple Pay \(tapped\)/);
  });

  it("reads an inserted chip card as card present", () => {
    const result = describeSquarePayment({ entryMethod: "EMV", cardBrand: "AMERICAN_EXPRESS" });
    assert.equal(result.method, "card_present");
    assert.equal(result.channel, "in_person");
    assert.equal(result.label, "Chip card · Amex");
  });

  it("falls back to a plain card when Square says nothing useful", () => {
    const result = describeSquarePayment({});
    assert.equal(result.method, "card");
    assert.equal(result.channel, null);
    assert.equal(result.label, "Card");
  });
});

type Stubbable = {
  create: (...args: unknown[]) => unknown;
  updateOne: (...args: unknown[]) => unknown;
};

describe("backfillSquarePaymentEvent", () => {
  const events = InvoiceEvent as unknown as Stubbable;
  const originalCreate = events.create;
  const originalUpdate = events.updateOne;
  const originalFind = squarePaymentLookup.find;

  afterEach(() => {
    events.create = originalCreate;
    events.updateOne = originalUpdate;
    squarePaymentLookup.find = originalFind;
    resetPaymentBackfillCache();
  });

  const invoice: InvoiceForActivity = {
    _id: new Types.ObjectId(),
    status: "paid",
    paidAt: new Date("2026-10-28T15:00:00Z"),
    amountCents: 28500,
    paymentProvider: "square",
    providerPaymentId: "pay_tap_1",
    providerOrderId: "order_1",
    offlinePayment: null,
    posCharge: null,
  };

  it("saves one real payment event, then reads it back without asking Square again", async () => {
    let lookups = 0;
    squarePaymentLookup.find = async () => {
      lookups += 1;
      return toInvoicePaymentDetail({
        squareProduct: "SQUARE_POS",
        entryMethod: "CONTACTLESS",
        cardBrand: "VISA",
        last4: "8089",
      });
    };
    const saved: Array<Record<string, unknown>> = [];
    events.create = async (docs: unknown) => {
      const [doc] = docs as Array<Record<string, unknown>>;
      saved.push(doc!);
      return [{ ...doc, _id: new Types.ObjectId() }];
    };
    events.updateOne = async () => {
      throw new Error("should not update");
    };

    const first = await backfillSquarePaymentEvent({ invoice, events: [], paidActivity: null });
    assert.equal(lookups, 1);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.method, "tap_to_pay");
    assert.equal(saved[0]?.kind, "payment_succeeded");
    assert.equal(first.length, 1);
    assert.equal(first[0]?.paymentDetail?.label, "Tap to Pay · Visa ending 8089 · Square Point of Sale app");

    const second = await backfillSquarePaymentEvent({ invoice, events: first, paidActivity: null });
    assert.equal(lookups, 1);
    assert.equal(saved.length, 1);
    assert.equal(second, first);
  });

  it("does not ask Square again right after a failed lookup", async () => {
    let lookups = 0;
    squarePaymentLookup.find = async () => {
      lookups += 1;
      return null;
    };
    await backfillSquarePaymentEvent({ invoice, events: [], paidActivity: null });
    await backfillSquarePaymentEvent({ invoice, events: [], paidActivity: null });
    assert.equal(lookups, 1);
  });

  it("leaves offline payments alone", async () => {
    squarePaymentLookup.find = async () => {
      throw new Error("should not look up");
    };
    const result = await backfillSquarePaymentEvent({
      invoice: { ...invoice, offlinePayment: { method: "check" } as InvoiceForActivity["offlinePayment"] },
      events: [],
      paidActivity: null,
    });
    assert.deepEqual(result, []);
  });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");

function snapshotBody(image: string) {
  return {
    sessionId: "abcdefghijklmnop1234",
    entry: "checkout",
    link: { payToken: "pay_token_1" },
    step: "pay_clicked",
    takenAt: new Date().toISOString(),
    width: 900,
    height: 1600,
    image,
  };
}

describe("journey snapshots", () => {
  const invoices = Invoice as unknown as { find: (...args: unknown[]) => unknown };
  const snapshots = PaymentJourneySnapshot as unknown as {
    create: (...args: unknown[]) => unknown;
    countDocuments: (...args: unknown[]) => unknown;
  };
  const originalFind = invoices.find;
  const originalCreate = snapshots.create;
  const originalCount = snapshots.countDocuments;

  afterEach(() => {
    invoices.find = originalFind;
    snapshots.create = originalCreate;
    snapshots.countDocuments = originalCount;
  });

  it("accepts a JPEG under the size limit", () => {
    assert.equal(journeySnapshotSchema.safeParse(snapshotBody(JPEG)).success, true);
  });

  it("rejects an image over the size limit", () => {
    const tooBig = Buffer.alloc(JOURNEY_SNAPSHOT_MAX_BYTES + 1024, 1).toString("base64");
    assert.equal(journeySnapshotSchema.safeParse(snapshotBody(tooBig)).success, false);
  });

  it("rejects a snapshot without a payment link", () => {
    const body = { ...snapshotBody(JPEG), link: {} };
    assert.equal(journeySnapshotSchema.safeParse(body).success, false);
  });

  it("does not store a snapshot for a link the server never issued", async () => {
    invoices.find = () => ({ select: () => ({ lean: async () => [] }) });
    snapshots.countDocuments = async () => 0;
    snapshots.create = async () => {
      throw new Error("should not store");
    };
    const parsed = journeySnapshotSchema.parse(snapshotBody(JPEG));
    const result = await ingestJourneySnapshot({ snapshot: parsed, userAgent: "", ip: null });
    assert.deepEqual(result, { stored: false, reason: "unknown_link" });
  });

  it("does not store something that is not a JPEG", async () => {
    snapshots.create = async () => {
      throw new Error("should not store");
    };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString("base64");
    const parsed = journeySnapshotSchema.parse(snapshotBody(png));
    const result = await ingestJourneySnapshot({ snapshot: parsed, userAgent: "", ip: null });
    assert.deepEqual(result, { stored: false, reason: "not_jpeg" });
  });
});
