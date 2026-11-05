import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { Contract, type IContract } from "../models/mongo/Contract";
import { Customer } from "../models/mongo/Customer";
import { CustomerActivity } from "../models/mongo/CustomerActivity";
import { Invoice } from "../models/mongo/Invoice";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  alreadyAppliedRenewal,
  applyContractRenewal,
  markInvoicePaid,
} from "./invoice.service";

function contractDoc(overrides?: Partial<IContract>): IContract {
  const contract = new Contract({
    customerId: 42,
    customerRef: new Types.ObjectId(),
    contractType: "service",
    durationMonths: 12,
    originalContractDate: new Date("2025-10-13T00:00:00.000Z"),
    contractDate: new Date("2025-10-13T00:00:00.000Z"),
    lastRenewalDate: new Date("2025-10-13T00:00:00.000Z"),
    renewalDueDate: new Date("2026-10-13T00:00:00.000Z"),
    renewals: [],
    description: "Annual Service Contract",
    ...overrides,
  });
  return contract;
}

describe("alreadyAppliedRenewal", () => {
  const invoiceRef = new Types.ObjectId();

  it("matches the same invoice", () => {
    assert.equal(
      alreadyAppliedRenewal(
        { renewals: [{ invoiceRef }] },
        { invoiceRef },
      ),
      true,
    );
  });

  it("matches the same provider payment on a different invoice", () => {
    assert.equal(
      alreadyAppliedRenewal(
        { renewals: [{ providerPaymentId: "pay_1" }] },
        { invoiceRef: new Types.ObjectId(), providerPaymentId: "pay_1" },
      ),
      true,
    );
  });

  it("allows a new invoice and payment", () => {
    assert.equal(
      alreadyAppliedRenewal(
        { renewals: [{ invoiceRef, providerPaymentId: "pay_1" }] },
        { invoiceRef: new Types.ObjectId(), providerPaymentId: "pay_2" },
      ),
      false,
    );
  });
});

