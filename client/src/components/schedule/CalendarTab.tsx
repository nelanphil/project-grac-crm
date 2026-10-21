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
import {
  type CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  cancelWorkOrderAppointment,
  type CityBoundaryCollection,
  geocodeMissingScheduleAddresses,
  getCityBoundaries,
  getScheduleQueue,
  getScheduleRecommendations,
  getScheduleStaff,
  getScheduleStartOptions,
  getWorkOrder,
  applyScheduleRoute,
  placeScheduleWorkOrder,
  planScheduleRoute,
  type PlannedRoute,
  type RouteObjective,
  ScheduleRecommendation,
  ScheduleStartOptions,
  ScheduleStaffMember,
  ScheduleSuggestion,
  suggestScheduleAssignee,
  updateWorkOrder,
  type ServiceCity,
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
  formatLocalClock,
  formatMonthYear,
  formatPrettyDate,
  formatWeekdayDate,
  isDispatcherRole,
  isScheduledOnDate,
  localDateTimeToIso,
  minutesToHhMm,
  normalizeTimeOfDay,
  shiftMonth,
  startOfMonth,
  startOfWeekSunday,
  resolvedTechnicianColor,
  workOrderCrewIds,
  workOrderLocalDate,
} from "@/lib/schedule";
import WeekBoard, {
  UnscheduledCard,
} from "@/components/schedule/WeekBoard";
import MonthCalendar from "@/components/schedule/MonthCalendar";
import MonthTable from "@/components/schedule/MonthTable";
import SuggestAssigneeModal from "@/components/schedule/SuggestAssigneeModal";
import GeneracScheduleLoadingOverlay from "@/components/schedule/GeneracScheduleLoadingOverlay";
import {
  MapRouteToolbar,
  TechnicianRoutePane,
} from "@/components/schedule/RoutePlannerPanel";
import ScheduleMap, {
  jobHasCoordinates,
} from "@/components/schedule/ScheduleMap";
import Segmented from "@/components/schedule/Segmented";
import WorkOrderModal from "@/components/work-orders/WorkOrderModal";
import {
  cityMatchesZone,
  jobOutsideServiceCities,
  territoryPlaceLabel,
} from "@/lib/serviceTerritory";

type ViewMode = "week" | "month";
type MonthMode = "calendar" | "table";
type SurfaceMode = "calendar" | "map";

function dropColumnId(overId: string): string {
  if (overId.startsWith("row:") || overId.startsWith("col:")) return overId.slice(4);
  return "";
}

const calendarCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const slotCollision = collisions.find((c) => String(c.id).startsWith("slot:"));
  if (slotCollision) return [slotCollision];
  return collisions;
};

