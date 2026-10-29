"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { History, Minimize2 } from "lucide-react";
import { useCommunicationsLog } from "@/hooks/useCommunicationsLog";
import type {
  CommunicationLogChannel,
  CommunicationLogThread,
} from "@/lib/api";
import {
  CHANNEL_LABEL,
  CommunicationThreadEntries,
  LOG_CHANNELS,
  MonthYearSwitcher,
  SOURCE_LABEL,
  THREAD_STATUS_LABEL,
  actorClass,
  actorLabel,
  channelIcon,
  customerHistoryHref,
  dayKey,
  exactTime,
  latestEntry,
  relativeTime,
  statusClass,
  threadHeadline,
} from "@/components/messaging/communicationLogUi";

const LATEST_LIMIT = 8;

function groupByDay(threads: CommunicationLogThread[]) {
  const rows: { day: string; threads: CommunicationLogThread[] }[] = [];
  for (const thread of threads) {
    const day = dayKey(thread.lastActivityAt);
    const last = rows[rows.length - 1];
    if (!last || last.day !== day) rows.push({ day, threads: [thread] });
    else last.threads.push(thread);
  }
  return rows;
}

function LogCard({
  thread,
  fresh,
  open,
  onToggle,
}: {
  thread: CommunicationLogThread;
  fresh: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const latest = latestEntry(thread);
  const iconChannel = latest?.channel ?? thread.channels[0] ?? "sms";
  return (
    <li
      className={`rounded-lg border px-3 py-3 ${
        fresh
          ? "border-brand-orange bg-orange-50"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
          {channelIcon(iconChannel)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-medium text-neutral-900">
              {threadHeadline(thread)}
            </p>
            <time
              dateTime={thread.lastActivityAt}
              title={exactTime(thread.lastActivityAt)}
              className="shrink-0 text-xs text-neutral-500"
            >
              {relativeTime(thread.lastActivityAt)}
            </time>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            {latest ? (
              <span
                className={`rounded-full px-1.5 py-0.5 font-medium ${actorClass(latest.actor)}`}
              >
                {actorLabel(latest.actor)}
              </span>
            ) : null}
            {latest ? <span>{SOURCE_LABEL[latest.source]}</span> : null}
            <span
              className={`rounded-full px-1.5 py-0.5 font-medium ${statusClass(thread.status)}`}
            >
              {THREAD_STATUS_LABEL[thread.status]}
            </span>
            {thread.customerRef ? (
              <Link
                href={customerHistoryHref(thread.customerRef)}
                className="font-medium text-brand-orange hover:underline"
              >
                {thread.customerName}
              </Link>
            ) : (
              <span>{thread.customerName}</span>
            )}
            {thread.handle && thread.handle !== thread.customerName ? (
              <span>{thread.handle}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="mt-2 text-xs font-medium text-brand-orange hover:underline"
          >
            {open
              ? "Hide messages"
              : `${thread.messageCount} message${thread.messageCount === 1 ? "" : "s"}`}
          </button>
          {open ? (
            <div className="mt-2">
              <CommunicationThreadEntries entries={thread.entries} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function LogList({
  threads,
  freshIds,
  openIds,
  onToggle,
}: {
  threads: CommunicationLogThread[];
  freshIds: string[];
  openIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const groups = useMemo(() => groupByDay(threads), [threads]);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {group.day}
          </h3>
          <ul className="space-y-2">
            {group.threads.map((thread) => (
              <LogCard
                key={thread.id}
                thread={thread}
                fresh={freshIds.includes(thread.id)}
                open={openIds.has(thread.id)}
                onToggle={() => onToggle(thread.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function CommunicationsLogFeed({
  token,
  expanded,
  onExpandedChange,
}: {
  token: string;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const log = useCommunicationsLog(token, { pageSize: 25, paging: "more" });
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const monthRef = useRef({
    current: log.isCurrentMonth,
    reset: log.goToCurrentMonth,
  });

  useEffect(() => {
    monthRef.current = {
      current: log.isCurrentMonth,
      reset: log.goToCurrentMonth,
    };
  }, [log.isCurrentMonth, log.goToCurrentMonth]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!monthRef.current.current) monthRef.current.reset();
      onExpandedChange(false);
    }
    window.addEventListener("keydown", onKey);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
    };
  }, [expanded, onExpandedChange]);

  function toggleThread(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleChannel(channel: CommunicationLogChannel) {
    log.updateFilters({
      channel: log.filters.channel === channel ? "" : channel,
    });
  }

  const liveLabel = log.live === "open" ? "Live" : "Paused";
  const latestThreads = log.threads.slice(0, LATEST_LIMIT);

  function closeExpanded() {
    if (!log.isCurrentMonth) log.goToCurrentMonth();
    onExpandedChange(false);
  }

  function filters() {
    return (
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ["", "Anyone"],
            ["outbound", "Outbound"],
            ["inbound", "Inbound"],
          ] as const
        ).map(([id, label]) => {
          const selected = log.filters.direction === id;
          return (
            <button
              key={label}
              type="button"
              onClick={() => log.updateFilters({ direction: id })}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                selected
                  ? "bg-brand-orange text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {label}
            </button>
          );
        })}
        {LOG_CHANNELS.map((channel) => {
          const selected = log.filters.channel === channel;
          return (
            <button
              key={channel}
              type="button"
              onClick={() => toggleChannel(channel)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                selected
                  ? "bg-neutral-800 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {CHANNEL_LABEL[channel]}
            </button>
          );
        })}
      </div>
    );
  }

  function emptyState(monthScoped: boolean) {
    if (log.loading || log.threads.length > 0 || log.error) return null;
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 py-12 text-center">
        <History className="mb-4 h-10 w-10 text-neutral-300" />
        <p className="text-sm font-medium text-neutral-500">
          {monthScoped
            ? `No communications in ${log.monthLabel}`
            : "No recent communications"}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          Texts, calls, emails, and contact forms will show up here.
        </p>
      </div>
    );
  }

  function feed(threads: CommunicationLogThread[], paging: boolean) {
    return (
      <>
        {log.error ? <p className="text-sm text-red-600">{log.error}</p> : null}
        {log.loading && threads.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            Loading communications…
          </p>
        ) : null}
        {emptyState(paging)}
        <LogList
          threads={threads}
          freshIds={log.freshIds}
          openIds={openIds}
          onToggle={toggleThread}
        />
        {paging && log.hasMore ? (
          <button
            type="button"
            onClick={log.loadMore}
            disabled={log.loadingMore}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
          >
            {log.loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </>
    );
  }

  const overlay =
    expanded && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Expanded communications log"
            className="fixed inset-0 z-[60] flex h-dvh w-dvw flex-col overflow-hidden bg-white p-3 text-brand-dark shadow-2xl sm:p-5"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 pb-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-semibold text-brand-dark">
                  Communications Log
                </span>
                <span className="inline-flex items-center gap-2 text-xs text-neutral-500">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      log.live === "open" ? "bg-emerald-500" : "bg-neutral-300"
                    }`}
                    aria-hidden
                  />
                  {liveLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={closeExpanded}
                title="Exit full screen (Esc)"
                aria-label="Exit full screen"
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-brand-dark shadow-2xs transition-colors hover:bg-neutral-200"
              >
                <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                <span>Exit Fullscreen</span>
                <kbd className="ml-1 hidden rounded bg-neutral-200/60 px-1 font-mono text-[10px] text-neutral-400 sm:inline">
                  Esc
                </kbd>
              </button>
            </div>
            <div className="flex shrink-0 justify-center border-b border-neutral-200 py-3">
              <MonthYearSwitcher
                label={log.monthLabel}
                onShiftMonth={log.shiftMonth}
                onShiftYear={log.shiftYear}
                onThisMonth={log.goToCurrentMonth}
                showThisMonth={!log.isCurrentMonth}
              />
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-3">
              {filters()}
              {feed(log.threads, true)}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="space-y-4">
      {filters()}
      {feed(latestThreads, false)}
      {overlay}
    </div>
  );
}
