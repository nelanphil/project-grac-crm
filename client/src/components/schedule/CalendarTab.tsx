"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  cancelWorkOrderAppointment,
  applyScheduleRoute,
  geocodeMissingScheduleAddresses,
  getScheduleQueue,
  getScheduleStaff,
  getScheduleStartOptions,
  placeScheduleWorkOrder,
  planScheduleRoute,
  type PlannedRoute,
  type RouteObjective,
  ScheduleStartOptions,
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
  formatLocalTime,
  formatMonthYear,
  formatPrettyDate,
  formatWeekdayDate,
  isDispatcherRole,
  localDateTimeToIso,
  minutesToHhMm,
  shiftMonth,
  startOfMonth,
  startOfWeekSunday,
  workOrderLocalDate,
  workOrderViewHref,
} from "@/lib/schedule";
import WeekBoard, {
  UnscheduledCard,
} from "@/components/schedule/WeekBoard";
import MonthCalendar from "@/components/schedule/MonthCalendar";
import MonthTable from "@/components/schedule/MonthTable";
import SuggestAssigneeModal from "@/components/schedule/SuggestAssigneeModal";
import RoutePlannerPanel, {
  type MapJobFilter,
} from "@/components/schedule/RoutePlannerPanel";
import ScheduleMap, {
  jobHasCoordinates,
} from "@/components/schedule/ScheduleMap";

type ViewMode = "week" | "month";
type MonthMode = "calendar" | "table";
type SurfaceMode = "calendar" | "map";
type RailFilter = "current" | "unscheduled";
type RailDateOrder = "asc" | "desc";

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

function startTimeHint(opts: ScheduleStartOptions): string | null {
  if (opts.warning) return opts.warning;
  if (opts.driveMinutes == null || !opts.driveFromLabel) return null;
  return `${opts.driveMinutes} min from ${opts.driveFromLabel}`;
}

function laterStartChoices(opts: {
  earliestIso: string;
  durationMinutes: number;
  windowEndIso: string | null;
  date: string;
  currentIso: string | null;
}): string[] {
  const earliest = new Date(opts.earliestIso);
  if (Number.isNaN(earliest.getTime())) return [];
  const durationMs = Math.max(15, opts.durationMinutes) * 60_000;
  const fallbackEnd = localDateTimeToIso(
    opts.date,
    `${String(BOARD_HOUR_END).padStart(2, "0")}:00`,
  );
  const cap = new Date(opts.windowEndIso ?? fallbackEnd);
  const capMs = Number.isNaN(cap.getTime())
    ? Number.POSITIVE_INFINITY
    : cap.getTime();
  const times = [earliest.getTime()];
  const quarter = 15 * 60_000;
  let cursor = Math.ceil((earliest.getTime() + 1) / quarter) * quarter;
  while (times.length < 96 && cursor + durationMs <= capMs) {
    times.push(cursor);
    cursor += quarter;
  }
  if (opts.currentIso) {
    const current = new Date(opts.currentIso).getTime();
    if (
      !Number.isNaN(current) &&
      current >= earliest.getTime() &&
      !times.includes(current)
    ) {
      times.push(current);
    }
  }
  times.sort((a, b) => a - b);
  return times.map((ms) => new Date(ms).toISOString());
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

const RAIL_WIDTH_KEY = "schedule-wizard-rail-width";
const RAIL_MIN = 220;
const RAIL_MAX = 560;
const RAIL_DEFAULT = 256;

function clampRailWidth(value: number): number {
  if (!Number.isFinite(value)) return RAIL_DEFAULT;
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(value)));
}

let memoryRailWidth: number | null = null;

function readRailWidth(): number {
  if (memoryRailWidth != null) return memoryRailWidth;
  try {
    const raw = window.localStorage.getItem(RAIL_WIDTH_KEY);
    return clampRailWidth(raw ? Number(raw) : RAIL_DEFAULT);
  } catch {
    return RAIL_DEFAULT;
  }
}

function writeRailWidth(value: number) {
  memoryRailWidth = value;
  try {
    window.localStorage.setItem(RAIL_WIDTH_KEY, String(value));
  } catch {
    /* ignore private-mode storage failures */
  }
}

async function fetchBoardData(
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
    unscheduled: queue.unscheduled,
  };
}

async function fetchRailMonth(token: string, from: string, to: string) {
  const [queue, board] = await Promise.all([
    getScheduleQueue(token, { from, to }),
    getScheduleStaff(token, from, to),
  ]);
  return {
    unscheduled: queue.unscheduled,
    scheduled: board.workOrders,
  };
}

type RailDayGroup = {
  key: string;
  label: string;
  jobs: WorkOrderListItem[];
};

