import { Request } from "express";
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProviderAdapter,
  VerifiedWebhookPayment,
} from "./types";
import { PaymentAccountWithSecrets } from "../services/paymentProvider.service";

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
};
