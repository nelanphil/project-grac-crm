import {
  API_URL,
  CommunicationChannel,
  CommunicationDirection,
  MessageThreadItem,
  MessageThreadStatus,
  TwilioCommunicationItem,
} from "@/lib/api";
import {
  formatCustomerName,
  formatCustomerRecordName,
} from "@/lib/formatName";

/** Playback URL for <audio src>. SERVER puts a signed CRM path in mediaUrls[0]. */
export function crmPlaybackSrc(url: string | null | undefined): string | null {
  const raw = (url || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host === "api.twilio.com" || host.endsWith(".twilio.com")) return null;
    } catch {
      return null;
    }
    return raw;
  }
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${API_URL.replace(/\/$/, "")}${path}`;
}

/** IVR / voice activity as timeline lines (newline-separated log). */
export function voiceActivityLines(transcript: string): string[] {
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function ts(iso: string | null | undefined): number {
  if (!iso) return 0;
  const n = new Date(iso).getTime();
  return Number.isNaN(n) ? 0 : n;
}

export function formatPhone(phone: string | undefined | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return phone;
}

export function formatDuration(
  seconds: number | null | undefined,
): string {
  if (seconds == null || Number.isNaN(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return "Just now";
  if (mins >= 0 && mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours >= 0 && hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days >= 0 && days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function voiceTranscript(msg: {
  transcript?: string | null;
  body?: string | null;
}): string {
  const transcript = (msg.transcript ?? "").trim();
  if (!transcript || transcript === "Voice message") return "";
  return transcript;
}

export function smsMessages(
  messages: TwilioCommunicationItem[],
): TwilioCommunicationItem[] {
  return messages.filter((m) => m.channel !== "voice");
}

export function customerDisplayName(thread: MessageThreadItem): string {
  if (thread.customer) {
    const name = formatCustomerRecordName(thread.customer);
    if (name) return name;
  }
  const contact = formatCustomerName(
    thread.contact?.first,
    thread.contact?.last,
  );
  return contact || "Customer";
}

export function contactDisplayName(thread: MessageThreadItem): string {
  const contact = formatCustomerName(
    thread.contact?.first,
    thread.contact?.last,
  );
  if (contact) return contact;
  const phone = formatPhone(
    thread.contactPhoneSnapshot || thread.contact?.phone,
  );
  return phone || "Contact";
}

export function contactThreadKey(thread: MessageThreadItem): string {
  return `${thread.contactRef ?? "none"}::${thread.ourNumber}`;
}

export type CustomerRow = {
  customerRef: string;
  displayName: string;
  preview: string;
  lastMessageAt: string | null;
  lastMessageChannel: CommunicationChannel | null;
  lastMessageDirection: CommunicationDirection | null;
  status: MessageThreadStatus;
  threads: MessageThreadItem[];
};

/** L1: one row per customerRef. Identified voice also appears in Voice Threads. */
export function groupCustomersByRef(
  threads: MessageThreadItem[],
): CustomerRow[] {
  const buckets = new Map<string, MessageThreadItem[]>();
  for (const thread of threads) {
    if (!thread.customerRef) continue;
    const list = buckets.get(thread.customerRef);
    if (list) list.push(thread);
    else buckets.set(thread.customerRef, [thread]);
  }

  const groups: CustomerRow[] = [];
  for (const [customerRef, list] of buckets) {
    const sorted = [...list].sort(
      (a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt),
    );
    const latest = sorted[0];
    groups.push({
      customerRef,
      displayName: customerDisplayName(latest),
      preview: compactVoicePreview(
        latest.lastMessagePreview || "",
        latest.lastMessageChannel,
        latest.lastMessageDirection,
      ),
      lastMessageAt: latest.lastMessageAt,
      lastMessageChannel: latest.lastMessageChannel,
      lastMessageDirection: latest.lastMessageDirection,
      status: sorted.some((t) => t.status === "open") ? "open" : "closed",
      threads: sorted,
    });
  }

  groups.sort((a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt));
  return groups;
}

/**
 * L2: continuous conversation per contact.
 * Unique is contactRef + ourNumber — not (customerRef, ourNumber).
 */
export function uniqueContactThreads(
  threads: MessageThreadItem[],
): MessageThreadItem[] {
  const map = new Map<string, MessageThreadItem>();
  for (const thread of threads) {
    const key = contactThreadKey(thread);
    const prev = map.get(key);
    if (!prev || ts(thread.lastMessageAt) > ts(prev.lastMessageAt)) {
      map.set(key, thread);
    }
  }
  return [...map.values()].sort(
    (a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt),
  );
}

export function pickReplyThread(
  threads: MessageThreadItem[],
): MessageThreadItem | null {
  const sms = threads.filter((t) => t.lastMessageChannel !== "voice");
  const pool = sms.length > 0 ? sms : threads;
  const byRecent = [...pool].sort(
    (a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt),
  );
  return byRecent.find((t) => t.status === "open") ?? byRecent[0] ?? null;
}

export function mergeMessages(
  lists: TwilioCommunicationItem[][],
): TwilioCommunicationItem[] {
  const seen = new Set<string>();
  const merged: TwilioCommunicationItem[] = [];
  for (const list of lists) {
    for (const msg of list) {
      if (seen.has(msg._id)) continue;
      seen.add(msg._id);
      merged.push(msg);
    }
  }
  merged.sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
  return merged;
}

export type VoiceCallRow = {
  id: string;
  customerRef: string | null;
  displayName: string;
  phone: string;
  direction: CommunicationDirection;
  durationSeconds: number | null;
  createdAt: string;
  transcript: string;
  recordingUrl: string | null;
  communication: TwilioCommunicationItem | null;
  thread: MessageThreadItem | null;
};

function threadPhone(thread: MessageThreadItem): string {
  return thread.contactPhoneSnapshot || thread.contact?.phone || "";
}

function callerNumber(msg: TwilioCommunicationItem): string {
  return msg.direction === "outbound" ? msg.toNumber : msg.fromNumber;
}

export function buildVoiceCallRows(
  communications: TwilioCommunicationItem[],
  threads: MessageThreadItem[],
): VoiceCallRow[] {
  const threadById = new Map(threads.map((t) => [t._id, t]));

  if (communications.length > 0) {
    return communications
      .filter((c) => c.channel === "voice")
      .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
      .map((c) => {
        const thread =
          (c.threadRef ? threadById.get(c.threadRef) : undefined) ??
          threads.find(
            (t) =>
              Boolean(c.contactRef) &&
              t.contactRef === c.contactRef &&
              (c.toNumber === t.ourNumber || c.fromNumber === t.ourNumber),
          ) ??
          threads.find(
            (t) => Boolean(c.contactRef) && t.contactRef === c.contactRef,
          ) ??
          threads.find(
            (t) => Boolean(c.customerRef) && t.customerRef === c.customerRef,
          ) ??
          null;
        const customerRef = c.customerRef ?? thread?.customerRef ?? null;
        const unknown = !customerRef;
        return {
          id: c._id,
          customerRef,
          displayName: unknown
            ? "Unknown caller"
            : thread
              ? customerDisplayName(thread)
              : "Customer",
          phone: formatPhone(
            unknown
              ? thread?.contactPhoneSnapshot || callerNumber(c)
              : callerNumber(c) || (thread ? threadPhone(thread) : ""),
          ),
          direction: c.direction,
          durationSeconds: c.durationSeconds,
          createdAt: c.createdAt,
          transcript: voiceTranscript(c),
          recordingUrl: crmPlaybackSrc(c.mediaUrls[0]),
          communication: c,
          thread,
        };
      });
  }

  return threads
    .filter((t) => t.lastMessageChannel === "voice")
    .sort((a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt))
    .map((t) => {
      const unknown = !t.customerRef;
      return {
        id: t._id,
        customerRef: t.customerRef,
        displayName: unknown ? "Unknown caller" : customerDisplayName(t),
        phone: formatPhone(threadPhone(t)),
        direction:
          t.lastMessageDirection === "outbound" ? "outbound" : "inbound",
        durationSeconds: null,
        createdAt: t.lastMessageAt || t.createdAt,
        transcript: "",
        recordingUrl: null,
        communication: null,
        thread: t,
      };
    });
}

export function voiceRowFromMessage(
  msg: TwilioCommunicationItem,
  thread: MessageThreadItem | null,
): VoiceCallRow {
  const unknown = !msg.customerRef && !thread?.customerRef;
  return {
    id: msg._id,
    customerRef: msg.customerRef ?? thread?.customerRef ?? null,
    displayName: unknown
      ? "Unknown caller"
      : thread
        ? customerDisplayName(thread)
        : "Customer",
    phone: formatPhone(
      unknown
        ? thread?.contactPhoneSnapshot || callerNumber(msg)
        : callerNumber(msg),
    ),
    direction: msg.direction,
    durationSeconds: msg.durationSeconds,
    createdAt: msg.createdAt,
    transcript: voiceTranscript(msg),
    recordingUrl: crmPlaybackSrc(msg.mediaUrls[0]),
    communication: msg,
    thread,
  };
}

export type VoiceTimelineLine = { kind: "event" | "voicemail"; text: string };

/** Prefer SERVER transcriptLines; fall back to splitting transcript. */
export function voiceTimelineLines(
  communication: TwilioCommunicationItem | null | undefined,
  transcriptFallback: string,
): VoiceTimelineLine[] {
  const fromApi = communication?.transcriptLines;
  if (Array.isArray(fromApi) && fromApi.length > 0) {
    return fromApi
      .filter((line) => line && typeof line.text === "string" && line.text.trim())
      .map((line) => ({
        kind: line.kind === "voicemail" ? "voicemail" : "event",
        text: line.text.trim(),
      }));
  }
  return voiceActivityLines(transcriptFallback).map((text) => ({
    kind: /^voicemail:/i.test(text) ? "voicemail" : "event",
    text,
  }));
}

export function voicemailDisplayText(text: string): string {
  const stripped = text.replace(/^voicemail:\s*/i, "").trim();
  return stripped || text.trim();
}

/** Conversations list preview for voice: never dump the IVR log. */
export function compactVoicePreview(
  preview: string,
  channel: CommunicationChannel | null | undefined,
  direction: CommunicationDirection | null | undefined,
): string {
  if (channel !== "voice") return (preview || "").trim();
  const trimmed = (preview || "").trim();
  if (!trimmed) {
    return direction === "outbound" ? "Outbound call" : "Inbound call";
  }
  const needsCompact = /\n/.test(trimmed) || /^call started/i.test(trimmed);
  if (!needsCompact) {
    return trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
  }
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.some((line) => /^voicemail:/i.test(line) || /left a voicemail/i.test(line))) {
    return "Left a voicemail";
  }
  const events = lines.filter((line) => !/^voicemail:/i.test(line));
  const lastEvent = events[events.length - 1] || "";
  if (lastEvent && !/^call started/i.test(lastEvent)) {
    return lastEvent.length > 40 ? `${lastEvent.slice(0, 39)}…` : lastEvent;
  }
  return direction === "outbound" ? "Outbound call" : "Inbound call";
}
