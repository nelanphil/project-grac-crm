import { Types } from "mongoose";
import {
  IPaymentProviderAccount,
  PaymentProviderAccount,
  PaymentProviderName,
} from "../models/mongo/PaymentProviderAccount";
import { Customer } from "../models/mongo/Customer";
import { decryptCredential } from "../utils/credentialsCrypto";
import { ensureFreshSquareAccessToken } from "./squareOAuth.service";

export type DecryptedPaymentSecrets = {
  accessToken?: string;
  refreshToken?: string;
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
    refreshToken: decryptOptional(account.refreshTokenEncrypted),
    webhookSignatureKey: decryptOptional(account.webhookSignatureKeyEncrypted),
    secretKey: decryptOptional(account.secretKeyEncrypted),
    webhookSecret: decryptOptional(account.webhookSecretEncrypted),
    clientSecret: decryptOptional(account.clientSecretEncrypted),
    webhookId: decryptOptional(account.webhookIdEncrypted),
  };
}

function globalOwnerFilter() {
  return {
    $or: [{ ownerUserRef: null }, { ownerUserRef: { $exists: false } }],
  };
}

async function findActiveAccount(filter: Record<string, unknown>) {
  let account = await PaymentProviderAccount.findOne({
    ...filter,
    isActive: true,
    isDefault: true,
  });
  if (!account) {
    account = await PaymentProviderAccount.findOne({
      ...filter,
      isActive: true,
    }).sort({ friendlyName: 1 });
  }
  return account;
}

/**
 * Resolve the payment account used for checkout.
 * Prefer the territory owner's account, then a global default/fallback,
 * then any active account (legacy).
 */
export async function getPaymentProviderAccountForCheckout(
  provider?: PaymentProviderName,
  ownerUserId?: string | Types.ObjectId | null,
): Promise<PaymentAccountWithSecrets | null> {
  const providerFilter = provider ? { provider } : {};

  let account: IPaymentProviderAccount | null = null;

  if (ownerUserId) {
    account = await findActiveAccount({
      ...providerFilter,
      ownerUserRef: new Types.ObjectId(String(ownerUserId)),
    });
  }

  if (!account) {
    account = await findActiveAccount({
      ...providerFilter,
      ...globalOwnerFilter(),
    });
  }

  if (!account && provider) {
    account = await findActiveAccount({ provider });
  }

  if (!account) {
    account = await findActiveAccount({});
  }

  if (!account) return null;

  if (account.provider === "square") {
    account = await ensureFreshSquareAccessToken(account);
  }

  return {
    account,
    secrets: decryptPaymentSecrets(account),
  };
}

/**
 * Resolve owner from invoice customer, then payment account.
 */
export async function getPaymentProviderAccountForInvoiceCheckout(
  customerRef?: Types.ObjectId | string | null,
  provider?: PaymentProviderName,
): Promise<PaymentAccountWithSecrets | null> {
  let ownerUserId: string | null = null;
  if (customerRef) {
    const customer = await Customer.findById(customerRef)
      .select("ownerUserRef")
      .lean();
    if (customer?.ownerUserRef) {
      ownerUserId = String(customer.ownerUserRef);
    }
  }
  return getPaymentProviderAccountForCheckout(provider, ownerUserId);
}

export async function getPaymentProviderAccountsForWebhook(
  provider: PaymentProviderName,
): Promise<PaymentAccountWithSecrets[]> {
  const accounts = await PaymentProviderAccount.find({
    provider,
    isActive: true,
  });

  const refreshed: IPaymentProviderAccount[] = [];
  for (const account of accounts) {
    if (account.provider === "square") {
      try {
        refreshed.push(await ensureFreshSquareAccessToken(account));
      } catch (err) {
        console.warn(
          `[payments] could not refresh Square token for ${String(account._id)}`,
          err,
        );
        refreshed.push(account);
      }
    } else {
      refreshed.push(account);
    }
  }

  return refreshed.map((account) => ({
    account,
    secrets: decryptPaymentSecrets(account),
  }));
}

export async function getPaymentProviderAccountById(
  id: string,
): Promise<PaymentAccountWithSecrets | null> {
  const found = await PaymentProviderAccount.findById(id);
  if (!found || !found.isActive) return null;
  const account =
    found.provider === "square"
      ? await ensureFreshSquareAccessToken(found)
      : found;
  return {
    account,
    secrets: decryptPaymentSecrets(account),
  };
}
