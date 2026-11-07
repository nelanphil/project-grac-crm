import { Request } from "express";
import { IInvoice } from "../models/mongo/Invoice";
import { PaymentAccountWithSecrets } from "../services/paymentProvider.service";
import { PaymentProviderName } from "../models/mongo/PaymentProviderAccount";

export type CheckoutBuyer = {
  email?: string;
  phoneE164?: string;
  firstName?: string;
  lastName?: string;
};

export type CreateCheckoutInput = {
  invoice: IInvoice;
  account: PaymentAccountWithSecrets;
  redirectUrl: string;
  /** Optional CRM contact data used to prefill provider checkout forms. */
  buyer?: CheckoutBuyer;
  /** Combined checkout total; defaults to invoice.amountCents. */
  amountCents?: number;
  paymentNote?: string;
  checkoutName?: string;
  checkoutDescription?: string;
};

export type CreateCheckoutResult = {
  url: string;
  checkoutId: string;
  orderId?: string;
};

export type VerifiedWebhookPayment = {
  providerPaymentId?: string;
  providerOrderId?: string;
  invoiceId?: string;
  invoiceIds?: string[];
  /** Charged amount before tip, in the smallest currency unit. */
  amountCents?: number;
  locationId?: string;
  status: "paid" | "failed" | "ignored";
  /** Provider status before mapping, e.g. Square FAILED vs CANCELED. */
  providerStatus?: string;
  /** Decline or error detail from the provider, when it sent one. */
  failureReason?: string;
  raw?: unknown;
};

/** How the provider says the payment was taken (product, card entry, wallet). */
export type ProviderPaymentDetail = {
  squareProduct?: string;
  sourceType?: string;
  entryMethod?: string;
  cardBrand?: string;
  last4?: string;
  wallet?: string;
  receiptUrl?: string;
};

export type RetrievedProviderPayment = {
  status: "paid" | "failed" | "pending";
  detail?: ProviderPaymentDetail;
  providerPaymentId?: string;
  providerOrderId?: string;
  invoiceIds: string[];
  note?: string;
  /** Charged amount before tip, in the smallest currency unit, when Square returned one. */
  amountCents?: number;
  /** Square location that took the payment, when Square returned one. */
  locationId?: string;
  createdAt?: string;
  /** Tax Square added on its side (Point of Sale can apply the location's default tax). */
  taxCents?: number;
};

export type LayerTransactionStatus = "paid" | "failed" | "pending" | "refunded";

export type ProviderLayerTransaction = {
  provider: PaymentProviderName;
  providerPaymentId: string;
  providerOrderId?: string | null;
  createdAt: string;
  status: LayerTransactionStatus;
  providerStatus: string;
  /** Total charged including tip and tax, in cents. */
  grossCents: number;
  /** Charged amount before tip, in cents. */
  amountCents: number;
  tipCents: number;
  taxCents: number;
  /** Payment processor fee deducted by the provider, in cents. */
  feeCents: number;
  /** Amount refunded to the customer, in cents. */
  refundedCents: number;
  /** Net revenue after refunds and processor fees (grossCents - refundedCents - feeCents). */
  netCents: number;
  currency: string;
  payerName?: string | null;
  payerEmail?: string | null;
  payerPhone?: string | null;
  note?: string | null;
  invoiceIds: string[];
  locationId?: string | null;
  detail?: ProviderPaymentDetail;
};

export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyWebhook(
    req: Request,
    accounts: PaymentAccountWithSecrets[],
  ): Promise<VerifiedWebhookPayment | null>;
  retrievePayment?(
    account: PaymentAccountWithSecrets,
    paymentId: string,
  ): Promise<RetrievedProviderPayment | null>;
  retrieveOrder?(
    account: PaymentAccountWithSecrets,
    orderId: string,
  ): Promise<RetrievedProviderPayment | null>;
  listPayments?(
    account: PaymentAccountWithSecrets,
    window: { beginTime: Date; endTime: Date; locationId: string },
  ): Promise<RetrievedProviderPayment[]>;
  listLayerTransactions?(
    account: PaymentAccountWithSecrets,
    window: { beginTime?: Date | null; endTime?: Date | null },
  ): Promise<ProviderLayerTransaction[]>;
}
