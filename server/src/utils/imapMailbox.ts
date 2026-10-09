export const SENT_FOLDER_FALLBACKS = [
  "Sent",
  "Sent Items",
  "Sent Mail",
  "[Gmail]/Sent Mail",
  "INBOX.Sent",
  "INBOX/Sent",
] as const;

export type MailboxListEntry = {
  path: string;
  name?: string;
  specialUse?: string;
};

export function resolveSentMailbox(boxes: MailboxListEntry[]): string | null {
  const special = boxes.find((box) => box.specialUse === "\\Sent" && box.path);
  if (special) return special.path;

  const byPath = new Map(
    boxes
      .filter((box) => box.path)
      .map((box) => [box.path.toLowerCase(), box.path]),
  );
  for (const name of SENT_FOLDER_FALLBACKS) {
    const hit = byPath.get(name.toLowerCase());
    if (hit) return hit;
  }

  const byName = boxes.find((box) => {
    const name = (box.name || "").toLowerCase();
    return SENT_FOLDER_FALLBACKS.some(
      (candidate) => candidate.toLowerCase() === name,
    );
  });
  return byName?.path ?? null;
}

/** Best-effort preview from a truncated raw message. Quoted-printable and
 * base64 bodies are skipped rather than shown as garbage. */
export function snippetFromPartialSource(source: Buffer | undefined): string {
  if (!source || source.length === 0) return "";
  const raw = source.toString("utf8");
  const splitAt = raw.search(/\r?\n\r?\n/);
  const body = splitAt >= 0 ? raw.slice(splitAt).replace(/^\r?\n\r?\n/, "") : "";
  const text = body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/=\r?\n/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const compact = text.replace(/\s/g, "");
  const base64ish = compact.match(/[A-Za-z0-9+/=]/g)?.length ?? 0;
  if (compact.length > 40 && base64ish / compact.length > 0.95 && !text.includes(" ")) {
    return "";
  }
  return text.slice(0, 160);
}
