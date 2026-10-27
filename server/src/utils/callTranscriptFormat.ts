export type TranscriptSentence = {
  transcript?: string | null;
  mediaChannel?: number | null;
  sentenceIndex?: number | null;
};

/** Dual-channel calls label staff as You and the other party as Customer. */
export function formatCallTranscript(
  sentences: TranscriptSentence[],
  mode: "dual" | "single",
): string {
  const ordered = [...sentences].sort(
    (left, right) => (left.sentenceIndex ?? 0) - (right.sentenceIndex ?? 0),
  );
  return ordered
    .map((sentence) => {
      const text = (sentence.transcript || "").trim();
      if (!text) return "";
      if (mode === "single") return text;
      const speaker = sentence.mediaChannel === 2 ? "Customer" : "You";
      return `${speaker}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}
