import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import express from "express";
import { z } from "zod";
import type { AddressInfo } from "node:net";
import { CheckoutLink, type ICheckoutLink } from "../models/mongo/CheckoutLink";
import { Invoice } from "../models/mongo/Invoice";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Contract } from "../models/mongo/Contract";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  assertScopedSelection,
  createScopedPaymentLink,
  loadScopedCheckout,
  paymentAmountLabel,
  previewPaymentSummary,
  validateInvoiceMessage,
} from "./checkoutLink.service";
import { mintPaymentLinkForCustomer } from "../utils/paymentLinkForCustomer";
import { getCheckoutByKey, previewCheckoutByKey, startCheckoutByKey } from "../controllers/checkout.controller";
import { startCustomerCheckout } from "./checkout.service";
import { hashPayToken } from "../utils/payToken";
import { messagingScheduleSchema, messagingSendSchema } from "../schemas/messageTemplate.schema";
import { emailMessageScheduleSchema, emailMessageSendSchema } from "../schemas/emailMessage.schema";
import { PaymentProviderAccount } from "../models/mongo/PaymentProviderAccount";
import { TaxSettings } from "../models/mongo/TaxSettings";
import { squareAdapter } from "../payments/square.adapter";
import type { CreateCheckoutInput } from "../payments/types";

function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), {
    select: () => query(value),
    sort: () => query(value),
    setOptions: () => query(value),
    lean: async () => value,
  });
}

