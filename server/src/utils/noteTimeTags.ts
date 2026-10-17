const TIME_TAG_RE =
  /(?:^|\s)@((?:0?[1-9]|1[0-2])(?::([0-5]\d))?\s*([AaPp][Mm]))(?=$|[\s.,;:!?])/g;

export type NoteTimeTags =
  | { ok: true; desiredStartTime: string; desiredStartBy: string }
  | { ok: false; reason: "none" | "too-many" | "order" };

function toHour24(hour12: number, minute: number, ampm: string): string {
  const pm = ampm.toLowerCase() === "pm";
  let hour = hour12 % 12;
  if (pm) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Read @8:00AM, or @8:00AM and a later @10:00AM, as a desired start window. */
export function parseNoteTimeTags(text: string): NoteTimeTags {
  const matches = [...text.matchAll(TIME_TAG_RE)];
  if (matches.length === 0) return { ok: false, reason: "none" };
  if (matches.length > 2) return { ok: false, reason: "too-many" };

  const desiredStartTime = toHour24(
    Number(matches[0][1].match(/^\d{1,2}/)?.[0]),
    Number(matches[0][2] ?? "0"),
    matches[0][3],
  );
  const desiredStartBy = matches[1]
    ? toHour24(
        Number(matches[1][1].match(/^\d{1,2}/)?.[0]),
        Number(matches[1][2] ?? "0"),
        matches[1][3],
      )
    : "";
  if (desiredStartBy && desiredStartBy <= desiredStartTime) {
    return { ok: false, reason: "order" };
  }
  return { ok: true, desiredStartTime, desiredStartBy };
}

export function noteTimeTagMessage(text: string): string | null {
  const parsed = parseNoteTimeTags(text);
  if (parsed.ok || parsed.reason === "none") return null;
  if (parsed.reason === "too-many") {
    return "A note can set one start time or a start window.";
  }
  return "The second time must be later than the first.";
}

/**
 * Earliest instant a visit of `durationMs` can start inside
 * [earliest, latest] and still finish by `windowEnd` without overlapping `busy`.
 */
export function earliestStartMs(opts: {
  earliest: number;
  latest: number;
  durationMs: number;
  windowStart: number;
  windowEnd: number;
  busy: Array<{ start: number; end: number }>;
}): number | null {
  const lastStart = Math.min(opts.latest, opts.windowEnd - opts.durationMs);
  const first = Math.max(opts.earliest, opts.windowStart);
  if (first > lastStart) return null;

  const points = [first];
  for (const block of opts.busy) {
    if (block.end > first && block.end <= lastStart) points.push(block.end);
  }
  points.sort((a, b) => a - b);

  for (const start of points) {
    if (start < first || start > lastStart) continue;
    const end = start + opts.durationMs;
    if (end > opts.windowEnd) continue;
    const hit = opts.busy.some((block) => start < block.end && end > block.start);
    if (!hit) return start;
  }
  return null;
}
