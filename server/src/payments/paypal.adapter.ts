import { Request } from "express";
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderAdapter,
  VerifiedWebhookPayment,
} from "./types";
import { PaymentAccountWithSecrets } from "../services/paymentProvider.service";

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
};
