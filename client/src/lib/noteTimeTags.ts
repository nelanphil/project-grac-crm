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

export function timeTagLabels(content: string): string[] {
  return [...content.matchAll(TIME_TAG_RE)].map((match) => `@${match[1]}`);
}

export type TimeTokenChoice = { label: string; token: string };

function clockLabel(hour12: number, minute: number, ampm: "AM" | "PM"): TimeTokenChoice {
  const mm = String(minute).padStart(2, "0");
  return {
    label: `${hour12}:${mm} ${ampm}`,
    token: `@${hour12}:${mm}${ampm}`,
  };
}

/** Latest completed time tag before the @ currently being typed. A second tag must be later. */
export function earlierTimeFloor(textBeforeAt: string): string {
  const count = [...textBeforeAt.matchAll(TIME_TAG_RE)].length;
  if (count !== 1) return "";
  const parsed = parseNoteTimeTags(textBeforeAt);
  return parsed.ok ? parsed.desiredStartTime : "";
}

/**
 * Times consistent with what has been typed so far.
 * `9` offers 9:00, `9:3` offers 9:30–9:39, and `9:34` offers 9:34.
 * `notBefore` drops anything that is not later than the first tag.
 */
export function suggestTimeTokens(
  query: string,
  notBefore = "",
): TimeTokenChoice[] {
  const match = query.match(/^(\d{1,2})(?::([0-5]?\d?)?)?\s*([ap]m?)?$/i);
  if (!match) return [];
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return [];
  const hasColon = query.includes(":");
  const minutePrefix = match[2] ?? "";
  const meridian = match[3]?.toLowerCase();
  const meridians: Array<"AM" | "PM"> = meridian?.startsWith("a")
    ? ["AM"]
    : meridian?.startsWith("p")
      ? ["PM"]
      : ["AM", "PM"];

  const choices: TimeTokenChoice[] = [];
  for (const ampm of meridians) {
    let minutes: number[];
    if (!hasColon) {
      const quarters = [0, 15, 30, 45].filter(
        (minute) => toHour24(hour, minute, ampm) > notBefore,
      );
      minutes = quarters.includes(0) ? [0] : quarters;
    } else if (minutePrefix.length >= 2) {
      minutes = [Number(minutePrefix)];
    } else if (minutePrefix.length === 1) {
      const tens = Number(minutePrefix) * 10;
      minutes = Array.from({ length: 10 }, (_, index) => tens + index);
    } else {
      minutes = Array.from({ length: 60 }, (_, index) => index);
    }
    for (const minute of minutes) {
      if (toHour24(hour, minute, ampm) <= notBefore) continue;
      choices.push(clockLabel(hour, minute, ampm));
    }
  }
  return choices;
}

export function winningDesiredWindow(
  notes: Array<{ content: string; updatedAt: string }>,
): { desiredStartTime: string; desiredStartBy: string } {
  const ordered = [...notes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  for (const note of ordered) {
    const parsed = parseNoteTimeTags(note.content);
    if (parsed.ok) {
      return {
        desiredStartTime: parsed.desiredStartTime,
        desiredStartBy: parsed.desiredStartBy,
      };
    }
  }
  return { desiredStartTime: "", desiredStartBy: "" };
}
