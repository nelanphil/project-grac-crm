import { Types } from "mongoose";
import { PaymentProviderName } from "../models/mongo/PaymentProviderAccount";
import { PaymentProviderAdapter } from "./types";
import { squareAdapter } from "./square.adapter";
import { stripeAdapter } from "./stripe.adapter";
import { paypalAdapter } from "./paypal.adapter";
import {
  getPaymentProviderAccountForCheckout,
  getPaymentProviderAccountForInvoiceCheckout,
  PaymentAccountWithSecrets,
} from "../services/paymentProvider.service";

const adapters: Record<PaymentProviderName, PaymentProviderAdapter> = {
  square: squareAdapter,
  stripe: stripeAdapter,
  paypal: paypalAdapter,
};

export function getAdapter(provider: PaymentProviderName): PaymentProviderAdapter {
  return adapters[provider];
}

export async function resolveCheckoutProvider(
  provider?: PaymentProviderName,
  ownerUserId?: string | Types.ObjectId | null,
): Promise<{
  adapter: PaymentProviderAdapter;
  account: PaymentAccountWithSecrets;
}> {
  const resolved = await getPaymentProviderAccountForCheckout(
    provider,
    ownerUserId,
  );
  if (!resolved) {
    throw new Error(
      "No active payment provider configured. Add one in Control Panel.",
    );
  }
  return {
    adapter: getAdapter(resolved.account.provider),
    account: resolved,
  };
}

export async function resolveCheckoutProviderForInvoice(
  customerRef?: Types.ObjectId | string | null,
  provider?: PaymentProviderName,
): Promise<{
  adapter: PaymentProviderAdapter;
  account: PaymentAccountWithSecrets;
}> {
  const resolved = await getPaymentProviderAccountForInvoiceCheckout(
    customerRef,
    provider,
  );
  if (!resolved) {
    throw new Error(
      "No active payment provider configured for this customer. Connect Square for the territory owner or a global fallback in Control Panel.",
    );
  }
  return {
    adapter: getAdapter(resolved.account.provider),
    account: resolved,
  };
}
