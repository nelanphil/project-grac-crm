import { Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { renewalDueDateFilterForMonth } from "./contractDates";
import { buildPayUrl, mintPayToken } from "./payToken";
import type { RenewalScope } from "./messagingContext";

async function findSoonestContract(
  customerRef: Types.ObjectId,
  scope?: RenewalScope,
) {
  const filter: Record<string, unknown> = {
    customerRef,
    renewalDueDate: { $ne: null },
  };
  if (scope) {
    Object.assign(filter, renewalDueDateFilterForMonth(scope.year, scope.month));
  } else {
    filter.renewalDueDate = { $ne: null, $gte: new Date() };
  }

  const upcoming = await Contract.findOne(filter).sort({ renewalDueDate: 1 });
  if (upcoming) return upcoming;

  return Contract.findOne({
    customerRef,
    renewalDueDate: { $ne: null },
  }).sort({ renewalDueDate: 1 });
}

async function findOpenInvoiceForCustomer(
  customerRef: Types.ObjectId,
  contractId?: Types.ObjectId | null,
): Promise<IInvoice | null> {
  if (contractId) {
    const renewal = await Invoice.findOne({
      customerRef,
      contractRef: contractId,
      sourceType: "contract_renewal",
      status: { $in: ["open", "draft"] },
    }).sort({ issuedAt: -1 });
    if (renewal) return renewal;
  }

  return Invoice.findOne({
    customerRef,
    status: { $in: ["open", "draft"] },
  }).sort({ issuedAt: -1 });
}

async function resolvePayableInvoice(
  customerId: string,
  scope?: RenewalScope,
): Promise<IInvoice | null> {
  if (!Types.ObjectId.isValid(customerId)) return null;
  const customerRef = new Types.ObjectId(customerId);
  const contract = await findSoonestContract(customerRef, scope);
  const invoice = await findOpenInvoiceForCustomer(
    customerRef,
    contract?._id as Types.ObjectId | undefined,
  );
  if (!invoice || invoice.status === "paid" || invoice.status === "void") {
    return null;
  }
  return invoice;
}

/** True when the customer already has an open/draft invoice we can attach a pay link to. */
export async function customerHasPayableInvoice(
  customerId: string,
  scope?: RenewalScope,
): Promise<boolean> {
  const invoice = await resolvePayableInvoice(customerId, scope);
  return invoice != null;
}

/** Customer ids that already have an open/draft invoice. */
export async function payableInvoiceCustomerIds(
  customerIds: string[],
): Promise<Set<string>> {
  const unique = [
    ...new Set(
      customerIds.filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  if (unique.length === 0) return new Set();

  const rows = await Invoice.find({
    customerRef: { $in: unique.map((id) => new Types.ObjectId(id)) },
    status: { $in: ["open", "draft"] },
  })
    .select("customerRef")
    .lean();

  return new Set(rows.map((r) => String(r.customerRef)));
}

/**
 * Mint a CRM pay-page token for an existing open invoice.
 * Does not create invoices. Checkout still uses the owner account or fallback.
 */
export async function mintPaymentLinkForCustomer(
  customerId: string,
  scope?: RenewalScope,
): Promise<{ payUrl: string; invoiceId: string } | null> {
  const invoice = await resolvePayableInvoice(customerId, scope);
  if (!invoice) return null;

  const { token, hash, expiresAt } = mintPayToken();
  invoice.payTokenHash = hash;
  invoice.payTokenExpiresAt = expiresAt;
  await invoice.save();

  return {
    payUrl: buildPayUrl(token),
    invoiceId: String(invoice._id),
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
