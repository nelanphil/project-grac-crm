const RANGE_RE =
  /(?<![\d:])([1-9]|1[0-2])\s*[-–—]\s*([1-9]|1[0-2])(?![\d:])/g;

export type NoteTimeWindow = {
  startTime: string;
  endTime: string;
};

export type NoteTimeWindowResult =
  | ({ ok: true } & NoteTimeWindow)
  | { ok: false; reason: "none" | "multiple" | "outside-work-day" };

/** Map a 12-hour clock hour onto an 8:00 AM–6:00 PM work day. */
function workdayHour(hour: number): number | null {
  if (hour >= 8 && hour <= 11) return hour;
  if (hour === 12) return 12;
  if (hour >= 1 && hour <= 6) return hour + 12;
  return null;
}

function formatHour(hour24: number): string {
  return `${String(hour24).padStart(2, "0")}:00`;
}

export function parseNoteTimeWindow(text: string): NoteTimeWindowResult {
  const matches = [...text.matchAll(RANGE_RE)];
  if (matches.length === 0) return { ok: false, reason: "none" };
  if (matches.length > 1) return { ok: false, reason: "multiple" };

  const start = workdayHour(Number(matches[0][1]));
  const end = workdayHour(Number(matches[0][2]));
  if (start == null || end == null || end <= start) {
    return { ok: false, reason: "outside-work-day" };
  }
  return {
    ok: true,
    startTime: formatHour(start),
    endTime: formatHour(end),
  };
}
