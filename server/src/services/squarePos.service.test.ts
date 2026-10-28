import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import type { Response } from "express";
import {
  confirmInvoicePosCharge,
  startInvoicePosCharge,
} from "../controllers/invoice.controller";
import { Invoice } from "../models/mongo/Invoice";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { PaymentProviderAccount } from "../models/mongo/PaymentProviderAccount";
import { User } from "../models/mongo/User";
import { squareAdapter } from "../payments/square.adapter";
import { signPosChargeState } from "./squarePos.service";
import { buildPosCallbackUrl } from "../utils/posCallbackUrl";
import type { AuthRequest } from "../middleware/auth.middleware";

function staffRequest(
  invoiceId: string,
  body: Record<string, unknown>,
): AuthRequest {
  return {
    params: { id: invoiceId },
    body,
    user: {
      id: new Types.ObjectId().toString(),
      sub: "staff",
      email: "staff@example.com",
      role: "admin",
      roles: ["admin"],
      userType: "staff",
      jobRoles: [],
      permissions: ["contracts:write"],
    },
  } as unknown as AuthRequest;
}

async function post(invoiceId: string, body: Record<string, unknown>) {
  let statusCode = 200;
  let payload: { status?: string; message?: string } | undefined;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: { status?: string; message?: string }) {
      payload = body;
      return this;
    },
  };
  await confirmInvoicePosCharge(
    staffRequest(invoiceId, body),
    res as unknown as Response,
  );
  return { statusCode, payload };
}

describe("confirm Tap to Pay", () => {
  let invoice: InstanceType<typeof Invoice>;
  let chargedCents = 5000;
  let retrieveCalls = 0;
  const restorers: Array<() => void> = [];

  function stub(object: object, method: string, implementation: unknown) {
    const mocked = mock.method(
      object,
      method as never,
      implementation as never,
    ) as { mock: { restore: () => void } };
    restorers.push(() => mocked.mock.restore());
  }

  beforeEach(() => {
    chargedCents = 5000;
    retrieveCalls = 0;
    invoice = new Invoice({
      customerId: 1,
      number: "INV-POS",
      sourceType: "work_order",
      amountCents: 5000,
      currency: "USD",
      status: "open",
      lineItems: [{ description: "Service", amountCents: 5000 }],
    });
    stub(invoice, "save", async () => invoice);
    stub(Invoice, "findById", async () => invoice);
    stub(User, "findById", () => ({
      select: () => ({ lean: async () => null }),
    }));
    stub(NotificationEvent, "create", async () => ({
      _id: new Types.ObjectId(),
      createdAt: new Date(),
    }));
    stub(PaymentProviderAccount, "findOne", async () =>
      new PaymentProviderAccount({
        provider: "square",
        isActive: true,
        isDefault: true,
        friendlyName: "Test",
        authMethod: "manual",
        environment: "sandbox",
        locationId: "LOC1",
      }),
    );
    stub(squareAdapter, "retrieveOrder", async () => {
      retrieveCalls += 1;
      return {
        status: "paid" as const,
        providerOrderId: "order-1",
        providerPaymentId: "pay-1",
        invoiceIds: [],
        amountCents: chargedCents,
        locationId: "LOC1",
      };
    });
  });

  afterEach(() => {
    for (const restore of restorers.splice(0)) restore();
  });

  function state() {
    return signPosChargeState({
      invoiceId: String(invoice._id),
      amountCents: invoice.amountCents,
    });
  }

  it("marks the invoice paid when the Square order matches", async () => {
    const result = await post(String(invoice._id), {
      transactionId: "order-1",
      state: state(),
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload?.status, "paid");
    assert.equal(invoice.status, "paid");
    assert.equal(invoice.providerOrderId, "order-1");
    assert.equal(invoice.providerPaymentId, "pay-1");
    assert.equal(retrieveCalls, 1);
  });

  it("rejects a charge for a different amount", async () => {
    chargedCents = 100;
    const result = await post(String(invoice._id), {
      transactionId: "order-1",
      state: state(),
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.payload?.message ?? "", /amount/i);
    assert.equal(invoice.status, "open");
  });

  it("rejects a bad state before calling Square", async () => {
    const result = await post(String(invoice._id), {
      transactionId: "order-1",
      state: "not-a-valid-session",
    });
    assert.equal(result.statusCode, 400);
    assert.match(result.payload?.message ?? "", /invalid payment session/i);
    assert.equal(retrieveCalls, 0);
    assert.equal(invoice.status, "open");
  });

  it("returns success again for the same Square order", async () => {
    const body = { transactionId: "order-1", state: state() };
    const first = await post(String(invoice._id), body);
    const second = await post(String(invoice._id), body);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload?.status, "paid");
    assert.equal(retrieveCalls, 1);
  });
});

describe("start Tap to Pay", () => {
  let invoice: InstanceType<typeof Invoice>;
  const restorers: Array<() => void> = [];

  function stub(object: object, method: string, implementation: unknown) {
    const mocked = mock.method(
      object,
      method as never,
      implementation as never,
    ) as { mock: { restore: () => void } };
    restorers.push(() => mocked.mock.restore());
  }

  function account(environment: "sandbox" | "production", applicationId?: string) {
    return new PaymentProviderAccount({
      provider: "square",
      isActive: true,
      isDefault: true,
      friendlyName: "Test",
      authMethod: "manual",
      environment,
      locationId: "LOC1",
      applicationId,
    });
  }

  beforeEach(() => {
    invoice = new Invoice({
      customerId: 1,
      number: "INV-POS",
      sourceType: "work_order",
      amountCents: 5000,
      currency: "USD",
      status: "open",
      lineItems: [{ description: "Service", amountCents: 5000 }],
    });
    stub(invoice, "save", async () => invoice);
    stub(Invoice, "findById", async () => invoice);
  });

  afterEach(() => {
    for (const restore of restorers.splice(0)) restore();
  });

  async function start() {
    let statusCode = 200;
    let payload: { applicationId?: string; callbackUrl?: string; message?: string } | undefined;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: { applicationId?: string; callbackUrl?: string; message?: string }) {
        payload = body;
        return this;
      },
    };
    await startInvoicePosCharge(
      staffRequest(String(invoice._id), {}),
      res as unknown as Response,
    );
    return { statusCode, payload };
  }

  it("rejects a sandbox Square account", async () => {
    stub(PaymentProviderAccount, "findOne", async () =>
      account("sandbox", "sandbox-sq0idb-test"),
    );
    const result = await start();
    assert.equal(result.statusCode, 400);
    assert.match(result.payload?.message ?? "", /production/i);
    assert.equal(invoice.paymentProvider, undefined);
  });

  it("uses the connected account's application id and a trailing-slash callback", async () => {
    stub(PaymentProviderAccount, "findOne", async () =>
      account("production", "sq0idp-account"),
    );
    const result = await start();
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload?.applicationId, "sq0idp-account");
    assert.equal(result.payload?.callbackUrl, buildPosCallbackUrl());
    assert.match(result.payload?.callbackUrl ?? "", /\/checkout\/pos-callback\/$/);
  });
});
