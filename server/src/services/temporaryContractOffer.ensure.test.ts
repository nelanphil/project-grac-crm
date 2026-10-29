import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { Customer } from "../models/mongo/Customer";
import { Invoice } from "../models/mongo/Invoice";
import { ensureTemporaryContractOffer } from "./temporaryContractOffer";

function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), {
    select: () => query(value),
    sort: () => query(value),
    lean: async () => value,
  });
}

describe("ensureTemporaryContractOffer", () => {
  afterEach(() => mock.restoreAll());

  const customerId = new Types.ObjectId();
  const templateId = new Types.ObjectId();
  const existingId = new Types.ObjectId();
  const renewalId = new Types.ObjectId();

  type ContractFilter = { temporary?: true | { $ne: true } };

  function install() {
    mock.method(ContractTemplate, "findById", () =>
      query({
        _id: templateId,
        cost: 199,
        label: "Annual Service Contract",
        slug: "asc",
        deletedAt: null,
      }),
    );
    mock.method(Customer, "findById", () =>
      query({ _id: customerId, legacyId: 42 }),
    );
    mock.method(Contract, "find", (filter: ContractFilter) =>
      query(filter.temporary === true ? [] : [{ _id: existingId }]),
    );
    mock.method(Contract, "findOne", () => query(null));
    mock.method(Contract, "create", async () => {
      throw new Error("should not create an offer");
    });
    mock.method(Invoice, "findOne", () =>
      query({
        _id: renewalId,
        contractRef: existingId,
        sourceType: "contract_renewal",
        status: "open",
      }),
    );
  }

  it("returns the open renewal when the customer already has the contract", async () => {
    install();
    const result = await ensureTemporaryContractOffer(
      String(customerId),
      String(templateId),
    );
    assert.deepEqual(result, {
      contractId: String(existingId),
      invoiceId: String(renewalId),
      created: false,
    });
  });
});
