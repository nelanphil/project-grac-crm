"use client";

import { InboxConversationItem } from "@/lib/api";
import { formatRelativeTime } from "@/components/messaging/conversationUtils";
import { avatarColor, conversationPreview, initials } from "./inboxFormat";
import { PhoneIncoming, PhoneOutgoing, Search, SlidersHorizontal } from "lucide-react";

export type InboxTab = "chats" | "calls";
export type InboxChip = "open" | "unread" | "unresponded";
export type InboxChannelFilter = "" | "text" | "email";

type ConversationListProps = {
  tab: InboxTab;
  chip: InboxChip;
  channel: InboxChannelFilter;
  closed: boolean;
  query: string;
  conversations: InboxConversationItem[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onTab: (tab: InboxTab) => void;
  onChip: (chip: InboxChip) => void;
  onChannel: (channel: InboxChannelFilter) => void;
  onClosed: (closed: boolean) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onMore: () => void;
};

export default function ConversationList({
  tab,
  chip,
  channel,
  closed,
  query,
  conversations,
  selectedId,
  loading,
  error,
  hasMore,
  onTab,
  onChip,
  onChannel,
  onClosed,
  onQuery,
  onSelect,
  onMore,
}: ConversationListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col border-[var(--staff-border)] bg-[var(--staff-surface)] lg:border-r">
      <div className="flex items-center gap-4 border-b border-[var(--staff-border)] px-4 pt-3">
        {(["chats", "calls"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onTab(item)}
            className={`border-b-2 pb-2 text-sm font-semibold capitalize ${
              tab === item
                ? "border-[#2f6fed] text-[var(--staff-ink)]"
                : "border-transparent text-[var(--staff-muted)]"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--staff-border)] bg-[var(--staff-cream)] px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--staff-muted)]" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search"
            className="w-full bg-transparent py-1.5 text-sm text-[var(--staff-ink)] outline-none placeholder:text-[var(--staff-muted)]"
          />
        </div>
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center rounded-md border border-[var(--staff-border)] p-1.5 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] p-2 shadow-lg">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
              Channel
            </p>
            {(
              [
                ["", "All"],
                ["text", "Text"],
                ["email", "Email"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => onChannel(value)}
                className={`block w-full rounded px-2 py-1 text-left text-xs ${
                  channel === value
                    ? "bg-[var(--staff-cream)] text-[var(--staff-ink)]"
                    : "text-[var(--staff-muted)]"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onClosed(!closed)}
              className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
            >
              {closed ? "Show open" : "Show closed"}
            </button>
          </div>
        </details>
      </div>
      <div className="flex gap-1.5 px-3 pb-2">
        {(
          [
            ["open", "Open"],
            ["unread", "Unread"],
            ["unresponded", "Unresponded"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onChip(value)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              chip === value
                ? "bg-[#2f6fed] text-white"
                : "bg-[var(--staff-cream)] text-[var(--staff-muted)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="px-3 pb-2 text-xs text-red-500">{error}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--staff-muted)]">Loading conversations…</p>
        ) : null}
        {!loading && conversations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--staff-muted)]">No conversations</p>
        ) : null}
        {conversations.map((item) => {
          const active = item.id === selectedId;
          const unread = item.unreadCount > 0;
          const voice = item.lastChannel === "voice";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-start gap-3 border-b border-[var(--staff-border)] px-3 py-3 text-left ${
                active ? "bg-[var(--staff-cream)]" : "hover:bg-[var(--staff-cream)]"
              }`}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: avatarColor(item.displayName || item.handle) }}
              >
                {initials(item.displayName || item.phone || item.email)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-sm text-[var(--staff-ink)] ${
                      unread ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {item.displayName || item.phone || item.email}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--staff-muted)]">
                    {formatRelativeTime(item.lastMessageAt)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--staff-muted)]">
                  {voice ? (
                    item.lastDirection === "outbound" ? (
                      <PhoneOutgoing className="h-3 w-3 shrink-0" />
                    ) : (
                      <PhoneIncoming className="h-3 w-3 shrink-0" />
                    )
                  ) : null}
                  <span className={`truncate ${unread ? "text-[var(--staff-ink)]" : ""}`}>
                    {conversationPreview(item)}
                  </span>
                  {unread ? (
                    <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-[#2f6fed]" />
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
        {hasMore ? (
          <button
            type="button"
            onClick={onMore}
            className="w-full py-3 text-xs font-medium text-[#2f6fed]"
          >
            Load more
          </button>
        ) : null}
      </div>
    </div>
  );
}
