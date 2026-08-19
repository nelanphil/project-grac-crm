/** Company timezone for technician schedules and work-order slots. */
export const SCHEDULE_TIMEZONE = "America/New_York";

export const WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const DEFAULT_DAY_START = "08:00";
export const DEFAULT_DAY_END = "17:00";
export const DEFAULT_ESTIMATED_MINUTES = 60;

export type WeeklyDayHours = {
  enabled: boolean;
  start: string;
  end: string;
};

export type WeeklyHours = Record<WeekdayKey, WeeklyDayHours>;

export type ScheduleException = {
  date: string;
  type: "off" | "custom";
  start?: string;
  end?: string;
  note?: string;
};

export type HomeLocation = {
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhMm(value: string): boolean {
  return HH_MM.test(value);
}

export function emptyHomeLocation(): HomeLocation {
  return {
    address: "",
    city: "",
    state: "",
    zip: "",
    lat: null,
    lng: null,
  };
}

export function defaultWeeklyHours(weekdayEnabled: boolean): WeeklyHours {
  const day = (enabled: boolean): WeeklyDayHours => ({
    enabled,
    start: DEFAULT_DAY_START,
    end: DEFAULT_DAY_END,
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

export function defaultSchedulableForRole(role: string): boolean {
  return role === "tech";
}

function nyParts(date: Date): {
  year: number;
  month: number;
  day: number;
  weekday: WeekdayKey;
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

  const weekdayMap: Record<string, WeekdayKey> = {
    Sun: "sun",
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
  };

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? "sun",
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function formatLocalDate(date: Date): string {
  const { year, month, day } = nyParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatLocalTime(date: Date): string {
  const { hour, minute } = nyParts(date);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function weekdayKeyForDate(date: Date): WeekdayKey {
  return nyParts(date).weekday;
}

export function weekdayKeyForLocalDate(localDate: string): WeekdayKey {
  const utcNoon = localDateToUtc(localDate, "12:00");
  return weekdayKeyForDate(utcNoon);
}

/**
 * Interpret a local calendar date + HH:mm in America/New_York as a UTC Date.
 */
export function localDateToUtc(localDate: string, hhmm: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid local date: ${localDate}`);
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour ?? 0, minute ?? 0, 0);
  const asIfNy = new Date(utcGuess);
  const shown = nyParts(asIfNy);
  const shownUtc = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    0,
  );
  const desiredUtc = Date.UTC(year, month - 1, day, hour ?? 0, minute ?? 0, 0);
  return new Date(utcGuess + (desiredUtc - shownUtc));
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function parseHhMmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHhMm(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export type DayWindow = {
  enabled: boolean;
  start: string;
  end: string;
  off: boolean;
};

export function resolveDayWindow(
  weeklyHours: WeeklyHours | null | undefined,
  exceptions: ScheduleException[] | null | undefined,
  localDate: string,
): DayWindow {
  const weekly = weeklyHours ?? defaultWeeklyHours(false);
  const key = weekdayKeyForLocalDate(localDate);
  const base = weekly[key] ?? {
    enabled: false,
    start: DEFAULT_DAY_START,
    end: DEFAULT_DAY_END,
  };
  const exception = (exceptions ?? []).find((e) => e.date === localDate);

  if (exception?.type === "off") {
    return { enabled: false, start: base.start, end: base.end, off: true };
  }
  if (exception?.type === "custom") {
    return {
      enabled: true,
      start: exception.start && isHhMm(exception.start) ? exception.start : base.start,
      end: exception.end && isHhMm(exception.end) ? exception.end : base.end,
      off: false,
    };
  }
  return {
    enabled: Boolean(base.enabled),
    start: base.start,
    end: base.end,
    off: false,
  };
}

export function windowToUtcRange(
  localDate: string,
  window: DayWindow,
): { start: Date; end: Date } | null {
  if (!window.enabled || window.off) return null;
  const start = localDateToUtc(localDate, window.start);
  const end = localDateToUtc(localDate, window.end);
  if (end.getTime() <= start.getTime()) return null;
  return { start, end };
}
