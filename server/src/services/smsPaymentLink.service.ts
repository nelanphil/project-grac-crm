import {
  resolveOfferContractTemplateId,
  type OfferContractOverride,
} from "../utils/temporaryContractOffer";
import {
  ensureTemporaryContractOffer,
  TemporaryContractOfferError,
} from "./temporaryContractOffer";

type MintedLink = { payUrl: string; invoiceId: string } | null;
type OfferResult = { invoiceId: string };

/**
 * Create the temporary-contract offer when one is selected, then mint a link
 * locked to that offer invoice. Offer failures are skipped so the text can still send.
 */
export async function resolveSmsPaymentUrl(input: {
  contactId: string;
  customerId: string | null | undefined;
  offerContractTemplateId: string | null | undefined;
  offerContractOverrides?: OfferContractOverride[] | null;
  paymentLinkForCustomer: (
    customerId: string,
    explicitInvoiceId?: string | null,
  ) => Promise<MintedLink>;
  offerInflight: Map<string, Promise<OfferResult>>;
}): Promise<string | null> {
  const customerId = input.customerId?.trim() ?? "";
  if (!customerId) return null;

  const offerTemplateId = resolveOfferContractTemplateId(
    input.contactId,
    input.offerContractTemplateId,
    input.offerContractOverrides,
  );
  let offerInvoiceId: string | undefined;
  if (offerTemplateId) {
    const offerKey = `${customerId}:${offerTemplateId}`;
    let pending = input.offerInflight.get(offerKey);
    if (!pending) {
      pending = ensureTemporaryContractOffer(customerId, offerTemplateId);
      input.offerInflight.set(offerKey, pending);
    }
    try {
      offerInvoiceId = (await pending).invoiceId;
    } catch (err) {
      if (!(err instanceof TemporaryContractOfferError)) throw err;
      console.error(
        `[sms] temporary contract offer skipped for ${customerId}`,
        err.message,
      );
    }
  }

  const minted = await input.paymentLinkForCustomer(customerId, offerInvoiceId);
  return minted?.payUrl ?? null;
}
