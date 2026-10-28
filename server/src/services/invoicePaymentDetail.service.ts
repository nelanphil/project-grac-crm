import { Types } from "mongoose";
import {
  InvoiceEvent,
  type IInvoicePaymentDetail,
  type InvoicePaymentMethod,
} from "../models/mongo/InvoiceEvent";
import { describeSquarePayment } from "../payments/paymentDetail";
import { getAdapter } from "../payments/registry";
import type { ProviderPaymentDetail } from "../payments/types";
import {
  getPaymentProviderAccountById,
  getPaymentProviderAccountsForWebhook,
  type PaymentAccountWithSecrets,
} from "./paymentProvider.service";

export const SQUARE_DETAIL_TIMEOUT_MS = 4000;

/** Methods Square can refine. Offline and staff marks are never overwritten. */
const REFINABLE_METHODS = new Set<InvoicePaymentMethod | null>([null, "card", "tap_to_pay"]);

export type SquarePaymentLookup = {
  detail: IInvoicePaymentDetail;
  method: InvoicePaymentMethod;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export function toInvoicePaymentDetail(
  raw: ProviderPaymentDetail,
  now: Date = new Date(),
): SquarePaymentLookup {
  const described = describeSquarePayment(raw);
  return {
    method: described.method,
    detail: {
      channel: described.channel,
      entryMethod: raw.entryMethod ?? null,
      cardBrand: raw.cardBrand ?? null,
      last4: raw.last4 ?? null,
      wallet: raw.wallet ?? null,
      squareProduct: raw.squareProduct ?? null,
      receiptUrl: raw.receiptUrl ?? null,
      label: described.label,
      fetchedAt: now,
    },
  };
}

async function squareAccounts(
  accountRef: Types.ObjectId | string | null | undefined,
): Promise<PaymentAccountWithSecrets[]> {
  if (accountRef) {
    const account = await getPaymentProviderAccountById(String(accountRef)).catch(() => null);
    if (account?.account.provider === "square") return [account];
  }
  return getPaymentProviderAccountsForWebhook("square").catch(() => []);
}

/** Asks Square how a payment was taken. Returns null when Square can't be reached. */
export const squarePaymentLookup = {
  async find(input: {
    paymentId: string;
    orderId?: string | null;
    accountRef?: Types.ObjectId | string | null;
    timeoutMs?: number;
  }): Promise<SquarePaymentLookup | null> {
    const adapter = getAdapter("square");
    const retrievePayment = adapter.retrievePayment?.bind(adapter);
    const retrieveOrder = adapter.retrieveOrder?.bind(adapter);
    if (!retrievePayment) return null;
    const run = async () => {
      for (const account of await squareAccounts(input.accountRef)) {
        const payment = await retrievePayment(account, input.paymentId).catch(() => null);
        if (payment?.detail) return toInvoicePaymentDetail(payment.detail);
        // Point of Sale can record an order or client transaction id instead of the payment id.
        const orderId = input.orderId || input.paymentId;
        if (!retrieveOrder) continue;
        const order = await retrieveOrder(account, orderId).catch(() => null);
        if (order?.detail) return toInvoicePaymentDetail(order.detail);
        if (order?.providerPaymentId && order.providerPaymentId !== input.paymentId) {
          const tender = await retrievePayment(account, order.providerPaymentId).catch(() => null);
          if (tender?.detail) return toInvoicePaymentDetail(tender.detail);
        }
      }
      return null;
    };
    return withTimeout(run(), input.timeoutMs ?? SQUARE_DETAIL_TIMEOUT_MS);
  },
};

/** Fills in how a recorded Square payment was taken. Never throws. */
export async function enrichSquarePaymentEvent(eventId: Types.ObjectId | string): Promise<void> {
  try {
    const event = await InvoiceEvent.findById(eventId)
      .select("provider providerPaymentId providerOrderId method paymentDetail invoiceRef")
      .populate<{ invoiceRef: { paymentProviderAccountRef?: Types.ObjectId | null } | null }>(
        "invoiceRef",
        "paymentProviderAccountRef",
      )
      .lean();
    if (!event || event.provider !== "square" || !event.providerPaymentId) return;
    if (event.paymentDetail) return;
    const found = await squarePaymentLookup.find({
      paymentId: event.providerPaymentId,
      orderId: event.providerOrderId ?? null,
      accountRef: event.invoiceRef?.paymentProviderAccountRef ?? null,
      timeoutMs: 15000,
    });
    if (!found) return;
    await InvoiceEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          paymentDetail: found.detail,
          ...(REFINABLE_METHODS.has(event.method ?? null) ? { method: found.method } : {}),
        },
      },
    );
  } catch (err) {
    console.error("[invoice-event] could not load Square payment details", err);
  }
}

export function enrichSquarePaymentEventAsync(eventId: Types.ObjectId | string): void {
  void enrichSquarePaymentEvent(eventId);
}

export function canRefineMethod(method: string | null | undefined): boolean {
  return REFINABLE_METHODS.has((method ?? null) as InvoicePaymentMethod | null);
}
