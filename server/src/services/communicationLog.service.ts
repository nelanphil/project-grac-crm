import { Types } from "mongoose";
import { ContactFormSubmission } from "../models/mongo/ContactFormSubmission";
import { Customer } from "../models/mongo/Customer";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { assignThreadKeys } from "../utils/mailboxThread";
import { normalizeMessageId } from "../utils/mailboxReply";

export const LOG_CHANNELS = [
  "sms",
  "mms",
  "voice",
  "email",
  "contact-form",
] as const;
export type LogChannel = (typeof LOG_CHANNELS)[number];

export const LOG_SOURCES = [
  "wizard",
  "invoice",
  "auto-reply",
  "inbox",
  "website-form",
  "mailbox-form",
] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export type LogActor = "customer" | "staff" | "system";
export type LogDirection = "inbound" | "outbound";
export type LogThreadStatus = "replied" | "no-reply" | "inbound-only";

const PREVIEW_LIMIT = 160;
const PAGE_SIZES = new Set([25, 50, 100]);
const EXTRA_EMAIL_LIMIT = 1000;
const EXTRA_MESSAGE_LIMIT = 2000;
const EXTRA_FORM_LIMIT = 500;

export type CommunicationLogItem = {
  id: string;
  at: Date;
  direction: LogDirection;
  channel: LogChannel;
  subject: string;
  preview: string;
  status: string;
  source: LogSource;
  from: string;
  to: string;
  customerRef: string | null;
  /** Name to show when the person is not a customer. */
  party: string;
  /** Phone or email of the other person. */
  handle: string;
  /** Texts and calls. Emails and forms get a key while grouping. */
  groupKey: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  providerMessageId: string;
  inMonth: boolean;
  emailId: string | null;
  actor: LogActor;
};

export type CommunicationLogEntry = {
  id: string;
  at: string;
  direction: LogDirection;
  channel: LogChannel;
  subject: string;
  preview: string;
  status: string;
  source: LogSource;
  from: string;
  to: string;
  inMonth: boolean;
  emailId: string | null;
  actor: LogActor;
};

export type CommunicationLogThread = {
  id: string;
  customerRef: string | null;
  customerName: string;
  handle: string;
  channels: LogChannel[];
  firstOutboundAt: string | null;
  firstReplyAt: string | null;
  lastActivityAt: string;
  messageCount: number;
  replyCount: number;
  status: LogThreadStatus;
  entries: CommunicationLogEntry[];
};

export type CommunicationLogChannelSummary = {
  outbound: number;
  inbound: number;
};

export type CommunicationLogSummary = {
  outbound: number;
  inbound: number;
  threads: number;
  repliedThreads: number;
  replyRate: number;
  byChannel: Record<LogChannel, CommunicationLogChannelSummary>;
};

export type CommunicationLogResult = {
  threads: CommunicationLogThread[];
  total: number;
  page: number;
  pageSize: number;
  summary: CommunicationLogSummary;
};

export type CommunicationLogFilters = {
  channel?: LogChannel | "";
  direction?: LogDirection | "";
  repliedOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  customerNames?: Map<string, string>;
};

type TwilioRow = {
  _id: Types.ObjectId;
  channel: "sms" | "mms" | "voice";
  direction: LogDirection;
  status: string;
  fromNumber: string;
  toNumber: string;
  body?: string;
  transcript?: string;
  callSummary?: string;
  customerRef?: Types.ObjectId | null;
  threadRef?: Types.ObjectId | null;
  invoiceRef?: Types.ObjectId | null;
  createdByUserRef?: Types.ObjectId | null;
  autoReply?: string;
  sendSource?: string;
  createdAt: Date;
};

type EmailRow = {
  _id: Types.ObjectId;
  direction: LogDirection;
  fromName?: string;
  fromEmail: string;
  toEmail: string;
  subject?: string;
  body?: string;
  status: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  providerMessageId?: string | null;
  mailboxFolder?: string;
  customerRef?: Types.ObjectId | null;
  templateRef?: Types.ObjectId | null;
  invoiceRef?: Types.ObjectId | null;
  createdByUserRef?: Types.ObjectId | null;
  createdAt: Date;
};

