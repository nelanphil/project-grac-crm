"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CornerDownRight,
  FileText,
  Mail,
  MessageSquare,
  Phone,
} from "lucide-react";
import type {
  CommunicationLogChannel,
  CommunicationLogEntry,
  CommunicationLogSource,
  CommunicationLogThread,
  CommunicationLogThreadStatus,
} from "@/lib/api";

export const CHANNEL_LABEL: Record<CommunicationLogChannel, string> = {
  sms: "SMS",
  mms: "MMS",
  voice: "Voice",
  email: "Email",
  "contact-form": "Contact form",
};

export const SOURCE_LABEL: Record<CommunicationLogSource, string> = {
  wizard: "Wizard",
  invoice: "Invoice",
  "auto-reply": "Auto-reply",
  inbox: "Inbox",
  "website-form": "Website form",
  "mailbox-form": "Mailbox form",
};

export const THREAD_STATUS_LABEL: Record<CommunicationLogThreadStatus, string> = {
  replied: "Replied",
  "no-reply": "No reply",
  "inbound-only": "Inbound only",
};

export const LOG_CHANNELS: CommunicationLogChannel[] = [
  "sms",
  "mms",
  "voice",
  "email",
  "contact-form",
];

export function channelIcon(channel: CommunicationLogChannel) {
  const className = "h-4 w-4";
  if (channel === "voice") return <Phone className={className} aria-hidden />;
  if (channel === "email") return <Mail className={className} aria-hidden />;
  if (channel === "contact-form") {
    return <FileText className={className} aria-hidden />;
  }
  return <MessageSquare className={className} aria-hidden />;
}

export function latestEntry(thread: CommunicationLogThread): CommunicationLogEntry | null {
  for (let index = thread.entries.length - 1; index >= 0; index -= 1) {
    if (thread.entries[index].inMonth) return thread.entries[index];
  }
  return thread.entries[thread.entries.length - 1] ?? null;
}

export function threadHeadline(thread: CommunicationLogThread): string {
  const entry = latestEntry(thread);
  if (!entry) return thread.customerName;
  return entry.subject || entry.preview || thread.customerName;
}

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "";
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) {
    return minutes > 0 ? `${minutes}m ago` : `in ${Math.abs(minutes)}m`;
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return hours > 0 ? `${hours}h ago` : `in ${Math.abs(hours)}h`;
  }
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 14) {
    return days > 0 ? `${days}d ago` : `in ${Math.abs(days)}d`;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function exactTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function customerHistoryHref(customerRef: string): string {
  const params = new URLSearchParams({ id: customerRef, tab: "history" });
  return `/dashboard/customers/detail?${params.toString()}`;
}

export function emailHref(emailId: string): string {
  const params = new URLSearchParams({
    tab: "email",
    view: "sent-emails",
    emailId,
  });
  return `/dashboard/messaging?${params.toString()}`;
}

export function actorLabel(actor: CommunicationLogEntry["actor"]): string {
  if (actor === "customer") return "Customer";
  if (actor === "staff") return "Staff";
  return "System";
}

export function actorClass(actor: CommunicationLogEntry["actor"]): string {
  if (actor === "customer") return "bg-sky-100 text-sky-800";
  if (actor === "staff") return "bg-neutral-200 text-neutral-700";
  return "bg-neutral-100 text-neutral-500";
}

export function statusClass(status: CommunicationLogThreadStatus): string {
  if (status === "replied") return "bg-green-50 text-green-700";
  if (status === "no-reply") return "bg-amber-50 text-amber-800";
  return "bg-sky-50 text-sky-800";
}

export function MonthYearSwitcher({
  label,
  onShiftMonth,
  onShiftYear,
  onThisMonth,
  showThisMonth,
}: {
  label: string;
  onShiftMonth: (delta: number) => void;
  onShiftYear: (delta: number) => void;
  onThisMonth: () => void;
  showThisMonth: boolean;
}) {
  const buttonClass =
    "rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark";
  return (
    <div className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onShiftYear(-1)}
        aria-label="Previous year"
        className={buttonClass}
      >
        <ChevronsLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onShiftMonth(-1)}
        aria-label="Previous month"
        className={buttonClass}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[9.5rem] text-center text-sm font-medium text-brand-dark">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onShiftMonth(1)}
        aria-label="Next month"
        className={buttonClass}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onShiftYear(1)}
        aria-label="Next year"
        className={buttonClass}
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
      {showThisMonth ? (
        <button
          type="button"
          onClick={onThisMonth}
          className="ml-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-200"
        >
          This month
        </button>
      ) : null}
    </div>
  );
}

export function CommunicationThreadEntries({
  entries,
}: {
  entries: CommunicationLogEntry[];
}) {
  return (
    <ol className="space-y-2">
      {entries.map((entry) => {
        const inbound = entry.direction === "inbound";
        return (
          <li
            key={entry.id}
            className={`rounded-md border border-neutral-200 bg-white px-3 py-2 ${
              inbound ? "ml-6" : ""
            }`}
          >
            <div className="flex items-start gap-2">
              {inbound ? (
                <CornerDownRight
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-700"
                  aria-hidden
                />
              ) : (
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-medium ${actorClass(entry.actor)}`}
                  >
                    {inbound ? "In" : "Out"} · {actorLabel(entry.actor)}
                  </span>
                  <span>{CHANNEL_LABEL[entry.channel]}</span>
                  <span>{SOURCE_LABEL[entry.source]}</span>
                  {!entry.inMonth ? (
                    <span className="text-neutral-400">Outside this month</span>
                  ) : null}
                  <time
                    dateTime={entry.at}
                    title={exactTime(entry.at)}
                    className="ml-auto shrink-0"
                  >
                    {exactTime(entry.at)}
                  </time>
                </div>
                {entry.subject ? (
                  <p className="mt-1 text-sm font-medium text-neutral-900">
                    {entry.subject}
                  </p>
                ) : null}
                {entry.preview ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
                    {entry.preview}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-neutral-400">
                  {entry.from}
                  {entry.to ? ` → ${entry.to}` : ""}
                  {entry.status ? ` · ${entry.status}` : ""}
                </p>
                {entry.emailId ? (
                  <Link
                    href={emailHref(entry.emailId)}
                    className="mt-1 inline-block text-xs font-medium text-brand-orange hover:underline"
                  >
                    View email
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
