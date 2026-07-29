import {
  IPaymentProviderAccount,
  PaymentProviderAccount,
  PaymentProviderName,
} from "../models/mongo/PaymentProviderAccount";
import { decryptCredential } from "../utils/credentialsCrypto";

export type DecryptedPaymentSecrets = {
  accessToken?: string;
  webhookSignatureKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  clientSecret?: string;
  webhookId?: string;
};

export type PaymentAccountWithSecrets = {
  account: IPaymentProviderAccount;
  secrets: DecryptedPaymentSecrets;
};

function decryptOptional(value?: string | null): string | undefined {
  if (!value) return undefined;
  return decryptCredential(value);
}

export function decryptPaymentSecrets(
  account: IPaymentProviderAccount,
): DecryptedPaymentSecrets {
  return {
    accessToken: decryptOptional(account.accessTokenEncrypted),
    webhookSignatureKey: decryptOptional(account.webhookSignatureKeyEncrypted),
    secretKey: decryptOptional(account.secretKeyEncrypted),
    webhookSecret: decryptOptional(account.webhookSecretEncrypted),
    clientSecret: decryptOptional(account.clientSecretEncrypted),
    webhookId: decryptOptional(account.webhookIdEncrypted),
  };
}

/**
 * Resolve the payment account used for checkout.
 * Prefer explicit provider, then the global default, then first active account.
 */
export async function getPaymentProviderAccountForCheckout(
  provider?: PaymentProviderName,
): Promise<PaymentAccountWithSecrets | null> {
  let account: IPaymentProviderAccount | null = null;

  if (provider) {
    account = await PaymentProviderAccount.findOne({
      provider,
      isActive: true,
      isDefault: true,
    });
    if (!account) {
      account = await PaymentProviderAccount.findOne({
        provider,
        isActive: true,
      }).sort({ friendlyName: 1 });
    }
  } else {
    account = await PaymentProviderAccount.findOne({
      isActive: true,
      isDefault: true,
    });
    if (!account) {
      account = await PaymentProviderAccount.findOne({ isActive: true }).sort({
        provider: 1,
        friendlyName: 1,
      });
    }
  }

  if (!account) return null;

  return {
    account,
    secrets: decryptPaymentSecrets(account),
  };
}

export async function getPaymentProviderAccountsForWebhook(
  provider: PaymentProviderName,
): Promise<PaymentAccountWithSecrets[]> {
  const accounts = await PaymentProviderAccount.find({
    provider,
    isActive: true,
  });
  return accounts.map((account) => ({
    account,
    secrets: decryptPaymentSecrets(account),
  }));
}

export async function getPaymentProviderAccountById(
  id: string,
): Promise<PaymentAccountWithSecrets | null> {
  const account = await PaymentProviderAccount.findById(id);
  if (!account || !account.isActive) return null;
  return {
    account,
    secrets: decryptPaymentSecrets(account),
  };
}
