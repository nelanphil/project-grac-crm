import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatUsPhoneInput, isValidUsPhone } from "./formatPhone";

describe("formatUsPhoneInput", () => {
  it("formats a 10-digit number", () => {
    assert.equal(formatUsPhoneInput("3863633750"), "(386) 363-3750");
    assert.equal(formatUsPhoneInput("(386) 363-3750"), "(386) 363-3750");
    assert.equal(formatUsPhoneInput("386-363-3750"), "(386) 363-3750");
  });

  it("keeps a partial number while typing", () => {
    assert.equal(formatUsPhoneInput("3"), "(3");
    assert.equal(formatUsPhoneInput("386"), "(386");
    assert.equal(formatUsPhoneInput("386363"), "(386) 363");
    assert.equal(formatUsPhoneInput("1"), "(1");
  });

  it("drops a leading country code 1 from a full paste", () => {
    assert.equal(formatUsPhoneInput("13863633750"), "(386) 363-3750");
    assert.equal(formatUsPhoneInput("+1 (386) 363-3750"), "(386) 363-3750");
    assert.equal(formatUsPhoneInput("1-386-363-3750"), "(386) 363-3750");
  });

  it("ignores digits past the first 10 when the value is not an 11-digit country code", () => {
    assert.equal(formatUsPhoneInput("38636337501"), "(386) 363-3750");
  });
});

describe("isValidUsPhone", () => {
  it("accepts 10 digits and an 11-digit number with a leading 1", () => {
    assert.equal(isValidUsPhone("3863633750"), true);
    assert.equal(isValidUsPhone("(386) 363-3750"), true);
    assert.equal(isValidUsPhone("13863633750"), true);
    assert.equal(isValidUsPhone("+1 (386) 363-3750"), true);
  });

  it("rejects incomplete numbers", () => {
    assert.equal(isValidUsPhone("386363375"), false);
    assert.equal(isValidUsPhone("1"), false);
    assert.equal(isValidUsPhone(""), false);
  });
});
