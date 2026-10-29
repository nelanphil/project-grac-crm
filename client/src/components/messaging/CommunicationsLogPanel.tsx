"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useCommunicationsLog } from "@/hooks/useCommunicationsLog";
import type { CommunicationLogChannel } from "@/lib/api";
import {
  CHANNEL_LABEL,
  CommunicationThreadEntries,
  LOG_CHANNELS,
  MonthYearSwitcher,
  THREAD_STATUS_LABEL,
  customerHistoryHref,
  exactTime,
  statusClass,
} from "./communicationLogUi";

function shortWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-brand-dark">{value}</p>
    </div>
  );
}

export default function CommunicationsLogPanel({ token }: { token: string }) {
  const log = useCommunicationsLog(token, { pageSize: 25, paging: "pages" });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function shiftMonth(delta: number) {
    setExpandedId(null);
    log.shiftMonth(delta);
  }

  function shiftYear(delta: number) {
    setExpandedId(null);
    log.shiftYear(delta);
  }

  const summary = log.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-dark">
            Communications Log
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Texts, calls, emails, inbox mail, and contact forms for{" "}
            {log.monthLabel}. Replies stay with the message they answer.
          </p>
        </div>
        <MonthYearSwitcher
          label={log.monthLabel}
          onShiftMonth={shiftMonth}
          onShiftYear={shiftYear}
          onThisMonth={() => {
            setExpandedId(null);
            log.goToCurrentMonth();
          }}
          showThisMonth={!log.isCurrentMonth}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard
          label="Outbound"
          value={summary ? String(summary.outbound) : "—"}
        />
        <SummaryCard
          label="Inbound"
          value={summary ? String(summary.inbound) : "—"}
        />
        <SummaryCard
          label="Reply rate"
          value={summary ? `${summary.replyRate}%` : "—"}
        />
        {LOG_CHANNELS.map((channel) => {
          const counts = summary?.byChannel[channel];
          const total = counts ? counts.outbound + counts.inbound : null;
          return (
            <SummaryCard
              key={channel}
              label={CHANNEL_LABEL[channel]}
              value={total === null ? "—" : String(total)}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={log.filters.channel}
          onChange={(event) =>
            log.updateFilters({
              channel: event.target.value as "" | CommunicationLogChannel,
            })
          }
          aria-label="Channel"
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">All channels</option>
          {LOG_CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {CHANNEL_LABEL[channel]}
            </option>
          ))}
        </select>
        <select
          value={log.filters.direction}
          onChange={(event) =>
            log.updateFilters({
              direction: event.target.value as "" | "inbound" | "outbound",
            })
          }
          aria-label="Direction"
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">Any direction</option>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={log.filters.repliedOnly}
            onChange={(event) =>
              log.updateFilters({ repliedOnly: event.target.checked })
            }
          />
          Has replies only
        </label>
        <input
          type="search"
          value={log.filters.search}
          onChange={(event) => log.updateFilters({ search: event.target.value })}
          placeholder="Search name, email, or phone"
          aria-label="Search communications"
          className="min-w-[14rem] flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </div>

      {log.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {log.error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        {log.loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading communications…
          </div>
        ) : log.threads.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-500">
            No communications in {log.monthLabel}.
          </p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">First outbound</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
                <th className="px-3 py-2 font-medium">Messages</th>
                <th className="px-3 py-2 font-medium">Replies</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {log.threads.map((thread) => {
                const open = expandedId === thread.id;
                const fresh = log.freshIds.includes(thread.id);
                return (
                  <Fragment key={thread.id}>
                    <tr className={fresh ? "bg-orange-50" : undefined}>
                      <td className="px-3 py-3 align-top">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((id) =>
                              id === thread.id ? null : thread.id,
                            )
                          }
                          className="inline-flex items-start gap-1 text-left"
                          aria-expanded={open}
                        >
                          {open ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                          )}
                          <span>
                            {thread.customerRef ? (
                              <Link
                                href={customerHistoryHref(thread.customerRef)}
                                onClick={(event) => event.stopPropagation()}
                                className="font-medium text-brand-orange hover:underline"
                              >
                                {thread.customerName}
                              </Link>
                            ) : (
                              <span className="font-medium text-brand-dark">
                                {thread.customerName}
                              </span>
                            )}
                            {thread.handle &&
                            thread.handle !== thread.customerName ? (
                              <span className="mt-0.5 block text-xs text-neutral-500">
                                {thread.handle}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="flex flex-wrap gap-1">
                          {thread.channels.map((channel) => (
                            <span
                              key={channel}
                              className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700"
                            >
                              {CHANNEL_LABEL[channel]}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top text-neutral-600">
                        <time
                          dateTime={thread.firstOutboundAt ?? undefined}
                          title={
                            thread.firstOutboundAt
                              ? exactTime(thread.firstOutboundAt)
                              : undefined
                          }
                        >
                          {shortWhen(thread.firstOutboundAt)}
                        </time>
                      </td>
                      <td className="px-3 py-3 align-top text-neutral-600">
                        <time
                          dateTime={thread.lastActivityAt}
                          title={exactTime(thread.lastActivityAt)}
                        >
                          {shortWhen(thread.lastActivityAt)}
                        </time>
                      </td>
                      <td className="px-3 py-3 align-top text-neutral-600">
                        {thread.messageCount}
                      </td>
                      <td className="px-3 py-3 align-top text-neutral-600">
                        {thread.replyCount}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusClass(thread.status)}`}
                        >
                          {THREAD_STATUS_LABEL[thread.status]}
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr className={fresh ? "bg-orange-50" : "bg-neutral-50"}>
                        <td colSpan={7} className="px-4 py-3">
                          <CommunicationThreadEntries entries={thread.entries} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {log.totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>
            {log.total} thread{log.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={log.page <= 1 || log.loading}
              onClick={() => {
                setExpandedId(null);
                log.setPage((current) => Math.max(1, current - 1));
              }}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {log.page} / {log.totalPages}
            </span>
            <button
              type="button"
              disabled={log.page >= log.totalPages || log.loading}
              onClick={() => {
                setExpandedId(null);
                log.setPage((current) => current + 1);
              }}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
