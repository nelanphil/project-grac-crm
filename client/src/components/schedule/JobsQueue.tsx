"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  cancelWorkOrderAppointment,
  getScheduleQueue,
  ScheduleSuggestion,
  suggestScheduleAssignee,
  updateWorkOrder,
  WorkOrderListItem,
} from "@/lib/api";
import {
  DEFAULT_ESTIMATED_MINUTES,
  formatAddressLine,
  formatLocalDate,
  formatLocalTime,
  formatPrettyDate,
  isDispatcherRole,
  minutesToLabel,
  workOrderLocalDate,
  workOrderViewHref,
} from "@/lib/schedule";
import SuggestAssigneeModal from "@/components/schedule/SuggestAssigneeModal";

type BucketId = "unscheduled" | "today" | "upcoming" | "pastDue";

const BUCKETS: { id: BucketId; title: string; empty: string }[] = [
  {
    id: "today",
    title: "Scheduled Today",
    empty: "Nothing scheduled for today.",
  },
  {
    id: "unscheduled",
    title: "Unscheduled",
    empty: "No unscheduled work orders.",
  },
  {
    id: "upcoming",
    title: "Upcoming",
    empty: "No upcoming appointments.",
  },
  {
    id: "pastDue",
    title: "Past Due",
    empty: "No past due work orders.",
  },
];

function techLabel(job: WorkOrderListItem): string {
  if (job.assignee) {
    return `${job.assignee.first_name} ${job.assignee.last_name}`.trim();
  }
  return job.tech || "Unassigned";
}

function JobMeta({ job }: { job: WorkOrderListItem }) {
  const parts: string[] = [];
  if (job.scheduledStart) {
    parts.push(
      `${formatPrettyDate(formatLocalDate(new Date(job.scheduledStart)))} ${formatLocalTime(new Date(job.scheduledStart))}`,
    );
    parts.push(techLabel(job));
  } else if (job.appointmentCanceledAt) {
    parts.push(
      `Canceled ${formatPrettyDate(formatLocalDate(new Date(job.appointmentCanceledAt)))}`,
    );
  } else if (job.date) {
    parts.push(job.date.slice(0, 10));
  }
  parts.push(minutesToLabel(job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES));
  return <span>{parts.join(" · ")}</span>;
}

