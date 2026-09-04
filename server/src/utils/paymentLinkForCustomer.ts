import { Types } from "mongoose";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { buildPayUrl, mintPayToken } from "./payToken";
import type { RenewalScope } from "./messagingContext";

const OPEN_STATUSES = ["open", "draft"] as const;

export async function findOpenInvoicesForCustomer(
  customerId: string,
): Promise<IInvoice[]> {
  if (!Types.ObjectId.isValid(customerId)) return [];
  return Invoice.find({
    customerRef: new Types.ObjectId(customerId),
    status: { $in: OPEN_STATUSES },
  }).sort({ issuedAt: 1 });
}

/** True when the customer already has an open/draft invoice we can attach a pay link to. */
export async function customerHasPayableInvoice(
  customerId: string,
  _scope?: RenewalScope,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(customerId)) return false;
  const count = await Invoice.countDocuments({
    customerRef: new Types.ObjectId(customerId),
    status: { $in: OPEN_STATUSES },
  });
  return count > 0;
}

/** Customer ids that already have an open/draft invoice. */
export async function payableInvoiceCustomerIds(
  customerIds: string[],
): Promise<Set<string>> {
  const unique = [
    ...new Set(customerIds.filter((id) => Types.ObjectId.isValid(id))),
  ];
  if (unique.length === 0) return new Set();

  const rows = await Invoice.find({
    customerRef: { $in: unique.map((id) => new Types.ObjectId(id)) },
    status: { $in: OPEN_STATUSES },
  })
    .select("customerRef")
    .lean();

  return new Set(rows.map((r) => String(r.customerRef)));
}

/**
 * Mint a CRM pay-page token for every open/draft invoice on the customer.
 * Does not create invoices. Checkout still uses the owner account or fallback.
 */
export async function mintPaymentLinkForCustomer(
  customerId: string,
  _scope?: RenewalScope,
): Promise<{ payUrl: string; invoiceId: string } | null> {
  const invoices = await findOpenInvoicesForCustomer(customerId);
  if (invoices.length === 0) return null;

  const { token, hash, expiresAt } = mintPayToken();
  await Invoice.updateMany(
    { _id: { $in: invoices.map((inv) => inv._id) } },
    { $set: { payTokenHash: hash, payTokenExpiresAt: expiresAt } },
  );

  return {
    payUrl: buildPayUrl(token),
    invoiceId: String(invoices[0]._id),
  };
}

export function createPaymentLinkCache(scope?: RenewalScope) {
  const inflight = new Map<
    string,
    Promise<{ payUrl: string; invoiceId: string } | null>
  >();

  return function paymentLinkForCustomer(customerId: string) {
    const existing = inflight.get(customerId);
    if (existing) return existing;
    const pending = mintPaymentLinkForCustomer(customerId, scope);
    inflight.set(customerId, pending);
    return pending;
  };
}

export function paymentNoteForInvoiceIds(ids: string[]): string {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length <= 1) return `invoice:${unique[0] ?? ""}`;
  return `invoices:${unique.join(",")}`;
}

export function parseInvoiceIdsFromPaymentNote(note: string): string[] {
  if (!note) return [];
  const multi = note.match(/invoices:([a-f0-9,]+)/i);
  if (multi?.[1]) {
    return multi[1]
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^[a-f0-9]{24}$/i.test(id));
  }
  const single = note.match(/invoice:([a-f0-9]{24})/i);
  return single?.[1] ? [single[1]] : [];
}
