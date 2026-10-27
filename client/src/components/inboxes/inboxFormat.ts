import { InboxConversationItem, InboxTimelineMessage } from "@/lib/api";

const PALETTE = [
  "#e85d4c",
  "#e09f3e",
  "#2a9d8f",
  "#3a86ff",
  "#7b2cbf",
  "#f77f00",
  "#2d6a4f",
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((part) => /[A-Za-z]/.test(part));
  if (words.length >= 2) {
    return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  }
  if (words.length === 1) {
    const letters = words[0].replace(/[^A-Za-z]/g, "");
    if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
    if (letters.length === 1) return letters.toUpperCase();
  }
  const digits = name.replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

export function conversationPreview(item: InboxConversationItem): string {
  if (item.lastChannel === "voice") {
    return item.lastDirection === "outbound" ? "You called" : "Called you";
  }
  const text =
    item.lastPreview ||
    (item.lastChannel === "email" ? "Email" : item.lastChannel === "mms" ? "Photo" : "");
  if (!text) return "";
  if (item.lastDirection === "outbound") return `You: ${text}`;
  return text;
}

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function moneyCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

export function moneyDollars(amount: number): string {
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

/** Collapse an HTML email into readable text for the folded preview. */
export function emailPlainText(value: string): string {
  if (!value) return "";
  if (!looksLikeHtml(value)) return value.trim();
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Keep the message body when a stored HTML document includes a full page. */
export function emailDisplayHtml(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (body ? body[1] : html).trim();
}

function markdownStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function callLength(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return ` (${rest}s)`;
  return ` (${minutes}m ${rest}s)`;
}

export function conversationMarkdown(
  item: InboxConversationItem,
  messages: InboxTimelineMessage[],
): string {
  const lines = [
    `# ${item.displayName || item.phone || item.email || "Conversation"}`,
  ];
  if (item.phone) lines.push(item.phone);
  if (item.email) lines.push(item.email);
  lines.push("");
  for (const message of messages) {
    if (message.channel === "voice") {
      const who = message.direction === "outbound" ? "You called" : "Called you";
      lines.push(`**${who}**${callLength(message.durationSeconds)} (${markdownStamp(message.at)})`);
      const spoken = (message.transcript || message.body || "").trim();
      if (spoken && spoken !== "Voice message") lines.push(spoken);
      lines.push("");
      continue;
    }
    const who =
      message.direction === "outbound"
        ? message.senderName || "You"
        : item.displayName || "Customer";
    const body =
      message.channel === "email"
        ? [message.subject, message.body].filter(Boolean).join("\n")
        : message.body;
    lines.push(`**${who}** (${markdownStamp(message.at)}): ${body || ""}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
