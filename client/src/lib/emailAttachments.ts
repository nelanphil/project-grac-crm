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

export function isBlockedAttachmentName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return name.includes(".") && BLOCKED_EXTENSIONS.has(ext);
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Merges new files into the current list, skipping duplicates. Returns an error when a limit is hit. */
export function mergeAttachments(
  current: File[],
  incoming: File[],
): { files: File[]; error: string | null } {
  const seen = new Set(current.map(attachmentKey));
  const files = [...current];
  const blocked: string[] = [];
  for (const file of incoming) {
    if (isBlockedAttachmentName(file.name)) {
      blocked.push(file.name);
      continue;
    }
    const key = attachmentKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(file);
  }
  if (files.length > MAX_EMAIL_ATTACHMENTS) {
    return {
      files: current,
      error: `You can attach up to ${MAX_EMAIL_ATTACHMENTS} files.`,
    };
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_EMAIL_ATTACHMENT_BYTES) {
    return {
      files: current,
      error: `Attachments must total ${formatAttachmentSize(MAX_EMAIL_ATTACHMENT_BYTES)} or less.`,
    };
  }
  return {
    files,
    error:
      blocked.length > 0
        ? `${blocked.join(", ")} can't be attached because that file type is blocked.`
        : null,
  };
}
