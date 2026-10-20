import { parseDateOnly } from "../utils/contractDates";
import { formatLocalDate, SCHEDULE_TIMEZONE } from "../utils/scheduleTime";

export const WORK_ORDER_REOPENED_REASON = "work_order_reopened";

const PAYABLE_STATUSES = new Set(["open", "draft", "failed"]);

export type InvoiceAvailabilityInput = {
  status?: string | null;
  sourceType?: string | null;
  workOrderRef?: unknown;
  dueDate?: Date | string | null;
  issuedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type WorkOrderAvailability = {
  completed?: boolean | null;
  deletedAt?: Date | string | null;
};

export function companyTodayKey(now: Date = new Date()): string {
  return formatLocalDate(now);
}

/** Date-only due dates stay on their UTC calendar day. Issued instants use America/New_York. */
export function invoiceAvailabilityDay(
  invoice: Pick<InvoiceAvailabilityInput, "dueDate" | "issuedAt">,
): string | null {
  if (invoice.dueDate) {
    const parsed = parseDateOnly(invoice.dueDate);
    return parsed ? parsed.toISOString().slice(0, 10) : null;
  }
  if (!invoice.issuedAt) return null;
  const issued =
    invoice.issuedAt instanceof Date
      ? invoice.issuedAt
      : new Date(invoice.issuedAt);
  if (Number.isNaN(issued.getTime())) return null;
  return formatLocalDate(issued);
}

export function isInvoiceAvailableThroughToday(
  invoice: InvoiceAvailabilityInput,
  workOrder: WorkOrderAvailability | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!invoice.status || !PAYABLE_STATUSES.has(invoice.status)) return false;
  if (invoice.sourceType === "work_order") {
    if (!workOrder || workOrder.deletedAt || !workOrder.completed) return false;
  }
  const day = invoiceAvailabilityDay(invoice);
  if (!day) return false;
  return day <= companyTodayKey(now);
}

function timeValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function pickLatestAvailableInvoice<T extends InvoiceAvailabilityInput>(
  invoices: T[],
  workOrdersById: Map<string, WorkOrderAvailability>,
  now: Date = new Date(),
): T | null {
  const available = invoices.filter((invoice) => {
    const workOrderId = invoice.workOrderRef ? String(invoice.workOrderRef) : "";
    const workOrder =
      invoice.sourceType === "work_order"
        ? workOrdersById.get(workOrderId)
        : null;
    return isInvoiceAvailableThroughToday(invoice, workOrder, now);
  });
  available.sort((a, b) => {
    const dayA = invoiceAvailabilityDay(a) ?? "";
    const dayB = invoiceAvailabilityDay(b) ?? "";
    if (dayA !== dayB) return dayA < dayB ? 1 : -1;
    const issuedDelta = timeValue(b.issuedAt) - timeValue(a.issuedAt);
    if (issuedDelta !== 0) return issuedDelta;
    return timeValue(b.createdAt) - timeValue(a.createdAt);
  });
  return available[0] ?? null;
}

export const PAYMENT_LINK_TIMEZONE = SCHEDULE_TIMEZONE;
