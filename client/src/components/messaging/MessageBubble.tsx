"use client";

import { useState } from "react";
import { AlertTriangle, Phone, X } from "lucide-react";
import { TwilioCommunicationItem } from "@/lib/api";
import { formatDuration } from "./conversationUtils";

export function truncateSid(sid: string): string {
  if (sid.length <= 10) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

const FAILED_STATUSES = new Set([
  "failed",
  "undelivered",
  "canceled",
  "busy",
  "no-answer",
]);

export function AccountBadge({
  name,
  sid,
}: {
  name: string | null;
  sid: string;
}) {
  return (
    <span
      className="inline-flex max-w-35 truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
      title={sid}
    >
      {name || truncateSid(sid)}
    </span>
  );
}

export function NumberBadge({
  outbound,
  fromNumber,
  toNumber,
}: {
  outbound: boolean;
  fromNumber: string;
  toNumber: string;
}) {
  const number = outbound ? fromNumber : toNumber;
  if (!number) return null;
  return (
    <span
      className="inline-flex max-w-30 truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
      title={`From ${fromNumber || "?"} · To ${toNumber || "?"}`}
    >
      {outbound ? "from " : "to "}
      {number}
    </span>
  );
}

export function StatusBadge({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage: string | null;
}) {
  const [open, setOpen] = useState(false);
  const failed = FAILED_STATUSES.has(status.toLowerCase());
  if (!failed) {
    return <span className="capitalize">{status}</span>;
  }
  const detail =
    errorMessage || `Message ${status} — no further detail provided by Twilio`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700 hover:bg-red-100"
      >
        <AlertTriangle className="h-3 w-3" />
        {status}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Message {status}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm whitespace-pre-wrap text-neutral-700">
              {detail}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Compact call chip for a voice event inside an SMS conversation. */
export function VoiceCallChip({ msg }: { msg: TwilioCommunicationItem }) {
  const label =
    msg.direction === "inbound" ? "Inbound call" : "Outbound call";
  const dur =
    msg.durationSeconds != null ? formatDuration(msg.durationSeconds) : "";
  return (
    <div className="flex justify-center py-0.5">
      <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2.5 py-1 text-[11px] text-[var(--staff-muted)]">
        <Phone className="h-3 w-3 shrink-0 text-brand-orange" />
        <span className="truncate">
          {label}
          {dur ? ` · ${dur}` : ""}
        </span>
      </div>
    </div>
  );
}

export default function MessageBubble({
  msg,
}: {
  msg: TwilioCommunicationItem;
}) {
  const outbound = msg.direction === "outbound";
  if (msg.channel === "voice") {
    return <VoiceCallChip msg={msg} />;
  }

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap ${
          outbound
            ? "rounded-br-md bg-[#34c759] text-white"
            : "rounded-bl-md bg-neutral-200 text-neutral-800"
        }`}
      >
        {msg.body || (msg.mediaUrls.length ? "(media)" : "")}
        {msg.mediaUrls.length > 0 ? (
          <div className="mt-2 space-y-1">
            {msg.mediaUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className={`block truncate text-[11px] underline ${
                  outbound ? "text-white/90" : "text-brand-orange"
                }`}
              >
                {url}
              </a>
            ))}
          </div>
        ) : null}
        <div
          className={`mt-1 flex flex-wrap items-center gap-2 text-[10px] ${
            outbound ? "text-white/70" : "text-neutral-500"
          }`}
        >
          <span className="uppercase">{msg.channel}</span>
          <AccountBadge name={msg.accountFriendlyName} sid={msg.accountSid} />
          <NumberBadge
            outbound={outbound}
            fromNumber={msg.fromNumber}
            toNumber={msg.toNumber}
          />
          {outbound && (
            <StatusBadge status={msg.status} errorMessage={msg.errorMessage} />
          )}
          <span>{formatTime(msg.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
