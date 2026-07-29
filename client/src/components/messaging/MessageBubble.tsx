"use client";

import { Phone } from "lucide-react";
import { TwilioCommunicationItem } from "@/lib/api";

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

export function AccountBadge({
  name,
  sid,
}: {
  name: string | null;
  sid: string;
}) {
  return (
    <span
      className="inline-flex max-w-[140px] truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
      title={sid}
    >
      {name || truncateSid(sid)}
    </span>
  );
}

export default function MessageBubble({
  msg,
}: {
  msg: TwilioCommunicationItem;
}) {
  const outbound = msg.direction === "outbound";
  if (msg.channel === "voice") {
    return (
      <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[90%] rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Phone className="h-3 w-3" />
            Voice call · {msg.status}
            {msg.durationSeconds != null ? ` · ${msg.durationSeconds}s` : ""}
          </div>
          {msg.body ? (
            <p className="text-neutral-500 whitespace-pre-wrap">{msg.body}</p>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-400">
            <AccountBadge name={msg.accountFriendlyName} sid={msg.accountSid} />
            <span>{formatTime(msg.createdAt)}</span>
          </div>
        </div>
      </div>
    );
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
          className={`mt-1 flex items-center gap-2 text-[10px] ${
            outbound ? "text-white/70" : "text-neutral-500"
          }`}
        >
          <span className="uppercase">{msg.channel}</span>
          <AccountBadge name={msg.accountFriendlyName} sid={msg.accountSid} />
          <span>{formatTime(msg.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
