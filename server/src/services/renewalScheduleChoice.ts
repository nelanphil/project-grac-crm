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

/** Date links for the renewal email. Empty when no dates were offered. */
export function recommendedDatesEmailHtml(input: {
  pageUrl: string;
  token: string;
  dates: string[];
}): string {
  const pageUrl = input.pageUrl.replace(/\/$/, "");
  return input.dates
    .map((date) => {
      const href = `${pageUrl}?token=${encodeURIComponent(input.token)}&date=${encodeURIComponent(date)}`.replace(
        /&/g,
        "&amp;",
      );
      return `<p><a href="${href}">${renewalOfferDateLabel(date)}</a></p>`;
    })
    .join("");
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
