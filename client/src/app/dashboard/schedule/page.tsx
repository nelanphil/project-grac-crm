"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getScheduleRoute,
  getScheduleStaff,
  getScheduleWorkOrders,
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
  minutesToLabel,
  startOfMonth,
  startOfWeekSunday,
} from "@/lib/schedule";
import WeekBoard, {
  UnscheduledCard,
} from "@/components/schedule/WeekBoard";
import MonthCalendar from "@/components/schedule/MonthCalendar";
import MonthTable from "@/components/schedule/MonthTable";
import DayRouteMap from "@/components/schedule/DayRouteMap";

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

function SchedulePageInner() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user?.role);
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));

  const today = formatLocalDate(new Date());
  const [anchorDate, setAnchorDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<ViewMode>("week");
  const [monthMode, setMonthMode] = useState<MonthMode>("calendar");

  const [staff, setStaff] = useState<ScheduleStaffMember[]>([]);
  const [jobs, setJobs] = useState<WorkOrderListItem[]>([]);
  const [unscheduled, setUnscheduled] = useState<WorkOrderListItem[]>([]);
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
    setLoading(true);
    setError(null);
    try {
      const [board, unsched] = await Promise.all([
        getScheduleStaff(token, range.from, range.to),
        dispatcher
          ? getScheduleWorkOrders(token, {
              from: range.from,
              to: range.to,
              unscheduled: true,
            })
          : Promise.resolve([] as WorkOrderListItem[]),
      ]);
      setStaff(board.staff);
      setJobs(board.workOrders);
      setUnscheduled(unsched);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load schedule.",
      );
    } finally {
      setLoading(false);
    }
  }, [token, range.from, range.to, dispatcher]);

  useEffect(() => {
    void load();
  }, [load]);

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
      unscheduled.find((j) => j._id === workOrderId);
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

  const monthJobs = view === "month" ? [...jobs, ...unscheduled] : jobs;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Schedule</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {dispatcher
              ? "Dispatch work orders onto technician calendars and review routes."
              : "Your assigned work orders for the week. Update time needed if a job will run long."}
          </p>
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const next =
              view === "week" ? addDays(anchorDate, -7) : addDays(monthStart, -1);
            setAnchorDate(next);
            setSelectedDate(view === "week" ? addDays(weekStart, -7) : startOfMonth(next));
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
            setSelectedDate(view === "week" ? addDays(weekStart, 7) : startOfMonth(next));
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
              <aside className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-brand-dark">
                    Unscheduled
                  </h2>
                  <button
                    type="button"
                    disabled={!selectedUnscheduled || suggesting}
                    onClick={() => void handleSuggest()}
                    className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-40"
                  >
                    {suggesting ? "Suggesting…" : "Suggest tech"}
                  </button>
                </div>
                {unscheduled.length === 0 ? (
                  <p className="text-xs text-neutral-400">
                    No unscheduled work orders this week.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {unscheduled.map((order) => (
                      <UnscheduledCard
                        key={order._id}
                        order={order}
                        selected={selectedUnscheduled?._id === order._id}
                        onSelect={() => setSelectedUnscheduled(order)}
                      />
                    ))}
                  </div>
                )}
              </aside>
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
      ) : monthMode === "calendar" ? (
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

      {suggestions && selectedUnscheduled && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-dark">
              Suggested technicians
            </h3>
            <p className="mt-1 text-sm text-neutral-500">
              {selectedUnscheduled.customerName} ·{" "}
              {formatAddressLine(selectedUnscheduled.address)}
            </p>
            <ul className="mt-4 space-y-2">
              {suggestions.map((s) => (
                <li
                  key={s.userId}
                  className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium text-brand-dark">
                      {s.first_name} {s.last_name}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {s.reason}
                      {s.driveMinutes > 0
                        ? ` · ${minutesToLabel(s.driveMinutes)} drive`
                        : ""}
                      {` · ${minutesToLabel(s.remainingMinutes)} remaining`}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!s.fits || !s.proposedStart || saving}
                    onClick={() =>
                      void assignJob(
                        selectedUnscheduled._id,
                        s.userId,
                        s.proposedStart,
                      )
                    }
                    className="btn-primary shrink-0 px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    Assign
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSuggestions(null)}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
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
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingJob(null)}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-600"
              >
                Cancel
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

export default function SchedulePage() {
  return (
    <AuthGuard>
      <SchedulePageInner />
    </AuthGuard>
  );
}