type FormRow = {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  message: string;
  source: "website" | "mailbox-import";
  providerMessageId?: string;
  createdAt: Date;
};

export function twilioLogMeta(input: {
  direction: LogDirection;
  autoReply?: string;
  sendSource?: string;
  invoiceRef?: unknown;
  createdByUserRef?: unknown;
}): { source: LogSource; actor: LogActor } {
  if (input.direction === "inbound") return { source: "inbox", actor: "customer" };
  if (input.autoReply) return { source: "auto-reply", actor: "system" };
  if (input.sendSource === "wizard") return { source: "wizard", actor: "system" };
  if (input.invoiceRef) {
    return {
      source: "invoice",
      actor: input.createdByUserRef ? "staff" : "system",
    };
  }
  if (input.createdByUserRef) return { source: "inbox", actor: "staff" };
  return { source: "inbox", actor: "system" };
}

export function emailLogMeta(input: {
  direction: LogDirection;
  mailboxFolder?: string;
  templateRef?: unknown;
  invoiceRef?: unknown;
  createdByUserRef?: unknown;
}): { source: LogSource; actor: LogActor } {
  if (input.direction === "inbound") return { source: "inbox", actor: "customer" };
  if (input.invoiceRef) {
    return {
      source: "invoice",
      actor: input.createdByUserRef ? "staff" : "system",
    };
  }
  if (input.mailboxFolder === "sent" && !input.templateRef) {
    return {
      source: "inbox",
      actor: input.createdByUserRef ? "staff" : "system",
    };
  }
  return {
    source: "wizard",
    actor: input.createdByUserRef ? "staff" : "system",
  };
}

function emptyChannelCounts(): Record<LogChannel, CommunicationLogChannelSummary> {
  return {
    sms: { outbound: 0, inbound: 0 },
    mms: { outbound: 0, inbound: 0 },
    voice: { outbound: 0, inbound: 0 },
    email: { outbound: 0, inbound: 0 },
    "contact-form": { outbound: 0, inbound: 0 },
  };
}

function previewText(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_LIMIT) return flat;
  return `${flat.slice(0, PREVIEW_LIMIT - 1)}…`;
}

