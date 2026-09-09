"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
  ApiError,
  ScheduledEmailItem,
  ScheduledEmailStatus,
  cancelScheduledEmail,
  getScheduledEmails,
  rescheduleEmailMessages,
} from "@/lib/api";
import {
  formatLocalDate,
  formatLocalTime,
  formatPrettyDateTime,
  isEmailScheduleTimeValid,
  localDateTimeToIso,
} from "@/lib/schedule";

type StatusFilter = ScheduledEmailStatus | "all";

function statusClass(status: ScheduledEmailStatus): string {
  switch (status) {
    case "scheduled":
      return "bg-sky-50 text-sky-800";
    case "sending":
      return "bg-amber-50 text-amber-800";
    case "sent":
      return "bg-green-50 text-green-700";
    case "cancelled":
      return "bg-neutral-100 text-neutral-600";
    case "failed":
      return "bg-red-50 text-red-700";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

export default function ScheduledEmailsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<ScheduledEmailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("scheduled");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    getScheduledEmails(token, {
      status,
      page,
      pageSize: 25,
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.scheduled);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load scheduled emails.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, status, page]);

  function openRow(row: ScheduledEmailItem) {
    setExpandedId((id) => {
      const next = id === row._id ? null : row._id;
      if (next) {
        const at = new Date(row.scheduledAt);
        setRescheduleDate(formatLocalDate(at));
        setRescheduleTime(formatLocalTime(at));
        setConfirmCancelId(null);
      }
      return next;
    });
  }

  async function handleReschedule(id: string) {
    if (!rescheduleDate || !rescheduleTime) {
      setError("Choose a date and time.");
      return;
    }
    const scheduledAt = localDateTimeToIso(rescheduleDate, rescheduleTime);
    if (!isEmailScheduleTimeValid(scheduledAt)) {
      setError("Scheduled time must be at least 1 minute in the future.");
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      const res = await rescheduleEmailMessages(token, id, scheduledAt);
      setRows((current) =>
        current.map((row) => (row._id === id ? res.scheduled : row)),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to reschedule email.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function handleCancel(id: string) {
    setSavingId(id);
    setError(null);
    try {
      const res = await cancelScheduledEmail(token, id);
      setRows((current) =>
        current.map((row) => (row._id === id ? res.scheduled : row)),
      );
      setConfirmCancelId(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to cancel scheduled email.",
      );
    } finally {
      setSavingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand-dark">
          Scheduled Emails
        </h2>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as StatusFilter);
            setPage(1);
          }}
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="scheduled">Upcoming</option>
          <option value="all">All statuses</option>
          <option value="sending">Sending</option>
          <option value="sent">Sent</option>
          <option value="cancelled">Cancelled</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading scheduled emails…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-500">
            No scheduled emails
            {status === "scheduled" ? " upcoming" : ""}.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row) => {
              const open = expandedId === row._id;
              const canEdit = row.status === "scheduled";
              const rescheduleIso =
                rescheduleDate && rescheduleTime
                  ? localDateTimeToIso(rescheduleDate, rescheduleTime)
                  : null;
              const rescheduleValid = rescheduleIso
                ? isEmailScheduleTimeValid(rescheduleIso)
                : false;
              return (
                <li key={row._id}>
                  <button
                    type="button"
                    onClick={() => openRow(row)}
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
                        <span>
                          {row.recipientCount} recipient
                          {row.recipientCount === 1 ? "" : "s"}
                        </span>
                        <span>
                          {row.accountFriendlyName || row.fromName || "—"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-brand-dark">
                        {row.subject || "(no subject)"}
                      </p>
                      {row.errorMessage ? (
                        <p className="mt-1 text-xs text-red-600">
                          {row.errorMessage}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-neutral-400">
                      {formatPrettyDateTime(row.scheduledAt)}
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-3 border-t border-neutral-100 bg-neutral-50 px-4 py-4">
                      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-neutral-500">From</dt>
                          <dd className="font-medium text-brand-dark">
                            {row.fromName}
                          </dd>
                        </div>
                        {row.replyTo ? (
                          <div>
                            <dt className="text-xs text-neutral-500">
                              Reply-To
                            </dt>
                            <dd className="font-medium text-brand-dark">
                              {row.replyTo}
                            </dd>
                          </div>
                        ) : null}
                        <div>
                          <dt className="text-xs text-neutral-500">
                            Recipients
                          </dt>
                          <dd className="font-medium text-brand-dark">
                            {row.recipientCount}
                          </dd>
                        </div>
                        {row.summary ? (
                          <div>
                            <dt className="text-xs text-neutral-500">
                              Result
                            </dt>
                            <dd className="font-medium text-brand-dark">
                              {row.summary.sent} sent
                              {row.summary.skipped
                                ? `, ${row.summary.skipped} skipped`
                                : ""}
                              {row.summary.failed
                                ? `, ${row.summary.failed} failed`
                                : ""}
                            </dd>
                          </div>
                        ) : null}
                      </dl>

                      {canEdit ? (
                        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3">
                          <p className="text-xs font-medium text-neutral-600">
                            Change send time (Eastern)
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <input
                              type="date"
                              value={rescheduleDate}
                              onChange={(e) =>
                                setRescheduleDate(e.target.value)
                              }
                              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                            />
                            <input
                              type="time"
                              value={rescheduleTime}
                              onChange={(e) =>
                                setRescheduleTime(e.target.value)
                              }
                              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                            />
                          </div>
                          {rescheduleDate &&
                          rescheduleTime &&
                          !rescheduleValid ? (
                            <p className="text-xs text-red-600">
                              Choose a time at least 1 minute in the future.
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={
                                savingId === row._id || !rescheduleValid
                              }
                              onClick={() => void handleReschedule(row._id)}
                              className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
                            >
                              {savingId === row._id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              Save new time
                            </button>
                            {confirmCancelId === row._id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={savingId === row._id}
                                  onClick={() => void handleCancel(row._id)}
                                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
                                >
                                  Confirm cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmCancelId(null)}
                                  className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                                >
                                  Keep scheduled
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={savingId === row._id}
                                onClick={() => setConfirmCancelId(row._id)}
                                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                              >
                                Cancel send
                              </button>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>
            {total} campaign{total === 1 ? "" : "s"}
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
