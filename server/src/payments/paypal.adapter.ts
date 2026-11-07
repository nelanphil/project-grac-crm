import { Request } from "express";
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  LayerTransactionStatus,
  PaymentProviderAdapter,
  ProviderLayerTransaction,
  VerifiedWebhookPayment,
} from "./types";
import { PaymentAccountWithSecrets } from "../services/paymentProvider.service";
import { parseInvoiceIdsFromPaymentNote } from "../utils/paymentLinkForCustomer";

const PAYPAL_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

type PayPalMoney = {
  currency_code?: string;
  value?: string;
};

type PayPalTransactionItem = {
  transaction_info?: {
    transaction_id?: string;
    paypal_reference_id?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_updated_date?: string;
    transaction_amount?: PayPalMoney;
    fee_amount?: PayPalMoney;
    tax_amount?: PayPalMoney;
    tip_amount?: PayPalMoney;
    transaction_status?: string;
    transaction_subject?: string;
    transaction_note?: string;
    invoice_id?: string;
    custom_field?: string;
  };
  payer_info?: {
    email_address?: string;
    phone_number?: { national_number?: string };
    payer_name?: {
      given_name?: string;
      surname?: string;
      alternate_full_name?: string;
    };
  };
};

type PayPalSearchResponse = {
  transaction_details?: PayPalTransactionItem[];
  total_pages?: number;
  message?: string;
  error_description?: string;
};

function clean(value?: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function moneyToCents(money?: PayPalMoney | null): number {
  if (!money?.value) return 0;
  const parsed = Number.parseFloat(money.value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function splitPayPalWindows(
  beginTime?: Date | null,
  endTime?: Date | null,
): Array<{ start: Date; end: Date }> {
  const end = endTime ?? new Date();
  const start =
    beginTime ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const windows: Array<{ start: Date; end: Date }> = [];
  let cursorEnd = end;
  // Cap at 12 windows (~1 year) to avoid excessive API round-trips
  while (cursorEnd > start && windows.length < 12) {
    const cursorStart = new Date(
      Math.max(start.getTime(), cursorEnd.getTime() - PAYPAL_MAX_WINDOW_MS + 1000),
    );
    windows.push({ start: cursorStart, end: cursorEnd });
    cursorEnd = new Date(cursorStart.getTime() - 1000);
  }
  return windows;
}

export const paypalAdapter: PaymentProviderAdapter = {
  name: "paypal",

  async createCheckout(_input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    throw new Error(
      "PayPal checkout is not implemented yet. Configure Square as the default provider, or implement the PayPal adapter.",
    );
  },

  async verifyWebhook(
    _req: Request,
    _accounts: PaymentAccountWithSecrets[],
  ): Promise<VerifiedWebhookPayment | null> {
    throw new Error("PayPal webhooks are not implemented yet");
  },

  async listLayerTransactions(
    account,
    window,
  ): Promise<ProviderLayerTransaction[]> {
    const clientId = account.account.clientId?.trim();
    const clientSecret = account.secrets.clientSecret?.trim();
    if (!clientId || !clientSecret) {
      throw new Error(
        "PayPal Client ID and Client Secret are required for this account",
      );
    }

    const baseUrl =
      account.account.environment === "production"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const tokenPayload = (await tokenRes.json()) as {
      access_token?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokenPayload.access_token) {
      throw new Error(
        tokenPayload.error_description ||
          `PayPal authentication failed (${tokenRes.status})`,
      );
    }

    const accessToken = tokenPayload.access_token;
    const windows = splitPayPalWindows(window.beginTime, window.endTime);
    const rows: ProviderLayerTransaction[] = [];
    const seenIds = new Set<string>();

    for (const chunk of windows) {
      const params = new URLSearchParams({
        start_date: chunk.start.toISOString(),
        end_date: chunk.end.toISOString(),
        fields: "all",
        page_size: "100",
        page: "1",
      });

      const res = await fetch(
        `${baseUrl}/v1/reporting/transactions?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      const data = (await res.json()) as PayPalSearchResponse;
      if (!res.ok) {
        throw new Error(
          data.message ||
            data.error_description ||
            `PayPal reporting API error (${res.status})`,
        );
      }

      for (const item of data.transaction_details ?? []) {
        const info = item.transaction_info;
        const txId = clean(info?.transaction_id);
        if (!txId || seenIds.has(txId)) continue;

        const rawAmountCents = moneyToCents(info?.transaction_amount);
        // Skip internal negative debits/withdrawals unless it is a payment reversal
        if (rawAmountCents <= 0) continue;

        seenIds.add(txId);
        const grossCents = rawAmountCents;
        const tipCents = Math.max(0, moneyToCents(info?.tip_amount));
        const taxCents = Math.max(0, moneyToCents(info?.tax_amount));
        const amountCents = Math.max(0, grossCents - tipCents);
        const feeCents = Math.abs(moneyToCents(info?.fee_amount));
        const rawStatus = String(info?.transaction_status || "S").toUpperCase();

        let status: LayerTransactionStatus = "paid";
        let refundedCents = 0;
        if (rawStatus === "V" || rawStatus === "R") {
          status = "refunded";
          refundedCents = grossCents;
        } else if (rawStatus === "P") {
          status = "pending";
        } else if (rawStatus === "D" || rawStatus === "F") {
          status = "failed";
        }

        const netCents =
          status === "failed" || status === "pending"
            ? 0
            : grossCents - refundedCents - feeCents;

        const payer = item.payer_info;
        const payerName =
          clean(payer?.payer_name?.alternate_full_name) ||
          clean(
            [payer?.payer_name?.given_name, payer?.payer_name?.surname]
              .filter(Boolean)
              .join(" "),
          );
        const payerEmail = clean(payer?.email_address);
        const payerPhone = clean(payer?.phone_number?.national_number);

        const note =
          clean(info?.transaction_subject) ||
          clean(info?.transaction_note) ||
          clean(info?.custom_field) ||
          clean(info?.invoice_id);
        const invoiceIds = [
          ...new Set([
            ...parseInvoiceIdsFromPaymentNote(note ?? ""),
            ...parseInvoiceIdsFromPaymentNote(info?.invoice_id ?? ""),
            ...parseInvoiceIdsFromPaymentNote(info?.custom_field ?? ""),
          ]),
        ];

        rows.push({
          provider: "paypal",
          providerPaymentId: txId,
          providerOrderId: clean(info?.paypal_reference_id),
          createdAt:
            clean(info?.transaction_initiation_date) ||
            clean(info?.transaction_updated_date) ||
            new Date().toISOString(),
          status,
          providerStatus: rawStatus,
          grossCents,
          amountCents,
          tipCents,
          taxCents,
          feeCents,
          refundedCents,
          netCents,
          currency: (
            info?.transaction_amount?.currency_code || "USD"
          ).toUpperCase(),
          payerName,
          payerEmail,
          payerPhone,
          note,
          invoiceIds,
          locationId: null,
          detail: {
            sourceType: "WALLET",
            wallet: "PAYPAL",
          },
        });
      }
    }

    rows.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return rows;
  },
};
