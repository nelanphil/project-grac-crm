"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  ApiError,
  TwilioAccountItem,
  TwilioCommunicationItem,
  getMessagingCommunications,
  getTwilioAccounts,
} from "@/lib/api";
import { MONTH_NAMES, monthBounds } from "@/lib/monthRange";

const PAGE_SIZE = 100;

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

type DayGroup = {
  key: string;
  label: string;
  rows: TwilioCommunicationItem[];
};

function groupByDay(rows: TwilioCommunicationItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.rows.push(row);
    } else {
      groups.push({ key, label: dayLabel(row.createdAt), rows: [row] });
    }
  }
  return groups;
}

function statusClass(status: string): string {
  if (status === "failed") return "bg-red-50 text-red-700";
  if (status === "queued") return "bg-amber-50 text-amber-800";
  return "bg-green-50 text-green-700";
}

type StatusFilter = "" | "sent" | "failed";

export default function SentMessagesPanel({ token }: { token: string }) {
  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const range = useMemo(
    () => monthBounds(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const [rows, setRows] = useState<TwilioCommunicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<TwilioAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const groups = useMemo(() => groupByDay(rows), [rows]);
  const monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setPage(1);
    setExpandedId(null);
  }

  useEffect(() => {
    getTwilioAccounts(token)
      .then((res) => setAccounts(res.accounts))
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    getMessagingCommunications(token, {
      sendSource: "wizard",
      channel: "sms,mms",
      direction: "outbound",
      status: status || undefined,
      twilioAccountId: accountId || undefined,
      from: range.from,
      to: range.to,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.communications);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load sent messages.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, status, accountId, page, range]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand-dark">Sent Messages</h2>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-brand-dark">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account._id} value={account._id}>
                {account.friendlyName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-clip rounded-xl border border-neutral-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sent messages…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-500">
            No messages in {monthLabel}.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {groups.map((group) => (
              <li key={group.key}>
                <div className="sticky top-0 z-20 flex items-baseline justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500">
                  <span>{group.label}</span>
                  <span className="text-neutral-400">{group.rows.length}</span>
                </div>
                <ul className="divide-y divide-neutral-100">
                  {group.rows.map((row) => {
                    const open = expandedId === row._id;
                    const preview = row.body.trim() || (row.mediaUrls.length > 0 ? "[Attachment]" : "(no text)");
                    return (
                      <li key={row._id}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((id) =>
                              id === row._id ? null : row._id,
                            )
                          }
                          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                        >
                          {open ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                              <span
                                className={`rounded px-1.5 py-0.5 font-medium uppercase ${statusClass(row.status)}`}
                              >
                                {row.status}
                              </span>
                              <span>{row.toNumber || "—"}</span>
                              <span>
                                {row.accountFriendlyName || row.fromNumber}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium text-brand-dark">
                              {preview}
                            </p>
                            {row.errorMessage ? (
                              <p className="mt-1 text-xs text-red-600">
                                {row.errorMessage}
                              </p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[11px] text-neutral-400">
                            {formatClock(row.createdAt)}
                          </span>
                        </button>
                        {open ? (
                          <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-4">
                            <p className="text-xs text-neutral-500">
                              From {row.fromNumber} to {row.toNumber || "—"}
                            </p>
                            <pre className="mt-3 whitespace-pre-wrap text-sm text-brand-dark">
                              {row.body.trim() || "(no text)"}
                            </pre>
                            {row.mediaUrls.length > 0 ? (
                              <ul className="mt-3 space-y-1">
                                {row.mediaUrls.map((url) => (
                                  <li key={url}>
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block truncate text-sm text-brand-orange underline"
                                    >
                                      {url}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {row.errorMessage ? (
                              <p role="alert" className="mt-2 text-sm text-red-700">
                                {row.errorMessage}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>
            {total} message{total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
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
