export const DEFAULT_DURATION_MONTHS = 12;
export const DUE_SOON_DAYS = 30;

export type ContractStanding = "active" | "due_soon" | "expired";

export function parseDateOnly(input: string | Date | null | undefined): Date | null {
  if (input == null) return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return new Date(
      Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
    );
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (match) {
    return new Date(
      Date.UTC(
        parseInt(match[1], 10),
        parseInt(match[2], 10) - 1,
        parseInt(match[3], 10),
      ),
    );
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

export function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function endOfDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const result = new Date(Date.UTC(year, month + months, day));

  if (result.getUTCDate() !== day) {
    result.setUTCDate(0);
  }

  return result;
}

export function differenceInCalendarDays(later: Date, earlier: Date): number {
  const laterStart = startOfDay(later).getTime();
  const earlierStart = startOfDay(earlier).getTime();
  return Math.round((laterStart - earlierStart) / (24 * 60 * 60 * 1000));
}

/**
 * Admin override of the current period. End must be strictly after start.
 * Both values are calendar dates.
 */
export function parseContractPeriod(
  startInput: unknown,
  endInput: unknown,
):
  | { ok: true; startDate: Date; endDate: Date }
  | { ok: false; message: string } {
  const startDate = parseDateOnly(asDateInput(startInput));
  const endDate = parseDateOnly(asDateInput(endInput));
  if (!startDate || !endDate) {
    return { ok: false, message: "Start date and end date are required" };
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return { ok: false, message: "End date must be after the start date" };
  }
  return { ok: true, startDate, endDate };
}

function asDateInput(value: unknown): string | Date | null {
  if (value instanceof Date || typeof value === "string") return value;
  return null;
}

export function computeInitialRenewalDueDate(
  contractDate: Date | null,
  durationMonths: number,
): Date | null {
  if (!contractDate) return null;
  return addMonths(contractDate, durationMonths);
}

export function computeRenewalDueDateAfterRenewal(
  renewedAt: Date,
  previousDueDate: Date,
  durationMonths: number,
): { newDueDate: Date; wasLate: boolean } {
  const renewedAtDay = startOfDay(renewedAt);
  const previousDueDay = startOfDay(previousDueDate);
  const wasLate = renewedAtDay.getTime() > previousDueDay.getTime();
  const anchor = wasLate ? renewedAtDay : previousDueDay;

  return {
    newDueDate: addMonths(anchor, durationMonths),
    wasLate,
  };
}

export function getContractStanding(
  renewalDueDate: Date | null | undefined,
  today: Date = new Date(),
): ContractStanding {
  if (!renewalDueDate) return "expired";

  const daysUntilDue = differenceInCalendarDays(renewalDueDate, today);
  if (daysUntilDue < 0) return "expired";
  if (daysUntilDue <= DUE_SOON_DAYS) return "due_soon";
  return "active";
}

export function isInGoodStanding(
  renewalDueDate: Date | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!renewalDueDate) return false;
  return today.getTime() <= endOfDay(renewalDueDate).getTime();
}

/** UTC half-open bounds for a calendar month (month is 1–12). */
export function renewalMonthWindow(
  year: number,
  month: number,
): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1)),
  };
}

/**
 * Mongo filter for renewals in a selected calendar month, including expired
 * contracts from earlier years with the same anniversary month.
 */
export function renewalDueDateFilterForMonth(
  year: number,
  month: number,
): Record<string, unknown> {
  const { gte, lt } = renewalMonthWindow(year, month);
  return {
    $or: [
      { renewalDueDate: { $gte: gte, $lt: lt } },
      {
        renewalDueDate: { $lt: gte, $ne: null },
        $expr: { $eq: [{ $month: "$renewalDueDate" }, month] },
      },
    ],
  };
}

export type RenewalCohortStatus = "due" | "overdue" | "renewed";

/**
 * Wizard audience for a calendar month: still due that month, overdue from
 * an earlier year with the same anniversary month, or already renewed so the
 * next due date landed in that month one year later.
 */
export function renewalCohortFilterForMonth(
  year: number,
  month: number,
): Record<string, unknown> {
  const { gte, lt } = renewalMonthWindow(year, month);
  const nextYear = renewalMonthWindow(year + 1, month);
  return {
    $or: [
      ...renewalOutreachClauses(month, gte, lt),
      {
        renewalDueDate: { $gte: nextYear.gte, $lt: nextYear.lt },
        lastRenewalDate: { $exists: true, $ne: null },
      },
    ],
  };
}

/**
 * Wizard audience for a calendar month: still due that month, or overdue
 * from an earlier year with the same anniversary month. Already-renewed
 * contracts are left out.
 */
export function renewalOutreachFilterForMonth(
  year: number,
  month: number,
): Record<string, unknown> {
  const { gte, lt } = renewalMonthWindow(year, month);
  return { $or: renewalOutreachClauses(month, gte, lt) };
}

function renewalOutreachClauses(
  month: number,
  gte: Date,
  lt: Date,
): Array<Record<string, unknown>> {
  return [
    { renewalDueDate: { $gte: gte, $lt: lt } },
    {
      renewalDueDate: { $lt: gte, $ne: null },
      $expr: { $eq: [{ $month: "$renewalDueDate" }, month] },
    },
  ];
}

/** Status of one contract inside a selected renewal month. */
export function renewalCohortStatus(
  renewalDueDate: Date,
  lastRenewalDate: Date | null | undefined,
  scope: { year: number; month: number },
  today: Date = new Date(),
): RenewalCohortStatus {
  const nextYear = renewalMonthWindow(scope.year + 1, scope.month);
  const dueTime = renewalDueDate.getTime();
  if (
    lastRenewalDate &&
    dueTime >= nextYear.gte.getTime() &&
    dueTime < nextYear.lt.getTime()
  ) {
    return "renewed";
  }
  if (differenceInCalendarDays(renewalDueDate, today) < 0) return "overdue";
  return "due";
}

/**
 * Status on the wizard contact list when no month is selected.
 * A past date is overdue. A recorded renewal whose next date is in a later
 * month is renewed. Anything else still ahead, including a first term with
 * no renewal on file, is due.
 */
export function listRenewalStatus(
  renewalDueDate: Date,
  lastRenewalDate: Date | null | undefined,
  today: Date = new Date(),
): RenewalCohortStatus {
  const due = startOfDay(renewalDueDate);
  const now = startOfDay(today);
  if (differenceInCalendarDays(due, now) < 0) return "overdue";
  if (!lastRenewalDate) return "due";
  const dueMonth = due.getUTCFullYear() * 12 + due.getUTCMonth();
  const todayMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (dueMonth > todayMonth) return "renewed";
  return "due";
}
