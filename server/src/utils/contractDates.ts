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
