import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { Invoice } from "../models/mongo/Invoice";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { User } from "../models/mongo/User";
import type { RetrievedProviderPayment } from "../payments/types";
import {
  matchPosPayment,
  paymentCoversInvoice,
  posLookups,
} from "./posReconcile.service";
import { settleInvoicePayment, settlementEffects } from "./invoiceSettlement.service";

const restorers: Array<() => void> = [];

function stub(object: object, method: string, implementation: unknown) {
  const mocked = mock.method(
    object,
    method as never,
    implementation as never,
  ) as { mock: { restore: () => void } };
  restorers.push(() => mocked.mock.restore());
}

function newInvoice(amountCents = 5000) {
  const invoice = new Invoice({
    customerId: 1,
    number: "INV-RECON",
    sourceType: "work_order",
    amountCents,
    currency: "USD",
    status: "open",
    lineItems: [{ description: "Service", amountCents }],
    posCharge: {
      startedAt: new Date("2026-10-28T16:00:00Z"),
      locationId: "LOC1",
      amountCents,
      status: "pending",
    },
  });
  stub(invoice, "save", async () => invoice);
  return invoice;
}

function payment(overrides: Partial<RetrievedProviderPayment> = {}): RetrievedProviderPayment {
  return {
    status: "paid",
    providerPaymentId: `pay-${Math.random().toString(36).slice(2)}`,
    providerOrderId: `order-${Math.random().toString(36).slice(2)}`,
    invoiceIds: [],
    amountCents: 5000,
    locationId: "LOC1",
    ...overrides,
  };
}

let linked = new Set<string>();
let competing = 0;

beforeEach(() => {
  linked = new Set();
  competing = 0;
  stub(posLookups, "linkedElsewhere", async () => linked);
  stub(posLookups, "competingCharges", async () => competing);
});

afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
});

describe("paymentCoversInvoice", () => {
  it("accepts the exact invoice amount", () => {
    const invoice = newInvoice(107);
    assert.equal(paymentCoversInvoice(payment({ amountCents: 107 }), invoice), true);
  });

  it("accepts Square's added tax only when the order names the invoice", () => {
    const invoice = newInvoice(107);
    const named = payment({
      amountCents: 111,
      taxCents: 4,
      invoiceIds: [String(invoice._id)],
    });
    const unnamed = payment({ amountCents: 111, taxCents: 4 });
    assert.equal(paymentCoversInvoice(named, invoice), true);
    assert.equal(paymentCoversInvoice(unnamed, invoice), false);
  });

  it("rejects a different amount", () => {
    const invoice = newInvoice(5000);
    assert.equal(paymentCoversInvoice(payment({ amountCents: 4999 }), invoice), false);
  });
});

describe("matchPosPayment", () => {
  const start = new Date("2026-10-28T16:00:00Z");

  it("settles on the single payment for the invoice amount", async () => {
    const invoice = newInvoice();
    const only = payment();
    const result = await matchPosPayment({
      invoice,
      payments: [only, payment({ amountCents: 1200 })],
      start,
    });
    assert.equal(result.status, "match");
    assert.equal(result.status === "match" && result.payment, only);
  });

  it("prefers the payment whose note names the invoice", async () => {
    const invoice = newInvoice();
    const named = payment({ invoiceIds: [String(invoice._id)] });
    const result = await matchPosPayment({
      invoice,
      payments: [payment(), named],
      start,
    });
    assert.equal(result.status === "match" && result.payment, named);
  });

  it("asks for review when two payments could be it", async () => {
    const invoice = newInvoice();
    const result = await matchPosPayment({
      invoice,
      payments: [payment(), payment()],
      start,
    });
    assert.equal(result.status, "review");
    assert.equal(result.status === "review" && result.candidates.length, 2);
  });

  it("skips a payment already recorded on another invoice", async () => {
    const invoice = newInvoice();
    const taken = payment({ providerPaymentId: "pay-taken" });
    linked = new Set(["pay-taken"]);
    const result = await matchPosPayment({ invoice, payments: [taken], start });
    assert.equal(result.status, "none");
  });

  it("asks for review when another open charge has the same amount", async () => {
    const invoice = newInvoice();
    competing = 1;
    const result = await matchPosPayment({ invoice, payments: [payment()], start });
    assert.equal(result.status, "review");
  });

  it("ignores payments for another invoice's note", async () => {
    const invoice = newInvoice();
    const other = payment({ invoiceIds: [new Types.ObjectId().toString()] });
    const result = await matchPosPayment({ invoice, payments: [other], start });
    assert.equal(result.status, "none");
  });
});

describe("settleInvoicePayment", () => {
  let receipts = 0;

  beforeEach(() => {
    receipts = 0;
    stub(User, "findById", () => ({
      select: () => ({ lean: async () => null }),
    }));
    stub(NotificationEvent, "create", async () => ({
      _id: new Types.ObjectId(),
      createdAt: new Date(),
    }));
    stub(settlementEffects, "finalizeRedemptions", async () => {});
    stub(settlementEffects, "sendReceipts", async (invoice: InstanceType<typeof Invoice>) => {
      receipts += 1;
      invoice.paymentReceiptSentAt = new Date();
      invoice.paymentReceiptTextSentAt = new Date();
    });
  });

  it("marks the invoice paid, confirms the charge, and sends receipts once", async () => {
    const invoice = newInvoice();
    const paid = { providerPaymentId: "pay-1", providerOrderId: "order-1" };
    await settleInvoicePayment({ invoices: [invoice], ...paid });
    await settleInvoicePayment({ invoices: [invoice], ...paid });
    assert.equal(invoice.status, "paid");
    assert.equal(invoice.posCharge?.status, "confirmed");
    assert.equal(invoice.providerOrderId, "order-1");
    assert.equal(receipts, 1);
  });

  it("retries receipts for the same payment when one did not go out", async () => {
    const invoice = newInvoice();
    const paid = { providerPaymentId: "pay-1", providerOrderId: "order-1" };
    await settleInvoicePayment({ invoices: [invoice], ...paid });
    invoice.paymentReceiptTextSentAt = null;
    await settleInvoicePayment({ invoices: [invoice], ...paid });
    assert.equal(receipts, 2);
  });

  it("leaves an invoice paid by a different payment alone", async () => {
    const invoice = newInvoice();
    await settleInvoicePayment({
      invoices: [invoice],
      providerPaymentId: "pay-1",
      providerOrderId: "order-1",
    });
    invoice.paymentReceiptTextSentAt = null;
    const settled = await settleInvoicePayment({
      invoices: [invoice],
      providerPaymentId: "pay-2",
      providerOrderId: "order-2",
    });
    assert.equal(settled.length, 0);
    assert.equal(invoice.providerPaymentId, "pay-1");
    assert.equal(receipts, 1);
  });
});
