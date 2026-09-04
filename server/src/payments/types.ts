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
  status: "paid" | "failed" | "ignored";
  raw?: unknown;
};

export interface PaymentProviderAdapter {
  readonly name: PaymentProviderName;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyWebhook(
    req: Request,
    accounts: PaymentAccountWithSecrets[],
  ): Promise<VerifiedWebhookPayment | null>;
}