describe("scoped checkout links", () => {
  const customerId = new Types.ObjectId();
  const contactId = new Types.ObjectId();
  let current: InstanceType<typeof Invoice>;
  let old: InstanceType<typeof Invoice>;
  let extra: InstanceType<typeof Invoice> | undefined;
  let stored: ICheckoutLink | undefined;

  beforeEach(() => {
    current = new Invoice({
      customerRef: customerId, customerId: 1579, number: "CURRENT",
      sourceType: "work_order", amountCents: 36380, status: "open",
      lineItems: [{ description: "Annual service and parts", amountCents: 34000 }],
    });
    old = new Invoice({
      customerRef: customerId, customerId: 1579, number: "OLD",
      sourceType: "contract_renewal", amountCents: 32100, status: "open",
      lineItems: [{ description: "Renewal", amountCents: 30000 }],
    });
    stored = undefined;
    extra = undefined;
    mock.method(Customer, "find", () => query([{ _id: customerId, first: "Ryan", last: "James", legacyId: 1579 }]));
    mock.method(Customer, "exists", async () => ({ _id: customerId }));
    mock.method(CustomerContact, "find", () => query([{ _id: contactId, customerRef: customerId }]));
    mock.method(WorkOrder, "find", () => query([]));
    mock.method(Invoice, "findById", () => query(current));
    mock.method(Invoice, "find", (filter: { _id?: { $in: Types.ObjectId[] }; status?: { $in: string[] } }) =>
      query([current, old, ...(extra ? [extra] : [])].filter((invoice) =>
        (!filter._id || filter._id.$in.some((id) => String(id) === String(invoice._id))) &&
        (!filter.status || filter.status.$in.includes(invoice.status)),
      )));
    mock.method(CheckoutLink, "create", async (input: ICheckoutLink) => {
      stored = input;
      return input;
    });
    mock.method(CheckoutLink, "findOne", (filter: { tokenHash: string }) =>
      query(stored?.tokenHash === filter.tokenHash ? stored : null));
    mock.method(CheckoutLink, "updateOne", async () => ({ acknowledged: true }));
    mock.method(Invoice, "updateOne", async () => ({ acknowledged: true }));
    mock.method(TaxSettings, "findOne", () => query(null));
  });

  afterEach(() => mock.restoreAll());

  async function mint() {
    const result = await createScopedPaymentLink(String(customerId), {
      invoiceId: String(current._id), expectedAmountCents: 36380,
    });
    assert.ok(result);
    const key = new URL(result.payUrl).searchParams.get("c");
    assert.ok(key);
    return { ...result, key };
  }

  it("covers exactly $363.80, never the older $321 invoice", async () => {
    const link = await mint();
    const { cart } = await loadScopedCheckout(link.key);
    assert.equal(cart.totalCents, 36380);
    assert.equal(cart.invoiceOnly, true);
    assert.deepEqual(cart.items.map((item) => item.id), [String(current._id)]);
    assert.equal(stored?.tokenHash, hashPayToken(link.key));
    assert.notEqual(stored?.tokenHash, link.key);
  });

  it("creates a different token on each send", async () => {
    assert.notEqual((await mint()).key, (await mint()).key);
  });

  it("snapshots only the latest invoice available today for a general link", async () => {
    const result = await createScopedPaymentLink(String(customerId));
    assert.ok(result);
    assert.equal(result.totalCents, 34347);
    assert.equal(stored?.invoiceOnly, false);
    assert.equal(stored?.items.length, 1);
    assert.equal(stored?.items[0]?.id, String(old._id));
    assert.match(paymentAmountLabel(result.totalCents, false), /Latest eligible invoice total: \$343\.47/);
    assert.equal(result.invoiceId, String(old._id));
    assert.match(new URL(result.payUrl).searchParams.get("c") ?? "", /^q_/);
  });

  it("keeps a general payment link on the invoice chosen at send time", async () => {
    const result = await mintPaymentLinkForCustomer(String(customerId));
    assert.ok(result);
    assert.equal(result.totalCents, 34347);
    assert.equal(result.invoiceId, String(old._id));
    const key = new URL(result.payUrl).searchParams.get("c");
    assert.match(key ?? "", /^q_/);
    assert.equal(new URL(result.payUrl).searchParams.get("p"), null);
    extra = new Invoice({
      customerRef: customerId, customerId: 1579, number: "NEW",
      sourceType: "contract_renewal", amountCents: 99999, status: "open",
      issuedAt: new Date(),
    });
    const { cart } = await loadScopedCheckout(key!);
    assert.equal(cart.totalCents, 34347);
    assert.deepEqual(cart.items.map((item) => item.id), [String(old._id)]);
  });

  it("charges the named offer invoice when a newer invoice exists", async () => {
    extra = new Invoice({
      customerRef: customerId, customerId: 1579, number: "NEWER",
      sourceType: "contract_renewal", amountCents: 99999, status: "open",
      issuedAt: new Date("2099-01-02"),
    });
    const result = await createScopedPaymentLink(String(customerId), {
      invoiceId: String(current._id),
    });
    assert.ok(result);
    assert.equal(result.totalCents, 36380);
    assert.equal(result.invoiceId, String(current._id));
    const key = new URL(result.payUrl).searchParams.get("c");
    assert.match(key ?? "", /^q_/);
    const { cart } = await loadScopedCheckout(key!);
    assert.equal(cart.totalCents, 36380);
    assert.deepEqual(cart.items.map((item) => item.id), [String(current._id)]);
  });

  it("previews an offer at the template price instead of a newer invoice", async () => {
    mock.method(ContractTemplate, "findById", () => query({ cost: 100, deletedAt: null }));
    mock.method(Contract, "findOne", () => query(null));
    const label = await previewPaymentSummary(
      String(customerId),
      undefined,
      String(new Types.ObjectId()),
    );
    assert.match(label, /Invoice total: \$107\.00/);
  });

  it("previews an existing open offer invoice instead of the template price", async () => {
    mock.method(ContractTemplate, "findById", () => query({ cost: 200, deletedAt: null }));
    mock.method(Contract, "findOne", () => query({ _id: new Types.ObjectId() }));
    mock.method(Invoice, "find", () => query([{
      status: "open",
      sourceType: "contract_initial",
      amountCents: 15000,
    }]));
    const label = await previewPaymentSummary(
      String(customerId),
      undefined,
      String(new Types.ObjectId()),
    );
    assert.match(label, /Invoice total: \$160\.50/);
  });

  it("updates an already-sent contract link from the catalog price to the taxed total", async () => {
    old.amountCents = 10000;
    old.taxCents = 0;
    old.taxRatePercent = 0;
    const key = `q_${"a".repeat(24)}`;
    stored = {
      tokenHash: hashPayToken(key),
      customerRef: customerId,
      invoiceOnly: false,
      items: [{ id: String(old._id), kind: "invoice", amountCents: 10000 }],
      expiresAt: new Date(Date.now() + 60_000),
    };
    const { cart } = await loadScopedCheckout(key);
    assert.equal(old.amountCents, 10700);
    assert.equal(old.taxCents, 700);
    assert.equal(cart.totalCents, 10700);
    assert.equal(stored?.items[0]?.amountCents, 10700);
  });

  it("does not add invoices created after a link was sent", async () => {
    const link = await createScopedPaymentLink(String(customerId));
    assert.ok(link);
    const key = new URL(link.payUrl).searchParams.get("c");
    assert.ok(key);
    extra = new Invoice({
      customerRef: customerId, customerId: 1579, number: "NEW",
      sourceType: "work_order", amountCents: 99999, status: "open",
    });
    const { cart } = await loadScopedCheckout(key);
    assert.equal(cart.totalCents, 34347);
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0]?.id, String(old._id));
  });

  it("rejects stale drafts before creating any link", async () => {
    current.amountCents = 40000;
    await assert.rejects(mint, /changed since/);
    assert.equal(stored, undefined);
  });

  it("rejects a changed amount after sending", async () => {
    const { key } = await mint();
    current.amountCents = 40000;
    await assert.rejects(() => loadScopedCheckout(key), /changed since/);
  });

  for (const status of ["paid", "void"] as const) {
    it(`blocks a ${status} invoice without falling back to the old balance`, async () => {
      const { key } = await mint();
      current.status = status;
      await assert.rejects(() => loadScopedCheckout(key), new RegExp(`already ${status}`));
    });
  }

  it("rejects deleted/missing invoices", async () => {
    const { key } = await mint();
    mock.method(Invoice, "find", () => query([]));
    await assert.rejects(() => loadScopedCheckout(key), /changed since/);
  });

  it("rejects nonexistent and expired tokens", async () => {
    await assert.rejects(() => loadScopedCheckout("q_unknown"), /not found/);
    const { key } = await mint();
    assert.ok(stored);
    stored.expiresAt = new Date(0);
    await assert.rejects(() => loadScopedCheckout(key), /expired/);
  });

  it("rejects foreign invoice, extra work order, or empty selections", async () => {
    await mint();
    assert.ok(stored);
    assert.doesNotThrow(() => assertScopedSelection(stored!.items, [String(current._id)]));
    assert.throws(() => assertScopedSelection(stored!.items, [String(current._id), String(old._id)]), /Only items/);
    assert.throws(() => assertScopedSelection(stored!.items, [String(current._id)], [String(new Types.ObjectId())]), /Only items/);
    assert.throws(() => assertScopedSelection(stored!.items, []), /Only items/);
  });

  it("revalidates the final selected invoice amount before contacting Square", async () => {
    await mint();
    assert.ok(stored);
    current.amountCents = 40000;
    await assert.rejects(() => startCustomerCheckout({
      customerIds: [String(customerId)],
      invoiceIds: [String(current._id)],
      expectedItems: stored!.items,
    }), /changed since/);
  });

  it("creates a Square checkout for exactly $363.80 and only the originating invoice", async () => {
    const { key } = await mint();
    const { items } = await loadScopedCheckout(key);
    mock.method(Customer, "findById", () => query({ _id: customerId, first: "Ryan", last: "James" }));
    mock.method(CustomerContact, "findOne", () => query(null));
    mock.method(PaymentProviderAccount, "findOne", () => query(new PaymentProviderAccount({
      provider: "square", isActive: true, friendlyName: "Test", authMethod: "manual",
    })));
    const saveCurrent = mock.method(current, "save", async () => current);
    const saveOld = mock.method(old, "save", async () => old);
    const checkout = mock.method(squareAdapter, "createCheckout", async (_input: CreateCheckoutInput) => ({
      url: "https://square.test/invoice-only", checkoutId: "test-checkout", orderId: "test-order",
    }));
    const result = await startCustomerCheckout({
      customerIds: [String(customerId)], invoiceIds: [String(current._id)], expectedItems: items,
    });
    assert.equal(result.url, "https://square.test/invoice-only");
    const input = checkout.mock.calls[0].arguments[0];
    assert.equal(input.amountCents, 36380);
    assert.equal(input.paymentNote, `invoice:${current._id}`);
    assert.equal(input.invoice._id, current._id);
    assert.equal(saveCurrent.mock.callCount(), 1);
    assert.equal(saveOld.mock.callCount(), 0);
  });

  it("rejects sending an invoice to a different customer's contact", async () => {
    mock.method(CustomerContact, "find", () => query([{ customerRef: new Types.ObjectId() }]));
    await assert.rejects(() => validateInvoiceMessage({
      invoiceId: String(current._id), contactIds: [String(contactId)], expectedAmountCents: 36380,
    }), /does not belong/);
  });

  it("requires invoice scope and expected amount in both SMS and email requests", () => {
    const data = {
      contactIds: [String(contactId)], body: "Pay {{payment_link}}",
      invoiceId: String(current._id), expectedAmountCents: 36380,
      emailAccountId: String(new Types.ObjectId()), subject: "Invoice",
    };
    for (const schema of [messagingSendSchema, emailMessageSendSchema]) {
      const parsed = schema.parse(data);
      assert.equal(parsed.invoiceId, String(current._id));
      assert.equal(parsed.expectedAmountCents, 36380);
      assert.equal(schema.safeParse({ ...data, expectedAmountCents: undefined }).success, false);
    }
    for (const schema of [messagingScheduleSchema, emailMessageScheduleSchema]) {
      const parsed = schema.parse({ ...data, scheduledAt: "2030-01-01T10:00:00Z" });
      assert.equal(parsed.invoiceId, String(current._id));
      assert.equal(parsed.expectedAmountCents, 36380);
    }
  });

  it("enforces invoice-only scope on public cart, session, and discount endpoints", async () => {
    const { key } = await mint();
    const app = express();
    app.use(express.json());
    app.get("/:key", getCheckoutByKey);
    app.post("/:key/session", startCheckoutByKey);
    app.post("/:key/discount", previewCheckoutByKey);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${key}`;
    try {
      const response = await fetch(base);
      assert.equal(response.status, 200);
      const cart = z.object({
        totalCents: z.number(), items: z.array(z.object({ id: z.string() })),
      }).parse(await response.json());
      assert.equal(cart.totalCents, 36380);
      assert.equal(cart.items.length, 1);
      for (const endpoint of ["session", "discount"]) {
        const bad = await fetch(`${base}/${endpoint}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceIds: [String(current._id), String(old._id)], discountCode: "SAVE" }),
        });
        assert.equal(bad.status, 400);
        assert.match(z.object({ message: z.string() }).parse(await bad.json()).message, /Only items/);
      }
      current.amountCents = 40000;
      const stale = await fetch(`${base}/session`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: [String(current._id)] }),
      });
      assert.equal(stale.status, 409);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });
});
