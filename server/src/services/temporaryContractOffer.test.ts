import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMonths } from "../utils/contractDates";
import {
  offerTemplateError,
  promoteTemporaryContract,
  resolveOfferContractTemplateId,
  reusableOfferInvoice,
  visibleContractQuery,
  type TemporaryContractDates,
} from "../utils/temporaryContractOffer";

describe("temporary contract offers", () => {
  it("rejects a missing, deleted, or zero-cost template", () => {
    assert.equal(
      offerTemplateError(null),
      "Contract template is not available",
    );
    assert.equal(
      offerTemplateError({ cost: 199, deletedAt: new Date("2026-01-01") }),
      "Contract template is not available",
    );
    assert.equal(
      offerTemplateError({ cost: 0, deletedAt: null }),
      "Contract template must have a cost greater than zero",
    );
    assert.equal(offerTemplateError({ cost: 199, deletedAt: null }), null);
  });

  it("reuses an open initial invoice instead of planning another", () => {
    const invoices = [
      { _id: "voided", status: "void", sourceType: "contract_initial" },
      { _id: "open", status: "open", sourceType: "contract_initial" },
      { _id: "renewal", status: "open", sourceType: "contract_renewal" },
    ];
    assert.equal(reusableOfferInvoice(invoices)?._id, "open");
    assert.equal(
      reusableOfferInvoice([
        { _id: "paid", status: "paid", sourceType: "contract_initial" },
      ]),
      null,
    );
  });

  it("promotes a paid temporary contract and sets the renewal date", () => {
    const contract: TemporaryContractDates = {
      temporary: true,
      durationMonths: 12,
      originalContractDate: null,
      contractDate: null,
      renewalDueDate: null,
    };
    const paidAt = new Date("2026-03-15T18:30:00.000Z");
    promoteTemporaryContract(contract, paidAt);

    assert.equal(contract.temporary, false);
    assert.equal(
      contract.contractDate?.toISOString(),
      "2026-03-15T00:00:00.000Z",
    );
    assert.equal(
      contract.originalContractDate?.toISOString(),
      "2026-03-15T00:00:00.000Z",
    );
    assert.equal(
      contract.renewalDueDate?.toISOString(),
      addMonths(contract.contractDate!, 12).toISOString(),
    );
    assert.equal(
      contract.renewalDueDate?.toISOString(),
      "2027-03-15T00:00:00.000Z",
    );
  });

  it("leaves a real contract unchanged when promotion runs", () => {
    const due = new Date("2026-08-01T00:00:00.000Z");
    const contract: TemporaryContractDates = {
      temporary: false,
      durationMonths: 12,
      originalContractDate: new Date("2025-08-01T00:00:00.000Z"),
      contractDate: new Date("2025-08-01T00:00:00.000Z"),
      renewalDueDate: due,
    };
    promoteTemporaryContract(contract, new Date("2026-03-15T00:00:00.000Z"));
    assert.equal(contract.temporary, false);
    assert.equal(contract.renewalDueDate, due);
  });

  it("keeps unpaid temporary contracts out of the contract list query", () => {
    const filter = visibleContractQuery({ customerId: 42 });
    assert.deepEqual(filter, {
      customerId: 42,
      temporary: { $ne: true },
    });
    const listed = [
      { _id: "real", temporary: false },
      { _id: "offer", temporary: true },
      { _id: "legacy" },
    ].filter((row) => row.temporary !== true);
    assert.deepEqual(
      listed.map((row) => row._id),
      ["real", "legacy"],
    );
  });

  it("lets a recipient override replace the template default", () => {
    const overrides = [
      { contactId: "a", contractTemplateId: "tmpl-b" },
      { contactId: "b", contractTemplateId: null },
    ];
    assert.equal(
      resolveOfferContractTemplateId("a", "tmpl-default", overrides),
      "tmpl-b",
    );
    assert.equal(
      resolveOfferContractTemplateId("b", "tmpl-default", overrides),
      null,
    );
    assert.equal(
      resolveOfferContractTemplateId("c", "tmpl-default", overrides),
      "tmpl-default",
    );
    assert.equal(resolveOfferContractTemplateId("c", null, []), null);
  });
});
