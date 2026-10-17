import type {
  ServiceCity,
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
export const DEFAULT_ESTIMATED_MINUTES = 30;

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

/** One clock, or "Start 8:00–10:00 AM" when the visit may begin anywhere in between. */
export function formatDesiredStart(
  start: string | null | undefined,
  startBy: string | null | undefined,
): string | null {
  const earliest = normalizeTimeOfDay(start);
  const latest = normalizeTimeOfDay(startBy);
  if (earliest && latest && latest > earliest) {
    return `Start ${formatHmClock(earliest)}–${formatHmClock(latest)}`;
  }
  if (earliest) return formatHmClock(earliest);
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

/** Compact coverage label, e.g. "FL (3), GA (1)". */
export function serviceTerritorySummary(
  cities: ServiceCity[] | null | undefined,
): string {
  if (!cities?.length) return "—";
  const counts = new Map<string, number>();
  for (const city of cities) {
    const state = city.state.trim().toUpperCase();
    if (!state) continue;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  if (counts.size === 0) return "—";
  return [...counts.entries()].map(([state, count]) => `${state} (${count})`).join(", ");
}

export function workOrderLocalDate(job: {
  scheduledStart?: string | null;
  date?: string | null;
}): string | null {
  if (job.scheduledStart) return formatLocalDate(new Date(job.scheduledStart));
  if (job.date) return job.date.slice(0, 10);
  return null;
}

/** A placed appointment whose start falls on the selected America/New_York date. */
export function isScheduledOnDate(
  job: { scheduledStart?: string | null },
  localDate: string,
): boolean {
  if (!job.scheduledStart) return false;
  return formatLocalDate(new Date(job.scheduledStart)) === localDate;
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

/** Spread technician ids around the hue wheel so nearby hashes stay apart. */
const GOLDEN_ANGLE = 137.508;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const sat = saturation / 100;
  const light = lightness / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (sector < 1) [red, green, blue] = [chroma, x, 0];
  else if (sector < 2) [red, green, blue] = [x, chroma, 0];
  else if (sector < 3) [red, green, blue] = [0, chroma, x];
  else if (sector < 4) [red, green, blue] = [0, x, chroma];
  else if (sector < 5) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];
  const match = light - chroma / 2;
  const channel = (value: number) =>
    Math.round((value + match) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

/** Stable swatch for a technician. The same id always maps to the same color. */
export function technicianColor(userId: string): string {
  const hue = (hashString(userId) * GOLDEN_ANGLE) % 360;
  return hslToHex(hue, 62, 46);
}

const SAVED_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Saved technician swatch, or the generated color when none is set. */
export function resolvedTechnicianColor(
  userId: string,
  saved?: string | null,
): string {
  const color = saved?.trim() ?? "";
  if (SAVED_COLOR.test(color)) return color.toLowerCase();
  return technicianColor(userId);
}

/** Title-case all-lower and all-upper words. Mixed-case words stay as stored. */
export function properCaseCity(city: string): string {
  return city
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      if (!letters) return word;
      const allLower = letters === letters.toLowerCase();
      const allUpper = letters === letters.toUpperCase();
      if (allLower || allUpper) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Equal mix of colors in sRGB. A single color is returned unchanged. */
export function blendColors(hexes: string[]): string {
  const unique = [...new Set(hexes.filter(Boolean))];
  if (unique.length === 0) return "#737373";
  if (unique.length === 1) return unique[0]!;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const hex of unique) {
    const rgb = hexToRgb(hex);
    red += rgb.r;
    green += rgb.g;
    blue += rgb.b;
  }
  const count = unique.length;
  const channel = (value: number) =>
    Math.round(value / count)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** Technicians on a work order. Falls back to the single assignee. */
export function workOrderCrewIds(job: {
  assignedUserRefs?: string[] | null;
  assignedUserRef?: string | null;
  assignee?: { _id: string } | null;
}): string[] {
  const listed = (job.assignedUserRefs ?? []).filter(Boolean);
  if (listed.length > 0) return [...new Set(listed)];
  const single = job.assignedUserRef || job.assignee?._id || "";
  return single ? [single] : [];
}

/** Opaque wash of a color: about 18% of the source mixed toward white. */
export function opaqueTechnicianTint(hex: string, mix = 0.18): string {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) =>
    Math.round(value * mix + 255 * (1 - mix))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** White on darker blends, near-black on lighter ones. */
export function contrastTextColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.55 ? "#ffffff" : "#171717";
}

export function workOrderViewHref(job: {
  _id?: string;
  customerRef?: string | null;
}): string | null {
  if (job._id) return `/dashboard/work-orders/detail?id=${job._id}`;
  if (!job.customerRef) return null;
  return `/dashboard/customers/detail?id=${job.customerRef}#customer-work-orders`;
}