function sortRailJobs(
  jobs: WorkOrderListItem[],
  order: RailDateOrder,
): WorkOrderListItem[] {
  const direction = order === "asc" ? 1 : -1;
  return [...jobs].sort((a, b) => {
    const aDate = workOrderLocalDate(a);
    const bDate = workOrderLocalDate(b);
    if (!aDate && !bDate) return compareWithinDay(a, b);
    if (!aDate) return 1;
    if (!bDate) return -1;
    if (aDate !== bDate) return aDate.localeCompare(bDate) * direction;
    return compareWithinDay(a, b);
  });
}

function compareWithinDay(a: WorkOrderListItem, b: WorkOrderListItem): number {
  const aScheduled = a.scheduledStart ? 1 : 0;
  const bScheduled = b.scheduledStart ? 1 : 0;
  if (aScheduled !== bScheduled) return aScheduled - bScheduled;
  return (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? "");
}

function groupJobsByDay(
  jobs: WorkOrderListItem[],
  order: RailDateOrder,
): RailDayGroup[] {
  const groups: RailDayGroup[] = [];
  for (const job of sortRailJobs(jobs, order)) {
    const date = workOrderLocalDate(job);
    const key = date ?? "none";
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.jobs.push(job);
      continue;
    }
    groups.push({
      key,
      label: date ? formatWeekdayDate(date) : "No date",
      jobs: [job],
    });
  }
  return groups;
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
  month,
  monthLabel,
  onMonth,
  dateOrder,
  onDateOrder,
  loading,
  selectedId,
  onSelect,
  onSuggest,
  suggesting,
  canSuggest,
  draggable,
  liftDrag = false,
}: {
  jobs: WorkOrderListItem[];
  filter: RailFilter;
  onFilter: (filter: RailFilter) => void;
  month: string;
  monthLabel: string;
  onMonth: (month: string) => void;
  dateOrder: RailDateOrder;
  onDateOrder: (order: RailDateOrder) => void;
  loading: boolean;
  selectedId: string | null;
  onSelect: (job: WorkOrderListItem) => void;
  onSuggest: () => void;
  suggesting: boolean;
  canSuggest: boolean;
  draggable: boolean;
  liftDrag?: boolean;
}) {
  const groups = useMemo(
    () => groupJobsByDay(jobs, dateOrder),
    [jobs, dateOrder],
  );
  const newestFirst = dateOrder === "desc";

  return (
    <aside className="flex max-h-[40rem] min-h-0 flex-col space-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonth(shiftMonth(month, -1))}
          className="rounded-md border border-neutral-200 bg-white p-1 text-neutral-600 hover:bg-neutral-50"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
        <input
          type="month"
          value={month}
          aria-label="Filter jobs by month and year"
          onChange={(event) => {
            if (event.target.value) onMonth(event.target.value);
          }}
          className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-brand-dark"
        />
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonth(shiftMonth(month, 1))}
          className="rounded-md border border-neutral-200 bg-white p-1 text-neutral-600 hover:bg-neutral-50"
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md border border-neutral-200 bg-white p-0.5 text-xs">
          <RailFilterTip
            label={`All work orders in ${monthLabel}. Unscheduled jobs are listed first within each day.`}
          >
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
          <RailFilterTip
            label={`Only work orders in ${monthLabel} that still need a time slot.`}
          >
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-pressed={newestFirst}
            aria-label={
              newestFirst
                ? "Showing newest dates first. Show oldest first."
                : "Showing oldest dates first. Show newest first."
            }
            onClick={() => onDateOrder(newestFirst ? "asc" : "desc")}
            className="inline-flex items-center gap-0.5 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
          >
            {newestFirst ? (
              <ArrowUp className="h-3 w-3" aria-hidden />
            ) : (
              <ArrowDown className="h-3 w-3" aria-hidden />
            )}
            {newestFirst ? "Newest" : "Oldest"}
          </button>
          <button
            type="button"
            disabled={!canSuggest || suggesting}
            onClick={onSuggest}
            className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-40"
          >
            {suggesting ? "Suggesting…" : "Suggest tech"}
          </button>
        </div>
      </div>
      {loading ? (
        <p className="text-xs text-neutral-400">Loading work orders…</p>
      ) : jobs.length === 0 ? (
        <p className="text-xs text-neutral-400">
          {filter === "unscheduled"
            ? `No unscheduled work orders in ${monthLabel}.`
            : `No work orders in ${monthLabel}.`}
        </p>
      ) : (
        <div className="min-h-0 space-y-3 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h3 className="sticky top-0 z-10 border-b border-neutral-200 bg-[var(--staff-canvas)] px-0.5 py-1.5 text-xs font-semibold text-brand-dark">
                {group.label}
              </h3>
              {group.jobs.map((order) => (
                <UnscheduledCard
                  key={order._id}
                  order={order}
                  selected={selectedId === order._id}
                  onSelect={() => onSelect(order)}
                  draggable={draggable}
                  lift={liftDrag}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

function ScheduleSplit({
  sidebar,
  children,
}: {
  sidebar: ReactNode | null;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => memoryRailWidth ?? RAIL_DEFAULT);
  const widthRef = useRef(width);
  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const stored = readRailWidth();
    memoryRailWidth = stored;
    setWidth(stored);
  }, []);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => () => dragCleanup.current?.(), []);

  function applyWidth(next: number) {
    const clamped = clampRailWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
    writeRailWidth(clamped);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCleanup.current?.();
    const startX = event.clientX;
    const startWidth = widthRef.current;

    function onMove(moveEvent: PointerEvent) {
      applyWidth(startWidth + (moveEvent.clientX - startX));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      dragCleanup.current = null;
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dragCleanup.current = onUp;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyWidth(widthRef.current - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applyWidth(widthRef.current + step);
    }
  }

  if (!sidebar) return <>{children}</>;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <div
        className="w-full min-w-0 lg:w-[var(--schedule-rail-width)] lg:shrink-0"
        style={{ "--schedule-rail-width": `${width}px` } as CSSProperties}
      >
        {sidebar}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize job list"
        aria-valuemin={RAIL_MIN}
        aria-valuemax={RAIL_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="group relative hidden w-3 shrink-0 cursor-col-resize focus:outline-none lg:block"
      >
        <span className="absolute inset-y-8 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-neutral-600/35 group-hover:bg-brand-orange group-focus:bg-brand-orange" />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function CalendarTab({
  initialDate,
}: {
  initialDate?: string;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user);
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));

  const today = formatLocalDate(new Date());
  const startDate = initialDate ?? today;
  const [anchorDate, setAnchorDate] = useState(startDate);
  const [selectedDate, setSelectedDate] = useState(startDate);
  const [view, setView] = useState<ViewMode>("week");
  const [monthMode, setMonthMode] = useState<MonthMode>("calendar");
  const [surface, setSurface] = useState<SurfaceMode>("calendar");
  const [railFilter, setRailFilter] = useState<RailFilter>("current");
  const [railDateOrder, setRailDateOrder] = useState<RailDateOrder>("asc");
  const [railMonth, setRailMonth] = useState(() => today.slice(0, 7));

  const [staff, setStaff] = useState<ScheduleStaffMember[]>([]);
  const [jobs, setJobs] = useState<WorkOrderListItem[]>([]);
  const [calendarUnscheduled, setCalendarUnscheduled] = useState<
    WorkOrderListItem[]
  >([]);
  const [railJobs, setRailJobs] = useState<WorkOrderListItem[]>([]);
  const [railScheduled, setRailScheduled] = useState<WorkOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [railLoading, setRailLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [selectedRailJob, setSelectedRailJob] =
    useState<WorkOrderListItem | null>(null);
  const [editingJob, setEditingJob] = useState<WorkOrderListItem | null>(null);
  const [durationDraft, setDurationDraft] = useState(60);
  const [startOptions, setStartOptions] = useState<ScheduleStartOptions | null>(
    null,
  );
  const [startOptionsLoading, setStartOptionsLoading] = useState(false);
  const [startDraft, setStartDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const [suggestions, setSuggestions] = useState<ScheduleSuggestion[] | null>(
    null,
  );
  const [suggesting, setSuggesting] = useState(false);

  const [mapJobFilter, setMapJobFilter] = useState<MapJobFilter>("scheduled");
  const [routeTechId, setRouteTechId] = useState<string | null>(null);
  const [roundTrip, setRoundTrip] = useState(true);
  const [routeObjective, setRouteObjective] = useState<RouteObjective>("time");
  const [addedUnscheduledIds, setAddedUnscheduledIds] = useState<string[]>([]);
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [routeLocks, setRouteLocks] = useState<Record<string, string>>({});
  const [unscheduling, setUnscheduling] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null,
  );
  const [routePlan, setRoutePlan] = useState<PlannedRoute | null>(null);
  const [routePlanning, setRoutePlanning] = useState(false);
  const [routeOptimizing, setRouteOptimizing] = useState(false);
  const [routeApplying, setRouteApplying] = useState(false);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null);
  const planSeq = useRef(0);
  const optimizeLock = useRef(false);
  const effectiveTechId = !dispatcher && user?.id ? user.id : routeTechId;

  const editingId = editingJob?._id ?? null;
  const editingStart = editingJob?.scheduledStart ?? null;
  const canEditStart = Boolean(
    dispatcher &&
      canWrite &&
      editingId &&
      editingStart &&
      editingJob?.assignedUserRef,
  );

  useEffect(() => {
    if (!token || !canEditStart || !editingId || !editingStart) {
      setStartOptions(null);
      setStartDraft("");
      setStartOptionsLoading(false);
      return;
    }
    let cancelled = false;
    setStartOptionsLoading(true);
    setStartOptions(null);
    void getScheduleStartOptions(token, editingId)
      .then((opts) => {
        if (cancelled) return;
        setStartOptions(opts);
        if (opts.isFirst) {
          setStartDraft(formatLocalTime(new Date(editingStart)));
          return;
        }
        const current = new Date(editingStart);
        const earliest = opts.earliestStart
          ? new Date(opts.earliestStart)
          : current;
        setStartDraft(
          !Number.isNaN(current.getTime()) &&
            current.getTime() >= earliest.getTime()
            ? current.toISOString()
            : earliest.toISOString(),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setStartOptions(null);
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load start times.",
        );
      })
      .finally(() => {
        if (!cancelled) setStartOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, canEditStart, editingId, editingStart]);

  const laterChoices = useMemo(() => {
    if (!startOptions || startOptions.isFirst || !startOptions.earliestStart) {
      return [];
    }
    return laterStartChoices({
      earliestIso: startOptions.earliestStart,
      durationMinutes: durationDraft,
      windowEndIso: startOptions.windowEnd,
      date: startOptions.date,
      currentIso: editingStart,
    });
  }, [startOptions, durationDraft, editingStart]);
  const selectedLaterStart = laterChoices.includes(startDraft)
    ? startDraft
    : (laterChoices[0] ?? "");

  const weekStart = startOfWeekSunday(anchorDate);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = addDays(monthStart, daysInMonth(monthStart) - 1);

  const range = useMemo(() => {
    if (view === "week") return { from: weekStart, to: weekEnd };
    return { from: monthStart, to: monthEnd };
  }, [view, weekStart, weekEnd, monthStart, monthEnd]);

  const railFrom = `${railMonth}-01`;
  const railTo = addDays(railFrom, daysInMonth(railFrom) - 1);
  const railMonthLabel = formatMonthYear(railMonth);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const railListJobs = useMemo(
    () =>
      railFilter === "unscheduled"
        ? railJobs
        : uniqueJobs(railScheduled, railJobs),
    [railFilter, railJobs, railScheduled],
  );
  const mapJobs = useMemo(
    () => uniqueJobs(jobs, calendarUnscheduled, railJobs),
    [jobs, calendarUnscheduled, railJobs],
  );
  const jobById = useMemo(() => {
    const byId = new Map<string, WorkOrderListItem>();
    for (const job of uniqueJobs(jobs, calendarUnscheduled, railJobs, railScheduled)) {
      byId.set(job._id, job);
    }
    return byId;
  }, [jobs, calendarUnscheduled, railJobs, railScheduled]);
  const draggingJob = draggingJobId
    ? (jobById.get(draggingJobId) ?? null)
    : null;
  const dayJobs = useMemo(() => {
    if (!effectiveTechId) return [];
    return jobs
      .filter((job) => {
        if (job.completed || !job.scheduledStart || job.appointmentCanceledAt) {
          return false;
        }
        const assignee = job.assignedUserRef ?? job.assignee?._id ?? "";
        if (assignee !== effectiveTechId) return false;
        return workOrderLocalDate(job) === selectedDate;
      })
      .sort((a, b) => {
        const aTime = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
        const bTime = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
        return aTime - bTime;
      });
  }, [jobs, effectiveTechId, selectedDate]);
  const addedJobs = useMemo(
    () =>
      addedUnscheduledIds
        .map((id) => jobById.get(id))
        .filter((job): job is WorkOrderListItem => Boolean(job && !job.scheduledStart)),
    [addedUnscheduledIds, jobById],
  );
  const routeJobs = useMemo(() => {
    const seen = new Set(dayJobs.map((job) => job._id));
    return [...dayJobs, ...addedJobs.filter((job) => !seen.has(job._id))];
  }, [dayJobs, addedJobs]);
  const jobsTodayByTech = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const job of jobs) {
      if (!job.scheduledStart || job.completed || job.appointmentCanceledAt) {
        continue;
      }
      if (workOrderLocalDate(job) !== selectedDate) continue;
      const id = job.assignedUserRef ?? job.assignee?._id ?? "";
      if (!id) continue;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [jobs, selectedDate]);
  const routeStopIds = useMemo(() => {
    const available = routeJobs.map((job) => job._id);
    if (!manualOrder) return available;
    const availableSet = new Set(available);
    const kept = manualOrder.filter((id) => availableSet.has(id));
    const rest = available.filter((id) => !kept.includes(id));
    return [...kept, ...rest];
  }, [routeJobs, manualOrder]);
  const routeStopKey = routeStopIds.join(",");
  const activeRouteLocks = useMemo(
    () =>
      routeStopIds.flatMap((id) => {
        const time = routeLocks[id];
        if (!time) return [];
        return [
          {
            workOrderId: id,
            arrival: localDateTimeToIso(selectedDate, time),
          },
        ];
      }),
    [routeStopIds, routeLocks, selectedDate],
  );
  const unscheduledPins = useMemo(
    () =>
      uniqueJobs(calendarUnscheduled, railJobs).filter(
        (job) => !job.scheduledStart && !job.completed,
      ),
    [calendarUnscheduled, railJobs],
  );
  const routeTotalsMatch = useMemo(() => {
    if (!routePlan || routeStopIds.length === 0) return false;
    const routed = new Set(routePlan.orderedWorkOrderIds);
    const clientRouted = routeStopIds.filter((id) => routed.has(id));
    return clientRouted.join(",") === routePlan.orderedWorkOrderIds.join(",");
  }, [routePlan, routeStopIds]);
  const requestedGeocodeRef = useRef(new Set<string>());
  const [geocodingPins, setGeocodingPins] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [board, rail] = await Promise.all([
        fetchBoardData(token, range.from, range.to, dispatcher),
        dispatcher
          ? fetchRailMonth(token, railFrom, railTo)
          : Promise.resolve(null),
      ]);
      setStaff(board.staff);
      setJobs(board.jobs);
      setCalendarUnscheduled(board.unscheduled);
      if (rail) {
        setRailJobs(rail.unscheduled);
        setRailScheduled(rail.scheduled);
      }
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load schedule.",
      );
    } finally {
      setLoading(false);
      setRailLoading(false);
    }
  }, [token, range.from, range.to, dispatcher, railFrom, railTo]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    void (async () => {
      try {
        const data = await fetchBoardData(
          token,
          range.from,
          range.to,
          dispatcher,
        );
        if (cancelled) return;
        setStaff(data.staff);
        setJobs(data.jobs);
        setCalendarUnscheduled(data.unscheduled);
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
    if (!token || !dispatcher) {
      setRailJobs([]);
      setRailScheduled([]);
      setRailLoading(false);
      return;
    }
    let cancelled = false;
    setRailLoading(true);
    void (async () => {
      try {
        const data = await fetchRailMonth(token, railFrom, railTo);
        if (cancelled) return;
        setRailJobs(data.unscheduled);
        setRailScheduled(data.scheduled);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load schedule.",
        );
      } finally {
        if (!cancelled) setRailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, dispatcher, railFrom, railTo]);

  useEffect(() => {
    if (surface !== "map" || !token || !dispatcher) return;
    const authToken = token;
    let cancelled = false;

    async function run() {
      const missing = [
        ...new Set(
          mapJobs
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
          setCalendarUnscheduled((prev) => applyAddressCoords(prev, updated));
          setRailJobs((prev) => applyAddressCoords(prev, updated));
          setRailScheduled((prev) => applyAddressCoords(prev, updated));
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
  }, [surface, token, dispatcher, mapJobs]);

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

  function addDroppedJob(overId: string, workOrderId: string) {
    const job = jobById.get(workOrderId);
    if (!job || job.scheduledStart || job.completed) return;
    const droppedTechId = overId.startsWith("tech:")
      ? overId.slice(5)
      : effectiveTechId;
    if (!droppedTechId) {
      setRouteMessage("Drop the appointment on a technician, or select one first.");
      return;
    }
    setRouteMessage(null);
    if (droppedTechId !== effectiveTechId) {
      setRouteTechId(droppedTechId);
      setManualOrder(null);
      setRoutePlan(null);
      setAddedUnscheduledIds([workOrderId]);
      return;
    }
    setAddedUnscheduledIds((current) =>
      current.includes(workOrderId) ? current : [...current, workOrderId],
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!dispatcher || !canWrite) return;
    const overId = event.over?.id ? String(event.over.id) : "";
    const activeId = String(event.active.id);
    if (!activeId.startsWith("job:")) return;
    if (
      overId.startsWith("tech:") ||
      overId === "schedule-map" ||
      overId === "route-table"
    ) {
      addDroppedJob(overId, activeId.slice(4));
      return;
    }
    if (!overId.startsWith("row:")) return;
    const userId = overId.slice(4);
    const workOrderId = activeId.slice(4);
    const minutes = dropMinutes(event);
    if (minutes == null) return;
    const hhmm = minutesToHhMm(minutes);
    const iso = localDateTimeToIso(selectedDate, hhmm);
    if (!token) return;
    setSaving(true);
    setWarning(null);
    setError(null);
    try {
      const placed = await placeScheduleWorkOrder(token, {
        workOrderId,
        assignedUserRef: userId,
        date: selectedDate,
        scheduledStart: iso,
      });
      if (placed.warnings?.length) {
        setWarning(placed.warnings.join(" "));
      }
      setSelectedRailJob(null);
      setSuggestions(null);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to place work order.",
      );
    } finally {
      setSaving(false);
    }
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
    if (
      surface !== "map" ||
      mapJobFilter !== "unscheduled" ||
      !dispatcher ||
      !effectiveTechId ||
      job.scheduledStart
    ) {
      return;
    }
    setAddedUnscheduledIds((current) =>
      current.includes(job._id)
        ? current.filter((id) => id !== job._id)
        : [...current, job._id],
    );
  }

  function toggleRouteLock(id: string) {
    setRouteLocks((current) => {
      if (current[id]) {
        const next = { ...current };
        delete next[id];
        return next;
      }
      const fromPlan = routeTotalsMatch
        ? routePlan?.stops.find((stop) => stop.workOrderId === id)?.arrival
        : null;
      const scheduled = jobById.get(id)?.scheduledStart;
      const source = fromPlan || scheduled;
      const time = source ? formatLocalTime(new Date(source)) : "08:00";
      return { ...current, [id]: time };
    });
  }

  function setRouteLockTime(id: string, time: string) {
    if (!time) return;
    setRouteLocks((current) => ({ ...current, [id]: time }));
  }

  function forgetRouteStop(id: string) {
    setAddedUnscheduledIds((current) => current.filter((item) => item !== id));
    setManualOrder((current) =>
      current ? current.filter((item) => item !== id) : current,
    );
    setRouteLocks((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function stopIsScheduledOnDay(id: string): boolean {
    const job = jobById.get(id);
    const assignee = job?.assignedUserRef ?? job?.assignee?._id ?? "";
    return Boolean(
      job?.scheduledStart &&
        !job.completed &&
        !job.appointmentCanceledAt &&
        assignee === effectiveTechId &&
        workOrderLocalDate(job) === selectedDate,
    );
  }

  function requestRemoveRouteStop(id: string) {
    if (!dispatcher || !canWrite || unscheduling) return;
    if (!stopIsScheduledOnDay(id)) {
      setConfirmingRemoveId((current) => (current === id ? null : current));
      forgetRouteStop(id);
      return;
    }
    setConfirmingRemoveId(id);
  }

  async function confirmRemoveRouteStop(id: string) {
    if (!dispatcher || !canWrite || unscheduling || !token) return;
    if (!stopIsScheduledOnDay(id)) {
      forgetRouteStop(id);
      setConfirmingRemoveId(null);
      return;
    }
    setUnscheduling(true);
    setRouteMessage(null);
    try {
      await updateWorkOrder(token, id, {
        scheduledStart: null,
        assignedUserRef: null,
      });
      forgetRouteStop(id);
      setConfirmingRemoveId(null);
      await load();
    } catch (err) {
      setRouteMessage(
        err instanceof ApiError
          ? err.message
          : "Failed to unschedule work order.",
      );
    } finally {
      setUnscheduling(false);
    }
  }

  function moveRouteStop(id: string, direction: -1 | 1) {
    const order = routeStopIds.slice();
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    const [item] = order.splice(index, 1);
    if (!item) return;
    order.splice(target, 0, item);
    setManualOrder(order);
  }

  const runPlan = useCallback(
    async (optimize: boolean) => {
      if (!token || !effectiveTechId || routeStopIds.length === 0) {
        return;
      }
      if (optimize) optimizeLock.current = true;
      const seq = ++planSeq.current;
      if (optimize) setRouteOptimizing(true);
      else setRoutePlanning(true);
      setRouteMessage(null);
      try {
        const result = await planScheduleRoute(token, {
          userId: effectiveTechId,
          date: selectedDate,
          workOrderIds: routeStopIds,
          roundTrip,
          objective: routeObjective,
          optimize,
          lockedStops: activeRouteLocks,
        });
        if (seq !== planSeq.current) return;
        if (optimize) setManualOrder(result.orderedWorkOrderIds);
        setRoutePlan(result);
      } catch (err) {
        if (seq !== planSeq.current) return;
        setRoutePlan(null);
        setRouteMessage(
          err instanceof ApiError ? err.message : "Failed to plan route.",
        );
      } finally {
        if (optimize) optimizeLock.current = false;
        if (seq === planSeq.current) {
          setRoutePlanning(false);
          setRouteOptimizing(false);
        }
      }
    },
    [
      token,
      effectiveTechId,
      routeStopIds,
      selectedDate,
      roundTrip,
      routeObjective,
      activeRouteLocks,
    ],
  );

  useEffect(() => {
    if (surface !== "map" || !effectiveTechId || routeStopIds.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (optimizeLock.current) return;
      void runPlan(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [surface, effectiveTechId, routeStopKey, roundTrip, runPlan, routeStopIds.length]);

  async function applyRoute() {
    if (!token || !effectiveTechId || routeStopIds.length === 0 || !canWrite) return;
    const tech = staff.find((person) => person._id === effectiveTechId);
    const name = tech
      ? `${tech.first_name} ${tech.last_name}`
      : "this technician";
    const confirmed = window.confirm(
      `Assign this route to ${name} on ${formatPrettyDate(selectedDate)} and rewrite start times for the day?`,
    );
    if (!confirmed) return;
    setRouteApplying(true);
    setRouteMessage(null);
    setWarning(null);
    try {
      const applied = await applyScheduleRoute(token, {
        userId: effectiveTechId,
        date: selectedDate,
        orderedWorkOrderIds: routeStopIds,
        lockedStops: activeRouteLocks,
      });
      if (applied.warnings?.length) setWarning(applied.warnings.join(" "));
      setAddedUnscheduledIds([]);
      setManualOrder(null);
      await load();
    } catch (err) {
      setRouteMessage(
        err instanceof ApiError ? err.message : "Failed to apply route.",
      );
    } finally {
      setRouteApplying(false);
    }
  }

  async function saveDuration() {
    if (!token || !editingJob) return;
    setSaving(true);
    setWarning(null);
    setError(null);
    try {
      if (canEditStart && startOptions && editingJob.assignedUserRef) {
        const scheduledStart = startOptions.isFirst
          ? localDateTimeToIso(startOptions.date, startDraft)
          : selectedLaterStart;
        if (!scheduledStart) {
          setError("Choose a start time.");
          return;
        }
        const placed = await placeScheduleWorkOrder(token, {
          workOrderId: editingJob._id,
          assignedUserRef: editingJob.assignedUserRef,
          date: startOptions.date,
          scheduledStart,
          estimatedMinutes: durationDraft,
        });
        if (placed.warnings?.length) setWarning(placed.warnings.join(" "));
      } else {
        const updated = await updateWorkOrder(token, editingJob._id, {
          estimatedMinutes: durationDraft,
        });
        if (updated.warnings?.length) setWarning(updated.warnings.join(" "));
      }
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

  const monthJobs =
    view === "month" ? uniqueJobs(jobs, calendarUnscheduled) : jobs;
  function changeRailMonth(next: string) {
    if (next === railMonth) return;
    setRailLoading(true);
    setRailMonth(next);
  }

  const rail = dispatcher ? (
    <ScheduleRail
      jobs={railListJobs}
      filter={railFilter}
      onFilter={setRailFilter}
      month={railMonth}
      monthLabel={railMonthLabel}
      onMonth={changeRailMonth}
      dateOrder={railDateOrder}
      onDateOrder={setRailDateOrder}
      loading={railLoading}
      selectedId={selectedRailJob?._id ?? null}
      onSelect={selectRailJob}
      onSuggest={() => void handleSuggest()}
      suggesting={suggesting}
      canSuggest={Boolean(
        selectedRailJob && !selectedRailJob.scheduledStart,
      )}
      draggable={
        canWrite &&
        (surface === "map"
          ? dispatcher
          : view === "week" && surface === "calendar")
      }
      liftDrag={surface === "map"}
    />
  ) : null;
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
        <DndContext
          key="schedule-map"
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(event) => {
            const id = String(event.active.id);
            setDraggingJobId(id.startsWith("job:") ? id.slice(4) : null);
          }}
          onDragCancel={() => setDraggingJobId(null)}
          onDragEnd={(event) => {
            setDraggingJobId(null);
            void handleDragEnd(event);
          }}
        >
        <div className="space-y-3">
          {geocodingPins && (
            <p className="text-xs text-neutral-500">
              Locating jobs on the map…
            </p>
          )}
          <ScheduleSplit sidebar={rail}>
            <div className="space-y-3">
              <RoutePlannerPanel
                staff={staff}
                techId={effectiveTechId}
                onTech={(id) => {
                  setRouteTechId(id || null);
                  setAddedUnscheduledIds([]);
                  setManualOrder(null);
                  setRouteLocks({});
                  setRoutePlan(null);
                  setRouteMessage(null);
                  setConfirmingRemoveId(null);
                }}
                techLocked={!dispatcher}
                filter={mapJobFilter}
                onFilter={setMapJobFilter}
                allowUnscheduled={dispatcher}
                roundTrip={roundTrip}
                onRoundTrip={setRoundTrip}
                objective={routeObjective}
                onObjective={setRouteObjective}
                onOptimize={() => void runPlan(true)}
                onApply={() => void applyRoute()}
                canApply={dispatcher && canWrite}
                optimizing={routeOptimizing}
                applying={routeApplying}
                planning={routePlanning}
                message={routeMessage}
                warnings={
                  routeTotalsMatch ? (routePlan?.warnings ?? []) : []
                }
                jobs={routeStopIds.map((id) => {
                  const stop = routeTotalsMatch
                    ? routePlan?.stops.find((item) => item.workOrderId === id)
                    : undefined;
                  const order = jobById.get(id);
                  return {
                    id,
                    label: order?.customerName || "Work order",
                    arrival: stop?.arrival,
                    departure: stop?.departure,
                    startTime: order?.startTime,
                    endTime: order?.endTime,
                  };
                })}
                stops={routeTotalsMatch ? (routePlan?.stops ?? []) : []}
                legs={routeTotalsMatch ? (routePlan?.route?.legs ?? []) : []}
                orderedWorkOrderIds={
                  routeTotalsMatch ? (routePlan?.orderedWorkOrderIds ?? []) : []
                }
                totalMinutes={routePlan?.route?.durationMinutes}
                totalMeters={routePlan?.route?.distanceMeters}
                showTotals={Boolean(routeTotalsMatch && routePlan?.route)}
                onMove={moveRouteStop}
                onRemove={
                  dispatcher && canWrite ? requestRemoveRouteStop : undefined
                }
                confirmingRemoveId={confirmingRemoveId}
                onConfirmRemove={(id) => void confirmRemoveRouteStop(id)}
                onCancelRemove={() => setConfirmingRemoveId(null)}
                removing={unscheduling}
                dayCounts={jobsTodayByTech}
                locks={routeLocks}
                onToggleLock={toggleRouteLock}
                onLockTime={setRouteLockTime}
              />
              <ScheduleMap
                unscheduled={
                  dispatcher && mapJobFilter === "unscheduled"
                    ? unscheduledPins
                    : addedJobs
                }
                scheduled={dayJobs}
                pinMode={mapJobFilter}
                selectedId={selectedRailJob?._id ?? null}
                onSelect={selectRailJob}
                routeStops={
                  routeTotalsMatch && routePlan ? routePlan.stops : undefined
                }
                encodedPolyline={
                  routeTotalsMatch ? routePlan?.route?.encodedPolyline : undefined
                }
              />
            </div>
          </ScheduleSplit>
        </div>
          <DragOverlay dropAnimation={null}>
            {draggingJob ? (
              <div className="w-56">
                <UnscheduledCard
                  order={draggingJob}
                  selected={false}
                  onSelect={() => {}}
                  draggable={false}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : view === "week" ? (
        <DndContext
          key="schedule-week"
          sensors={sensors}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <ScheduleSplit sidebar={rail}>
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
              onMap={(userId) => {
                setRouteTechId(userId);
                setSurface("map");
                setMapJobFilter("scheduled");
                setAddedUnscheduledIds([]);
                setManualOrder(null);
                setRouteLocks({});
                setRoutePlan(null);
                setRouteMessage(null);
              }}
            />
          </ScheduleSplit>
        </DndContext>
      ) : (
        <ScheduleSplit sidebar={rail}>
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
        </ScheduleSplit>
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
            {canEditStart && (
              <div className="mt-4">
                <label className="block text-sm font-medium text-brand-dark">
                  Start time
                </label>
                {startOptionsLoading ? (
                  <p className="mt-1 text-sm text-neutral-400">
                    Loading start times…
                  </p>
                ) : startOptions?.isFirst ? (
                  <input
                    type="time"
                    step={900}
                    value={startDraft}
                    onChange={(e) => setStartDraft(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
                  />
                ) : startOptions ? (
                  <select
                    value={selectedLaterStart}
                    onChange={(e) => setStartDraft(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
                  >
                    {laterChoices.map((iso) => (
                      <option key={iso} value={iso}>
                        {formatLocalTime(new Date(iso))}
                      </option>
                    ))}
                  </select>
                ) : null}
                {startOptions && startTimeHint(startOptions) ? (
                  <p className="mt-1 text-xs text-neutral-500">
                    {startTimeHint(startOptions)}
                  </p>
                ) : null}
              </div>
            )}
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
                  disabled={
                    saving ||
                    (canEditStart &&
                      (startOptionsLoading ||
                        !startOptions ||
                        (startOptions.isFirst
                          ? !startDraft
                          : !selectedLaterStart)))
                  }
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

    </div>
  );
}