describe("applyContractRenewal", () => {
  afterEach(() => mock.restoreAll());

  function install(existing: IContract) {
    mock.method(Customer, "exists", async () => ({ _id: existing.customerRef }));
    mock.method(NotificationEvent, "create", async () => ({
      _id: new Types.ObjectId(),
    }));
    mock.method(CustomerActivity, "create", async () => ({
      _id: new Types.ObjectId(),
    }));
    mock.method(
      Contract,
      "findOneAndUpdate",
      async (
        _filter: unknown,
        update: { $set?: Record<string, unknown>; $push?: { renewals?: unknown } },
      ) => {
        if (update.$set) Object.assign(existing, update.$set);
        if (update.$push?.renewals) {
          existing.renewals.push(update.$push.renewals as never);
        }
        return existing;
      },
    );
    mock.method(Contract, "findById", async () => existing);
  }

  it("keeps the anniversary when paid on or before the due date", async () => {
    const contract = contractDoc();
    install(contract);
    await applyContractRenewal({
      contract,
      renewedAt: new Date("2026-09-01T15:00:00.000Z"),
      durationMonths: 12,
      invoiceRef: new Types.ObjectId(),
    });
    assert.equal(contract.renewalDueDate?.toISOString(), "2027-10-13T00:00:00.000Z");
    assert.equal(contract.lastRenewalDate?.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(contract.renewals.length, 1);
    assert.equal(contract.renewals[0]?.wasLate, false);
  });

  it("starts a new year from the payment date when paid late", async () => {
    const contract = contractDoc();
    install(contract);
    await applyContractRenewal({
      contract,
      renewedAt: new Date("2026-11-20T12:00:00.000Z"),
      durationMonths: 12,
      invoiceRef: new Types.ObjectId(),
    });
    assert.equal(contract.renewalDueDate?.toISOString(), "2027-11-20T00:00:00.000Z");
    assert.equal(contract.contractDate?.toISOString(), "2026-11-20T00:00:00.000Z");
    assert.equal(contract.renewals[0]?.wasLate, true);
  });

  it("does not apply the same invoice twice", async () => {
    const invoiceRef = new Types.ObjectId();
    const contract = contractDoc();
    install(contract);
    await applyContractRenewal({
      contract,
      renewedAt: new Date("2026-10-13T00:00:00.000Z"),
      durationMonths: 12,
      invoiceRef,
    });
    await applyContractRenewal({
      contract,
      renewedAt: new Date("2026-10-13T00:00:00.000Z"),
      durationMonths: 12,
      invoiceRef,
    });
    assert.equal(contract.renewals.length, 1);
    assert.equal(contract.renewalDueDate?.toISOString(), "2027-10-13T00:00:00.000Z");
  });

  it("does not apply the same provider payment on a second invoice", async () => {
    const contract = contractDoc();
    contract.renewals.push({
      renewedAt: new Date("2026-10-13T00:00:00.000Z"),
      durationMonths: 12,
      previousDueDate: new Date("2026-10-13T00:00:00.000Z"),
      newDueDate: new Date("2027-10-13T00:00:00.000Z"),
      wasLate: false,
      invoiceRef: new Types.ObjectId(),
      providerPaymentId: "sq_abc",
      createdAt: new Date(),
    });
    install(contract);
    await applyContractRenewal({
      contract,
      renewedAt: new Date("2026-10-14T00:00:00.000Z"),
      durationMonths: 12,
      invoiceRef: new Types.ObjectId(),
      providerPaymentId: "sq_abc",
    });
    assert.equal(contract.renewals.length, 1);
  });

  it("ignores a second staff renew with the same date within two minutes", async () => {
    const contract = contractDoc();
    contract.renewals.push({
      renewedAt: new Date("2026-10-13T00:00:00.000Z"),
      durationMonths: 12,
      previousDueDate: new Date("2026-10-13T00:00:00.000Z"),
      newDueDate: new Date("2027-10-13T00:00:00.000Z"),
      wasLate: false,
      createdAt: new Date(),
    });
    install(contract);
    await applyContractRenewal({
      contract,
      renewedAt: new Date("2026-10-13T00:00:00.000Z"),
      durationMonths: 12,
    });
    assert.equal(contract.renewals.length, 1);
  });

  it("treats a lost race as already applied", async () => {
    const contract = contractDoc();
    const invoiceRef = new Types.ObjectId();
    mock.method(Customer, "exists", async () => ({ _id: contract.customerRef }));
    mock.method(CustomerActivity, "create", async () => ({
      _id: new Types.ObjectId(),
    }));
    mock.method(Contract, "findOneAndUpdate", async () => null);
    mock.method(Contract, "findById", async () => {
      contract.renewals = [
        {
          renewedAt: new Date("2026-10-13T00:00:00.000Z"),
          durationMonths: 12,
          previousDueDate: new Date("2026-10-13T00:00:00.000Z"),
          newDueDate: new Date("2027-10-13T00:00:00.000Z"),
          wasLate: false,
          invoiceRef,
          createdAt: new Date(),
        },
      ];
      contract.renewalDueDate = new Date("2027-10-13T00:00:00.000Z");
      return contract;
    });
    await applyContractRenewal({
      contract,
      renewedAt: new Date("2026-10-13T00:00:00.000Z"),
      durationMonths: 12,
      invoiceRef,
    });
    assert.equal(contract.renewals.length, 1);
  });
});

describe("markInvoicePaid already-paid renewal", () => {
  afterEach(() => mock.restoreAll());

  it("applies a missing contract_renewal once", async () => {
    const customerRef = new Types.ObjectId();
    const contract = contractDoc({ customerRef });
    const invoice = new Invoice({
      number: "INV-RETRY",
      customerId: 42,
      customerRef,
      sourceType: "contract_renewal",
      contractRef: contract._id,
      templateRef: new Types.ObjectId(),
      status: "paid",
      amountCents: 32100,
      paidAt: new Date("2026-10-13T15:00:00.000Z"),
      serviceWorkOrderRef: new Types.ObjectId(),
      metadata: { durationMonths: 12 },
    });
    mock.method(Customer, "exists", async () => ({ _id: customerRef }));
    mock.method(Contract, "findById", () => {
      const lean = {
        select: () => ({ lean: async () => ({ contractType: "service" }) }),
      };
      return Object.assign(Promise.resolve(contract), lean);
    });
    mock.method(
      Contract,
      "findOneAndUpdate",
      async (
        _filter: unknown,
        update: { $set?: Record<string, unknown>; $push?: { renewals?: unknown } },
      ) => {
        if (update.$set) Object.assign(contract, update.$set);
        if (update.$push?.renewals) {
          contract.renewals.push(update.$push.renewals as never);
        }
        return contract;
      },
    );
    mock.method(Contract, "find", () =>
      Object.assign(Promise.resolve([{ _id: contract._id, temporary: false }]), {
        select: () => ({
          lean: async () => [{ _id: contract._id, temporary: false }],
        }),
      }),
    );
    mock.method(Invoice, "find", () => Promise.resolve([]));
    mock.method(WorkOrder, "countDocuments", async () => 0);
    mock.method(NotificationEvent, "create", async () => ({
      _id: new Types.ObjectId(),
    }));
    mock.method(CustomerActivity, "create", async () => ({
      _id: new Types.ObjectId(),
    }));

    await markInvoicePaid({ invoice });
    assert.equal(contract.renewals.length, 1);
    assert.equal(contract.renewalDueDate?.toISOString(), "2027-10-13T00:00:00.000Z");
    await markInvoicePaid({ invoice });
    assert.equal(contract.renewals.length, 1);
  });
});
