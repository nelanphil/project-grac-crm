import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSquarePosUrl,
  detectPlatform,
  invoiceIdFromPosState,
  parsePosCallback,
  posCallbackMessage,
  type SquarePosCharge,
} from "./squarePos.ts";

const charge: SquarePosCharge = {
  amountCents: 2599,
  currency: "USD",
  applicationId: "sq0idp-test",
  callbackUrl: "https://crm.example.com/checkout/pos-callback",
  state: "payload.sig",
  note: "invoice:abc123",
};

describe("detectPlatform", () => {
  it("recognizes iPhone, Android, and desktop browsers", () => {
    assert.equal(
      detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
      "ios",
    );
    assert.equal(
      detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)"),
      "android",
    );
    assert.equal(
      detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
      "unsupported",
    );
  });
});

describe("buildSquarePosUrl", () => {
  it("builds an iOS Point of Sale link for a card tap", () => {
    const url = buildSquarePosUrl("ios", charge);
    assert.ok(url.startsWith("square-commerce-v1://payment/create?data="));
    const data = JSON.parse(decodeURIComponent(url.split("data=")[1]!));
    assert.equal(data.amount_money.amount, "2599");
    assert.equal(data.amount_money.currency_code, "USD");
    assert.equal(data.callback_url, charge.callbackUrl);
    assert.equal(data.client_id, "sq0idp-test");
    assert.equal(data.version, "1.3");
    assert.equal(data.notes, "invoice:abc123");
    assert.equal(data.state, "payload.sig");
    assert.deepEqual(data.options.supported_tender_types, ["CARD_FROM_READER"]);
    assert.equal(data.options.auto_return, true);
  });

  it("builds an Android intent that charges a card and falls back when the app is missing", () => {
    const url = buildSquarePosUrl("android", charge);
    assert.ok(url.startsWith("intent:#Intent;"));
    assert.ok(url.endsWith(";end"));
    assert.match(url, /action=com\.squareup\.pos\.action\.CHARGE/);
    assert.match(url, /package=com\.squareup/);
    assert.match(url, /i\.com\.squareup\.pos\.TOTAL_AMOUNT=2599/);
    assert.match(url, /S\.com\.squareup\.pos\.CURRENCY_CODE=USD/);
    assert.match(url, /S\.com\.squareup\.pos\.TENDER_TYPES=com\.squareup\.pos\.TENDER_CARD/);
    assert.match(url, /S\.com\.squareup\.pos\.API_VERSION=v2\.0/);
    assert.match(url, /S\.com\.squareup\.pos\.CLIENT_ID=sq0idp-test/);
    assert.match(
      url,
      /S\.com\.squareup\.pos\.WEB_CALLBACK_URI=https:\/\/crm\.example\.com\/checkout\/pos-callback/,
    );
    assert.match(url, /S\.com\.squareup\.pos\.NOTE=invoice:abc123/);
    assert.match(url, /S\.com\.squareup\.pos\.REQUEST_METADATA=payload\.sig/);
    assert.match(url, /S\.browser_fallback_url=https:\/\/crm\.example\.com\/checkout\/pos-callback\?error=app_not_installed/);
  });
});

describe("parsePosCallback", () => {
  it("reads a successful iOS callback", () => {
    const params = new URLSearchParams();
    params.set(
      "data",
      JSON.stringify({
        status: "ok",
        transaction_id: "order-1",
        client_transaction_id: "client-1",
        state: "payload.sig",
      }),
    );
    assert.deepEqual(parsePosCallback(params), {
      ok: true,
      transactionId: "order-1",
      clientTransactionId: "client-1",
      state: "payload.sig",
    });
  });

  it("reads a canceled iOS callback", () => {
    const params = new URLSearchParams();
    params.set(
      "data",
      JSON.stringify({
        status: "error",
        error_code: "payment_canceled",
        state: "payload.sig",
      }),
    );
    assert.deepEqual(parsePosCallback(params), {
      ok: false,
      errorCode: "payment_canceled",
      state: "payload.sig",
    });
    assert.match(posCallbackMessage("payment_canceled"), /canceled/i);
  });

  it("reads Android success and error callbacks", () => {
    const success = new URLSearchParams({
      "com.squareup.pos.SERVER_TRANSACTION_ID": "order-9",
      "com.squareup.pos.CLIENT_TRANSACTION_ID": "client-9",
      "com.squareup.pos.REQUEST_METADATA": "payload.sig",
    });
    assert.equal(parsePosCallback(success)?.ok, true);
    if (parsePosCallback(success)?.ok) {
      assert.equal(parsePosCallback(success)?.transactionId, "order-9");
    }

    const failed = new URLSearchParams({
      "com.squareup.pos.ERROR_CODE": "user_not_logged_in",
      "com.squareup.pos.REQUEST_METADATA": "payload.sig",
    });
    assert.deepEqual(parsePosCallback(failed), {
      ok: false,
      errorCode: "user_not_logged_in",
      state: "payload.sig",
    });
  });

  it("rejects a bad iOS payload and a missing app", () => {
    const bad = new URLSearchParams({ data: "not-json" });
    assert.deepEqual(parsePosCallback(bad), {
      ok: false,
      errorCode: "invalid_callback",
    });
    const missing = new URLSearchParams({ error: "app_not_installed" });
    assert.equal(parsePosCallback(missing)?.ok, false);
    assert.equal(parsePosCallback(new URLSearchParams()), null);
  });
});

describe("invoiceIdFromPosState", () => {
  it("reads the invoice id from the signed payload and ignores a bad token", () => {
    const payload = Buffer.from(
      JSON.stringify({
        invoiceId: "507f1f77bcf86cd799439011",
        amountCents: 2599,
        exp: Date.now() + 1000,
      }),
    ).toString("base64url");
    assert.equal(
      invoiceIdFromPosState(`${payload}.not-the-signature`),
      "507f1f77bcf86cd799439011",
    );
    assert.equal(invoiceIdFromPosState("not-a-token"), null);
    assert.equal(invoiceIdFromPosState(""), null);
  });
});
