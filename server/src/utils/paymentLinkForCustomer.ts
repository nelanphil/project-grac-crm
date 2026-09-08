import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { type WorkOrderInvoiceSource } from "../services/invoice.service";
import { buildCheckoutUrl, getOrCreateCheckoutKey } from "./checkoutKey";
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

function uniqueValidCustomerIds(customerIds: string[]): Types.ObjectId[] {
  return [
    ...new Set(customerIds.filter((id) => Types.ObjectId.isValid(id))),
  ].map((id) => new Types.ObjectId(id));
}

/**
 * Unpaid billable work orders that do not already have an open/draft invoice.
 * Matches customerRef, and customerId = Customer.legacyId for older tickets.
 */
export async function findUnbilledWorkOrdersForCustomers(
  customerIds: string[],
): Promise<Array<{ wo: WorkOrderInvoiceSource; customerId: string }>> {
  const objectIds = uniqueValidCustomerIds(customerIds);
  if (objectIds.length === 0) return [];

  const customers = await Customer.find({ _id: { $in: objectIds } })
    .select("_id legacyId")
    .lean();
  const requested = new Set(objectIds.map((id) => String(id)));
  const refByLegacy = new Map<number, string>();
  const legacyIds: number[] = [];
  for (const customer of customers) {
    if (typeof customer.legacyId === "number") {
      legacyIds.push(customer.legacyId);
      refByLegacy.set(customer.legacyId, String(customer._id));
    }
  }

  const or: Record<string, unknown>[] = [
    { customerRef: { $in: objectIds } },
  ];
  if (legacyIds.length > 0) {
    or.push({ customerId: { $in: legacyIds } });
  }

  const wos = await WorkOrder.find({
    paid: { $ne: true },
    total: { $gt: 0 },
    $or: or,
  });
  if (wos.length === 0) return [];

  const billed = await Invoice.find({
    workOrderRef: { $in: wos.map((wo) => wo._id) },
    status: { $in: OPEN_STATUSES },
  })
    .select("workOrderRef")
    .lean();
  const billedIds = new Set(billed.map((row) => String(row.workOrderRef)));

  const result: Array<{ wo: WorkOrderInvoiceSource; customerId: string }> = [];
  for (const wo of wos) {
    if (billedIds.has(String(wo._id))) continue;
    const fromRef =
      wo.customerRef && requested.has(String(wo.customerRef))
        ? String(wo.customerRef)
        : undefined;
    const fromLegacy = refByLegacy.get(wo.customerId);
    const customerId =
      fromRef ??
      (fromLegacy && requested.has(fromLegacy) ? fromLegacy : undefined);
    if (!customerId) continue;
    result.push({ wo, customerId });
  }
  return result;
}

/** True when the customer has an open/draft invoice or an unpaid billable work order. */
export async function customerHasPayableInvoice(
  customerId: string,
  _scope?: RenewalScope,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(customerId)) return false;
  const count = await Invoice.countDocuments({
    customerRef: new Types.ObjectId(customerId),
    status: { $in: OPEN_STATUSES },
  });
  if (count > 0) return true;
  const unbilled = await findUnbilledWorkOrdersForCustomers([customerId]);
  return unbilled.length > 0;
}

/** Customer ids that have an open/draft invoice or an unpaid billable work order. */
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

  const available = new Set(rows.map((r) => String(r.customerRef)));
  const unbilled = await findUnbilledWorkOrdersForCustomers(unique);
  for (const row of unbilled) available.add(row.customerId);
  return available;
}

/**
 * Stable customer checkout URL. Does not remint pay tokens or create invoices.
 */
export async function mintPaymentLinkForCustomer(
  customerId: string,
  _scope?: RenewalScope,
): Promise<{ payUrl: string; invoiceId: string } | null> {
  const payable = await customerHasPayableInvoice(customerId);
  if (!payable) return null;

  const invoices = await findOpenInvoicesForCustomer(customerId);
  const key = await getOrCreateCheckoutKey(customerId);
  return {
    payUrl: buildCheckoutUrl(key),
    invoiceId: invoices[0] ? String(invoices[0]._id) : "",
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
