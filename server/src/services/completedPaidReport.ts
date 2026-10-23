/**
 * Completed & Paid matches the legacy complete.php list:
 * work orders with both flags set, bucketed by the work-order date.
 */

export type CompletedPaidWorkOrder = {
  completed?: boolean;
  paid?: boolean;
  date?: Date | string | null;
  createdAt?: Date | string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Mongo filter. `to` is exclusive so a calendar month ends before the next month starts. */
export function completedPaidWorkOrderFilter(
  from: Date | null,
  to: Date | null,
): Record<string, unknown> {
  const date: Record<string, unknown> = { $ne: null };
  if (from) date.$gte = from;
  if (to) date.$lt = to;
  return {
    completed: true,
    paid: true,
    date,
  };
}

/** pp.php: completed and unpaid at any date, including $0 tickets. */
export function pendingPaymentWorkOrderFilter(): Record<string, unknown> {
  return { completed: true, paid: false };
}

export function workOrderMatchesPendingPayment(wo: {
  completed?: boolean;
  paid?: boolean;
  total?: number;
}): boolean {
  return wo.completed === true && wo.paid === false;
}

export function workOrderMatchesCompletedPaid(
  wo: CompletedPaidWorkOrder,
  from: Date | null,
  to: Date | null,
): boolean {
  if (!wo.completed || !wo.paid) return false;
  const date = asDate(wo.date);
  if (!date) return false;
  const time = date.getTime();
  if (from && time < from.getTime()) return false;
  if (to && time >= to.getTime()) return false;
  return true;
}