export default function JobsQueue({
  onOpenCalendar,
}: {
  onOpenCalendar: (date: string) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user?.role);
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));

  const today = formatLocalDate(new Date());
  const [queue, setQueue] = useState<Record<BucketId, WorkOrderListItem[]>>({
    unscheduled: [],
    today: [],
    upcoming: [],
    pastDue: [],
  });
  const [bucket, setBucket] = useState<BucketId>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [suggestJob, setSuggestJob] = useState<WorkOrderListItem | null>(null);
  const [suggestions, setSuggestions] = useState<ScheduleSuggestion[] | null>(
    null,
  );
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getScheduleQueue(token);
      setQueue({
        unscheduled: data.unscheduled,
        today: data.today,
        upcoming: data.upcoming,
        pastDue: data.pastDue,
      });
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load work orders.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    void (async () => {
      try {
        const data = await getScheduleQueue(token);
        if (cancelled) return;
        setQueue({
          unscheduled: data.unscheduled,
          today: data.today,
          upcoming: data.upcoming,
          pastDue: data.pastDue,
        });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load work orders.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function openCalendarFor(job: WorkOrderListItem) {
    onOpenCalendar(workOrderLocalDate(job) ?? today);
  }

  async function handleSuggest(job: WorkOrderListItem) {
    if (!token) return;
    setSuggesting(true);
    setError(null);
    setSuggestJob(job);
    try {
      const result = await suggestScheduleAssignee(token, {
        workOrderId: job._id,
        date: workOrderLocalDate(job) ?? today,
        estimatedMinutes: job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
      });
      setSuggestions(result.suggestions);
    } catch (err) {
      setSuggestJob(null);
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to suggest a technician.",
      );
    } finally {
      setSuggesting(false);
    }
  }

  async function assignJob(userId: string, proposedStart: string) {
    if (!token || !suggestJob) return;
    setSaving(true);
    try {
      await updateWorkOrder(token, suggestJob._id, {
        assignedUserRef: userId,
        scheduledStart: proposedStart,
      });
      setSuggestJob(null);
      setSuggestions(null);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to assign work order.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(job: WorkOrderListItem) {
    if (!token) return;
    if (
      !window.confirm(
        "Cancel this appointment? The work order stays open as past due so it can be rescheduled.",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cancelWorkOrderAppointment(token, job._id);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to cancel appointment.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canDispatch = dispatcher && canWrite;

  function viewLink(job: WorkOrderListItem) {
    const href = workOrderViewHref(job);
    if (!href) return null;
    return (
      <Link
        href={href}
        className="text-xs font-medium text-brand-orange hover:underline"
      >
        View
      </Link>
    );
  }

  function actionsFor(bucket: BucketId, job: WorkOrderListItem) {
    if (!canDispatch) {
      return (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {viewLink(job)}
          <button
            type="button"
            onClick={() => openCalendarFor(job)}
            className="text-xs font-medium text-brand-orange hover:underline"
          >
            Open calendar
          </button>
        </div>
      );
    }

    const hasSlot = Boolean(job.scheduledStart);
    const showSuggest = bucket === "unscheduled" || (bucket === "pastDue" && !hasSlot);
    const showCancel = hasSlot;

    return (
      <div className="flex flex-wrap items-center justify-end gap-3">
        {viewLink(job)}
        {showSuggest && (
          <button
            type="button"
            disabled={suggesting || saving}
            onClick={() => void handleSuggest(job)}
            className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-40"
          >
            Suggest tech
          </button>
        )}
        {showCancel && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleCancel(job)}
            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
          >
            Cancel appointment
          </button>
        )}
        <button
          type="button"
          onClick={() => openCalendarFor(job)}
          className="text-xs font-medium text-neutral-600 hover:underline"
        >
          Open calendar
        </button>
      </div>
    );
  }

  const visibleBuckets = dispatcher
    ? BUCKETS
    : BUCKETS.filter((item) => item.id !== "unscheduled");
  const activeBucket =
    visibleBuckets.find((item) => item.id === bucket) ?? visibleBuckets[0];
  const jobs = activeBucket ? queue[activeBucket.id] : [];

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading work orders…</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <div className="flex gap-1 overflow-x-auto border-b border-neutral-100 p-2 sm:px-3">
          {visibleBuckets.map((item) => {
            const count = queue[item.id].length;
            const selected = activeBucket?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setBucket(item.id)}
                className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
                  selected
                    ? "bg-brand-orange text-white"
                    : "text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {item.title}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                    selected
                      ? "bg-white/20 text-white"
                      : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {jobs.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-400 sm:px-5">
            {activeBucket?.empty}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {jobs.map((job) => (
              <li
                key={job._id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <button
                  type="button"
                  onClick={() => openCalendarFor(job)}
                  className="min-w-0 text-left"
                >
                  <div className="truncate text-sm font-medium text-brand-dark">
                    {job.customerName || "Customer"}
                  </div>
                  <div className="truncate text-xs text-neutral-500">
                    {formatAddressLine(job.address)}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-400">
                    <JobMeta job={job} />
                  </div>
                </button>
                {activeBucket ? actionsFor(activeBucket.id, job) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {suggestions && suggestJob && (
        <SuggestAssigneeModal
          job={suggestJob}
          suggestions={suggestions}
          saving={saving}
          onAssign={(userId, start) => void assignJob(userId, start)}
          onClose={() => {
            setSuggestions(null);
            setSuggestJob(null);
          }}
        />
      )}
    </div>
  );
}
