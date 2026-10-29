import { DUE_SOON_DAYS, differenceInCalendarDays } from "./contractDates";
import { formatDateForTemplate, type MessageTemplateContext } from "./messageTemplate";

export const DEFAULT_DUE_SOON_DAYS = DUE_SOON_DAYS;

export interface RenewalVariants {
  enabled: boolean;
  dueSoonDays: number;
  expired: string;
  dueSoon: string;
  active: string;
}

export type RenewalVariantStatus = "expired" | "due_soon" | "active" | "none";

export type RenewalPreviewStatus = RenewalVariantStatus | "fallback";

type RenewalTimingSource = {
  renewalDueDate: Date | null;
  lastRenewalDate?: Date | null;
  contractDate?: Date | null;
  renewalStatus?: "due" | "overdue" | "renewed" | null;
};

export function coerceRenewalVariants(value: unknown): RenewalVariants | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const days = Number(raw.dueSoonDays);
  return {
    enabled: raw.enabled === true,
    dueSoonDays:
      Number.isInteger(days) && days >= 1 && days <= 365
        ? days
        : DEFAULT_DUE_SOON_DAYS,
    expired: typeof raw.expired === "string" ? raw.expired : "",
    dueSoon: typeof raw.dueSoon === "string" ? raw.dueSoon : "",
    active: typeof raw.active === "string" ? raw.active : "",
  };
}

/** Variants that should change the message. Disabled or missing settings do not. */
export function enabledRenewalVariants(value: unknown): RenewalVariants | null {
  const variants = coerceRenewalVariants(value);
  return variants?.enabled ? variants : null;
}

export function renewalVariantsHaveCopy(
  variants: RenewalVariants | null | undefined,
): boolean {
  if (!variants) return false;
  return [variants.expired, variants.dueSoon, variants.active].some((part) =>
    part.trim(),
  );
}

/**
 * Expired is a past due date. Due soon is today through dueSoonDays.
 * Active is further out. A contract already renewed into next year is active.
 * No due date (and not renewed) has no status, so the fallback body is used.
 */
export function renewalVariantStatus(
  info: RenewalTimingSource,
  dueSoonDays: number,
  today: Date = new Date(),
): RenewalVariantStatus {
  if (info.renewalStatus === "renewed") return "active";
  if (!info.renewalDueDate) return "none";
  const days = differenceInCalendarDays(info.renewalDueDate, today);
  if (days < 0) return "expired";
  if (days <= dueSoonDays) return "due_soon";
  return "active";
}

export function renewalStatusLabel(status: RenewalVariantStatus): string {
  if (status === "due_soon") return "due soon";
  if (status === "expired" || status === "active") return status;
  return "";
}

export function renewalTimingFields(
  info: RenewalTimingSource,
  dueSoonDays: number,
  today: Date = new Date(),
): {
  renewal_status: string;
  days_until_due: string;
  days_past_due: string;
  last_renewal_date: string;
  contract_start_date: string;
} {
  const days = info.renewalDueDate
    ? differenceInCalendarDays(info.renewalDueDate, today)
    : null;
  return {
    renewal_status: renewalStatusLabel(
      renewalVariantStatus(info, dueSoonDays, today),
    ),
    days_until_due: days != null && days >= 0 ? String(days) : "",
    days_past_due: days != null && days < 0 ? String(Math.abs(days)) : "",
    last_renewal_date: formatDateForTemplate(info.lastRenewalDate ?? null),
    contract_start_date: formatDateForTemplate(info.contractDate ?? null),
  };
}

/** Blank status boxes fall back so a template still sends something. */
export function pickRenewalVariantBody(
  variants: RenewalVariants | null | undefined,
  status: RenewalVariantStatus,
  fallback: string,
): string {
  if (!variants?.enabled || status === "none") return fallback;
  const chosen =
    status === "expired"
      ? variants.expired
      : status === "due_soon"
        ? variants.dueSoon
        : variants.active;
  return chosen.trim() ? chosen : fallback;
}

function addUtcDays(today: Date, days: number): Date {
  return new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + days,
    ),
  );
}

/** Sample dates that match the status being previewed. */
export function sampleContextForRenewalStatus(
  base: MessageTemplateContext,
  status: Exclude<RenewalVariantStatus, "none">,
  dueSoonDays: number,
  today: Date = new Date(),
): MessageTemplateContext {
  const days =
    status === "expired"
      ? -30
      : status === "due_soon"
        ? Math.min(14, dueSoonDays)
        : dueSoonDays + 60;
  const dueDate = addUtcDays(today, days);
  return {
    ...base,
    renewal_due_date: formatDateForTemplate(dueDate),
    renewal_status: renewalStatusLabel(status),
    days_until_due: days >= 0 ? String(days) : "",
    days_past_due: days < 0 ? String(-days) : "",
  };
}
