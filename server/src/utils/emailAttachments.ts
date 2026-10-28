export const MAX_EMAIL_ATTACHMENTS = 10;
export const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "scr",
  "pif",
  "js",
  "jse",
  "vbs",
  "vbe",
  "wsf",
  "ps1",
  "jar",
  "sh",
  "app",
  "dll",
  "cpl",
  "hta",
  "lnk",
  "reg",
]);

export type OutgoingEmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export class EmailAttachmentError extends Error {
  status = 400;
}

export function sanitizeAttachmentFilename(name: string): string {
  const base = (name || "").split(/[/\\]/).pop() || "";
  const cleaned = Array.from(base)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && ch !== '"';
    })
    .join("")
    .trim()
    .slice(0, 180);
  return cleaned || "attachment";
}

export function isBlockedAttachmentName(name: string): boolean {
  if (!name.includes(".")) return false;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BLOCKED_EXTENSIONS.has(ext);
}

export function prepareEmailAttachments(
  files: { originalname: string; buffer: Buffer; mimetype?: string; size: number }[],
): OutgoingEmailAttachment[] {
  if (files.length > MAX_EMAIL_ATTACHMENTS) {
    throw new EmailAttachmentError(`You can attach up to ${MAX_EMAIL_ATTACHMENTS} files.`);
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_EMAIL_ATTACHMENT_BYTES) {
    throw new EmailAttachmentError("Attachments must total 20 MB or less.");
  }
  return files.map((file) => {
    const filename = sanitizeAttachmentFilename(file.originalname);
    if (isBlockedAttachmentName(filename)) {
      throw new EmailAttachmentError(
        `${filename} can't be attached because that file type is blocked.`,
      );
    }
    return {
      filename,
      content: file.buffer,
      contentType:
        file.mimetype && /^[\w.+-]+\/[\w.+-]+$/.test(file.mimetype)
          ? file.mimetype
          : "application/octet-stream",
    };
  });
}

/** Multipart sends carry the JSON fields in a single `payload` field next to the files. */
export function unpackMultipartPayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const payload = (body as { payload?: unknown }).payload;
  if (typeof payload !== "string") return body as Record<string, unknown>;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new EmailAttachmentError("The email form data was malformed.");
}
