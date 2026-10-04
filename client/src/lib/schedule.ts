import type {
  UserHomeLocation,
  UserWeeklyHours,
  WeekdayKey,
  WeeklyDayHours,
} from "@/lib/api";

export const SCHEDULE_TIMEZONE = "America/New_York";

export const WEEKDAY_KEYS: WeekdayKey[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

export const BOARD_HOUR_START = 7;
export const BOARD_HOUR_END = 19;
export const DEFAULT_ESTIMATED_MINUTES = 60;

export function emptyHomeLocation(): UserHomeLocation {
  return {
    address: "",
    city: "",
    state: "",
    zip: "",
    lat: null,
    lng: null,
  };
}

export function defaultWeeklyHours(weekdayEnabled: boolean): UserWeeklyHours {
  const day = (enabled: boolean): WeeklyDayHours => ({
    enabled,
    start: "08:00",
    end: "17:00",
  });
  return {
    sun: day(false),
    mon: day(weekdayEnabled),
    tue: day(weekdayEnabled),
    wed: day(weekdayEnabled),
    thu: day(weekdayEnabled),
    fri: day(weekdayEnabled),
    sat: day(false),
  };
}

export function nyDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
  weekdayIndex: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekdayIndex: weekdayMap[get("weekday")] ?? 0,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function formatLocalDate(date: Date): string {
  const { year, month, day } = nyDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatLocalTime(date: Date): string {
  const { hour, minute } = nyDateParts(date);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatLocalClock(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeTimeOfDay(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return TIME_OF_DAY.test(trimmed) ? trimmed : "";
}

function formatHmClock(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(Date.UTC(2020, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function timeWindowError(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const startTime = normalizeTimeOfDay(start);
  const endTime = normalizeTimeOfDay(end);
  if (startTime && endTime && endTime <= startTime) {
    return "End time must be after start time";
  }
  return null;
}

export function formatTimeWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const startLabel = normalizeTimeOfDay(start);
  const endLabel = normalizeTimeOfDay(end);
  if (startLabel && endLabel) {
    return `${formatHmClock(startLabel)} – ${formatHmClock(endLabel)}`;
  }
  if (startLabel) return `From ${formatHmClock(startLabel)}`;
  if (endLabel) return `Until ${formatHmClock(endLabel)}`;
  return null;
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const utc = Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  return formatLocalDate(new Date(utc + 12 * 3600 * 1000));
}

export function startOfWeekSunday(localDate: string): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const asDate = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
  const weekday = nyDateParts(asDate).weekdayIndex;
  return addDays(localDate, -weekday);
}

export function startOfMonth(localDate: string): string {
  return `${localDate.slice(0, 7)}-01`;
}

export function daysInMonth(localDate: string): number {
  const [y, m] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
}

export function formatAddressLine(addr: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
} | null | undefined): string {
  if (!addr) return "—";
  const street = addr.address?.trim() ?? "";
  const city = addr.city?.trim() ?? "";
  const state = addr.state?.trim() ?? "";
  const zip = addr.zip?.trim() ?? "";
  const cityLine = [city, state].filter(Boolean).join(", ");
  const tail = [cityLine, zip].filter(Boolean).join(" ");
  return [street, tail].filter(Boolean).join(", ") || "—";
}

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function minutesToHhMm(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Interpret YYYY-MM-DD + HH:mm in America/New_York as UTC ISO. */
export function localDateTimeToIso(localDate: string, hhmm: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const utcGuess = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0);
  const shown = nyDateParts(new Date(utcGuess));
  const shownUtc = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    0,
  );
  const desiredUtc = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    0,
  );
  return new Date(utcGuess + (desiredUtc - shownUtc)).toISOString();
}

export function formatPrettyDate(localDate: string): string {
  const iso = localDateTimeToIso(localDate, "12:00");
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: SCHEDULE_TIMEZONE,
  });
}

export function formatMonthDayYear(localDate: string): string {
  const iso = localDateTimeToIso(localDate, "12:00");
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: SCHEDULE_TIMEZONE,
  });
}

