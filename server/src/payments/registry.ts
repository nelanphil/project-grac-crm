import { PaymentProviderName } from "../models/mongo/PaymentProviderAccount";
import { PaymentProviderAdapter } from "./types";
import { squareAdapter } from "./square.adapter";
import { stripeAdapter } from "./stripe.adapter";
import { paypalAdapter } from "./paypal.adapter";
import {
  getPaymentProviderAccountForCheckout,
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
): Promise<{
  adapter: PaymentProviderAdapter;
  account: PaymentAccountWithSecrets;
}> {
  const resolved = await getPaymentProviderAccountForCheckout(provider);
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
