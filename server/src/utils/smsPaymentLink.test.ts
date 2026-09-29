import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isReservedPayCode,
  isValidPayCode,
  mintPayCode,
} from "./checkoutKey";
import { composeSmsPaymentBody } from "./smsPaymentLink";
import { SMS_BODY_MAX } from "../schemas/messageTemplate.schema";

const SHORT_URL = "https://pay.example.com/p/Ab12Cd34";

describe("pay codes", () => {
  it("mints an 8-character code that is safe to put in a URL", () => {
    for (let i = 0; i < 20; i++) {
      const code = mintPayCode();
      assert.equal(code.length, 8);
      assert.equal(isValidPayCode(code), true);
      assert.equal(isReservedPayCode(code), false);
    }
  });

  it("rejects reserved preview codes", () => {
    assert.equal(isReservedPayCode("preview"), true);
    assert.equal(isReservedPayCode("Preview"), true);
    assert.equal(isValidPayCode("preview"), false);
    assert.equal(isValidPayCode("sample"), false);
    assert.equal(isValidPayCode("short"), false);
  });
});

describe("composeSmsPaymentBody", () => {
  it("substitutes the short link for the payment token", () => {
    const result = composeSmsPaymentBody({
      bodyTemplate: "Hi {{first_name}}, pay here: {{payment_link}}",
      context: { first_name: "Ada", payment_link: "" },
      includePaymentLink: false,
      paymentUrl: SHORT_URL,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.body, `Hi Ada, pay here: ${SHORT_URL}`);
  });

  it("appends a pay line when the checkbox is on and the token is absent", () => {
    const result = composeSmsPaymentBody({
      bodyTemplate: "Hi {{first_name}}",
      context: { first_name: "Ada", payment_link: "" },
      includePaymentLink: true,
      paymentUrl: SHORT_URL,
    });
    assert.equal(result.body, `Hi Ada\nPay: ${SHORT_URL}`);
  });

  it("does not append a blank line when there is nothing to pay", () => {
    const result = composeSmsPaymentBody({
      bodyTemplate: "Hi {{first_name}} {{payment_link}}",
      context: { first_name: "Ada", payment_link: "" },
      includePaymentLink: true,
      paymentUrl: null,
    });
    assert.equal(result.body, "Hi Ada ");
    assert.equal(result.error, undefined);
  });

  it("fails when the rendered message exceeds the SMS limit", () => {
    const result = composeSmsPaymentBody({
      bodyTemplate: "x".repeat(SMS_BODY_MAX),
      context: { payment_link: "" },
      includePaymentLink: true,
      paymentUrl: SHORT_URL,
    });
    assert.match(result.error ?? "", /1600/);
    assert.ok(result.body.length > SMS_BODY_MAX);
  });
});
