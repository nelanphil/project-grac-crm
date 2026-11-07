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

type StripeBalanceTransaction = {
  fee?: number;
  net?: number;
};

type StripeChargeItem = {
  id: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  created?: number;
  status?: string;
  paid?: boolean;
  refunded?: boolean;
  description?: string | null;
  receipt_email?: string | null;
  receipt_url?: string | null;
  payment_intent?: string | { id?: string } | null;
  balance_transaction?: string | StripeBalanceTransaction | null;
  metadata?: Record<string, string | undefined> | null;
  billing_details?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  payment_method_details?: {
    type?: string | null;
    card?: {
      brand?: string | null;
      last4?: string | null;
      wallet?: { type?: string | null } | null;
    } | null;
    card_present?: {
      brand?: string | null;
      last4?: string | null;
      read_method?: string | null;
      wallet?: { type?: string | null } | null;
    } | null;
  } | null;
};

type StripeChargeListResponse = {
  data?: StripeChargeItem[];
  has_more?: boolean;
  error?: { message?: string };
};

function clean(value?: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const stripeAdapter: PaymentProviderAdapter = {
  name: "stripe",

  async createCheckout(_input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    throw new Error(
      "Stripe checkout is not implemented yet. Configure Square as the default provider, or implement the Stripe adapter.",
    );
  },

  async verifyWebhook(
    _req: Request,
    _accounts: PaymentAccountWithSecrets[],
  ): Promise<VerifiedWebhookPayment | null> {
    throw new Error("Stripe webhooks are not implemented yet");
  },

  async listLayerTransactions(
    account,
    window,
  ): Promise<ProviderLayerTransaction[]> {
    const secretKey = account.secrets.secretKey?.trim();
    if (!secretKey) {
      throw new Error("Stripe secret key is not configured for this account");
    }

    const rows: ProviderLayerTransaction[] = [];
    let startingAfter: string | undefined;

    for (let pageIdx = 0; pageIdx < 5; pageIdx += 1) {
      const params = new URLSearchParams();
      params.set("limit", "100");
      params.append("expand[]", "data.balance_transaction");
      if (window.beginTime) {
        params.set(
          "created[gte]",
          String(Math.floor(window.beginTime.getTime() / 1000)),
        );
      }
      if (window.endTime) {
        params.set(
          "created[lte]",
          String(Math.floor(window.endTime.getTime() / 1000)),
        );
      }
      if (startingAfter) {
        params.set("starting_after", startingAfter);
      }

      const response = await fetch(
        `https://api.stripe.com/v1/charges?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
        },
      );

      const payload = (await response.json()) as StripeChargeListResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ||
            `Stripe API error (${response.status})`,
        );
      }

      const items = Array.isArray(payload.data) ? payload.data : [];
      for (const charge of items) {
        if (!charge?.id) continue;
        const grossCents =
          typeof charge.amount === "number" ? charge.amount : 0;
        const refundedCents =
          typeof charge.amount_refunded === "number"
            ? charge.amount_refunded
            : 0;
        const bt =
          charge.balance_transaction &&
          typeof charge.balance_transaction === "object"
            ? charge.balance_transaction
            : null;
        const feeCents = typeof bt?.fee === "number" ? bt.fee : 0;
        const rawStatus = String(charge.status || "pending");

        let status: LayerTransactionStatus = "pending";
        if (rawStatus === "succeeded" && charge.paid !== false) {
          status =
            (charge.refunded || (refundedCents > 0 && refundedCents >= grossCents))
              ? "refunded"
              : "paid";
        } else if (rawStatus === "failed") {
          status = "failed";
        }

        const netCents =
          status === "failed" || status === "pending"
            ? 0
            : grossCents - refundedCents - feeCents;

        const metaNote =
          clean(charge.metadata?.paymentNote) ||
          clean(charge.metadata?.note) ||
          clean(charge.metadata?.invoiceNumber);
        const note = clean(charge.description) || metaNote;
        const metaInvoiceId = clean(charge.metadata?.invoiceId);
        const invoiceIds = [
          ...new Set([
            ...parseInvoiceIdsFromPaymentNote(note ?? ""),
            ...parseInvoiceIdsFromPaymentNote(metaNote ?? ""),
            ...(metaInvoiceId ? [metaInvoiceId] : []),
          ]),
        ];

        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : clean(charge.payment_intent?.id);

        const card =
          charge.payment_method_details?.card ??
          charge.payment_method_details?.card_present ??
          null;
        const isPresent = Boolean(charge.payment_method_details?.card_present);

        rows.push({
          provider: "stripe",
          providerPaymentId: charge.id,
          providerOrderId: paymentIntentId,
          createdAt: charge.created
            ? new Date(charge.created * 1000).toISOString()
            : new Date().toISOString(),
          status,
          providerStatus: rawStatus.toUpperCase(),
          grossCents,
          amountCents: grossCents,
          tipCents: 0,
          taxCents: 0,
          feeCents,
          refundedCents,
          netCents,
          currency: (charge.currency || "usd").toUpperCase(),
          payerName: clean(charge.billing_details?.name),
          payerEmail:
            clean(charge.billing_details?.email) || clean(charge.receipt_email),
          payerPhone: clean(charge.billing_details?.phone),
          note,
          invoiceIds,
          locationId: null,
          detail: {
            sourceType: clean(charge.payment_method_details?.type)?.toUpperCase(),
            entryMethod: isPresent ? "EMV" : "KEYED",
            cardBrand: clean(card?.brand)?.toUpperCase(),
            last4: clean(card?.last4) ?? undefined,
            wallet: clean(card?.wallet?.type)?.toUpperCase(),
            receiptUrl: clean(charge.receipt_url) ?? undefined,
          },
        });
      }

      if (!payload.has_more || items.length === 0) break;
      startingAfter = items[items.length - 1]?.id;
      if (!startingAfter) break;
    }

    return rows;
  },
};
