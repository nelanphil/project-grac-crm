import { parseDateOnly } from "./contractDates";

/** A completed, unpaid ASC work order already loaded for the renewal list. */
export type UnpaidAscWorkOrder = {
  _id: string;
  number?: string | null;
  legacyId?: number | null;
  date?: Date | string | null;
  total?: number | null;
  customerRef?: string | null;
};

export type AscUnpaidWorkOrder = {
  _id: string;
  number: string;
  date: string | null;
  totalCents: number;
};

/** Prior unpaid ASC visits. The renewal now due is not included in `count`. */
export type AscUnpaidSummary = {
  count: number;
  totalCents: number;
  workOrders: AscUnpaidWorkOrder[];
};

function ticketLabel(ticket: UnpaidAscWorkOrder): string {
  const number = ticket.number?.trim();
  if (number) return number;
  if (ticket.legacyId != null && Number.isFinite(ticket.legacyId)) {
    return String(ticket.legacyId);
  }
  return ticket._id;
}

function dollarsToCents(total: number | null | undefined): number {
  if (typeof total !== "number" || !Number.isFinite(total)) return 0;
  return Math.round(total * 100);
}

/**
 * Unpaid ASC tickets for this customer dated before the renewal due date.
 * A ticket on or after that date pays for the renewal now due, not an earlier year.
 * Returns null when nothing earlier is still unpaid.
 */
export function priorUnpaidAscForCustomer(
  tickets: UnpaidAscWorkOrder[],
  customerRef: string,
  renewalDueDate: Date | string | null | undefined,
): AscUnpaidSummary | null {
  const due = parseDateOnly(renewalDueDate ?? null);
  if (!due || !customerRef) return null;

  const workOrders = tickets
    .filter((ticket) => ticket.customerRef === customerRef)
    .flatMap((ticket) => {
      const date = parseDateOnly(ticket.date ?? null);
      if (!date || date.getTime() >= due.getTime()) return [];
      return [
        {
          _id: ticket._id,
          number: ticketLabel(ticket),
          date: date.toISOString().slice(0, 10),
          totalCents: dollarsToCents(ticket.total),
          sort: date.getTime(),
        },
      ];
    })
    .sort((a, b) => a.sort - b.sort || a.number.localeCompare(b.number));

  if (workOrders.length === 0) return null;

  return {
    count: workOrders.length,
    totalCents: workOrders.reduce((sum, row) => sum + row.totalCents, 0),
    workOrders: workOrders.map((row) => ({
      _id: row._id,
      number: row.number,
      date: row.date,
      totalCents: row.totalCents,
    })),
  };
}

/**
 * The payment link charges the latest invoice only. An earlier unpaid ASC
 * stays beside that total and is not added to it.
 */
export function checkoutAmountBesidePriorAsc(
  latestInvoiceCents: number | null,
  prior: AscUnpaidSummary | null,
): {
  paymentLinkAmountCents: number | null;
  priorAscUnpaid: { count: number; totalCents: number } | null;
} {
  return {
    paymentLinkAmountCents: latestInvoiceCents,
    priorAscUnpaid: prior
      ? { count: prior.count, totalCents: prior.totalCents }
      : null,
  };
}
