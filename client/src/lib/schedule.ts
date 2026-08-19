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

export const DISPATCHER_ROLES = ["super-admin", "admin", "owner"];

export function isDispatcherRole(role: string | null | undefined): boolean {
  return Boolean(role && DISPATCHER_ROLES.includes(role));
}
