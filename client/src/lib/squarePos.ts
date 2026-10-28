export type SquarePosPlatform = "ios" | "android" | "unsupported";

export type SquarePosCharge = {
  amountCents: number;
  currency: string;
  applicationId: string;
  callbackUrl: string;
  state: string;
  note: string;
};

export type PosCallbackResult =
  | {
      ok: true;
      transactionId: string;
      clientTransactionId?: string;
      state: string;
    }
  | {
      ok: false;
      errorCode: string;
      state?: string;
    };

type NavigatorWithTouch = Navigator & { maxTouchPoints?: number };

export function detectPlatform(userAgent?: string): SquarePosPlatform {
  if (userAgent == null && typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/i.test(ua)) return "ios";
    if (/Android/i.test(ua)) return "android";
    const touch = navigator as NavigatorWithTouch;
    if (/Macintosh/i.test(ua) && (touch.maxTouchPoints ?? 0) > 1) return "ios";
    return "unsupported";
  }

  const ua = userAgent ?? "";
  if (/iPad|iPhone|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "unsupported";
}

/** Opens the Square Point of Sale app with the invoice amount filled in. */
export function buildSquarePosUrl(
  platform: "ios" | "android",
  charge: SquarePosCharge,
): string {
  if (platform === "ios") {
    const data = {
      amount_money: {
        amount: String(charge.amountCents),
        currency_code: charge.currency || "USD",
      },
      callback_url: charge.callbackUrl,
      client_id: charge.applicationId,
      version: "1.3",
      notes: charge.note,
      state: charge.state,
      options: {
        supported_tender_types: ["CARD_FROM_READER"],
        auto_return: true,
      },
    };
    return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
  }

  const fallback = charge.callbackUrl.includes("?")
    ? `${charge.callbackUrl}&error=app_not_installed`
    : `${charge.callbackUrl}?error=app_not_installed`;
  return [
    "intent:#Intent",
    "action=com.squareup.pos.action.CHARGE",
    "package=com.squareup",
    `S.browser_fallback_url=${fallback}`,
    `S.com.squareup.pos.WEB_CALLBACK_URI=${charge.callbackUrl}`,
    `S.com.squareup.pos.CLIENT_ID=${charge.applicationId}`,
    "S.com.squareup.pos.API_VERSION=v2.0",
    `i.com.squareup.pos.TOTAL_AMOUNT=${charge.amountCents}`,
    `S.com.squareup.pos.CURRENCY_CODE=${charge.currency || "USD"}`,
    "S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD",
    `S.com.squareup.pos.NOTE=${charge.note}`,
    `S.com.squareup.pos.REQUEST_METADATA=${charge.state}`,
    "end",
  ].join(";");
}

function decodeBase64Url(value: string): string {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Reads the invoice id from the signed state. The server checks the signature. */
export function invoiceIdFromPosState(state: string): string | null {
  const body = state.slice(0, state.lastIndexOf("."));
  if (!body) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(body)) as { invoiceId?: unknown };
    return typeof parsed.invoiceId === "string" && parsed.invoiceId
      ? parsed.invoiceId
      : null;
  } catch {
    return null;
  }
}

export function parsePosCallback(
  params: URLSearchParams,
): PosCallbackResult | null {
  const data = params.get("data");
  if (data) {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const state = typeof parsed.state === "string" ? parsed.state : undefined;
      const errorCode =
        typeof parsed.error_code === "string" ? parsed.error_code : undefined;
      if (errorCode || parsed.status === "error") {
        return { ok: false, errorCode: errorCode || "error", state };
      }
      const transactionId =
        typeof parsed.transaction_id === "string" ? parsed.transaction_id : "";
      if (!transactionId) {
        return { ok: false, errorCode: "missing_transaction", state };
      }
      return {
        ok: true,
        transactionId,
        clientTransactionId:
          typeof parsed.client_transaction_id === "string"
            ? parsed.client_transaction_id
            : undefined,
        state: state || "",
      };
    } catch {
      return { ok: false, errorCode: "invalid_callback" };
    }
  }

  const androidError = params.get("com.squareup.pos.ERROR_CODE");
  const androidTxn = params.get("com.squareup.pos.SERVER_TRANSACTION_ID");
  const androidMeta = params.get("com.squareup.pos.REQUEST_METADATA");
  if (androidError || androidTxn || androidMeta) {
    const state = androidMeta || undefined;
    if (androidError) return { ok: false, errorCode: androidError, state };
    if (!androidTxn) return { ok: false, errorCode: "missing_transaction", state };
    return {
      ok: true,
      transactionId: androidTxn,
      clientTransactionId:
        params.get("com.squareup.pos.CLIENT_TRANSACTION_ID") || undefined,
      state: state || "",
    };
  }

  if (params.get("error") === "app_not_installed") {
    return { ok: false, errorCode: "app_not_installed" };
  }
  return null;
}

export function posCallbackMessage(code: string): string {
  if (code === "payment_canceled") {
    return "Payment canceled. No charge was made.";
  }
  if (
    code === "app_not_installed" ||
    code === "user_not_logged_in" ||
    code === "user_not_activated"
  ) {
    return "Install the Square Point of Sale app, sign in to this merchant account, and turn on Tap to Pay.";
  }
  if (code === "no_network_connection") {
    return "The Square app could not reach the network. Try again.";
  }
  return "Tap to Pay could not be completed.";
}
