"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  cancelWorkOrderAppointment,
  getScheduleQueue,
  getScheduleRoute,
  getScheduleStaff,
  ScheduleStaffMember,
  ScheduleSuggestion,
  suggestScheduleAssignee,
  updateWorkOrder,
  WorkOrderListItem,
} from "@/lib/api";
import {
  addDays,
  BOARD_HOUR_END,
  BOARD_HOUR_START,
  DEFAULT_ESTIMATED_MINUTES,
  daysInMonth,
  formatAddressLine,
  formatLocalDate,
  formatPrettyDate,
  isDispatcherRole,
  localDateTimeToIso,
  minutesToHhMm,
  startOfMonth,
  startOfWeekSunday,
  workOrderViewHref,
} from "@/lib/schedule";
import WeekBoard, {
  UnscheduledCard,
} from "@/components/schedule/WeekBoard";
import MonthCalendar from "@/components/schedule/MonthCalendar";
import MonthTable from "@/components/schedule/MonthTable";
import DayRouteMap from "@/components/schedule/DayRouteMap";
import SuggestAssigneeModal from "@/components/schedule/SuggestAssigneeModal";

type ViewMode = "week" | "month";
type MonthMode = "calendar" | "table";

function dropMinutes(event: DragEndEvent): number | null {
  const over = event.over;
  const translated = event.active.rect.current.translated;
  if (!over || !translated) return null;
  const x =
    translated.left + Math.min(translated.width, 48) / 2 - over.rect.left;
  const ratio = Math.max(0, Math.min(0.999, x / Math.max(1, over.rect.width)));
  const total = (BOARD_HOUR_END - BOARD_HOUR_START) * 60;
  return Math.round((BOARD_HOUR_START * 60 + ratio * total) / 15) * 15;
}

function emptyQueue() {
  return {
    unscheduled: [] as WorkOrderListItem[],
    today: [] as WorkOrderListItem[],
    upcoming: [] as WorkOrderListItem[],
    pastDue: [] as WorkOrderListItem[],
  };
}

async function fetchCalendarData(
  token: string,
  from: string,
  to: string,
  dispatcher: boolean,
) {
  const [board, queue] = await Promise.all([
    getScheduleStaff(token, from, to),
    dispatcher
      ? getScheduleQueue(token, { from, to })
      : Promise.resolve(emptyQueue()),
  ]);
  return {
    staff: board.staff,
    jobs: board.workOrders,
    rail: queue.unscheduled,
  };
}

