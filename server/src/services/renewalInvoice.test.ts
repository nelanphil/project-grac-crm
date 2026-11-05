import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { Invoice } from "../models/mongo/Invoice";
import { TaxSettings } from "../models/mongo/TaxSettings";
import { ensureOpenRenewalInvoice } from "./renewalInvoice";

function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), {
    select: () => query(value),
    sort: () => query(value),
    lean: async () => value,
  });
}

describe("ensureOpenRenewalInvoice", () => {
  afterEach(() => mock.restoreAll());

  const contractId = new Types.ObjectId();
  const customerRef = new Types.ObjectId();
  const templateId = new Types.ObjectId();
  const contract = {
    _id: contractId,
    customerId: 42,
    customerRef,
    templateId,
    durationMonths: 12,
    renewalDueDate: new Date("2026-11-15T00:00:00.000Z"),
  };

  it("returns the existing open renewal", async () => {
    const openId = new Types.ObjectId();
    mock.method(Invoice, "findOne", () =>
      query({
        _id: openId,
        contractRef: contractId,
        sourceType: "contract_renewal",
        status: "open",
      }),
    );
    const result = await ensureOpenRenewalInvoice(contract);
    assert.equal(result.created, false);
    assert.equal(String(result.invoice?._id), String(openId));
  });

  it("creates one when none is open", async () => {
    mock.method(Invoice, "findOne", () => query(null));
    mock.method(Invoice, "exists", async () => null);
    mock.method(TaxSettings, "findOne", () => query({ ratePercent: 7 }));
    mock.method(ContractTemplate, "findById", () =>
      query({ _id: templateId, cost: 300, label: "Annual Service Contract" }),
    );
    const createdId = new Types.ObjectId();
    mock.method(Invoice, "create", async (doc: { sourceType: string; status: string }) => {
      assert.equal(doc.sourceType, "contract_renewal");
      assert.equal(doc.status, "open");
      return { _id: createdId, ...doc };
    });
    const result = await ensureOpenRenewalInvoice(contract);
    assert.equal(result.created, true);
    assert.equal(String(result.invoice?._id), String(createdId));
  });

  it("reuses the invoice when a unique-index race loses", async () => {
    const openId = new Types.ObjectId();
    const open = {
      _id: openId,
      contractRef: contractId,
      sourceType: "contract_renewal",
      status: "open",
    };
    let createCalled = false;
    mock.method(Invoice, "findOne", (filter: { status?: unknown }) => {
      if (createCalled && filter.status && typeof filter.status === "object") {
        return query(open);
      }
      return query(null);
    });
    mock.method(Invoice, "exists", async () => null);
    mock.method(TaxSettings, "findOne", () => query({ ratePercent: 7 }));
    mock.method(ContractTemplate, "findById", () =>
      query({ _id: templateId, cost: 300, label: "Annual Service Contract" }),
    );
    mock.method(Invoice, "create", async () => {
      createCalled = true;
      const err = new Error("E11000") as Error & { code: number };
      err.code = 11000;
      throw err;
    });
    const result = await ensureOpenRenewalInvoice(contract);
    assert.equal(result.created, false);
    assert.equal(String(result.invoice?._id), String(openId));
  });
});

describe("open renewal unique index", () => {
  it("is defined on the invoice schema", () => {
    const indexes = Invoice.schema.indexes();
    const found = indexes.some(([fields, options]) => {
      return (
        Boolean(fields.contractRef) &&
        fields.sourceType === 1 &&
        options?.unique === true &&
        options?.partialFilterExpression?.sourceType === "contract_renewal" &&
        options?.partialFilterExpression?.status === "open"
      );
    });
    assert.equal(found, true);
  });
});
