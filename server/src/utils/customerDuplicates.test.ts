import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAddressKey } from "./customerSites";
import {
  accountNamesMatch,
  classifyContactField,
  classifyUniqueField,
  contactFieldMessage,
  firstBlockingMessage,
  hasBlockingDuplicates,
  MIN_ACCOUNT_NAME_LEN,
  MIN_PHONE_DIGITS_FOR_CHECK,
  normalizeAccountNameKey,
  recordAccountName,
  uniqueFieldMessage,
  type DuplicateCheckResult,
  type DuplicateMatch,
} from "./customerDuplicates";

function match(overrides: Partial<DuplicateMatch> = {}): DuplicateMatch {
  return {
    _id: "cust-1",
    legacyId: 12,
    accountName: "Jane Smith",
    first: "Jane",
    last: "Smith",
    phone: "(386) 555-0100",
    email: "jane@example.com",
    address: "1 Main St",
    city: "Palm Coast",
    state: "FL",
    zip: "32137",
    ...overrides,
  };
}

describe("customerDuplicates helpers", () => {
  it("normalizes account names for uniqueness", () => {
    assert.equal(normalizeAccountNameKey("  Jane   Smith "), "jane smith");
    assert.equal(accountNamesMatch("Jane Smith", "jane   smith"), true);
    assert.equal(accountNamesMatch("Jane Smith", "John Smith"), false);
    assert.equal(accountNamesMatch("", ""), false);
  });

  it("uses durable account name, then first + last", () => {
    assert.equal(
      recordAccountName({ accountName: "Acme LLC", first: "A", last: "B" }),
      "Acme LLC",
    );
    assert.equal(
      recordAccountName({ accountName: "  ", first: "Jane", last: "Smith" }),
      "Jane Smith",
    );
  });

  it("treats primary contact matches as blocking and secondary as warnings", () => {
    assert.equal(classifyContactField([], true), "none");
    assert.equal(classifyContactField([match()], true), "blocking");
    assert.equal(classifyContactField([match()], false), "warning");
    assert.equal(classifyUniqueField([]), "none");
    assert.equal(classifyUniqueField([match()]), "blocking");
  });

  it("returns field-specific copy", () => {
    assert.equal(contactFieldMessage("phone", "none"), undefined);
    assert.match(contactFieldMessage("phone", "blocking") ?? "", /tied to a customer/);
    assert.match(contactFieldMessage("phone", "warning") ?? "", /already exists/);
    assert.match(contactFieldMessage("email", "blocking") ?? "", /tied to a customer/);
    assert.equal(uniqueFieldMessage("accountName", "warning"), undefined);
    assert.match(uniqueFieldMessage("accountName", "blocking") ?? "", /account name/);
    assert.match(uniqueFieldMessage("address", "blocking") ?? "", /address/);
  });

  it("requires street + zip before an address can match", () => {
    assert.equal(normalizeAddressKey("1 Main St", ""), "");
    assert.equal(normalizeAddressKey("", "32137"), "");
    assert.equal(
      normalizeAddressKey("1 Main St.", "32137"),
      normalizeAddressKey("1 Main St", "32137"),
    );
  });

  it("keeps check thresholds conservative", () => {
    assert.equal(MIN_PHONE_DIGITS_FOR_CHECK, 7);
    assert.equal(MIN_ACCOUNT_NAME_LEN, 2);
  });

  it("finds the first blocking message across fields", () => {
    const empty: DuplicateCheckResult = {
      accountName: { severity: "none", matches: [] },
      contacts: {
        c1: {
          phone: { severity: "warning", message: "warn", matches: [match()] },
          email: { severity: "none", matches: [] },
        },
      },
      addresses: {},
    };
    assert.equal(firstBlockingMessage(empty), null);
    assert.equal(hasBlockingDuplicates(empty), false);

    const blocked: DuplicateCheckResult = {
      ...empty,
      accountName: {
        severity: "blocking",
        message: "A customer with this account name already exists.",
        matches: [match()],
      },
    };
    assert.equal(
      firstBlockingMessage(blocked),
      "A customer with this account name already exists.",
    );
    assert.equal(hasBlockingDuplicates(blocked), true);
  });
});
