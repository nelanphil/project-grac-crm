export type VoiceTranscriptLineKind = "event" | "voicemail";

export type VoiceTranscriptLine = {
  kind: VoiceTranscriptLineKind;
  text: string;
};

const PREVIEW_LENGTH = 160;

export function isVoicemailLine(line: string): boolean {
  return /^voicemail:/i.test(line.trim());
}

export function previewVoiceBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length <= PREVIEW_LENGTH
    ? trimmed
    : `${trimmed.slice(0, PREVIEW_LENGTH - 1)}…`;
}

export function formatVoicemailLine(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/^voicemail:/i.test(trimmed)) return trimmed;
  return `Voicemail: ${trimmed}`;
}

/** Split the stored newline activity log for the public messaging payload. */
export function toTranscriptLines(transcript: string): VoiceTranscriptLine[] {
  return (transcript || "")
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({
      kind: isVoicemailLine(text) ? "voicemail" : "event",
      text,
    }));
}

/**
 * Conversations-list label for inbound voice. Never the full IVR log.
 * Prefer "Left a voicemail" when a voicemail line exists; otherwise the
 * latest event, or "Inbound call".
 */
export function voiceConversationPreview(transcript: string): string {
  const lines = (transcript || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.some(isVoicemailLine)) return "Left a voicemail";
  if (lines.length === 0) return "Inbound call";
  const last = lines[lines.length - 1].replace(/\.+$/, "");
  if (!last || last.length > 80) return "Inbound call";
  return last;
}

/** Newline-separated activity log. Replaces an existing Voicemail: line in place. */
export function mergeVoiceActivity(existing: string, line: string): string {
  const prev = (existing || "").trim();
  const next = (line || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  const lines = prev
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (isVoicemailLine(next)) {
    const idx = lines.findIndex(isVoicemailLine);
    if (idx >= 0) {
      if (lines[idx] === next) return lines.join("\n");
      lines[idx] = next;
      return lines.join("\n");
    }
    const unprefixed = next.replace(/^voicemail:\s*/i, "");
    if (
      unprefixed &&
      lines.some(
        (entry) =>
          entry === unprefixed ||
          entry.replace(/^voicemail:\s*/i, "") === unprefixed,
      )
    ) {
      return prev;
    }
  }

  if (lines.includes(next)) return prev;
  return `${prev}\n${next}`;
}
