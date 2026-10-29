import { SCHEDULE_TIMEZONE } from "../utils/scheduleTime";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type RenewalScheduleChoice =
  | { ok: true }
  | {
      ok: false;
      reason: "expired" | "invalid_date" | "already_scheduled" | "past";
    };

/** Whether a customer may book one of the dates from their renewal email. */
export function evaluateRenewalScheduleChoice(input: {
  now: Date;
  expiresAt: Date | null;
  offeredDates: string[];
  requestedDate: string;
  today: string;
  workOrderScheduled: boolean;
}): RenewalScheduleChoice {
  if (!input.expiresAt || input.now.getTime() > input.expiresAt.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (input.workOrderScheduled) {
    return { ok: false, reason: "already_scheduled" };
  }
  if (
    !ISO_DATE.test(input.requestedDate) ||
    !input.offeredDates.includes(input.requestedDate)
  ) {
    return { ok: false, reason: "invalid_date" };
  }
  if (input.requestedDate < input.today) {
    return { ok: false, reason: "past" };
  }
  return { ok: true };
}

type OfferDateParts = {
  month: string;
  day: string;
  weekday: string;
};

function offerInstant(isoDate: string): Date | null {
  if (!ISO_DATE.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function offerDateParts(isoDate: string): OfferDateParts {
  const instant = offerInstant(isoDate);
  if (!instant) return { month: "", day: isoDate, weekday: "" };
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: SCHEDULE_TIMEZONE,
    }).format(instant);
  return {
    month: format({ month: "short" }).toUpperCase(),
    day: format({ day: "numeric" }),
    weekday: format({ weekday: "long" }),
  };
}

function confirmHref(pageUrl: string, token: string, date: string): string {
  return `${pageUrl.replace(/\/$/, "")}?token=${encodeURIComponent(token)}&date=${encodeURIComponent(date)}`;
}

/** Calendar tiles for the renewal email. Empty when no dates were offered. */
export function recommendedDatesEmailHtml(input: {
  pageUrl: string;
  token: string;
  dates: string[];
}): string {
  if (input.dates.length === 0) return "";
  const cells = input.dates
    .map((date) => {
      const href = escapeHtml(confirmHref(input.pageUrl, input.token, date));
      const parts = offerDateParts(date);
      return `<td style="width:33%;vertical-align:top;padding:0 6px 12px;">
<a href="${href}" style="display:block;text-decoration:none;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;text-align:center;background-color:#ffffff;">
<span style="display:block;background-color:#f36c21;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.08em;padding:8px 10px;">${escapeHtml(parts.month)}</span>
<span style="display:block;color:#231f20;font-size:32px;font-weight:700;line-height:1.1;padding:10px 10px 0;">${escapeHtml(parts.day)}</span>
<span style="display:block;color:#737373;font-size:13px;padding:4px 10px 0;">${escapeHtml(parts.weekday)}</span>
<span style="display:block;color:#f36c21;font-size:12px;font-weight:700;padding:10px 10px 12px;">Choose this day</span>
</a>
</td>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:8px 0 4px;"><tr>${cells}</tr></table>`;
}

/** Plain-text date list. Empty when no dates were offered. */
export function recommendedDatesEmailText(input: {
  pageUrl: string;
  token: string;
  dates: string[];
}): string {
  return input.dates
    .map((date) => `${renewalOfferDateLabel(date)}: ${confirmHref(input.pageUrl, input.token, date)}`)
    .join("\n");
}

/** Long label for a YYYY-MM-DD schedule date, in the company timezone. */
export function renewalOfferDateLabel(isoDate: string): string {
  if (!ISO_DATE.test(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: SCHEDULE_TIMEZONE,
  }).format(date);
}
