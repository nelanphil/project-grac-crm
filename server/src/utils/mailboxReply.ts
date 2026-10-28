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

const COMPANY = {
  name: "Generator Maintenance of Florida",
  tagline: "Expert Backup Power for Central Florida",
  phone: "(386) 631-8982",
  phoneHref: "tel:+13866318982",
  email: "contact@genmaintoffl.com",
  license: "Licensed & Insured",
} as const;

export function renderBrandedReplyShell(bodyHtml: string): string {
  const content = bodyHtml.trim() || "<p></p>";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
  <tr>
    <td style="background-color:#0b1f33;padding:20px 28px;border-bottom:3px solid #f36c21;text-align:left;">
      <div style="font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;">
        ${escapeHtml(COMPANY.name)}
      </div>
      <div style="margin-top:3px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:11px;color:#f36c21;font-weight:600;">
        ${escapeHtml(COMPANY.tagline)}
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:14px;line-height:1.6;color:#231f20;">
      ${content}
    </td>
  </tr>
  <tr>
    <td style="padding:16px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif,'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';font-size:12px;color:#64748b;line-height:1.5;">
      <div style="font-weight:700;color:#0b1f33;font-size:12px;">${escapeHtml(COMPANY.name)}</div>
      <div style="margin-top:4px;">
        <a href="${COMPANY.phoneHref}" style="color:#f36c21;text-decoration:none;font-weight:600;">${escapeHtml(COMPANY.phone)}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#f36c21;text-decoration:none;">${escapeHtml(COMPANY.email)}</a>
      </div>
      <div style="margin-top:3px;font-size:11px;color:#94a3b8;">
        ${escapeHtml(COMPANY.license)} &nbsp;·&nbsp; Generac Authorized Dealer &nbsp;·&nbsp; Central Florida
      </div>
    </td>
  </tr>
</table>`;
}

export function composeReplyHtml(input: {
  mode: MailboxReplyMode;
  bodyHtml: string;
  useBrandTemplate?: boolean;
  original: {
    html: string;
    text: string;
    from: MailboxReplyAddress[];
    to: MailboxReplyAddress[];
    date: string | null;
    subject: string;
  };
}): string {
  const content = input.useBrandTemplate
    ? renderBrandedReplyShell(input.bodyHtml)
    : input.bodyHtml;
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
    return `${content}<br><div style="max-width:640px;margin:16px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;"><p style="margin:0 0 6px 0;">${header}</p>${original}</div>`;
  }
  const who = formatMailboxAddress(input.original.from) || "someone";
  const when = formatQuoteDate(input.original.date);
  const intro = when ? `On ${when}, ${who} wrote:` : `${who} wrote:`;
  return `${content}<br><div style="max-width:640px;margin:16px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;"><p style="margin:0 0 6px 0;">${escapeHtml(intro)}</p>${original}</div>`;
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
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}): Buffer {
  const boundary = `grac-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const attachments = input.attachments ?? [];
  const mixedBoundary = `${boundary}-mixed`;
  const headerLines = [`From: ${input.from}`, `To: ${input.to.join(", ")}`];
  if (input.cc.length > 0) headerLines.push(`Cc: ${input.cc.join(", ")}`);
  headerLines.push(`Subject: ${encodeHeader(input.subject)}`);
  headerLines.push(`Date: ${(input.date ?? new Date()).toUTCString()}`);
  if (input.messageId?.trim()) {
    headerLines.push(`Message-ID: ${normalizeMessageId(input.messageId)}`);
  }
  headerLines.push("MIME-Version: 1.0");
  headerLines.push(
    attachments.length > 0
      ? `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
      : `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (!value.trim()) continue;
    headerLines.push(`${key}: ${value}`);
  }
  const textPart = wrapBase64(Buffer.from(input.text, "utf8").toString("base64"));
  const htmlPart = wrapBase64(Buffer.from(input.html, "utf8").toString("base64"));
  const alternative = [
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
  if (attachments.length === 0) {
    return Buffer.from(`${headerLines.join("\r\n")}\r\n\r\n${alternative}`, "utf8");
  }
  const parts = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    alternative,
  ];
  for (const file of attachments) {
    const name = encodeHeader(file.filename.replace(/["\r\n]/g, ""));
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${file.contentType || "application/octet-stream"}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      wrapBase64(file.content.toString("base64")),
    );
  }
  parts.push(`--${mixedBoundary}--`, "");
  return Buffer.from(`${headerLines.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`, "utf8");
}
