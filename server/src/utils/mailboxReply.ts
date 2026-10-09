export type MailboxReplyAddress = {
  name: string;
  address: string;
};

export type MailboxReplyMode = "reply" | "replyAll" | "forward";
export type MailboxReplyFolder = "inbox" | "sent";

export function normalizeMessageId(value: string): string {
  const trimmed = value.trim().replace(/^<|>$/g, "");
  if (!trimmed) return "";
  return `<${trimmed}>`;
}

/** Stable CRM key for a mailbox message. Message-ID survives moves; UID does not. */
export function assignmentMessageKey(
  messageId: string,
  folder: string,
  uid: number,
): string {
  const normalized = normalizeMessageId(messageId);
  if (normalized) return normalized;
  return `uid:${folder}:${uid}`;
}

export function replySubject(subject: string, mode: MailboxReplyMode): string {
  const base = subject.trim() || "(no subject)";
  if (mode === "forward") {
    return /^fwd:/i.test(base) ? base : `Fwd: ${base}`;
  }
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

function dedupeAddresses(
  list: MailboxReplyAddress[],
  exclude: Set<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const address = item.address.trim();
    const key = address.toLowerCase();
    if (!key || exclude.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

export function defaultRecipients(input: {
  mode: MailboxReplyMode;
  folder: MailboxReplyFolder;
  from: MailboxReplyAddress[];
  to: MailboxReplyAddress[];
  cc: MailboxReplyAddress[];
  ownAddress: string;
}): { to: string[]; cc: string[] } {
  if (input.mode === "forward") return { to: [], cc: [] };
  const own = input.ownAddress.trim().toLowerCase();
  const exclude = new Set(own ? [own] : []);
  const primary = input.folder === "sent" ? input.to : input.from;
  const to = dedupeAddresses(primary, exclude);
  if (input.mode === "reply") return { to, cc: [] };
  const taken = new Set([
    ...exclude,
    ...to.map((address) => address.toLowerCase()),
  ]);
  const cc = dedupeAddresses(
    [...input.from, ...input.to, ...input.cc],
    taken,
  );
  return { to, cc };
}

export const RECEIPT_REPLY_HTML =
  "<p>Thanks for your email. We received it and someone will respond soon.</p>";

export function isAutomatedMailboxSender(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) return true;
  const local = value.split("@")[0] ?? "";
  return (
    local === "mailer-daemon" ||
    local === "postmaster" ||
    local.startsWith("noreply") ||
    local.startsWith("no-reply") ||
    local.startsWith("do-not-reply")
  );
}

/** True only for real inbound mail that arrived after the receipt switch was turned on. */
export function shouldSendReceiptReply(input: {
  enabledAt: Date | null;
  messageDate: string | null;
  from: { address: string }[];
  ownAddresses: string[];
  subject: string;
}): boolean {
  if (!input.enabledAt) return false;
  if (!input.messageDate) return false;
  const sentAt = new Date(input.messageDate);
  if (Number.isNaN(sentAt.getTime()) || sentAt < input.enabledAt) return false;
  const own = new Set(
    input.ownAddresses.map((address) => address.trim().toLowerCase()).filter(Boolean),
  );
  const from = input.from
    .map((item) => item.address.trim().toLowerCase())
    .filter(Boolean);
  if (from.length === 0) return false;
  if (from.every((address) => own.has(address) || isAutomatedMailboxSender(address))) {
    return false;
  }
  if (
    /^(auto:|automatic reply|out of office|undeliverable|undelivered)/i.test(
      input.subject.trim(),
    )
  ) {
    return false;
  }
  return true;
}

export function newlyTaggedUserIds(
  previous: string[],
  next: string[],
  actorId: string,
): string[] {
  const prev = new Set(previous);
  const actor = actorId.trim();
  const seen = new Set<string>();
  const added: string[] = [];
  for (const id of next) {
    const value = id.trim();
    if (!value || value === actor || prev.has(value) || seen.has(value)) continue;
    seen.add(value);
    added.push(value);
  }
  return added;
}

export function isBlankHtml(html: string): boolean {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .trim();
  return text.length === 0;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatMailboxAddress(list: MailboxReplyAddress[]): string {
  if (list.length === 0) return "";
  return list
    .map((item) => {
      const address = item.address.trim();
      const name = item.name.trim();
      if (!address) return "";
      return name ? `${name} <${address}>` : address;
    })
    .filter(Boolean)
    .join(", ");
}

function quoteBodyHtml(html: string, text: string): string {
  const body = html.trim()
    ? html
    : `<pre style="white-space:pre-wrap;font-family:sans-serif">${escapeHtml(text)}</pre>`;
  return `<blockquote style="margin:8px 0 0;padding-left:12px;border-left:2px solid #cccccc">${body}</blockquote>`;
}

function formatQuoteDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toUTCString();
}

export function composeReplyHtml(input: {
  mode: MailboxReplyMode;
  bodyHtml: string;
  original: {
    html: string;
    text: string;
    from: MailboxReplyAddress[];
    to: MailboxReplyAddress[];
    date: string | null;
    subject: string;
  };
}): string {
  const original = quoteBodyHtml(input.original.html, input.original.text);
  if (input.mode === "forward") {
    const header = [
      "---------- Forwarded message ---------",
      `From: ${formatMailboxAddress(input.original.from) || "Unknown"}`,
      `Date: ${formatQuoteDate(input.original.date) || "Unknown"}`,
      `Subject: ${input.original.subject || "(no subject)"}`,
      `To: ${formatMailboxAddress(input.original.to) || "Unknown"}`,
    ]
      .map((line) => escapeHtml(line))
      .join("<br>");
    return `${input.bodyHtml}<br><p>${header}</p>${original}`;
  }
  const who = formatMailboxAddress(input.original.from) || "someone";
  const when = formatQuoteDate(input.original.date);
  const intro = when ? `On ${when}, ${who} wrote:` : `${who} wrote:`;
  return `${input.bodyHtml}<br><p>${escapeHtml(intro)}</p>${original}`;
}

export function threadingHeaders(input: {
  messageId: string;
  references: string[];
}): Record<string, string> {
  const id = normalizeMessageId(input.messageId);
  if (!id) return {};
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const value of [...input.references, input.messageId]) {
    const normalized = normalizeMessageId(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    refs.push(normalized);
  }
  return {
    "In-Reply-To": id,
    References: refs.join(" "),
  };
}

function wrapBase64(value: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += 76) {
    chunks.push(value.slice(i, i + 76));
  }
  return chunks.join("\r\n");
}

function encodeHeader(value: string): string {
  if (/^[\t\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildRfc822Message(input: {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  messageId?: string;
  date?: Date;
}): Buffer {
  const boundary = `grac-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const headerLines = [`From: ${input.from}`, `To: ${input.to.join(", ")}`];
  if (input.cc.length > 0) headerLines.push(`Cc: ${input.cc.join(", ")}`);
  headerLines.push(`Subject: ${encodeHeader(input.subject)}`);
  headerLines.push(`Date: ${(input.date ?? new Date()).toUTCString()}`);
  if (input.messageId?.trim()) {
    headerLines.push(`Message-ID: ${normalizeMessageId(input.messageId)}`);
  }
  headerLines.push("MIME-Version: 1.0");
  headerLines.push(
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (!value.trim()) continue;
    headerLines.push(`${key}: ${value}`);
  }
  const textPart = wrapBase64(Buffer.from(input.text, "utf8").toString("base64"));
  const htmlPart = wrapBase64(Buffer.from(input.html, "utf8").toString("base64"));
  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    textPart,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return Buffer.from(`${headerLines.join("\r\n")}\r\n\r\n${body}`, "utf8");
}
