import {
  resolveOfferContractTemplateId,
  type OfferContractOverride,
} from "../utils/temporaryContractOffer";
import {
  ensureTemporaryContractOffer,
  TemporaryContractOfferError,
} from "./temporaryContractOffer";

type MintedLink = { payUrl: string; invoiceId: string } | null;

/**
 * Same offer-then-mint sequence as staff email, but the URL is the short
 * `/p/{code}` link. Offer failures are skipped so the text can still send.
 */
export async function resolveSmsPaymentUrl(input: {
  contactId: string;
  customerId: string | null | undefined;
  offerContractTemplateId: string | null | undefined;
  offerContractOverrides?: OfferContractOverride[] | null;
  paymentLinkForCustomer: (customerId: string) => Promise<MintedLink>;
  offerInflight: Map<string, Promise<unknown>>;
}): Promise<string | null> {
  const customerId = input.customerId?.trim() ?? "";
  if (!customerId) return null;

  const offerTemplateId = resolveOfferContractTemplateId(
    input.contactId,
    input.offerContractTemplateId,
    input.offerContractOverrides,
  );
  if (offerTemplateId) {
    const offerKey = `${customerId}:${offerTemplateId}`;
    let pending = input.offerInflight.get(offerKey);
    if (!pending) {
      pending = ensureTemporaryContractOffer(customerId, offerTemplateId);
      input.offerInflight.set(offerKey, pending);
    }
    try {
      await pending;
    } catch (err) {
      if (!(err instanceof TemporaryContractOfferError)) throw err;
      console.error(
        `[sms] temporary contract offer skipped for ${customerId}`,
        err.message,
      );
    }
  }

  const minted = await input.paymentLinkForCustomer(customerId);
  return minted?.payUrl ?? null;
}
