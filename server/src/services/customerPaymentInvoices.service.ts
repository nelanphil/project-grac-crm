import { Types } from "mongoose";
import { Invoice } from "../models/mongo/Invoice";
import { InvoiceEvent } from "../models/mongo/InvoiceEvent";
import { PaymentJourneySession } from "../models/mongo/PaymentJourneySession";

/** Contact events that mean someone tried to pay. A plain invoice view does not. */
export const PAYMENT_ATTEMPT_EVENT_KINDS = [
  "pay_link_opened",
  "checkout_started",
  "payment_succeeded",
  "payment_failed",
  "payment_canceled",
  "payment_needs_review",
] as const;

export const PAYMENT_ATTEMPT_VISIT_ENTRIES = ["checkout", "pay", "complete"] as const;

export interface CustomerPaymentInvoice {
  id: string;
  number: string;
  status: string;
  amountCents: number;
  latestAt: string;
}

export interface PaymentInvoiceRow {
  _id: Types.ObjectId;
  number: string;
  status: string;
  amountCents: number;
  paidAt?: Date | null;
  issuedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestActivityAt(
  invoice: PaymentInvoiceRow,
  eventAt: Date | null,
  visitAt: Date | null,
): string {
  const stamps: Array<Date | string | null | undefined> = [eventAt, visitAt, invoice.paidAt];
  if (invoice.status === "failed") stamps.push(invoice.updatedAt);
  const latest = Math.max(...stamps.map(timeOf));
  if (latest > 0) return new Date(latest).toISOString();
  const fallback = Math.max(timeOf(invoice.issuedAt), timeOf(invoice.createdAt), timeOf(invoice.updatedAt));
  return new Date(fallback || Date.now()).toISOString();
}

/** Paid, failed, or invoices with a checkout/payment attempt. Newest activity first. */
export function selectPaymentInvoices(
  invoices: PaymentInvoiceRow[],
  latestEventAt: Map<string, Date>,
  latestVisitAt: Map<string, Date>,
): CustomerPaymentInvoice[] {
  const rows: CustomerPaymentInvoice[] = [];
  for (const invoice of invoices) {
    const id = String(invoice._id);
    const eventAt = latestEventAt.get(id) ?? null;
    const visitAt = latestVisitAt.get(id) ?? null;
    const qualifies =
      invoice.status === "paid" ||
      invoice.status === "failed" ||
      eventAt != null ||
      visitAt != null;
    if (!qualifies) continue;
    rows.push({
      id,
      number: invoice.number,
      status: invoice.status,
      amountCents: invoice.amountCents,
      latestAt: latestActivityAt(invoice, eventAt, visitAt),
    });
  }
  rows.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  return rows;
}

export async function listCustomerPaymentInvoices(
  customerId: string,
): Promise<CustomerPaymentInvoice[]> {
  const customerRef = new Types.ObjectId(customerId);
  const invoices = await Invoice.find({ customerRef })
    .select("number status amountCents paidAt issuedAt createdAt updatedAt")
    .lean<PaymentInvoiceRow[]>();
  if (invoices.length === 0) return [];

  const ids = invoices.map((invoice) => invoice._id);
  const [events, visits] = await Promise.all([
    InvoiceEvent.aggregate<{ _id: Types.ObjectId; latestAt: Date }>([
      {
        $match: {
          invoiceRef: { $in: ids },
          kind: { $in: [...PAYMENT_ATTEMPT_EVENT_KINDS] },
        },
      },
      { $group: { _id: "$invoiceRef", latestAt: { $max: "$createdAt" } } },
    ]),
    PaymentJourneySession.find({
      invoiceRefs: { $in: ids },
      $or: [
        { entry: { $in: [...PAYMENT_ATTEMPT_VISIT_ENTRIES] } },
        { pages: { $in: [...PAYMENT_ATTEMPT_VISIT_ENTRIES] } },
      ],
    })
      .select("invoiceRefs lastEventAt")
      .lean<Array<{ invoiceRefs?: Types.ObjectId[]; lastEventAt?: Date }>>(),
  ]);

  const eventAt = new Map<string, Date>();
  for (const event of events) {
    if (event.latestAt) eventAt.set(String(event._id), new Date(event.latestAt));
  }

  const visitAt = new Map<string, Date>();
  const idSet = new Set(ids.map((id) => String(id)));
  for (const visit of visits) {
    const at = visit.lastEventAt ? new Date(visit.lastEventAt) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    for (const ref of visit.invoiceRefs ?? []) {
      const key = String(ref);
      if (!idSet.has(key)) continue;
      const previous = visitAt.get(key);
      if (!previous || at > previous) visitAt.set(key, at);
    }
  }

  return selectPaymentInvoices(invoices, eventAt, visitAt);
}
