export type SmsOptOutKind = "keyword" | "phrase" | "start";

export type SmsOptOutClassification = {
  kind: SmsOptOutKind;
  matched: string;
};

const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
]);

const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);

/** Looser requests that staff confirm before texts are turned off. */
const OPT_OUT_PHRASES: RegExp[] = [
  /\bstop\s+(texting|messaging|text messages|texts|messages)\b/,
  /\bstop\s+sending\b/,
  /\bunsubscribe(\s+me)?\b/,
  /\bremove\s+me\b/,
  /\b(do not|don't|dont)\s+(text|message|contact)\s+me\b/,
  /\bno\s+more\s+(texts|text messages|messages)\b/,
];

function lettersOnly(body: string): string {
  return body.trim().toUpperCase().replace(/[^A-Z]/g, "");
}

/**
 * Exact opt-out and opt-in keywords are the whole message, ignoring case and
 * punctuation. Longer requests stay suggestions until a person confirms them.
 */
export function classifySmsOptOut(body: string): SmsOptOutClassification | null {
  const raw = body.trim();
  if (!raw) return null;

  const keyword = lettersOnly(raw);
  if (keyword && OPT_OUT_KEYWORDS.has(keyword)) {
    return { kind: "keyword", matched: keyword };
  }
  if (keyword && START_KEYWORDS.has(keyword)) {
    return { kind: "start", matched: keyword };
  }

  const lower = raw.toLowerCase();
  for (const pattern of OPT_OUT_PHRASES) {
    const match = pattern.exec(lower);
    if (match) {
      return { kind: "phrase", matched: match[0] };
    }
  }
  return null;
}
