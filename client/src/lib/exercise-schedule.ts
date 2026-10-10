export const EXERCISE_WEEKDAYS = [
  { value: "Sun", label: "Sunday" },
  { value: "Mon", label: "Monday" },
  { value: "Tue", label: "Tuesday" },
  { value: "Wed", label: "Wednesday" },
  { value: "Thu", label: "Thursday" },
  { value: "Fri", label: "Friday" },
  { value: "Sat", label: "Saturday" },
] as const;

export type ExerciseWeekday = (typeof EXERCISE_WEEKDAYS)[number]["value"];

const WEEKDAY_BY_NAME = new Map<string, ExerciseWeekday>(
  EXERCISE_WEEKDAYS.flatMap((day) => [
    [day.value.toLowerCase(), day.value],
    [day.label.toLowerCase(), day.value],
  ]),
);

/** Short weekday label already stored on work orders, or null when it is not a weekday. */
export function canonicalWeekday(raw: string | null | undefined): ExerciseWeekday | null {
  const text = (raw ?? "").trim().toLowerCase().replace(/\./g, "");
  if (!text) return null;
  return WEEKDAY_BY_NAME.get(text) ?? null;
}

/** Full weekday name for display. Unknown text is returned unchanged. */
export function exerciseDayLabel(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  const canonical = canonicalWeekday(text);
  if (!canonical) return text;
  return EXERCISE_WEEKDAYS.find((day) => day.value === canonical)?.label ?? text;
}

/** Clock time for display. Unparseable text is returned unchanged. */
export function exerciseTimeLabel(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  const input = toTimeInputValue(text);
  return input ? fromTimeInputValue(input) : text;
}

/**
 * Value for an `<input type="time">`. Accepts `3 PM`, `3:00 PM`, and `15:00`.
 * Returns "" when the text is empty or not a time, so the stored string can stay put.
 */
export function toTimeInputValue(raw: string | null | undefined): string {
  const parsed = parseClock(raw);
  if (!parsed) return "";
  return `${pad(parsed.hours)}:${pad(parsed.minutes)}`;
}

/** Readable time stored on the work order, such as `3:00 PM`. */
export function fromTimeInputValue(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return hhmm;
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${pad(minutes)} ${period}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseClock(
  raw: string | null | undefined,
): { hours: number; minutes: number } | null {
  const text = (raw ?? "").trim().toLowerCase().replace(/\./g, "");
  if (!text) return null;

  const withMinutes = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/.exec(text);
  const hourOnly = /^(\d{1,2})\s*([ap]m)$/.exec(text);
  const hourText = withMinutes?.[1] ?? hourOnly?.[1];
  const minuteText = withMinutes?.[2] ?? "00";
  const period = withMinutes?.[3] ?? hourOnly?.[2];
  if (!hourText) return null;

  const hour = Number(hourText);
  const minutes = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minutes) || minutes > 59) {
    return null;
  }

  if (period) {
    if (hour < 1 || hour > 12) return null;
    const hours = (hour % 12) + (period === "pm" ? 12 : 0);
    return { hours, minutes };
  }

  if (hour > 23) return null;
  return { hours: hour, minutes };
}
