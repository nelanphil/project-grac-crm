import { parseFutureScheduledAt, ScheduledAtError } from "./scheduledEmail";

export const MAX_INBOX_MEDIA = 10;
export const MAX_INBOX_MEDIA_URL_LENGTH = 2000;
/** One year. Scheduled inbox texts cannot be booked past this. */
export const MAX_INBOX_SCHEDULE_MS = 365 * 24 * 60 * 60 * 1000;

const CLOUDINARY_HOST = "res.cloudinary.com";

export class InboxSmsInputError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "InboxSmsInputError";
  }
}

export function parseInboxScheduledAt(raw: unknown): Date {
  if (typeof raw !== "string") {
    throw new ScheduledAtError("Invalid scheduledAt");
  }
  const date = parseFutureScheduledAt(raw);
  if (date.getTime() > Date.now() + MAX_INBOX_SCHEDULE_MS) {
    throw new ScheduledAtError("Scheduled time must be within the next year");
  }
  return date;
}

/** Inbox rows are sent back into the conversation. Everything else is a campaign. */
export function scheduledMessageRoute(row: {
  inboxConversationRef?: unknown;
}): "inbox" | "campaign" {
  return row.inboxConversationRef ? "inbox" : "campaign";
}

export function inboxSendPreview(body: string, mediaCount: number): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text) return text;
  if (mediaCount > 0) return "[Attachment]";
  return "";
}

export function normalizeInboxMediaUrls(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new InboxSmsInputError("Attachments must be a list of uploaded files");
  }
  if (raw.length > MAX_INBOX_MEDIA) {
    throw new InboxSmsInputError(`Attach ${MAX_INBOX_MEDIA} files or fewer`);
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new InboxSmsInputError("Each attachment must be an uploaded file");
    }
    const url = item.trim();
    if (!url) continue;
    if (url.length > MAX_INBOX_MEDIA_URL_LENGTH) {
      throw new InboxSmsInputError("Attachment link is too long");
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InboxSmsInputError("Attachment link is invalid");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== CLOUDINARY_HOST) {
      throw new InboxSmsInputError("Attachments must be uploaded files");
    }
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}
