"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  geocodeMissingScheduleAddresses,
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
import ScheduleMap, {
  jobHasCoordinates,
} from "@/components/schedule/ScheduleMap";

type ViewMode = "week" | "month";
type MonthMode = "calendar" | "table";
type SurfaceMode = "calendar" | "map";
type RailFilter = "current" | "unscheduled";

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

function uniqueJobs(...lists: WorkOrderListItem[][]): WorkOrderListItem[] {
  const byId = new Map<string, WorkOrderListItem>();
  for (const list of lists) {
    for (const job of list) byId.set(job._id, job);
  }
  return [...byId.values()];
}

function applyAddressCoords(
  jobs: WorkOrderListItem[],
  updated: Array<{ addressId: string; lat: number; lng: number }>,
): WorkOrderListItem[] {
  if (updated.length === 0) return jobs;
  const byId = new Map(updated.map((row) => [row.addressId, row]));
  return jobs.map((job) => {
    const id = job.address?._id;
    const hit = id ? byId.get(id) : undefined;
    if (!hit || !job.address) return job;
    return {
      ...job,
      address: { ...job.address, lat: hit.lat, lng: hit.lng },
    };
  });
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

function RailFilterTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="group/tip relative">
      {children}
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden w-48 -translate-x-1/2 rounded-md bg-neutral-800 px-2 py-1.5 text-center text-[11px] font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity md:block md:group-hover/tip:opacity-100">
        {label}
      </span>
    </span>
  );
}

