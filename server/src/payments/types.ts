import { Request } from "express";
import { IInvoice } from "../models/mongo/Invoice";
import { PaymentAccountWithSecrets } from "../services/paymentProvider.service";
import { PaymentProviderName } from "../models/mongo/PaymentProviderAccount";

export type CreateCheckoutInput = {
  invoice: IInvoice;
  account: PaymentAccountWithSecrets;
  redirectUrl: string;
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
