import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyReceiptEmail,
  classifyReceiptPhone,
} from "./invoiceReceipt.service";

describe("classifyReceiptEmail", () => {
  it("treats a blank address as missing", () => {
    assert.deepEqual(classifyReceiptEmail("  "), { status: "missing" });
    assert.deepEqual(classifyReceiptEmail(null), { status: "missing" });
  });

  it("rejects an address that is not a valid email", () => {
    assert.deepEqual(classifyReceiptEmail("not-an-email"), {
      status: "invalid",
      to: "not-an-email",
    });
  });

  it("accepts a valid address and normalizes it", () => {
    assert.deepEqual(classifyReceiptEmail(" Ada@Example.com "), {
      status: "ok",
      to: "ada@example.com",
    });
  });
});

describe("classifyReceiptPhone", () => {
  it("rejects a number that is not 10 digits", () => {
    assert.deepEqual(classifyReceiptPhone("555-010"), { status: "invalid" });
    assert.deepEqual(classifyReceiptPhone(""), { status: "invalid" });
  });

  it("accepts a 10-digit US number", () => {
    assert.deepEqual(classifyReceiptPhone("(813) 555-0100"), {
      status: "ok",
      phone: "(813) 555-0100",
    });
  });
});