function ScheduleRail({
  jobs,
  filter,
  onFilter,
  selectedId,
  onSelect,
  onSuggest,
  suggesting,
  canSuggest,
  draggable,
}: {
  jobs: WorkOrderListItem[];
  filter: RailFilter;
  onFilter: (filter: RailFilter) => void;
  selectedId: string | null;
  onSelect: (job: WorkOrderListItem) => void;
  onSuggest: () => void;
  suggesting: boolean;
  canSuggest: boolean;
  draggable: boolean;
}) {
  return (
    <aside className="flex max-h-[40rem] min-h-0 flex-col space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-md border border-neutral-200 bg-white p-0.5 text-xs">
          <RailFilterTip label="All work orders in this week or month. Unscheduled jobs are listed first.">
            <button
              type="button"
              onClick={() => onFilter("current")}
              className={`rounded px-2.5 py-1 font-medium ${
                filter === "current"
                  ? "bg-brand-orange text-white"
                  : "text-neutral-600"
              }`}
            >
              Current
            </button>
          </RailFilterTip>
          <RailFilterTip label="Only work orders in this week or month that still need a time slot.">
            <button
              type="button"
              onClick={() => onFilter("unscheduled")}
              className={`rounded px-2.5 py-1 font-medium ${
                filter === "unscheduled"
                  ? "bg-brand-orange text-white"
                  : "text-neutral-600"
              }`}
            >
              Unscheduled
            </button>
          </RailFilterTip>
        </div>
        <button
          type="button"
          disabled={!canSuggest || suggesting}
          onClick={onSuggest}
          className="shrink-0 text-xs font-medium text-brand-orange hover:underline disabled:opacity-40"
        >
          {suggesting ? "Suggesting…" : "Suggest tech"}
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="text-xs text-neutral-400">
          {filter === "unscheduled"
            ? "No unscheduled work orders in this range."
            : "No work orders in this range."}
        </p>
      ) : (
        <div className="min-h-0 space-y-2 overflow-y-auto">
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
  initialDate?: string;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user?.role);
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));

  const today = formatLocalDate(new Date());
  const startDate = initialDate ?? today;
  const [anchorDate, setAnchorDate] = useState(startDate);
  const [selectedDate, setSelectedDate] = useState(startDate);
  const [view, setView] = useState<ViewMode>("week");
  const [monthMode, setMonthMode] = useState<MonthMode>("calendar");
  const [surface, setSurface] = useState<SurfaceMode>("calendar");
  const [railFilter, setRailFilter] = useState<RailFilter>("current");

  const [staff, setStaff] = useState<ScheduleStaffMember[]>([]);
  const [jobs, setJobs] = useState<WorkOrderListItem[]>([]);
  const [railJobs, setRailJobs] = useState<WorkOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [selectedRailJob, setSelectedRailJob] =
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

  const currentJobs = useMemo(() => {
    const merged = uniqueJobs(jobs, railJobs);
    return merged.sort((a, b) => {
      const aScheduled = a.scheduledStart ? 1 : 0;
      const bScheduled = b.scheduledStart ? 1 : 0;
      return aScheduled - bScheduled;
    });
  }, [jobs, railJobs]);
  const railListJobs =
    railFilter === "unscheduled" ? railJobs : currentJobs;
  const requestedGeocodeRef = useRef(new Set<string>());
  const [geocodingPins, setGeocodingPins] = useState(false);

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

  useEffect(() => {
    if (surface !== "map" || !token || !dispatcher) return;
    const authToken = token;
    let cancelled = false;

    async function run() {
      const missing = [
        ...new Set(
          currentJobs
            .map((job) => job.address)
            .filter(
              (addr): addr is NonNullable<typeof addr> =>
                Boolean(addr?._id) &&
                !jobHasCoordinates({ address: addr } as WorkOrderListItem),
            )
            .map((addr) => addr._id)
            .filter((id) => !requestedGeocodeRef.current.has(id)),
        ),
      ];
      if (missing.length === 0) return;
      setGeocodingPins(true);
      try {
        for (let i = 0; i < missing.length; i += 40) {
          if (cancelled) return;
          const batch = missing.slice(i, i + 40);
          const { updated } = await geocodeMissingScheduleAddresses(
            authToken,
            batch,
          );
          batch.forEach((id) => requestedGeocodeRef.current.add(id));
          if (updated.length === 0) continue;
          setRailJobs((prev) => applyAddressCoords(prev, updated));
          setJobs((prev) => applyAddressCoords(prev, updated));
          setSelectedRailJob((prev) =>
            prev ? (applyAddressCoords([prev], updated)[0] ?? prev) : prev,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to locate jobs on the map.",
          );
        }
      } finally {
        if (!cancelled) setGeocodingPins(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [surface, token, dispatcher, currentJobs]);

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
      setSelectedRailJob(null);
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
    const job =
      selectedRailJob && !selectedRailJob.scheduledStart
        ? selectedRailJob
        : null;
    if (!token || !job) return;
    setSuggesting(true);
    setError(null);
    try {
      const result = await suggestScheduleAssignee(token, {
        workOrderId: job._id,
        date: selectedDate,
        estimatedMinutes: job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
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

  function selectRailJob(job: WorkOrderListItem) {
    setSelectedRailJob(job);
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
          <span className="min-w-0 text-sm font-medium text-neutral-600 break-words">
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
          {view === "month" && surface === "calendar" && (
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
          <div className="flex rounded-md border border-neutral-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setSurface("calendar")}
              className={`rounded px-3 py-1.5 ${surface === "calendar" ? "bg-brand-orange text-white" : "text-neutral-600"}`}
            >
              Calendar
            </button>
            <button
              type="button"
              onClick={() => setSurface("map")}
              className={`rounded px-3 py-1.5 ${surface === "map" ? "bg-brand-orange text-white" : "text-neutral-600"}`}
            >
              Map
            </button>
          </div>
        </div>
      </div>

      {(view === "week" || surface === "map") && (
        <div className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:pb-0">
          {weekDays.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => {
                setSelectedDate(day);
                setAnchorDate(day);
              }}
              className={`shrink-0 rounded-md px-3 py-2 text-xs font-medium ${
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
      ) : surface === "map" ? (
        <div className="space-y-3">
          {geocodingPins && (
            <p className="text-xs text-neutral-500">
              Locating jobs on the map…
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
            {dispatcher && (
              <ScheduleRail
                jobs={railListJobs}
                filter={railFilter}
                onFilter={setRailFilter}
                selectedId={selectedRailJob?._id ?? null}
                onSelect={selectRailJob}
                onSuggest={() => void handleSuggest()}
                suggesting={suggesting}
                canSuggest={Boolean(
                  selectedRailJob && !selectedRailJob.scheduledStart,
                )}
                draggable={false}
              />
            )}
            <ScheduleMap
              unscheduled={dispatcher ? railJobs : []}
              scheduled={jobs}
              showScheduled={railFilter === "current"}
              selectedId={selectedRailJob?._id ?? null}
              onSelect={selectRailJob}
            />
          </div>
        </div>
      ) : view === "week" ? (
        <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
          <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
            {dispatcher && (
              <ScheduleRail
                jobs={railListJobs}
                filter={railFilter}
                onFilter={setRailFilter}
                selectedId={selectedRailJob?._id ?? null}
                onSelect={selectRailJob}
                onSuggest={() => void handleSuggest()}
                suggesting={suggesting}
                canSuggest={Boolean(
                  selectedRailJob && !selectedRailJob.scheduledStart,
                )}
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
            <ScheduleRail
              jobs={railListJobs}
              filter={railFilter}
              onFilter={setRailFilter}
              selectedId={selectedRailJob?._id ?? null}
              onSelect={selectRailJob}
              onSuggest={() => void handleSuggest()}
              suggesting={suggesting}
              canSuggest={Boolean(
                selectedRailJob && !selectedRailJob.scheduledStart,
              )}
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

      {suggestions && selectedRailJob && !selectedRailJob.scheduledStart && (
        <SuggestAssigneeModal
          job={selectedRailJob}
          suggestions={suggestions}
          saving={saving}
          onAssign={(userId, start) =>
            void assignJob(selectedRailJob._id, userId, start)
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
