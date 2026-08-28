import {
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
  return msg.transcript?.trim() || msg.body?.trim() || "";
}

export function isSmsOrMms(
  channel: CommunicationChannel | null | undefined,
): boolean {
  return channel === "sms" || channel === "mms";
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

/**
 * L1: one row per customerRef. Identified voice-only customers still get a
 * Conversations row so you can drill to the contact. Preview is latest SMS/MMS
 * (empty so the UI shows an em-dash when voice-only). Unknown (null) is Voice
 * Threads only — do not skip identified-only voice here.
 */
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
    const latestSms = sorted.find((th) => isSmsOrMms(th.lastMessageChannel));
    groups.push({
      customerRef,
      displayName: customerDisplayName(latestSms ?? latest),
      preview: latestSms?.lastMessagePreview || "",
      lastMessageAt: latest.lastMessageAt,
      lastMessageChannel: (latestSms ?? latest).lastMessageChannel,
      lastMessageDirection: (latestSms ?? latest).lastMessageDirection,
      status: sorted.some((t) => t.status === "open") ? "open" : "closed",
      threads: sorted,
    });
  }

  groups.sort((a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt));
  return groups;
}

/**
 * L2: one row per contact/ourNumber — a contact list, not a flattened pane.
 * Do not merge all contacts into one timeline.
 */
export function uniqueContactThreads(
  threads: MessageThreadItem[],
): MessageThreadItem[] {
  const map = new Map<string, MessageThreadItem>();
  for (const thread of threads) {
    if (!thread.contactRef) continue;
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

/** Same contact/ourNumber only — used to mix SMS + voice on that contact timeline. */
export function pickReplyThread(
  threads: MessageThreadItem[],
): MessageThreadItem | null {
  const sms = threads.filter((t) => isSmsOrMms(t.lastMessageChannel));
  const pool = sms.length > 0 ? sms : threads;
  const byRecent = [...pool].sort(
    (a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt),
  );
  return byRecent.find((t) => t.status === "open") ?? byRecent[0] ?? null;
}

/** Mix SMS + voice for one contact/ourNumber. Do not use across all contacts. */
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

/**
 * Voice Threads = unknown callers only (null customerRef).
 * Identified voice lives only on that contact timeline under Conversations.
 */
export function buildVoiceCallRows(
  communications: TwilioCommunicationItem[],
  threads: MessageThreadItem[],
): VoiceCallRow[] {
  const threadById = new Map(threads.map((t) => [t._id, t]));

  if (communications.length > 0) {
    return communications
      .filter((c) => c.channel === "voice" && c.customerRef == null)
      .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
      .flatMap((c) => {
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
          null;
        if (thread?.customerRef) return [];
        return [
          {
            id: c._id,
            customerRef: null,
            displayName: "Unknown caller",
            phone: formatPhone(
              thread?.contactPhoneSnapshot || callerNumber(c),
            ),
            direction: c.direction,
            durationSeconds: c.durationSeconds,
            createdAt: c.createdAt,
            transcript: voiceTranscript(c),
            recordingUrl: c.mediaUrls[0] ?? null,
            communication: c,
            thread,
          },
        ];
      });
  }

  return threads
    .filter((t) => t.lastMessageChannel === "voice" && t.customerRef == null)
    .sort((a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt))
    .map((t) => ({
      id: t._id,
      customerRef: null,
      displayName: "Unknown caller",
      phone: formatPhone(threadPhone(t)),
      direction:
        t.lastMessageDirection === "outbound" ? "outbound" : "inbound",
      durationSeconds: null,
      createdAt: t.lastMessageAt || t.createdAt,
      transcript: "",
      recordingUrl: null,
      communication: null,
      thread: t,
    }));
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
    recordingUrl: msg.mediaUrls[0] ?? null,
    communication: msg,
    thread,
  };
}