function NeedsSchedulingRail({
  jobs,
  selectedId,
  onSelect,
  onSuggest,
  suggesting,
  draggable,
}: {
  jobs: WorkOrderListItem[];
  selectedId: string | null;
  onSelect: (job: WorkOrderListItem) => void;
  onSuggest: () => void;
  suggesting: boolean;
  draggable: boolean;
}) {
  return (
    <aside className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-brand-dark">
          Needs scheduling
        </h2>
        <button
          type="button"
          disabled={!selectedId || suggesting}
          onClick={onSuggest}
          className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-40"
        >
          {suggesting ? "Suggesting…" : "Suggest tech"}
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="text-xs text-neutral-400">
          No work orders waiting to be scheduled.
        </p>
      ) : (
        <div className="space-y-2">
          {jobs.map((order) => (
            <UnscheduledCard
              key={order._id}
              order={order}
              selected={selectedId === order._id}
              onSelect={() => onSelect(order)}
              draggable={draggable}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

export default function CalendarTab({
  initialDate,
}: {
  initialDate: string;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user?.role);
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));

  const today = formatLocalDate(new Date());
  const [anchorDate, setAnchorDate] = useState(initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [view, setView] = useState<ViewMode>("week");
  const [monthMode, setMonthMode] = useState<MonthMode>("calendar");

  const [staff, setStaff] = useState<ScheduleStaffMember[]>([]);
  const [jobs, setJobs] = useState<WorkOrderListItem[]>([]);
  const [railJobs, setRailJobs] = useState<WorkOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [selectedUnscheduled, setSelectedUnscheduled] =
    useState<WorkOrderListItem | null>(null);
  const [editingJob, setEditingJob] = useState<WorkOrderListItem | null>(null);
  const [durationDraft, setDurationDraft] = useState(60);
  const [saving, setSaving] = useState(false);

  const [suggestions, setSuggestions] = useState<ScheduleSuggestion[] | null>(
    null,
  );
  const [suggesting, setSuggesting] = useState(false);

  const [routeUserId, setRouteUserId] = useState<string | null>(null);
  const [routeStops, setRouteStops] = useState<
    Awaited<ReturnType<typeof getScheduleRoute>>["stops"] | null
  >(null);
  const [routePolyline, setRoutePolyline] = useState<string | undefined>();
  const [routeLoading, setRouteLoading] = useState(false);

  const weekStart = startOfWeekSunday(anchorDate);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = addDays(monthStart, daysInMonth(monthStart) - 1);

  const range = useMemo(() => {
    if (view === "week") return { from: weekStart, to: weekEnd };
    return { from: monthStart, to: monthEnd };
  }, [view, weekStart, weekEnd, monthStart, monthEnd]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchCalendarData(
        token,
        range.from,
        range.to,
        dispatcher,
      );
      setStaff(data.staff);
      setJobs(data.jobs);
      setRailJobs(data.rail);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load schedule.",
      );
    } finally {
      setLoading(false);
    }
  }, [token, range.from, range.to, dispatcher]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    void (async () => {
      try {
        const data = await fetchCalendarData(
          token,
          range.from,
          range.to,
          dispatcher,
        );
        if (cancelled) return;
        setStaff(data.staff);
        setJobs(data.jobs);
        setRailJobs(data.rail);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load schedule.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, range.from, range.to, dispatcher]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function assignJob(
    workOrderId: string,
    assignedUserRef: string,
    scheduledStart: string,
    estimatedMinutes?: number,
  ) {
    if (!token) return;
    setSaving(true);
    setWarning(null);
    try {
      const updated = await updateWorkOrder(token, workOrderId, {
        assignedUserRef,
        scheduledStart,
        estimatedMinutes,
      });
      if (updated.warnings?.length) {
        setWarning(updated.warnings.join(" "));
      }
      setSelectedUnscheduled(null);
      setEditingJob(null);
      setSuggestions(null);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update work order.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!dispatcher || !canWrite) return;
    const overId = event.over?.id ? String(event.over.id) : "";
    if (!overId.startsWith("row:")) return;
    const userId = overId.slice(4);
    const activeId = String(event.active.id);
    if (!activeId.startsWith("job:")) return;
    const workOrderId = activeId.slice(4);
    const minutes = dropMinutes(event);
    if (minutes == null) return;
    const hhmm = minutesToHhMm(minutes);
    const iso = localDateTimeToIso(selectedDate, hhmm);
    const job =
      jobs.find((j) => j._id === workOrderId) ||
      railJobs.find((j) => j._id === workOrderId);
    await assignJob(
      workOrderId,
      userId,
      iso,
      job?.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
    );
  }

  async function handleSuggest() {
    if (!token || !selectedUnscheduled) return;
    setSuggesting(true);
    setError(null);
    try {
      const result = await suggestScheduleAssignee(token, {
        workOrderId: selectedUnscheduled._id,
        date: selectedDate,
        estimatedMinutes:
          selectedUnscheduled.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
      });
      setSuggestions(result.suggestions);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to suggest a technician.",
      );
    } finally {
      setSuggesting(false);
    }
  }

  async function openRoute(userId: string) {
    if (!token) return;
    setRouteUserId(userId);
    setRouteLoading(true);
    setRouteStops(null);
    try {
      const result = await getScheduleRoute(token, userId, selectedDate);
      setRouteStops(result.stops);
      setRoutePolyline(result.route?.encodedPolyline);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load day route.",
      );
      setRouteUserId(null);
    } finally {
      setRouteLoading(false);
    }
  }

  async function saveDuration() {
    if (!token || !editingJob) return;
    setSaving(true);
    setWarning(null);
    try {
      const updated = await updateWorkOrder(token, editingJob._id, {
        estimatedMinutes: durationDraft,
      });
      if (updated.warnings?.length) setWarning(updated.warnings.join(" "));
      setEditingJob(null);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update duration.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelEditing() {
    if (!token || !editingJob) return;
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
      await cancelWorkOrderAppointment(token, editingJob._id);
      setEditingJob(null);
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

  const monthJobs = view === "month" ? [...jobs, ...railJobs] : jobs;
  const editingViewHref = editingJob ? workOrderViewHref(editingJob) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next =
                view === "week"
                  ? addDays(anchorDate, -7)
                  : addDays(monthStart, -1);
              setAnchorDate(next);
              setSelectedDate(
                view === "week" ? addDays(weekStart, -7) : startOfMonth(next),
              );
            }}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => {
              setAnchorDate(today);
              setSelectedDate(today);
            }}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              const next =
                view === "week" ? addDays(anchorDate, 7) : addDays(monthEnd, 1);
              setAnchorDate(next);
              setSelectedDate(
                view === "week" ? addDays(weekStart, 7) : startOfMonth(next),
              );
            }}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            Next
          </button>
          <span className="text-sm font-medium text-neutral-600">
            {view === "week"
              ? `${formatPrettyDate(weekStart)} – ${formatPrettyDate(weekEnd)}`
              : formatPrettyDate(monthStart)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-neutral-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setView("week")}
              className={`rounded px-3 py-1.5 ${view === "week" ? "bg-brand-orange text-white" : "text-neutral-600"}`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setView("month")}
              className={`rounded px-3 py-1.5 ${view === "month" ? "bg-brand-orange text-white" : "text-neutral-600"}`}
            >
              Month
            </button>
          </div>
          {view === "month" && (
            <div className="flex rounded-md border border-neutral-200 bg-white p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setMonthMode("calendar")}
                className={`rounded px-3 py-1.5 ${monthMode === "calendar" ? "bg-neutral-800 text-white" : "text-neutral-600"}`}
              >
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setMonthMode("table")}
                className={`rounded px-3 py-1.5 ${monthMode === "table" ? "bg-neutral-800 text-white" : "text-neutral-600"}`}
              >
                Table
              </button>
            </div>
          )}
        </div>
      </div>

      {view === "week" && (
        <div className="flex flex-wrap gap-1">
          {weekDays.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => {
                setSelectedDate(day);
                setAnchorDate(day);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                day === selectedDate
                  ? "bg-brand-orange text-white"
                  : "bg-white text-neutral-600 border border-neutral-200"
              }`}
            >
              {formatPrettyDate(day)}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {warning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warning}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading schedule…</p>
      ) : view === "week" ? (
        <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
          <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
            {dispatcher && (
              <NeedsSchedulingRail
                jobs={railJobs}
                selectedId={selectedUnscheduled?._id ?? null}
                onSelect={setSelectedUnscheduled}
                onSuggest={() => void handleSuggest()}
                suggesting={suggesting}
                draggable={canWrite}
              />
            )}
            <WeekBoard
              staff={staff}
              jobs={jobs}
              selectedDate={selectedDate}
              dispatcher={dispatcher && canWrite}
              onJobClick={(job) => {
                setEditingJob(job);
                setDurationDraft(
                  job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                );
              }}
              onMap={(userId) => void openRoute(userId)}
            />
          </div>
        </DndContext>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          {dispatcher && (
            <NeedsSchedulingRail
              jobs={railJobs}
              selectedId={selectedUnscheduled?._id ?? null}
              onSelect={setSelectedUnscheduled}
              onSuggest={() => void handleSuggest()}
              suggesting={suggesting}
              draggable={false}
            />
          )}
          {monthMode === "calendar" ? (
            <MonthCalendar
              monthDate={anchorDate}
              jobs={monthJobs}
              selectedDate={selectedDate}
              onSelectDate={(date) => {
                setSelectedDate(date);
                setView("week");
                setAnchorDate(date);
              }}
            />
          ) : (
            <MonthTable
              jobs={monthJobs}
              onJobClick={(job) => {
                setEditingJob(job);
                setDurationDraft(
                  job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                );
              }}
            />
          )}
        </div>
      )}

      {suggestions && selectedUnscheduled && (
        <SuggestAssigneeModal
          job={selectedUnscheduled}
          suggestions={suggestions}
          saving={saving}
          onAssign={(userId, start) =>
            void assignJob(selectedUnscheduled._id, userId, start)
          }
          onClose={() => setSuggestions(null)}
        />
      )}

      {editingJob && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-dark">
              {editingJob.customerName || "Work order"}
            </h3>
            <p className="mt-1 text-sm text-neutral-500">
              {formatAddressLine(editingJob.address)}
            </p>
            {editingViewHref ? (
              <Link
                href={editingViewHref}
                className="mt-2 inline-block text-sm font-medium text-brand-orange hover:underline"
              >
                View
              </Link>
            ) : null}
            <label className="mt-4 block text-sm font-medium text-brand-dark">
              Estimated time (minutes)
            </label>
            <input
              type="number"
              min={15}
              step={15}
              value={durationDraft}
              onChange={(e) => setDurationDraft(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {dispatcher && canWrite && editingJob.scheduledStart && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleCancelEditing()}
                  className="mr-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:underline disabled:opacity-40"
                >
                  Cancel appointment
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditingJob(null)}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600"
              >
                Close
              </button>
              {canWrite && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDuration()}
                  className="btn-primary px-4 py-1.5 text-sm disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {(routeUserId || routeLoading) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-dark">Day route</h3>
            <p className="mt-1 text-sm text-neutral-500">
              {formatPrettyDate(selectedDate)}
            </p>
            <div className="mt-4">
              {routeLoading || !routeStops ? (
                <p className="text-sm text-neutral-500">Loading map…</p>
              ) : (
                <DayRouteMap
                  stops={routeStops}
                  encodedPolyline={routePolyline}
                />
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setRouteUserId(null);
                  setRouteStops(null);
                }}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