function dayColumnMinutes(userId: string, event: DragEndEvent): number | null {
  const translated = event.active.rect.current.translated;
  if (!translated) return null;
  const day =
    typeof document !== "undefined"
      ? document.querySelector(`[data-schedule-day="${userId}"]`)
      : null;
  const rect = day?.getBoundingClientRect();
  const overId = event.over?.id ? String(event.over.id) : "";
  const top = rect?.top ?? (overId.startsWith("row:") ? event.over?.rect.top : undefined);
  const height =
    rect?.height ?? (overId.startsWith("row:") ? event.over?.rect.height : undefined);
  if (top == null || height == null) return null;
  const y = translated.top + Math.min(translated.height, 24) / 2 - top;
  const ratio = Math.max(0, Math.min(0.999, y / Math.max(1, height)));
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
const RAIL_DEFAULT = 288;

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

const STAFF_ORDER_KEY = "schedule-wizard-staff-order";
const SCHEDULE_VIEW_KEY = "schedule-wizard-view";
const SCHEDULE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ScheduleViewPrefs = {
  view?: ViewMode;
  layout?: MonthMode;
  surface?: SurfaceMode;
  date?: string;
  tab?: "calendar" | "technicians";
};

function readScheduleView(): ScheduleViewPrefs | null {
  try {
    const raw = window.localStorage.getItem(SCHEDULE_VIEW_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ScheduleViewPrefs;
  } catch {
    return null;
  }
}

function rememberScheduleView(patch: ScheduleViewPrefs) {
  try {
    const current = readScheduleView() ?? {};
    window.localStorage.setItem(
      SCHEDULE_VIEW_KEY,
      JSON.stringify({ ...current, ...patch }),
    );
  } catch {
    /* ignore private-mode storage failures */
  }
}

function storedViewChoice(value: unknown): ViewMode | null {
  return value === "week" || value === "month" ? value : null;
}

function storedLayoutChoice(value: unknown): MonthMode | null {
  return value === "calendar" || value === "table" ? value : null;
}

function storedSurfaceChoice(value: unknown): SurfaceMode | null {
  return value === "calendar" || value === "map" ? value : null;
}

export function storedScheduleTab(): "technicians" | null {
  if (typeof window === "undefined") return null;
  return readScheduleView()?.tab === "technicians" ? "technicians" : null;
}

export function rememberScheduleTab(tab: "calendar" | "technicians") {
  rememberScheduleView({ tab });
}

function readStaffOrder(): string[] {
  try {
    const raw = window.localStorage.getItem(STAFF_ORDER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStaffOrder(ids: string[]) {
  try {
    window.localStorage.setItem(STAFF_ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* ignore private-mode storage failures */
  }
}

function applyStaffOrder(
  people: ScheduleStaffMember[],
  order: string[],
): ScheduleStaffMember[] {
  const byId = new Map(people.map((person) => [person._id, person]));
  const seen = new Set<string>();
  const ordered: ScheduleStaffMember[] = [];
  for (const id of order) {
    const person = byId.get(id);
    if (!person || seen.has(id)) continue;
    seen.add(id);
    ordered.push(person);
  }
  for (const person of people) {
    if (seen.has(person._id)) continue;
    ordered.push(person);
  }
  return ordered;
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

async function fetchRailDay(token: string, day: string) {
  const [queue, board] = await Promise.all([
    getScheduleQueue(token, { from: day, to: day, includeUndated: true }),
    getScheduleStaff(token, day, day),
  ]);
  return {
    unscheduled: queue.unscheduled,
    scheduled: board.workOrders,
  };
}

function recommendedTechnician(
  list: ScheduleRecommendation[] | undefined,
): ScheduleRecommendation | null {
  return list?.find((tech) => tech.available) ?? null;
}

function compareWithinDay(a: WorkOrderListItem, b: WorkOrderListItem): number {
  const aScheduled = a.scheduledStart ? 1 : 0;
  const bScheduled = b.scheduledStart ? 1 : 0;
  if (aScheduled !== bScheduled) return aScheduled - bScheduled;
  return (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? "");
}

type MapRailPane = "appointments" | "technicians";

function ScheduleRail({
  dayLabel,
  dayJobs,
  undatedJobs,
  recommendations,
  loading,
  selectedId,
  onSelect,
  onSuggest,
  onAssignTechnician,
  onUnschedule,
  onView,
  onMoveDate,
  suggesting,
  canSuggest,
  draggable,
  liftDrag = false,
  pane,
  onPane,
  technicianPane,
  technicianColors,
}: {
  dayLabel: string;
  dayJobs: WorkOrderListItem[];
  undatedJobs: WorkOrderListItem[];
  recommendations: Record<string, ScheduleRecommendation[]>;
  loading: boolean;
  selectedId: string | null;
  onSelect: (job: WorkOrderListItem) => void;
  onSuggest: () => void;
  onAssignTechnician?: (job: WorkOrderListItem, userId: string) => void;
  onUnschedule?: (job: WorkOrderListItem) => void;
  onView?: (job: WorkOrderListItem) => void;
  onMoveDate?: (job: WorkOrderListItem, date: string) => void;
  suggesting: boolean;
  canSuggest: boolean;
  draggable: boolean;
  liftDrag?: boolean;
  pane?: MapRailPane;
  onPane?: (pane: MapRailPane) => void;
  technicianPane?: ReactNode;
  technicianColors: Record<string, string>;
}) {
  const empty = dayJobs.length === 0 && undatedJobs.length === 0;
  const showTechnicians = pane === "technicians" && technicianPane;

  return (
    <aside className="flex h-full max-h-[44rem] min-h-0 flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm lg:max-h-none">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-brand-dark">{dayLabel}</h2>
        {showTechnicians ? null : (
          <button
            type="button"
            disabled={!canSuggest || suggesting}
            onClick={onSuggest}
            className="shrink-0 text-xs font-medium text-brand-orange hover:underline disabled:opacity-40"
          >
            {suggesting ? "Suggesting…" : "Suggest tech"}
          </button>
        )}
      </div>
      {onPane ? (
        <Segmented<MapRailPane>
          ariaLabel="Schedule list"
          size="sm"
          value={pane ?? "appointments"}
          onChange={onPane}
          options={[
            { id: "appointments", label: "Appointments" },
            { id: "technicians", label: "Technicians" },
          ]}
        />
      ) : null}
      {showTechnicians ? (
        technicianPane
      ) : loading ? (
        <p className="text-xs text-neutral-400">Loading work orders…</p>
      ) : empty ? (
        <p className="text-xs text-neutral-400">No work orders on {dayLabel}.</p>
      ) : (
        <div className="-mx-1 min-h-0 space-y-3 overflow-y-auto px-1">
          {dayJobs.length > 0 ? (
            <section className="space-y-2">
              {dayJobs.map((order) => (
                <UnscheduledCard
                  key={order._id}
                  order={order}
                  selected={selectedId === order._id}
                  onSelect={() => onSelect(order)}
                  draggable={draggable}
                  lift={liftDrag}
                  recommendation={recommendedTechnician(
                    recommendations[order._id],
                  )}
                  technicians={recommendations[order._id] ?? []}
                  technicianColors={technicianColors}
                  dayLabel={dayLabel}
                  onAssignTechnician={
                    onAssignTechnician
                      ? (userId) => onAssignTechnician(order, userId)
                      : undefined
                  }
                  onUnschedule={
                    onUnschedule ? () => onUnschedule(order) : undefined
                  }
                  onView={onView ? () => onView(order) : undefined}
                  onMoveDate={
                    onMoveDate
                      ? (date) => onMoveDate(order, date)
                      : undefined
                  }
                />
              ))}
            </section>
          ) : null}
          {undatedJobs.length > 0 ? (
            <section className="space-y-2">
              <h3 className="sticky top-0 z-10 bg-white py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                No date
              </h3>
              {undatedJobs.map((order) => (
                <UnscheduledCard
                  key={order._id}
                  order={order}
                  selected={selectedId === order._id}
                  onSelect={() => onSelect(order)}
                  draggable={draggable}
                  lift={liftDrag}
                  recommendation={recommendedTechnician(
                    recommendations[order._id],
                  )}
                  technicians={recommendations[order._id] ?? []}
                  technicianColors={technicianColors}
                  dayLabel={dayLabel}
                  onAssignTechnician={
                    onAssignTechnician
                      ? (userId) => onAssignTechnician(order, userId)
                      : undefined
                  }
                  onUnschedule={
                    onUnschedule ? () => onUnschedule(order) : undefined
                  }
                  onView={onView ? () => onView(order) : undefined}
                  onMoveDate={
                    onMoveDate
                      ? (date) => onMoveDate(order, date)
                      : undefined
                  }
                />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </aside>
  );
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type TechnicianLegendItem = {
  id: string;
  name: string;
  color: string;
};

function ScheduleHeader({
  view,
  surface,
  monthMode,
  today,
  selectedDate,
  weekDays,
  technicianLegend,
  onToday,
  onView,
  onSurface,
  onMonthMode,
  onStepTitle,
  onStepWeek,
  onSelectDay,
}: {
  view: ViewMode;
  surface: SurfaceMode;
  monthMode: MonthMode;
  today: string;
  selectedDate: string;
  weekDays: string[];
  technicianLegend: TechnicianLegendItem[];
  onToday: () => void;
  onView: (view: ViewMode) => void;
  onSurface: (surface: SurfaceMode) => void;
  onMonthMode: (mode: MonthMode) => void;
  onStepTitle: (direction: -1 | 1) => void;
  onStepWeek: (direction: -1 | 1) => void;
  onSelectDay: (day: string) => void;
}) {
  const showDays = view === "week" || surface === "map";
  const showLayout = surface === "calendar";
  const showLegend =
    view === "month" && surface === "calendar" && monthMode === "calendar";
  const rangeLabel =
    weekDays.length > 0
      ? `${formatPrettyDate(weekDays[0]!)} – ${formatPrettyDate(weekDays[weekDays.length - 1]!)}`
      : "";

  return (
    <div className="space-y-3">
      <div className="relative flex items-center justify-center">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onStepTitle(-1)}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <h2 className="text-2xl font-semibold tracking-tight text-brand-dark">
            {formatMonthYear(selectedDate.slice(0, 7))}
          </h2>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onStepTitle(1)}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {showDays && rangeLabel ? (
          <span className="absolute right-0 hidden text-xs text-neutral-500 sm:block">
            {rangeLabel}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm lg:flex-row lg:items-center">
        {showDays ? (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => onStepWeek(-1)}
              className="shrink-0 rounded-lg border border-neutral-200 p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
              {weekDays.map((day, index) => {
                const selected = day === selectedDate;
                const isToday = day === today;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelectDay(day)}
                    className={`relative flex flex-col items-center rounded-lg border px-1 py-1.5 text-center transition-all ${
                      selected
                        ? "schedule-day-active z-10"
                        : "border-transparent hover:bg-neutral-50"
                    }`}
                  >
                    <span
                      className={`text-[11px] ${
                        selected
                          ? "font-semibold text-brand-orange"
                          : "text-neutral-500"
                      }`}
                    >
                      {WEEKDAY_SHORT[index]}
                    </span>
                    <span
                      className={`text-sm tabular-nums ${
                        selected
                          ? "font-bold text-brand-orange"
                          : isToday
                            ? "font-semibold text-brand-orange"
                            : "font-semibold text-brand-dark"
                      }`}
                    >
                      {Number(day.slice(8))}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => onStepWeek(1)}
              className="shrink-0 rounded-lg border border-neutral-200 p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-sm text-neutral-500">
            <span>Pick a day to open its technician board.</span>
            {showLegend && technicianLegend.length > 0 ? (
              <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {technicianLegend.map((tech) => (
                  <li
                    key={tech.id}
                    className="flex items-center gap-1.5 text-xs text-brand-dark"
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tech.color }}
                    />
                    {tech.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            aria-pressed={selectedDate === today}
            disabled={selectedDate === today}
            onClick={onToday}
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-100 ${
              selectedDate === today
                ? "border-neutral-200 bg-white text-brand-dark shadow-sm ring-1 ring-neutral-200"
                : "border-neutral-200 bg-neutral-100 text-neutral-500 hover:text-brand-dark"
            }`}
          >
            Today
          </button>
          {surface !== "map" && (
            <Segmented<ViewMode>
              ariaLabel="Calendar range"
              value={view}
              onChange={onView}
              options={[
                { id: "week", label: "Week" },
                { id: "month", label: "Month" },
              ]}
            />
          )}
          {showLayout && (
            <Segmented<MonthMode>
              ariaLabel="Calendar layout"
              value={monthMode}
              onChange={onMonthMode}
              options={[
                { id: "calendar", label: "Grid" },
                { id: "table", label: "Table" },
              ]}
            />
          )}
          <Segmented<SurfaceMode>
            ariaLabel="Schedule surface"
            value={surface}
            onChange={onSurface}
            options={[
              { id: "calendar", label: "Calendar" },
              { id: "map", label: "Map" },
            ]}
          />
        </div>
      </div>
    </div>
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
    queueMicrotask(() => setWidth(stored));
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
      applyWidth(startWidth - (moveEvent.clientX - startX));
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
      applyWidth(widthRef.current + step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applyWidth(widthRef.current - step);
    }
  }

  if (!sidebar) return <div className="min-h-0 flex-1">{children}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-1">
      <div className="h-full min-h-0 min-w-0 flex-1">{children}</div>
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
        <span className="absolute inset-y-8 left-1/2 w-1 -translate-x-1/2 rounded-full bg-neutral-200 group-hover:bg-brand-orange group-focus:bg-brand-orange" />
      </div>
      <div
        className="h-full w-full min-w-0 lg:w-[var(--schedule-rail-width)] lg:shrink-0"
        style={{ "--schedule-rail-width": `${width}px` } as CSSProperties}
      >
        {sidebar}
      </div>
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
  const [viewReady, setViewReady] = useState(false);
  const [isMonthExpanded, setIsMonthExpanded] = useState(false);
  const [staff, setStaff] = useState<ScheduleStaffMember[]>([]);
  const [staffOrder, setStaffOrder] = useState<string[]>([]);

  const effectiveMonthExpanded =
    isMonthExpanded &&
    view === "month" &&
    monthMode === "calendar" &&
    surface === "calendar";

  useEffect(() => {
    queueMicrotask(() => setStaffOrder(readStaffOrder()));
  }, []);

  useEffect(() => {
    const stored = readScheduleView();
    const viewChoice = storedViewChoice(stored?.view);
    const layoutChoice = storedLayoutChoice(stored?.layout);
    const surfaceChoice = storedSurfaceChoice(stored?.surface);
    const date =
      initialDate ??
      (stored?.date && SCHEDULE_DATE_RE.test(stored.date) ? stored.date : null);
    queueMicrotask(() => {
      if (viewChoice) setView(viewChoice);
      if (layoutChoice) setMonthMode(layoutChoice);
      if (surfaceChoice) setSurface(surfaceChoice);
      if (date) {
        setAnchorDate(date);
        setSelectedDate(date);
      }
      setViewReady(true);
    });
  }, [initialDate]);

  useEffect(() => {
    if (!viewReady) return;
    rememberScheduleView({
      view,
      layout: monthMode,
      surface,
      date: selectedDate,
    });
  }, [viewReady, view, monthMode, surface, selectedDate]);
  const orderedStaff = useMemo(
    () => applyStaffOrder(staff, staffOrder),
    [staff, staffOrder],
  );
  const [jobs, setJobs] = useState<WorkOrderListItem[]>([]);
  const [calendarUnscheduled, setCalendarUnscheduled] = useState<
    WorkOrderListItem[]
  >([]);
  const [railJobs, setRailJobs] = useState<WorkOrderListItem[]>([]);
  const [railScheduled, setRailScheduled] = useState<WorkOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [railLoading, setRailLoading] = useState(true);
  const [railLoadedFor, setRailLoadedFor] = useState(selectedDate);
  if (railLoadedFor !== selectedDate) {
    setRailLoadedFor(selectedDate);
    setRailLoading(true);
  }
  const [recommendations, setRecommendations] = useState<
    Record<string, ScheduleRecommendation[]>
  >({});
  const [monthRecommendedByJobId, setMonthRecommendedByJobId] = useState<
    Record<string, string>
  >({});
  const [monthRecommendedNames, setMonthRecommendedNames] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [selectedRailJob, setSelectedRailJob] =
    useState<WorkOrderListItem | null>(null);
  const [editingJob, setEditingJob] = useState<WorkOrderListItem | null>(null);
  const [durationDraft, setDurationDraft] = useState(DEFAULT_ESTIMATED_MINUTES);
  const [startOptions, setStartOptions] = useState<ScheduleStartOptions | null>(
    null,
  );
  const [startOptionsLoading, setStartOptionsLoading] = useState(false);
  const [startDraft, setStartDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [dropLoading, setDropLoading] = useState<{
    workOrder?: WorkOrderListItem | null;
    technicianName?: string | null;
    technicianInitials?: string | null;
    targetTime?: string | null;
    targetDate?: string | null;
    message?: string;
  } | null>(null);

  const [suggestions, setSuggestions] = useState<ScheduleSuggestion[] | null>(
    null,
  );
  const [suggesting, setSuggesting] = useState(false);

  const [mapRailPane, setMapRailPane] = useState<MapRailPane>("appointments");
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
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null);
  const [viewingWorkOrderId, setViewingWorkOrderId] = useState<string | null>(
    null,
  );
  const [viewingOrder, setViewingOrder] = useState<WorkOrderListItem | null>(
    null,
  );
  const [viewingLoading, setViewingLoading] = useState(false);
  const [viewingError, setViewingError] = useState<string | null>(null);
  const planSeq = useRef(0);
  const optimizeLock = useRef(false);
  const effectiveTechId = !dispatcher && user?.id ? user.id : routeTechId;
  const [territoryFeatures, setTerritoryFeatures] = useState<
    CityBoundaryCollection["features"]
  >([]);
  const [territoryPrompt, setTerritoryPrompt] = useState<{
    technicianName: string;
    place: string;
    resolve: (proceed: boolean) => void;
  } | null>(null);
  const territoryCities = useMemo(() => {
    if (!effectiveTechId) return [] as ServiceCity[];
    return (
      staff.find((person) => person._id === effectiveTechId)?.serviceCities ??
      []
    );
  }, [staff, effectiveTechId]);

  useEffect(() => {
    if (!token || territoryCities.length === 0) {
      queueMicrotask(() => setTerritoryFeatures([]));
      return;
    }
    const states = [
      ...new Set(
        territoryCities
          .map((city) => city.state.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    let cancelled = false;
    void Promise.all(states.map((state) => getCityBoundaries(token, state)))
      .then((collections) => {
        if (cancelled) return;
        setTerritoryFeatures(
          collections
            .flatMap((collection) => collection.features)
            .filter((feature) =>
              territoryCities.some((city) =>
                cityMatchesZone(city, feature.properties),
              ),
            ),
        );
      })
      .catch(() => {
        if (!cancelled) setTerritoryFeatures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, territoryCities]);

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
      queueMicrotask(() => {
        setStartOptions(null);
        setStartDraft("");
        setStartOptionsLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      setStartOptionsLoading(true);
      setStartOptions(null);
    });
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

  useEffect(() => {
    if (!token || !viewingWorkOrderId) {
      queueMicrotask(() => {
        setViewingOrder(null);
        setViewingError(null);
        setViewingLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      setViewingLoading(true);
      setViewingError(null);
    });
    getWorkOrder(token, viewingWorkOrderId)
      .then((next) => {
        if (!cancelled) setViewingOrder(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setViewingOrder(null);
        setViewingError(
          err instanceof ApiError ? err.message : "Failed to load work order.",
        );
      })
      .finally(() => {
        if (!cancelled) setViewingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, viewingWorkOrderId]);

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
    if (view === "week" || surface === "map") {
      return { from: weekStart, to: weekEnd };
    }
    return { from: monthStart, to: monthEnd };
  }, [view, surface, weekStart, weekEnd, monthStart, monthEnd]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const railListJobs = useMemo(() => {
    const incoming = uniqueJobs(railScheduled, railJobs).filter(
      (job) => workOrderLocalDate(job) === selectedDate,
    );
    const undated = railJobs.filter((job) => !workOrderLocalDate(job));
    const dated = incoming.slice().sort(compareWithinDay);
    return { dated, undated };
  }, [railJobs, railScheduled, selectedDate]);
  const railRecommendationKey = useMemo(
    () =>
      [...railListJobs.dated, ...railListJobs.undated]
        .map(
          (job) =>
            `${job._id}:${job.assignedUserRef ?? ""}:${job.scheduledStart ?? ""}`,
        )
        .join("|"),
    [railListJobs],
  );

  const recommendationsEnabled = Boolean(
    token && dispatcher && canWrite && railRecommendationKey,
  );

  useEffect(() => {
    if (!token || !dispatcher || !canWrite || !railRecommendationKey) return;
    const ids = [
      ...new Set(
        railRecommendationKey
          .split("|")
          .map((row) => row.split(":")[0] ?? "")
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) return;
    let cancelled = false;
    void getScheduleRecommendations(token, {
      date: selectedDate,
      workOrderIds: ids,
    })
      .then((result) => {
        if (cancelled) return;
        const next: Record<string, ScheduleRecommendation[]> = {};
        for (const row of result.recommendations) {
          next[row.workOrderId] = row.technicians?.length
            ? row.technicians
            : row.recommendation
              ? [row.recommendation]
              : [];
        }
        setRecommendations(next);
      })
      .catch(() => {
        if (!cancelled) setRecommendations({});
      });
    return () => {
      cancelled = true;
    };
  }, [token, dispatcher, canWrite, selectedDate, railRecommendationKey]);
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
  const dayAppointments = useMemo(() => {
    return jobs
      .filter(
        (job) =>
          workOrderCrewIds(job).length > 0 && isScheduledOnDate(job, selectedDate),
      )
      .sort((a, b) => {
        const aTime = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
        const bTime = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
        return aTime - bTime;
      });
  }, [jobs, selectedDate]);
  const selectedTechAppointments = useMemo(() => {
    if (!effectiveTechId) return [];
    return dayAppointments.filter((job) =>
      workOrderCrewIds(job).includes(effectiveTechId),
    );
  }, [dayAppointments, effectiveTechId]);
  const mapAppointments = effectiveTechId
    ? selectedTechAppointments
    : dayAppointments;
  const addedJobs = useMemo(
    () =>
      addedUnscheduledIds
        .map((id) => jobById.get(id))
        .filter((job): job is WorkOrderListItem => Boolean(job && !job.scheduledStart)),
    [addedUnscheduledIds, jobById],
  );
  const routeJobs = useMemo(() => {
    const seen = new Set(selectedTechAppointments.map((job) => job._id));
    return [
      ...selectedTechAppointments,
      ...addedJobs.filter((job) => !seen.has(job._id)),
    ];
  }, [selectedTechAppointments, addedJobs]);
  const jobsTodayByTech = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const job of dayAppointments) {
      for (const id of workOrderCrewIds(job)) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  }, [dayAppointments]);
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
  const routableStopIds = useMemo(
    () => routeStopIds.filter((id) => !jobById.get(id)?.completed),
    [routeStopIds, jobById],
  );
  const routeTotalsMatch = useMemo(() => {
    if (!routePlan || routableStopIds.length === 0) return false;
    const routed = new Set(routePlan.orderedWorkOrderIds);
    const clientRouted = routableStopIds.filter((id) => routed.has(id));
    return clientRouted.join(",") === routePlan.orderedWorkOrderIds.join(",");
  }, [routePlan, routableStopIds]);
  const requestedGeocodeRef = useRef(new Set<string>());
  const [geocodingPins, setGeocodingPins] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [board, rail] = await Promise.all([
        fetchBoardData(token, range.from, range.to, dispatcher),
        dispatcher
          ? fetchRailDay(token, selectedDate)
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
  }, [token, range.from, range.to, dispatcher, selectedDate]);

  useEffect(() => {
    if (!viewReady) return;
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
  }, [viewReady, token, range.from, range.to, dispatcher]);

  useEffect(() => {
    if (!viewReady) return;
    if (!token || !dispatcher) {
      queueMicrotask(() => {
        setRailJobs([]);
        setRailScheduled([]);
        setRailLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setRailLoading(true));
    void (async () => {
      try {
        const data = await fetchRailDay(token, selectedDate);
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
  }, [viewReady, token, dispatcher, selectedDate]);

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

  function confirmTerritory(
    job: WorkOrderListItem,
    userId: string,
  ): Promise<boolean> {
    const person = staff.find((member) => member._id === userId);
    const cities = person?.serviceCities ?? [];
    if (!jobOutsideServiceCities(job, cities, territoryFeatures)) {
      return Promise.resolve(true);
    }
    const technicianName =
      [person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
      "this technician";
    return new Promise((resolve) => {
      setTerritoryPrompt((current) => {
        current?.resolve(false);
        return {
          technicianName,
          place: territoryPlaceLabel(job),
          resolve,
        };
      });
    });
  }

  async function assignRailTechnician(
    job: WorkOrderListItem,
    userId: string,
    insertIndex?: number,
    estimatedMinutes?: number,
    isDragDropManaged = false,
  ): Promise<boolean> {
    if (!token || !canWrite) return false;
    const crew = workOrderCrewIds(job);
    const alreadyScheduled =
      insertIndex === undefined &&
      Boolean(job.scheduledStart) &&
      crew.includes(userId) &&
      workOrderLocalDate(job) === selectedDate;
    if (alreadyScheduled) return false;
    if (!(await confirmTerritory(job, userId))) return false;
    if (!isDragDropManaged) {
      const targetStaff = staff.find((s) => s._id === userId);
      const techName = targetStaff
        ? `${targetStaff.first_name} ${targetStaff.last_name}`
        : "Technician";
      const techInitials =
        targetStaff?.initials?.trim() ||
        `${targetStaff?.first_name?.[0] ?? ""}${targetStaff?.last_name?.[0] ?? ""}`.toUpperCase() ||
        "T";
      setDropLoading({
        workOrder: job,
        technicianName: techName,
        technicianInitials: techInitials,
        targetTime: insertIndex !== undefined ? `Slot ${insertIndex + 1}` : undefined,
        targetDate: selectedDate,
      });
    }
    setSaving(true);
    setWarning(null);
    setError(null);
    const startTime = Date.now();
    try {
      const dur = estimatedMinutes || job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES;
      const result = await suggestScheduleAssignee(token, {
        workOrderId: job._id,
        date: selectedDate,
        estimatedMinutes: dur,
      });
      const suggestion = result.suggestions.find((item) => item.userId === userId);
      if (!suggestion?.proposedStart && insertIndex === undefined) {
        setError(
          suggestion?.reason || "This technician is not available that day.",
        );
        return false;
      }
      let scheduledStart = suggestion?.proposedStart;
      const windowStart = normalizeTimeOfDay(job.desiredStartTime);
      const windowEnd = normalizeTimeOfDay(job.desiredStartBy);
      if (windowStart && scheduledStart) {
        const windowIso = localDateTimeToIso(selectedDate, windowStart);
        if (new Date(windowIso).getTime() > new Date(scheduledStart).getTime()) {
          scheduledStart = windowIso;
        }
      }
      if (windowEnd && scheduledStart) {
        const capIso = localDateTimeToIso(selectedDate, windowEnd);
        if (new Date(scheduledStart).getTime() > new Date(capIso).getTime()) {
          scheduledStart = capIso;
        }
      }
      const nextCrew =
        insertIndex !== undefined && (!crew.includes(userId) || crew.length <= 1)
          ? [userId]
          : crew.includes(userId)
            ? crew
            : [...crew, userId];
      const placed = await placeScheduleWorkOrder(token, {
        workOrderId: job._id,
        assignedUserRef: nextCrew[0] ?? userId,
        assignedUserRefs: nextCrew,
        date: selectedDate,
        scheduledStart,
        insertIndex,
        estimatedMinutes: dur,
        requirePreferred: nextCrew.length > 1,
      });
      if (placed.warnings?.length) {
        setWarning(placed.warnings.join(" "));
      }
      const updatedJob = placed.workOrders.find((item) => item._id === job._id);
      if (updatedJob) {
        setSelectedRailJob((prev) =>
          prev?._id === job._id ? updatedJob : prev,
        );
      }
      setSuggestions(null);
      setRouteTechId(userId);
      await load();
      return true;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to assign technician.",
      );
      return false;
    } finally {
      if (!isDragDropManaged) {
        const elapsed = Date.now() - startTime;
        if (elapsed < 750) {
          await new Promise((r) => setTimeout(r, 750 - elapsed));
        }
        setDropLoading(null);
      }
      setSaving(false);
    }
  }

  async function assignJob(
    workOrderId: string,
    assignedUserRef: string,
    scheduledStart: string,
    estimatedMinutes?: number,
  ) {
    if (!token) return;
    const job = jobById.get(workOrderId);
    if (job && !(await confirmTerritory(job, assignedUserRef))) return;
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

  async function addDroppedJob(overId: string, workOrderId: string) {
    const job = jobById.get(workOrderId);
    if (!job || job.scheduledStart || job.completed) return;
    const droppedTechId = overId.startsWith("tech:")
      ? overId.slice(5)
      : effectiveTechId;
    if (!droppedTechId) {
      setRouteMessage("Drop the appointment on a technician, or select one first.");
      return;
    }
    if (!(await confirmTerritory(job, droppedTechId))) return;
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
    if (activeId.startsWith("col:")) {
      const fromId = activeId.slice(4);
      const toId = overId.startsWith("col:")
        ? overId.slice(4)
        : overId.startsWith("row:")
          ? overId.slice(4)
          : "";
      if (!fromId || !toId || fromId === toId) return;
      const ids = applyStaffOrder(staff, staffOrder).map((person) => person._id);
      const from = ids.indexOf(fromId);
      if (from < 0) return;
      const next = ids.slice();
      next.splice(from, 1);
      const target = next.indexOf(toId);
      if (target < 0) return;
      next.splice(target, 0, fromId);
      writeStaffOrder(next);
      setStaffOrder(next);
      return;
    }
    if (!activeId.startsWith("job:")) return;
    if (
      overId.startsWith("tech:") ||
      overId === "schedule-map" ||
      overId === "route-table"
    ) {
      await addDroppedJob(overId, activeId.slice(4));
      return;
    }
    if (overId.startsWith("slot:")) {
      const parts = overId.split(":");
      const userId = parts[1];
      const insertIndex = parseInt(parts[2] ?? "0", 10);
      if (!userId || Number.isNaN(insertIndex)) return;
      const workOrderId = activeId.slice(4);
      const dropped = jobById.get(workOrderId);
      if (dropped && !(await confirmTerritory(dropped, userId))) return;
      if (dropped) {
        const targetStaff = staff.find((s) => s._id === userId);
        const techName = targetStaff
          ? `${targetStaff.first_name} ${targetStaff.last_name}`
          : "Technician";
        const techInitials =
          targetStaff?.initials?.trim() ||
          `${targetStaff?.first_name?.[0] ?? ""}${targetStaff?.last_name?.[0] ?? ""}`.toUpperCase() ||
          "T";
        setDropLoading({
          workOrder: dropped,
          technicianName: techName,
          technicianInitials: techInitials,
          targetTime: `Slot ${insertIndex + 1}`,
          targetDate: selectedDate,
        });
        const startTime = Date.now();
        try {
          await assignRailTechnician(
            dropped,
            userId,
            insertIndex,
            dropped.estimatedMinutes,
            true,
          );
        } finally {
          const elapsed = Date.now() - startTime;
          if (elapsed < 750) {
            await new Promise((r) => setTimeout(r, 750 - elapsed));
          }
          setDropLoading(null);
        }
      }
      return;
    }
    const userId = dropColumnId(overId);
    if (!userId) return;
    const workOrderId = activeId.slice(4);
    const dropped = jobById.get(workOrderId);
    if (dropped && !(await confirmTerritory(dropped, userId))) return;
    const minutes = dayColumnMinutes(userId, event);
    if (minutes == null) return;
    const hhmm = minutesToHhMm(minutes);
    const iso = localDateTimeToIso(selectedDate, hhmm);
    if (!token) return;
    const targetStaff = staff.find((s) => s._id === userId);
    const techName = targetStaff
      ? `${targetStaff.first_name} ${targetStaff.last_name}`
      : "Technician";
    const techInitials =
      targetStaff?.initials?.trim() ||
      `${targetStaff?.first_name?.[0] ?? ""}${targetStaff?.last_name?.[0] ?? ""}`.toUpperCase() ||
      "T";
    setDropLoading({
      workOrder: dropped,
      technicianName: techName,
      technicianInitials: techInitials,
      targetTime: formatLocalClock(new Date(iso)),
      targetDate: selectedDate,
    });
    setSaving(true);
    setWarning(null);
    setError(null);
    const startTime = Date.now();
    try {
      const existing = dropped ? workOrderCrewIds(dropped) : [];
      const nextCrew = existing.includes(userId)
        ? existing
        : [...existing, userId];
      const placed = await placeScheduleWorkOrder(token, {
        workOrderId,
        assignedUserRef: nextCrew[0] ?? userId,
        assignedUserRefs: nextCrew,
        date: selectedDate,
        scheduledStart: iso,
        requirePreferred: nextCrew.length > 1,
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
      const elapsed = Date.now() - startTime;
      if (elapsed < 750) {
        await new Promise((r) => setTimeout(r, 750 - elapsed));
      }
      setSaving(false);
      setDropLoading(null);
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
    return Boolean(
      job &&
        effectiveTechId &&
        workOrderCrewIds(job).includes(effectiveTechId) &&
        isScheduledOnDate(job, selectedDate),
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

  async function unscheduleWorkOrder(id: string) {
    if (!dispatcher || !canWrite || unscheduling || !token) return;
    setUnscheduling(true);
    setRouteMessage(null);
    setError(null);
    try {
      await updateWorkOrder(token, id, {
        scheduledStart: null,
        assignedUserRef: null,
      });
      forgetRouteStop(id);
      setConfirmingRemoveId(null);
      setSelectedRailJob((prev) => (prev?._id === id ? null : prev));
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to unschedule work order.",
      );
    } finally {
      setUnscheduling(false);
    }
  }

  async function confirmRemoveRouteStop(id: string) {
    if (!dispatcher || !canWrite || unscheduling || !token) return;
    if (!stopIsScheduledOnDay(id)) {
      forgetRouteStop(id);
      setConfirmingRemoveId(null);
      return;
    }
    await unscheduleWorkOrder(id);
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
      const planIds = routeStopIds.filter((id) => !jobById.get(id)?.completed);
      if (!token || !effectiveTechId || planIds.length === 0) {
        if (planIds.length === 0) setRoutePlan(null);
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
          workOrderIds: planIds,
          roundTrip,
          objective: routeObjective,
          optimize,
          lockedStops: activeRouteLocks.filter((lock) =>
            planIds.includes(lock.workOrderId),
          ),
        });
        if (seq !== planSeq.current) return;
        if (optimize) {
          const applied = await applyScheduleRoute(token, {
            userId: effectiveTechId,
            date: selectedDate,
            orderedWorkOrderIds: result.orderedWorkOrderIds,
            lockedStops: activeRouteLocks.filter((lock) =>
              result.orderedWorkOrderIds.includes(lock.workOrderId),
            ),
          });
          if (seq !== planSeq.current) return;
          setManualOrder(result.orderedWorkOrderIds);
          setRoutePlan({
            ...result,
            warnings: [...result.warnings, ...(applied.warnings ?? [])],
          });
          setJobs((current) => {
            const byId = new Map(current.map((job) => [job._id, job]));
            for (const job of applied.workOrders) {
              byId.set(job._id, { ...byId.get(job._id), ...job });
            }
            return [...byId.values()];
          });
          if (applied.warnings?.length) {
            setWarning(applied.warnings.join(" "));
          }
          await load();
        } else {
          setRoutePlan(result);
        }
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
      jobById,
      routeStopIds,
      selectedDate,
      roundTrip,
      routeObjective,
      activeRouteLocks,
      load,
    ],
  );

  useEffect(() => {
    const previewRoute = surface === "map" || mapRailPane === "technicians";
    if (!previewRoute || !effectiveTechId || routeStopIds.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (optimizeLock.current) return;
      void runPlan(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    surface,
    mapRailPane,
    effectiveTechId,
    routeStopKey,
    roundTrip,
    runPlan,
    routeStopIds.length,
  ]);

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

  const rangeJobs = uniqueJobs(jobs, calendarUnscheduled);
  const monthRecommendationKey = useMemo(() => {
    if (
      view !== "month" ||
      surface !== "calendar" ||
      monthMode !== "calendar"
    ) {
      return "";
    }
    const groups = new Map<string, string[]>();
    for (const job of rangeJobs) {
      if (workOrderCrewIds(job).length > 0) continue;
      const date = workOrderLocalDate(job);
      if (!date || date < range.from || date > range.to) continue;
      const ids = groups.get(date) ?? [];
      ids.push(job._id);
      groups.set(date, ids);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, ids]) => `${date}=${[...ids].sort().join(",")}`)
      .join("|");
  }, [view, surface, monthMode, rangeJobs, range.from, range.to]);

  useEffect(() => {
    if (!token || !dispatcher || !canWrite || !monthRecommendationKey) {
      queueMicrotask(() => {
        setMonthRecommendedByJobId({});
        setMonthRecommendedNames({});
      });
      return;
    }
    let cancelled = false;
    const groups = monthRecommendationKey.split("|").map((row) => {
      const splitAt = row.indexOf("=");
      const date = row.slice(0, splitAt);
      const ids = row
        .slice(splitAt + 1)
        .split(",")
        .filter(Boolean)
        .slice(0, 200);
      return { date, ids };
    });
    void Promise.all(
      groups.map((group) =>
        getScheduleRecommendations(token, {
          date: group.date,
          workOrderIds: group.ids,
        }).catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      const names: Record<string, string> = {};
      for (const result of results) {
        if (!result) continue;
        for (const row of result.recommendations) {
          const list = row.technicians?.length
            ? row.technicians
            : row.recommendation
              ? [row.recommendation]
              : [];
          const pick = list.find((tech) => tech.available);
          if (!pick) continue;
          next[row.workOrderId] = pick.userId;
          const name = `${pick.first_name} ${pick.last_name}`.trim();
          if (name) names[pick.userId] = name;
        }
      }
      setMonthRecommendedByJobId(next);
      setMonthRecommendedNames(names);
    });
    return () => {
      cancelled = true;
    };
  }, [token, dispatcher, canWrite, monthRecommendationKey]);

  const technicianLegend = useMemo(() => {
    const staffNames = new Map(
      orderedStaff.map((person) => [
        person._id,
        `${person.first_name} ${person.last_name}`.trim(),
      ]),
    );
    const seen = new Map<string, string>();
    for (const job of rangeJobs) {
      const city = (job.address?.city || job.customerCity || "").trim();
      const date = workOrderLocalDate(job);
      if (!city || !date || date < range.from || date > range.to) continue;
      const fromAssignee = [job.assignee?.first_name, job.assignee?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      for (const id of workOrderCrewIds(job)) {
        if (seen.has(id)) continue;
        const named = job.assignees?.find((person) => person._id === id);
        const crewName = named
          ? `${named.first_name} ${named.last_name}`.trim()
          : "";
        seen.set(
          id,
          staffNames.get(id) ||
            crewName ||
            fromAssignee ||
            job.tech.trim() ||
            "Technician",
        );
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({
        id,
        name,
        color: resolvedTechnicianColor(
          id,
          orderedStaff.find((person) => person._id === id)?.scheduleColor,
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [orderedStaff, range.from, range.to, rangeJobs]);
  const technicianColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const person of orderedStaff) {
      colors[person._id] = resolvedTechnicianColor(
        person._id,
        person.scheduleColor,
      );
    }
    return colors;
  }, [orderedStaff]);

  const recommendedByJobId = useMemo(() => {
    const map = { ...monthRecommendedByJobId };
    for (const [jobId, list] of Object.entries(recommendations)) {
      const pick = list.find((tech) => tech.available);
      if (pick) map[jobId] = pick.userId;
    }
    return map;
  }, [monthRecommendedByJobId, recommendations]);

  const technicianNames = useMemo(() => {
    const names = { ...monthRecommendedNames };
    for (const list of Object.values(recommendations)) {
      for (const tech of list) {
        const name = `${tech.first_name} ${tech.last_name}`.trim();
        if (name) names[tech.userId] = name;
      }
    }
    for (const person of orderedStaff) {
      const name = `${person.first_name} ${person.last_name}`.trim();
      if (name) names[person._id] = name;
    }
    return names;
  }, [monthRecommendedNames, recommendations, orderedStaff]);

  function openWorkOrder(job: WorkOrderListItem) {
    setEditingJob(null);
    setViewingOrder(job);
    setViewingWorkOrderId(job._id);
  }

  function mergeSavedOrder(updated: WorkOrderListItem) {
    const merge = (list: WorkOrderListItem[]) =>
      list.map((job) => (job._id === updated._id ? updated : job));
    setJobs(merge);
    setCalendarUnscheduled(merge);
    setRailJobs(merge);
    setRailScheduled(merge);
    setSelectedRailJob((prev) => (prev?._id === updated._id ? updated : prev));
    setViewingOrder(updated);
  }

  async function handleViewingSaved(updated: WorkOrderListItem) {
    mergeSavedOrder(updated);
    await load();
  }

  async function moveWorkOrderDate(job: WorkOrderListItem, date: string) {
    if (!token || !canWrite || !date) return;
    if ((job.date?.slice(0, 10) ?? "") === date) return;
    setSaving(true);
    setError(null);
    try {
      await updateWorkOrder(token, job._id, { date });
      const nextRange =
        view === "week" || surface === "map"
          ? {
              from: startOfWeekSunday(date),
              to: addDays(startOfWeekSunday(date), 6),
            }
          : {
              from: startOfMonth(date),
              to: addDays(startOfMonth(date), daysInMonth(startOfMonth(date)) - 1),
            };
      const [board, rail] = await Promise.all([
        fetchBoardData(token, nextRange.from, nextRange.to, dispatcher),
        fetchRailDay(token, date),
      ]);
      setStaff(board.staff);
      setJobs(board.jobs);
      setCalendarUnscheduled(board.unscheduled);
      setRailJobs(rail.unscheduled);
      setRailScheduled(rail.scheduled);
      setAnchorDate(date);
      setSelectedDate(date);
      setRailLoading(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to move work order.",
      );
    } finally {
      setSaving(false);
    }
  }

  function selectRouteTech(id: string) {
    setRouteTechId(id || null);
    setAddedUnscheduledIds([]);
    setManualOrder(null);
    setRouteLocks({});
    setRoutePlan(null);
    setRouteMessage(null);
    setConfirmingRemoveId(null);
  }

  const routePlannerJobs = routeStopIds.map((id) => {
    const stop = routeTotalsMatch
      ? routePlan?.stops.find((item) => item.workOrderId === id)
      : undefined;
    const order = jobById.get(id);
    return {
      id,
      label: order?.customerName || "Work order",
      arrival: stop?.arrival,
      departure: stop?.departure,
      desiredStartTime: order?.desiredStartTime,
      desiredStartBy: order?.desiredStartBy,
    };
  });

  const technicianPane = (
    <TechnicianRoutePane
      staff={staff}
      date={selectedDate}
      techId={effectiveTechId}
      onTech={selectRouteTech}
      filter="scheduled"
      roundTrip={roundTrip}
      optimizing={routeOptimizing}
      planning={routePlanning}
      jobs={routePlannerJobs}
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
      routeControls={
        <MapRouteToolbar
          roundTrip={roundTrip}
          onRoundTrip={setRoundTrip}
          objective={routeObjective}
          onObjective={setRouteObjective}
          onOptimize={() => void runPlan(true)}
          canOptimize={Boolean(effectiveTechId) && routableStopIds.length >= 2}
          optimizing={routeOptimizing}
          message={routeMessage}
          warnings={
            routeTotalsMatch ? (routePlan?.warnings ?? []) : []
          }
        />
      }
    />
  );

  const rail = dispatcher ? (
    <ScheduleRail
      dayLabel={formatWeekdayDate(selectedDate)}
      dayJobs={railListJobs.dated}
      undatedJobs={railListJobs.undated}
      recommendations={
        recommendationsEnabled ? recommendations : {}
      }
      loading={railLoading}
      selectedId={selectedRailJob?._id ?? null}
      onSelect={selectRailJob}
      onSuggest={() => void handleSuggest()}
      onAssignTechnician={
        canWrite ? (job, userId) => void assignRailTechnician(job, userId) : undefined
      }
      onUnschedule={
        canWrite
          ? (job) => {
              if (!job.scheduledStart || unscheduling) return;
              void unscheduleWorkOrder(job._id);
            }
          : undefined
      }
      onView={openWorkOrder}
      onMoveDate={
        canWrite ? (job, date) => void moveWorkOrderDate(job, date) : undefined
      }
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
      liftDrag={surface === "map" || (view === "week" && surface === "calendar")}
      pane={mapRailPane}
      onPane={setMapRailPane}
      technicianPane={technicianPane}
      technicianColors={technicianColors}
    />
  ) : null;



  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {!viewReady ? (
        <p className="text-sm text-neutral-500">Loading schedule…</p>
      ) : (
      <>
      <ScheduleHeader
        view={view}
        surface={surface}
        monthMode={monthMode}
        today={today}
        selectedDate={selectedDate}
        weekDays={weekDays}
        technicianLegend={technicianLegend}
        onToday={() => {
          setAnchorDate(today);
          setSelectedDate(today);
        }}
        onView={setView}
        onSurface={setSurface}
        onMonthMode={setMonthMode}
        onStepTitle={(direction) => {
          const month = shiftMonth(selectedDate.slice(0, 7), direction);
          const day = Math.min(
            Number(selectedDate.slice(8)),
            daysInMonth(`${month}-01`),
          );
          const next = `${month}-${String(day).padStart(2, "0")}`;
          setAnchorDate(next);
          setSelectedDate(next);
        }}
        onStepWeek={(direction) => {
          const next = addDays(selectedDate, 7 * direction);
          setAnchorDate(next);
          setSelectedDate(next);
        }}
        onSelectDay={(day) => {
          setSelectedDate(day);
          setAnchorDate(day);
        }}
      />

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
      ) : (
      <div className="flex min-h-0 flex-1 flex-col">
      {surface === "map" ? (
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
        <div className="flex min-h-0 flex-1 flex-col">
          {geocodingPins && (
            <p className="text-xs text-neutral-500">
              Locating jobs on the map…
            </p>
          )}
          <ScheduleSplit sidebar={rail}>
            <div className="flex h-full min-h-0 flex-col">
              <ScheduleMap
                unscheduled={addedJobs}
                scheduled={mapAppointments}
                territoryFeatures={territoryFeatures}
                pinMode="scheduled"
                selectedId={selectedRailJob?._id ?? null}
                onSelect={selectRailJob}
                routeStops={
                  routeTotalsMatch && routePlan ? routePlan.stops : undefined
                }
                encodedPolyline={
                  routeTotalsMatch ? routePlan?.route?.encodedPolyline : undefined
                }
                surfaceClassName="h-full min-h-[24rem] flex-1"
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
                  technicianColors={technicianColors}
                  recommendation={
                    recommendationsEnabled
                      ? recommendedTechnician(recommendations[draggingJob._id])
                      : undefined
                  }
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <DndContext
          key="schedule-calendar"
          sensors={sensors}
          collisionDetection={calendarCollisionDetection}
          onDragStart={(event) => {
            const id = String(event.active.id);
            setDraggingJobId(id.startsWith("job:") ? id.slice(4) : null);
          }}
          onDragCancel={() => setDraggingJobId(null)}
          onDragEnd={(e) => {
            setDraggingJobId(null);
            void handleDragEnd(e);
          }}
        >
          {view === "week" && monthMode === "table" ? (
            <ScheduleSplit sidebar={rail}>
              <div className="h-full min-h-0 overflow-auto">
                <MonthTable
                  jobs={rangeJobs}
                  emptyLabel="No work orders this week."
                  onJobClick={(job) => {
                    setEditingJob(job);
                    setDurationDraft(
                      job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                    );
                  }}
                />
              </div>
            </ScheduleSplit>
          ) : view === "week" ? (
            <ScheduleSplit sidebar={rail}>
              <div className="h-full min-h-0">
                <WeekBoard
                  staff={orderedStaff}
                  jobs={jobs}
                  selectedDate={selectedDate}
                  dispatcher={dispatcher && canWrite}
                  draggingJob={draggingJob}
                  onJobClick={(job) => {
                    setEditingJob(job);
                    setDurationDraft(
                      job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                    );
                  }}
                  onMap={(userId) => {
                    setRouteTechId(userId);
                    setSurface("map");
                    setAddedUnscheduledIds([]);
                    setManualOrder(null);
                    setRouteLocks({});
                    setRoutePlan(null);
                    setRouteMessage(null);
                  }}
                />
              </div>
            </ScheduleSplit>
          ) : (
            <ScheduleSplit sidebar={rail}>
              {monthMode === "calendar" ? (
                <div className="h-full min-h-0">
                  <MonthCalendar
                    monthDate={anchorDate}
                    jobs={rangeJobs}
                    selectedDate={selectedDate}
                    technicianColors={technicianColors}
                    recommendedByJobId={recommendedByJobId}
                    technicianNames={technicianNames}
                    onSelectDate={(date) => {
                      setSelectedDate(date);
                    }}
                    isExpanded={effectiveMonthExpanded}
                    onToggleExpand={() => setIsMonthExpanded((prev) => !prev)}
                    onStepMonth={(direction) => {
                      const month = shiftMonth(selectedDate.slice(0, 7), direction);
                      const day = Math.min(
                        Number(selectedDate.slice(8)),
                        daysInMonth(`${month}-01`),
                      );
                      const next = `${month}-${String(day).padStart(2, "0")}`;
                      setAnchorDate(next);
                      setSelectedDate(next);
                    }}
                    onToday={() => {
                      setAnchorDate(today);
                      setSelectedDate(today);
                    }}
                    today={today}
                    technicianLegend={technicianLegend}
                    recommendations={recommendationsEnabled ? recommendations : {}}
                    staff={orderedStaff}
                    onAssignTechnician={(job, userId, insertIndex, estimatedMinutes) =>
                      assignRailTechnician(job, userId, insertIndex, estimatedMinutes)
                    }
                    onJobClick={(job) => {
                      setEditingJob(job);
                      setDurationDraft(
                        job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                      );
                    }}
                    onViewJob={openWorkOrder}
                  />
                </div>
              ) : (
                <div className="h-full min-h-0 overflow-auto">
                  <MonthTable
                    jobs={rangeJobs}
                    onJobClick={(job) => {
                      setEditingJob(job);
                      setDurationDraft(
                        job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                      );
                    }}
                  />
                </div>
              )}
            </ScheduleSplit>
          )}
          <DragOverlay dropAnimation={null}>
            {draggingJob ? (
              <div className="w-56 cursor-grabbing rounded-xl ring-2 ring-brand-orange/40 shadow-2xl rotate-1">
                <UnscheduledCard
                  order={draggingJob}
                  selected={false}
                  onSelect={() => {}}
                  draggable={false}
                  technicianColors={technicianColors}
                  recommendation={
                    recommendationsEnabled
                      ? recommendedTechnician(recommendations[draggingJob._id])
                      : undefined
                  }
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      </div>
      )}

      {territoryPrompt ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => {
            territoryPrompt.resolve(false);
            setTerritoryPrompt(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="territory-warning-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
          >
            <h3
              id="territory-warning-title"
              className="text-lg font-semibold text-brand-dark"
            >
              Outside territory
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              {territoryPrompt.place
                ? `${territoryPrompt.place} is outside ${territoryPrompt.technicianName}'s territory.`
                : `This address is outside ${territoryPrompt.technicianName}'s territory.`}{" "}
              Add this appointment anyway?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  territoryPrompt.resolve(false);
                  setTerritoryPrompt(null);
                }}
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  territoryPrompt.resolve(true);
                  setTerritoryPrompt(null);
                }}
                className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dropLoading && (
        <GeneracScheduleLoadingOverlay
          workOrder={dropLoading.workOrder}
          technicianName={dropLoading.technicianName}
          technicianInitials={dropLoading.technicianInitials}
          targetTime={dropLoading.targetTime}
          targetDate={dropLoading.targetDate}
          message={dropLoading.message}
        />
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
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-dark">
              {editingJob.customerName || "Work order"}
            </h3>
            <p className="mt-1 text-sm text-neutral-500">
              {formatAddressLine(editingJob.address)}
            </p>
            <button
              type="button"
              onClick={() => openWorkOrder(editingJob)}
              className="mt-2 inline-block text-sm font-medium text-brand-orange hover:underline"
            >
              View
            </button>
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

      {viewingWorkOrderId && (
        <WorkOrderModal
          workOrderId={viewingWorkOrderId}
          initialOrder={viewingOrder}
          token={token}
          user={user}
          canWrite={canWrite}
          onClose={() => setViewingWorkOrderId(null)}
          onSaved={(updated) => void handleViewingSaved(updated)}
        />
      )}

      </>
      )}
    </div>
  );
}
