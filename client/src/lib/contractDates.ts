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

export function formatDateOnly(date: string | Date | null | undefined): string {
  const parsed = typeof date === "string" ? parseDateOnly(date) : parseDateOnly(date);
  if (!parsed) return "—";
  return parsed.toLocaleDateString(undefined, { timeZone: "UTC" });
}

export const STANDING_LABELS: Record<ContractStanding, string> = {
  active: "Active",
  due_soon: "Due Soon",
  expired: "Expired",
};

export const STANDING_STYLES: Record<ContractStanding, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  due_soon: "bg-amber-50 text-amber-700 border-amber-200",
  expired: "bg-red-50 text-red-700 border-red-200",
};
