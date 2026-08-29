"use client";

import {
  VoiceTimelineLine,
  voicemailDisplayText,
} from "./conversationUtils";

export function VoiceActivityTimeline({
  lines,
  compact = false,
}: {
  lines: VoiceTimelineLine[];
  compact?: boolean;
}) {
  const events = lines.filter((line) => line.kind === "event");
  const voicemails = lines.filter((line) => line.kind === "voicemail");
  const shownEvents = compact ? events.slice(-1) : events;
  const shownVoicemails = compact ? voicemails.slice(-1) : voicemails;

  if (lines.length === 0) {
    if (compact) return null;
    return (
      <p className="text-[15px] text-neutral-500 sm:text-base">
        Transcript isn&apos;t available yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {shownEvents.length > 0 ? (
        <ol className="relative ml-1.5 border-l border-[var(--staff-border)] pl-4">
          {shownEvents.map((line, index) => (
            <li
              key={`event-${index}-${line.text.slice(0, 24)}`}
              className="relative py-1 text-[13px] leading-snug text-neutral-500"
            >
              <span className="absolute -left-[21px] top-[9px] h-2 w-2 rounded-full bg-brand-orange" />
              {line.text}
            </li>
          ))}
        </ol>
      ) : null}
      {shownVoicemails.map((line, index) => (
        <blockquote
          key={`vm-${index}-${line.text.slice(0, 24)}`}
          className="rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-2"
        >
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Voicemail
          </span>
          <p className="text-[15px] leading-relaxed text-brand-dark">
            {voicemailDisplayText(line.text)}
          </p>
        </blockquote>
      ))}
    </div>
  );
}