function refId(value: Types.ObjectId | null | undefined): string | null {
  if (!value) return null;
  return String(value);
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function idKeys(value: string): string[] {
  const normalized = normalizeMessageId(value);
  if (!normalized) return [];
  return [normalized, normalized.slice(1, -1)];
}

export function phoneGroupKey(
  direction: LogDirection,
  fromNumber: string,
  toNumber: string,
  threadRef: string | null,
): string {
  if (threadRef) return `thread:${threadRef}`;
  const ours = direction === "outbound" ? fromNumber : toNumber;
  const theirs = direction === "outbound" ? toNumber : fromNumber;
  const ourDigits = digits(ours);
  const theirDigits = digits(theirs);
  return `pair:${ourDigits || ours}:${theirDigits || theirs}`;
}

function toEntry(item: CommunicationLogItem): CommunicationLogEntry {
  return {
    id: item.id,
    at: item.at.toISOString(),
    direction: item.direction,
    channel: item.channel,
    subject: item.subject,
    preview: item.preview,
    status: item.status,
    source: item.source,
    from: item.from,
    to: item.to,
    inMonth: item.inMonth,
    emailId: item.emailId,
    actor: item.actor,
  };
}

/**
 * A mailbox-imported contact form is the same inbound email. Keep the form
 * and drop the inbox copy. If only the email fell in this month, the form
 * still counts for the month.
 */
export function dedupeMailboxForms(
  items: CommunicationLogItem[],
): CommunicationLogItem[] {
  const formsByKey = new Map<string, CommunicationLogItem>();
  for (const item of items) {
    if (item.channel !== "contact-form" || item.source !== "mailbox-form") continue;
    for (const key of idKeys(item.providerMessageId)) formsByKey.set(key, item);
  }
  if (formsByKey.size === 0) return items;

  const formInMonth = new Set<string>();
  const kept: CommunicationLogItem[] = [];
  for (const item of items) {
    if (item.channel === "email") {
      const keys = [
        ...idKeys(item.messageId),
        ...idKeys(item.providerMessageId),
      ];
      const form = keys
        .map((key) => formsByKey.get(key))
        .find((match) => match !== undefined);
      if (form) {
        if (item.inMonth) formInMonth.add(form.id);
        continue;
      }
    }
    kept.push(item);
  }

  return kept.map((item) =>
    formInMonth.has(item.id) && !item.inMonth
      ? { ...item, inMonth: true }
      : item,
  );
}

function threadKeyFor(
  item: CommunicationLogItem,
  emailKeys: Map<string, string>,
): string {
  if (item.channel === "contact-form") return `form:${item.id}`;
  if (item.channel === "email") return emailKeys.get(item.id) ?? `email:${item.id}`;
  return item.groupKey || `solo:${item.id}`;
}

function latestInMonth(items: CommunicationLogItem[]): CommunicationLogItem | null {
  let latest: CommunicationLogItem | null = null;
  for (const item of items) {
    if (!item.inMonth) continue;
    if (!latest || item.at.getTime() > latest.at.getTime()) latest = item;
  }
  return latest;
}

function buildThread(
  id: string,
  items: CommunicationLogItem[],
  customerNames: Map<string, string>,
): CommunicationLogThread | null {
  const inMonth = items.filter((item) => item.inMonth);
  if (inMonth.length === 0) return null;

  const entries = [...items].sort((left, right) => {
    const delta = left.at.getTime() - right.at.getTime();
    if (delta !== 0) return delta;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const outbound = entries.filter((item) => item.direction === "outbound");
  const firstOutbound = outbound[0] ?? null;
  const firstReply = firstOutbound
    ? entries.find(
        (item) =>
          item.direction === "inbound" &&
          item.at.getTime() >= firstOutbound.at.getTime(),
      )
    : undefined;
  const replyCount = firstOutbound
    ? entries.filter(
        (item) =>
          item.direction === "inbound" &&
          item.at.getTime() >= firstOutbound.at.getTime(),
      ).length
    : 0;
  const status: LogThreadStatus = !firstOutbound
    ? "inbound-only"
    : firstReply
      ? "replied"
      : "no-reply";

  const anchor = latestInMonth(items) ?? entries[entries.length - 1];
  const customerRef =
    [...entries].reverse().find((item) => item.customerRef)?.customerRef ?? null;
  const named = customerRef ? customerNames.get(customerRef)?.trim() : "";
  const party =
    [...entries].reverse().find((item) => item.party.trim())?.party.trim() ?? "";
  const handle =
    [...entries].reverse().find((item) => item.handle.trim())?.handle.trim() ??
    "";
  const channels: LogChannel[] = [];
  for (const channel of LOG_CHANNELS) {
    if (entries.some((item) => item.channel === channel)) channels.push(channel);
  }

  return {
    id,
    customerRef,
    customerName: named || party || handle || "Unknown",
    handle: handle || party,
    channels,
    firstOutboundAt: firstOutbound ? firstOutbound.at.toISOString() : null,
    firstReplyAt: firstReply ? firstReply.at.toISOString() : null,
    lastActivityAt: anchor.at.toISOString(),
    messageCount: entries.length,
    replyCount,
    status,
    entries: entries.map(toEntry),
  };
}

function matchesSearch(thread: CommunicationLogThread, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    thread.customerName,
    thread.handle,
    ...thread.entries.flatMap((entry) => [
      entry.subject,
      entry.preview,
      entry.from,
      entry.to,
    ]),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

function summarize(threads: CommunicationLogThread[]): CommunicationLogSummary {
  const byChannel = emptyChannelCounts();
  let outbound = 0;
  let inbound = 0;
  let repliedThreads = 0;
  let outboundThreads = 0;
  for (const thread of threads) {
    if (thread.status === "replied") repliedThreads += 1;
    if (thread.status === "replied" || thread.status === "no-reply") {
      outboundThreads += 1;
    }
    for (const entry of thread.entries) {
      if (!entry.inMonth) continue;
      if (entry.direction === "outbound") {
        outbound += 1;
        byChannel[entry.channel].outbound += 1;
      } else {
        inbound += 1;
        byChannel[entry.channel].inbound += 1;
      }
    }
  }
  return {
    outbound,
    inbound,
    threads: threads.length,
    repliedThreads,
    replyRate:
      outboundThreads === 0
        ? 0
        : Math.round((100 * repliedThreads) / outboundThreads),
    byChannel,
  };
}

/** Group already-loaded messages. No database access, so tests can call it directly. */
export function groupCommunicationLog(
  items: CommunicationLogItem[],
  filters: CommunicationLogFilters = {},
): CommunicationLogResult {
  const pageSize = PAGE_SIZES.has(filters.pageSize ?? 0)
    ? (filters.pageSize as number)
    : 25;
  const page = Math.max(1, filters.page ?? 1);
  const names = filters.customerNames ?? new Map<string, string>();
  const deduped = dedupeMailboxForms(
    items.filter((item) => !Number.isNaN(item.at.getTime())),
  );

  const emails = deduped.filter((item) => item.channel === "email");
  const emailThreadKeys = assignThreadKeys(
    emails.map((item) => ({
      id: item.id,
      messageId: item.messageId,
      inReplyTo: item.inReplyTo,
      references: item.references,
    })),
  );
  const emailKeys = new Map<string, string>();
  emails.forEach((item, index) => {
    emailKeys.set(item.id, `email:${emailThreadKeys[index]}`);
  });

  const grouped = new Map<string, CommunicationLogItem[]>();
  for (const item of deduped) {
    const key = threadKeyFor(item, emailKeys);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }

  const threads = [...grouped.entries()]
    .map(([id, group]) => buildThread(id, group, names))
    .filter((thread): thread is CommunicationLogThread => thread !== null)
    .sort((left, right) => {
      const delta =
        new Date(right.lastActivityAt).getTime() -
        new Date(left.lastActivityAt).getTime();
      if (delta !== 0) return delta;
      return left.id < right.id ? -1 : 1;
    });

  const summary = summarize(threads);
  const filtered = threads.filter((thread) => {
    if (
      filters.channel &&
      !thread.entries.some(
        (entry) => entry.inMonth && entry.channel === filters.channel,
      )
    ) {
      return false;
    }
    if (
      filters.direction &&
      !thread.entries.some(
        (entry) => entry.inMonth && entry.direction === filters.direction,
      )
    ) {
      return false;
    }
    if (filters.repliedOnly && thread.status !== "replied") return false;
    return matchesSearch(thread, filters.search ?? "");
  });

  const start = (page - 1) * pageSize;
  return {
    threads: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    summary,
  };
}

function twilioItem(row: TwilioRow, inMonth: boolean): CommunicationLogItem {
  const meta = twilioLogMeta(row);
  const threadRef = refId(row.threadRef);
  const theirs =
    row.direction === "outbound" ? row.toNumber : row.fromNumber;
  const previewSource =
    row.channel === "voice"
      ? row.callSummary || row.transcript || row.body || ""
      : row.body || "";
  return {
    id: String(row._id),
    at: row.createdAt,
    direction: row.direction,
    channel: row.channel,
    subject: row.channel === "voice" ? "Phone call" : "",
    preview: previewText(previewSource),
    status: row.status,
    source: meta.source,
    from: row.fromNumber,
    to: row.toNumber,
    customerRef: refId(row.customerRef),
    party: theirs,
    handle: theirs,
    groupKey: phoneGroupKey(
      row.direction,
      row.fromNumber,
      row.toNumber,
      threadRef,
    ),
    messageId: "",
    inReplyTo: "",
    references: [],
    providerMessageId: "",
    inMonth,
    emailId: null,
    actor: meta.actor,
  };
}

function emailItem(row: EmailRow, inMonth: boolean): CommunicationLogItem {
  const meta = emailLogMeta(row);
  const handle = row.direction === "inbound" ? row.fromEmail : row.toEmail;
  const party = row.direction === "inbound" && row.fromName?.trim()
    ? row.fromName.trim()
    : handle;
  return {
    id: String(row._id),
    at: row.createdAt,
    direction: row.direction,
    channel: "email",
    subject: row.subject?.trim() || "(no subject)",
    preview: previewText(row.body || ""),
    status: row.status,
    source: meta.source,
    from: row.fromEmail,
    to: row.toEmail,
    customerRef: refId(row.customerRef),
    party,
    handle,
    groupKey: "",
    messageId: row.messageId || "",
    inReplyTo: row.inReplyTo || "",
    references: row.references ?? [],
    providerMessageId: row.providerMessageId || "",
    inMonth,
    emailId: String(row._id),
    actor: meta.actor,
  };
}

function formItem(row: FormRow, inMonth: boolean): CommunicationLogItem {
  const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
  return {
    id: String(row._id),
    at: row.createdAt,
    direction: "inbound",
    channel: "contact-form",
    subject: "Contact form",
    preview: previewText(row.message || ""),
    status: "received",
    source: row.source === "mailbox-import" ? "mailbox-form" : "website-form",
    from: row.email,
    to: "",
    customerRef: null,
    party: name || row.email,
    handle: row.email || row.phone || "",
    groupKey: "",
    messageId: "",
    inReplyTo: "",
    references: [],
    providerMessageId: row.providerMessageId || "",
    inMonth,
    emailId: null,
    actor: "customer",
  };
}

const TWILIO_FIELDS =
  "channel direction status fromNumber toNumber body transcript callSummary customerRef threadRef invoiceRef createdByUserRef autoReply sendSource createdAt";
const EMAIL_FIELDS =
  "direction fromName fromEmail toEmail subject body status messageId inReplyTo references providerMessageId mailboxFolder customerRef templateRef invoiceRef createdByUserRef createdAt";
const FORM_FIELDS =
  "firstName lastName email phone message source providerMessageId createdAt";

function monthWindow(from: Date, to: Date): { $gte: Date; $lt: Date } {
  return { $gte: from, $lt: to };
}

function outsideWindow(from: Date, to: Date): Record<string, unknown> {
  return { $or: [{ createdAt: { $lt: from } }, { createdAt: { $gte: to } }] };
}

async function loadCustomerNames(
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => Types.ObjectId.isValid(id)))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const customers = await Customer.find({ _id: { $in: unique } })
    .select("accountName first last")
    .lean<{ _id: Types.ObjectId; accountName?: string; first?: string; last?: string }[]>();
  for (const customer of customers) {
    const account = customer.accountName?.trim() ?? "";
    const person = `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
    const label = account || person;
    if (label) names.set(String(customer._id), label);
  }
  return names;
}

function relatedEmailIds(rows: EmailRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const value of [
      row.messageId,
      row.inReplyTo,
      ...(row.references ?? []),
    ]) {
      for (const key of idKeys(value || "")) ids.add(key);
    }
  }
  return [...ids];
}

export async function loadCommunicationLog(input: {
  from: Date;
  to: Date;
  channel?: LogChannel | "";
  direction?: LogDirection | "";
  repliedOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<CommunicationLogResult> {
  const window = monthWindow(input.from, input.to);
  const [texts, emails, forms] = await Promise.all([
    TwilioCommunication.find({ createdAt: window })
      .select(TWILIO_FIELDS)
      .lean<TwilioRow[]>(),
    EmailCommunication.find({ createdAt: window })
      .select(EMAIL_FIELDS)
      .lean<EmailRow[]>(),
    ContactFormSubmission.find({ createdAt: window })
      .select(FORM_FIELDS)
      .lean<FormRow[]>(),
  ]);

  const threadRefs = [
    ...new Set(
      texts
        .map((row) => refId(row.threadRef))
        .filter((id): id is string => Boolean(id && Types.ObjectId.isValid(id))),
    ),
  ];
  const pairQueries: Record<string, string>[] = [];
  const seenPairs = new Set<string>();
  for (const row of texts) {
    if (row.threadRef) continue;
    const key = `${row.fromNumber}\n${row.toNumber}`;
    const reverse = `${row.toNumber}\n${row.fromNumber}`;
    if (seenPairs.has(key) || seenPairs.has(reverse)) continue;
    seenPairs.add(key);
    pairQueries.push({ fromNumber: row.fromNumber, toNumber: row.toNumber });
    pairQueries.push({ fromNumber: row.toNumber, toNumber: row.fromNumber });
  }

  const textOr: Record<string, unknown>[] = [];
  if (threadRefs.length > 0) {
    textOr.push({
      threadRef: { $in: threadRefs.map((id) => new Types.ObjectId(id)) },
    });
  }
  if (pairQueries.length > 0) textOr.push(...pairQueries);

  const emailIds = relatedEmailIds(emails);
  const formIds = [
    ...new Set(forms.flatMap((row) => idKeys(row.providerMessageId || ""))),
  ];
  const lookupIds = [...new Set([...emailIds, ...formIds])];

  const [extraTexts, extraEmails, extraForms] = await Promise.all([
    textOr.length === 0
      ? Promise.resolve([] as TwilioRow[])
      : TwilioCommunication.find({
          $and: [{ $or: textOr }, outsideWindow(input.from, input.to)],
        })
          .select(TWILIO_FIELDS)
          .limit(EXTRA_MESSAGE_LIMIT)
          .lean<TwilioRow[]>(),
    lookupIds.length === 0
      ? Promise.resolve([] as EmailRow[])
      : EmailCommunication.find({
          $and: [
            {
              $or: [
                { messageId: { $in: lookupIds } },
                { inReplyTo: { $in: lookupIds } },
                { references: { $in: lookupIds } },
                { providerMessageId: { $in: lookupIds } },
              ],
            },
            outsideWindow(input.from, input.to),
          ],
        })
          .select(EMAIL_FIELDS)
          .limit(EXTRA_EMAIL_LIMIT)
          .lean<EmailRow[]>(),
    lookupIds.length === 0
      ? Promise.resolve([] as FormRow[])
      : ContactFormSubmission.find({
          source: "mailbox-import",
          providerMessageId: { $in: lookupIds },
          ...outsideWindow(input.from, input.to),
        })
          .select(FORM_FIELDS)
          .limit(EXTRA_FORM_LIMIT)
          .lean<FormRow[]>(),
  ]);

  const items: CommunicationLogItem[] = [];
  const seen = new Set<string>();
  function add(item: CommunicationLogItem) {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  }
  for (const row of texts) add(twilioItem(row, true));
  for (const row of extraTexts) add(twilioItem(row, false));
  for (const row of emails) add(emailItem(row, true));
  for (const row of extraEmails) add(emailItem(row, false));
  for (const row of forms) add(formItem(row, true));
  for (const row of extraForms) add(formItem(row, false));

  const names = await loadCustomerNames(
    items
      .map((item) => item.customerRef)
      .filter((id): id is string => Boolean(id)),
  );

  return groupCommunicationLog(items, {
    channel: input.channel,
    direction: input.direction,
    repliedOnly: input.repliedOnly,
    search: input.search,
    page: input.page,
    pageSize: input.pageSize,
    customerNames: names,
  });
}
