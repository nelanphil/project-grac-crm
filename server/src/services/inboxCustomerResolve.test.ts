import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreCustomerName } from "./inboxCustomerResolve.service";

describe("inbox customer name score", () => {
  it("prefers Christopher Hatton over Dad Hatton for Chris Hatton", () => {
    const chris = scoreCustomerName(
      { accountName: "Christopher Hatton", first: "Christopher", last: "Hatton" },
      "Chris Hatton",
    );
    const dad = scoreCustomerName(
      { accountName: "DAD HATTON", first: "Dad", last: "Hatton" },
      "Chris Hatton",
    );
    assert.ok(chris > dad);
  });

  it("does not score an unrelated sender", () => {
    assert.equal(
      scoreCustomerName(
        { accountName: "Christopher Hatton", first: "Christopher", last: "Hatton" },
        "Mail Delivery Subsystem",
      ),
      0,
    );
  });
});