/** Long date, e.g. "August 27, 2026". */
export function formatLongDate(localDate: string): string {
  const iso = localDateTimeToIso(localDate, "12:00");
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: SCHEDULE_TIMEZONE,
  });
}

/** Full weekday plus short date, e.g. "Tuesday, Sep 29". */
export function formatWeekdayDate(localDate: string): string {
  const iso = localDateTimeToIso(localDate, "12:00");
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: SCHEDULE_TIMEZONE,
  });
}

/** "September 2026" from YYYY-MM. */
export function formatMonthYear(yyyyMm: string): string {
  const iso = localDateTimeToIso(`${yyyyMm}-01`, "12:00");
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: SCHEDULE_TIMEZONE,
  });
}

/** Move a YYYY-MM value by whole months. */
export function shiftMonth(yyyyMm: string, delta: number): string {
  if (delta === 0) return yyyyMm;
  let cursor = `${yyyyMm}-01`;
  if (delta > 0) {
    for (let i = 0; i < delta; i += 1) {
      cursor = addDays(cursor, daysInMonth(cursor));
    }
    return cursor.slice(0, 7);
  }
  for (let i = 0; i < -delta; i += 1) {
    cursor = startOfMonth(addDays(cursor, -1));
  }
  return cursor.slice(0, 7);
}

export function formatPrettyDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SCHEDULE_TIMEZONE,
  })} ET`;
}

export const MIN_EMAIL_SCHEDULE_LEAD_MS = 60_000;

export function isEmailScheduleTimeValid(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t >= Date.now() + MIN_EMAIL_SCHEDULE_LEAD_MS;
}

export { DISPATCHER_ROLES, isDispatcherRole } from "@/lib/dashboard-role";

export function weeklyHoursNeverEnabled(hours: UserWeeklyHours): boolean {
  return WEEKDAY_KEYS.every((key) => !hours[key].enabled);
}

export function weeklyHoursSummary(hours: UserWeeklyHours): string {
  const enabledKeys = WEEKDAY_KEYS.filter((key) => hours[key].enabled);
  const firstKey = enabledKeys[0];
  if (!firstKey) return "Hours not set";
  const first = hours[firstKey];
  const same = enabledKeys.every(
    (key) => hours[key].start === first.start && hours[key].end === first.end,
  );
  const days = enabledKeys.map((key) => WEEKDAY_LABELS[key].slice(0, 3)).join(", ");
  if (same) return `${days} ${first.start}–${first.end}`;
  return `${enabledKeys.length} days set`;
}

export function workOrderLocalDate(job: {
  scheduledStart?: string | null;
  date?: string | null;
}): string | null {
  if (job.scheduledStart) return formatLocalDate(new Date(job.scheduledStart));
  if (job.date) return job.date.slice(0, 10);
  return null;
}

const JOB_ACCENTS = [
  "#f59e0b",
  "#22c55e",
  "#6366f1",
  "#a855f7",
  "#f43f5e",
  "#14b8a6",
];
/** Untyped jobs use the same status colors as the schedule map pins. */
const SCHEDULED_ACCENT = "#2563eb";
const UNSCHEDULED_ACCENT = "#f36c21";

/** Stable accent color per work order type, shared by every schedule view. */
export function jobAccent(job: {
  workOrderType?: { _id?: string; label?: string } | null;
  scheduledStart?: string | null;
}): string {
  const fallback = job.scheduledStart ? SCHEDULED_ACCENT : UNSCHEDULED_ACCENT;
  const key = job.workOrderType?._id || job.workOrderType?.label || "";
  if (!key) return fallback;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return JOB_ACCENTS[Math.abs(hash) % JOB_ACCENTS.length] ?? fallback;
}

export function workOrderViewHref(job: {
  _id?: string;
  customerRef?: string | null;
}): string | null {
  if (job._id) return `/dashboard/work-orders/detail?id=${job._id}`;
  if (!job.customerRef) return null;
  return `/dashboard/customers/detail?id=${job.customerRef}#customer-work-orders`;
}
