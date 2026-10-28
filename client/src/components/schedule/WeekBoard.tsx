"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  useDndContext,
  useDraggable,
  useDroppable,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, MapPin } from "lucide-react";
import { ScheduleNoteComposer } from "@/components/schedule/ScheduleNoteComposer";
import { TextScheduleButton } from "@/components/schedule/TextScheduleDialog";
import {
  getScheduleRoute,
  type ScheduleRecommendation,
  type ScheduleRouteLeg,
  type ScheduleRouteStop,
  type ScheduleStaffMember,
  type TaskItem,
  type WorkOrderListItem,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import {
  BOARD_HOUR_END,
  BOARD_HOUR_START,
  DEFAULT_ESTIMATED_MINUTES,
  formatLocalClock,
  formatMonthDayYear,
  formatDesiredStart,
  isScheduledOnDate,
  jobAccent,
  minutesToLabel,
  nyDateParts,
  opaqueTechnicianTint,
  properCaseCity,
  technicianColor,
  workOrderCrewIds,
} from "@/lib/schedule";

const NARROW_SCHEDULE_QUERY = "(max-width: 1023px)";
const SWIPE_THRESHOLD = 64;

function subscribeNarrowSchedule(onChange: () => void) {
  const media = window.matchMedia(NARROW_SCHEDULE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useNarrowSchedule(): boolean {
  return useSyncExternalStore(
    subscribeNarrowSchedule,
    () => window.matchMedia(NARROW_SCHEDULE_QUERY).matches,
    () => false,
  );
}

const HOURS = Array.from(
  { length: BOARD_HOUR_END - BOARD_HOUR_START },
  (_, i) => BOARD_HOUR_START + i,
);
const HOUR_PX = 112;
const DRIVE_LABEL_MIN_PX = 14;

function formatDriveMiles(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatDriveLeg(minutes: number, meters: number): string {
  return `${minutes} min · ${formatDriveMiles(meters)}`;
}

function hourLabel(hour: number): string {
  if (hour === 12) return "12 PM";
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

function jobCity(order: WorkOrderListItem): string {
  return properCaseCity(
    order.address?.city?.trim() || order.customerCity?.trim() || "",
  );
}

function formatMinutesClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(m).padStart(2, "0");
  return `${h12}:${mm} ${period}`;
}

function orderCustomerName(order: WorkOrderListItem): string {
  return properCaseCity(order.customerName?.trim() || "") || "Job";
}

/** Cities for one technician-day, most appointments first. Ties use the city name. */
function citiesByAppointmentCount(
  jobs: WorkOrderListItem[],
): { city: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const city = jobCity(job);
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

function personName(
  person?: { first_name?: string; last_name?: string } | null,
): string {
  return [person?.first_name, person?.last_name].filter(Boolean).join(" ");
}

function weekdayFromDayLabel(dayLabel: string): string {
  const name = dayLabel.split(",")[0]?.trim();
  return name || "that day";
}

function TechnicianAssignMenu({
  x,
  y,
  technicians,
  assignedId,
  dayLabel,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  technicians: ScheduleRecommendation[];
  assignedId: string;
  dayLabel: string;
  onPick: (userId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<ScheduleRecommendation | null>(null);
  const working = technicians.filter((tech) => tech.available);
  const offSchedule = technicians.filter((tech) => !tech.available);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y, technicians, pending]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointer(event: PointerEvent) {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  function renderTech(tech: ScheduleRecommendation, muted: boolean) {
    const name = personName(tech);
    const current = tech.userId === assignedId;
    return (
      <button
        key={tech.userId}
        type="button"
        role="menuitem"
        onClick={() => {
          if (!tech.available) {
            setPending(tech);
            return;
          }
          onPick(tech.userId);
        }}
        className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-neutral-50"
      >
        <Check
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
            current ? "text-emerald-600" : "text-transparent"
          }`}
          aria-hidden
        />
        <span className="min-w-0">
          <span
            className={`block truncate text-xs font-medium ${
              muted ? "text-neutral-500" : "text-brand-dark"
            }`}
          >
            {name || "Technician"}
          </span>
          {tech.reason ? (
            <span className="block truncate text-[11px] text-neutral-500">
              {tech.reason}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  const pendingName = personName(pending) || "This technician";

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Assign technician"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      className={`fixed z-[80] overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg ${
        pending ? "w-72" : "flex max-h-80 w-64 flex-col"
      }`}
    >
      {pending ? (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Override schedule
          </div>
          <div className="mx-2 mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            {pendingName} isn&apos;t scheduled to work{" "}
            {weekdayFromDayLabel(dayLabel)}. Continuing will override their
            schedule.
          </div>
          <div className="flex justify-end gap-2 px-2 pb-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (!pending) return;
                onPick(pending.userId);
              }}
              className="btn-primary px-2.5 py-1 text-xs"
            >
              Assign anyway
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Assign technician
          </div>
          <div className="min-h-0 overflow-y-auto">
            {technicians.length === 0 ? (
              <p className="px-3 py-2 text-xs text-neutral-500">
                No technicians available
              </p>
            ) : (
              <>
                {working.map((tech) => renderTech(tech, false))}
                {offSchedule.length > 0 ? (
                  <>
                    <div className="mt-1 border-t border-neutral-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                      Not scheduled to work
                    </div>
                    {offSchedule.map((tech) => renderTech(tech, true))}
                  </>
                ) : null}
              </>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function UnscheduledCardShell({
  order,
  selected,
  onSelect,
  recommendation,
  technicians,
  dayLabel = "",
  onAssignTechnician,
  onUnschedule,
  onView,
  onMoveDate,
  onNoteAdded,
  isDragging,
  setNodeRef,
  style,
  dragHandle,
  technicianColors = {},
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
  recommendation?: ScheduleRecommendation | null;
  technicians?: ScheduleRecommendation[];
  dayLabel?: string;
  onAssignTechnician?: (userId: string) => void;
  onUnschedule?: () => void;
  onView?: (order: WorkOrderListItem) => void;
  onMoveDate?: (date: string) => void;
  onNoteAdded?: () => void;
  isDragging?: boolean;
  setNodeRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragHandle?: {
    attributes: ReturnType<typeof useDraggable>["attributes"];
    listeners: ReturnType<typeof useDraggable>["listeners"];
  };
  technicianColors?: Record<string, string>;
}) {
  const windowLabel = formatDesiredStart(order.desiredStartTime, order.desiredStartBy);
  const [movingDate, setMovingDate] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const moveDateRef = useRef<HTMLInputElement>(null);
  const assignedName = personName(order.assignee);
  const recommendedName = recommendation ? personName(recommendation) : "";
  const assignedId = order.assignee?._id ?? order.assignedUserRef ?? "";
  const techId = assignedId || recommendation?.userId || "";
  const techColor = techId
    ? (technicianColors[techId] ?? technicianColor(techId))
    : "";
  const accent = techColor || jobAccent(order);
  const cityLabel = properCaseCity(
    order.address?.city?.trim() || order.customerCity?.trim() || "",
  );
  const recommendedMatches = Boolean(
    recommendation && assignedId === recommendation.userId,
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = () => setMenu(null);
  const narrow = useNarrowSchedule();
  const swipe = useRef<{
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const suppressClick = useRef(false);

  function onSwipePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!narrow || event.button !== 0) return;
    swipe.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function onSwipePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!narrow || !start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    suppressClick.current = true;
    if (dx > 0) {
      if (!onAssignTechnician) return;
      setMenu({ x: event.clientX, y: event.clientY });
      return;
    }
    if (order.scheduledStart && onUnschedule) onUnschedule();
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        touchAction: narrow ? "pan-y" : style?.touchAction,
        backgroundColor: techColor ? opaqueTechnicianTint(techColor) : undefined,
      }}
      onPointerDown={onSwipePointerDown}
      onPointerUp={onSwipePointerUp}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        if (!onAssignTechnician) return;
        event.preventDefault();
        event.stopPropagation();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`flex w-full gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors hover:border-neutral-300 ${
        techColor ? "theme-light" : "bg-neutral-50"
      } ${
        selected
          ? "border-brand-orange ring-1 ring-brand-orange"
          : "border-neutral-200"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <span
        aria-hidden
        className="w-[3px] shrink-0 self-stretch rounded-full"
        style={{ backgroundColor: accent }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button
            type="button"
            {...(dragHandle?.listeners ?? {})}
            {...(dragHandle?.attributes ?? {})}
            onClick={onSelect}
            className="min-w-0 flex-1 text-left"
          >
            <div className="truncate text-[13px] font-semibold text-brand-dark">
              {order.customerName || "Customer"}
            </div>
            <div className="mt-0.5 truncate text-neutral-500">
              {[
                cityLabel || "—",
                order.workOrderType?.label,
                minutesToLabel(order.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {order.scheduleNote ? (
              <div className="mt-1 line-clamp-2 whitespace-pre-line text-neutral-600">
                {order.scheduleNote}
              </div>
            ) : null}
            <div className="mt-1 text-neutral-400">
              {[
                order.date ? formatMonthDayYear(order.date.slice(0, 10)) : "No date",
                windowLabel,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {assignedName ? (
              <div className="mt-1 truncate text-neutral-500">
                Assigned: {assignedName}
              </div>
            ) : null}
            {recommendedName && !order.scheduledStart ? (
              <div className="mt-0.5 flex items-center gap-1 text-neutral-500">
                {recommendedMatches ? (
                  <Check
                    className="h-3 w-3 shrink-0 text-emerald-600"
                    aria-hidden
                  />
                ) : null}
                <span className="truncate">
                  Recommended: {recommendedName}
                  {recommendation?.reason ? ` · ${recommendation.reason}` : ""}
                </span>
              </div>
            ) : null}
          </button>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={`rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
                order.scheduledStart
                  ? "bg-blue-500/15 text-blue-700"
                  : "unscheduled-badge bg-[#c2410c] text-white"
              }`}
            >
              {order.scheduledStart ? "Scheduled" : "Unscheduled"}
            </span>
            {order.scheduledStart && !narrow && onUnschedule ? (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onUnschedule();
                }}
                className="text-[11px] font-medium text-brand-orange hover:underline"
              >
                Cancel
              </button>
            ) : null}
            {!order.scheduledStart && onMoveDate ? (
              <>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMovingDate(true);
                    const input = moveDateRef.current;
                    if (!input) return;
                    try {
                      input.showPicker();
                    } catch {
                      input.focus();
                    }
                  }}
                  className="text-[11px] font-medium text-brand-orange hover:underline"
                >
                  Move
                </button>
                <input
                  ref={moveDateRef}
                  type="date"
                  aria-label={`Move ${order.customerName || "work order"} to a new date`}
                  defaultValue={order.date?.slice(0, 10) ?? ""}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setMovingDate(false);
                  }}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!next || !onMoveDate) return;
                    onMoveDate(next);
                    setMovingDate(false);
                  }}
                  className={
                    movingDate
                      ? "w-[7.5rem] rounded-md border border-neutral-200 bg-white px-1 py-0.5 text-[11px] text-brand-dark"
                      : "sr-only"
                  }
                />
              </>
            ) : null}
          </div>
        </div>
        {onView || onNoteAdded ? (
          <div className="mt-1.5 flex items-center gap-3">
            {onView ? (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onView(order);
                }}
                className="text-[11px] font-medium text-brand-orange hover:underline"
              >
                View
              </button>
            ) : null}
            {onNoteAdded ? (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setAddingNote((open) => !open);
                }}
                className="text-[11px] font-medium text-brand-orange hover:underline"
              >
                Add Note
              </button>
            ) : null}
          </div>
        ) : null}
        {addingNote && onNoteAdded ? (
          <ScheduleNoteComposer
            workOrderId={order._id}
            onSaved={() => {
              setAddingNote(false);
              onNoteAdded();
            }}
            onCancel={() => setAddingNote(false)}
          />
        ) : null}
      </div>
      {menu && onAssignTechnician ? (
        <TechnicianAssignMenu
          x={menu.x}
          y={menu.y}
          technicians={technicians ?? []}
          assignedId={assignedId}
          dayLabel={dayLabel}
          onPick={(userId) => {
            closeMenu();
            onAssignTechnician(userId);
          }}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

function DraggableUnscheduledCard({
  order,
  selected,
  onSelect,
  recommendation,
  technicians,
  dayLabel,
  onAssignTechnician,
  onUnschedule,
  onView,
  onMoveDate,
  onNoteAdded,
  lift = false,
  technicianColors,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
  recommendation?: ScheduleRecommendation | null;
  technicians?: ScheduleRecommendation[];
  dayLabel?: string;
  onAssignTechnician?: (userId: string) => void;
  onUnschedule?: () => void;
  onView?: (order: WorkOrderListItem) => void;
  onMoveDate?: (date: string) => void;
  onNoteAdded?: () => void;
  lift?: boolean;
  technicianColors?: Record<string, string>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `job:${order._id}` });
  const style =
    transform && !lift
      ? { transform: CSS.Translate.toString(transform) }
      : undefined;

  return (
    <UnscheduledCardShell
      order={order}
      selected={selected}
      onSelect={onSelect}
      recommendation={recommendation}
      technicians={technicians}
      dayLabel={dayLabel}
      onAssignTechnician={onAssignTechnician}
      onUnschedule={onUnschedule}
      onView={onView}
      onMoveDate={onMoveDate}
      onNoteAdded={onNoteAdded}
      isDragging={isDragging}
      setNodeRef={setNodeRef}
      style={style}
      dragHandle={{ attributes, listeners }}
      technicianColors={technicianColors}
    />
  );
}

export function UnscheduledCard({
  order,
  selected,
  onSelect,
  draggable = true,
  lift = false,
  recommendation,
  technicians,
  dayLabel,
  onAssignTechnician,
  onUnschedule,
  onView,
  onMoveDate,
  onNoteAdded,
  technicianColors,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
  draggable?: boolean;
  lift?: boolean;
  recommendation?: ScheduleRecommendation | null;
  technicians?: ScheduleRecommendation[];
  dayLabel?: string;
  onAssignTechnician?: (userId: string) => void;
  onUnschedule?: () => void;
  onView?: (order: WorkOrderListItem) => void;
  onMoveDate?: (date: string) => void;
  onNoteAdded?: () => void;
  technicianColors?: Record<string, string>;
}) {
  const narrow = useNarrowSchedule();
  if (!draggable || narrow || Boolean(order.scheduledStart)) {
    return (
      <UnscheduledCardShell
        order={order}
        selected={selected}
        onSelect={onSelect}
        recommendation={recommendation}
        technicians={technicians}
        dayLabel={dayLabel}
        onAssignTechnician={onAssignTechnician}
        onUnschedule={onUnschedule}
        onView={onView}
        onMoveDate={onMoveDate}
        onNoteAdded={onNoteAdded}
        technicianColors={technicianColors}
      />
    );
  }
  return (
    <DraggableUnscheduledCard
      order={order}
      selected={selected}
      onSelect={onSelect}
      recommendation={recommendation}
      technicians={technicians}
      dayLabel={dayLabel}
      onAssignTechnician={onAssignTechnician}
      onUnschedule={onUnschedule}
      onView={onView}
      onMoveDate={onMoveDate}
      onNoteAdded={onNoteAdded}
      lift={lift}
      technicianColors={technicianColors}
    />
  );
}

type JobLane = { lane: number; laneCount: number };

/** Side-by-side columns for blocks that share the same clock time. */
function assignTimeLanes(
  items: Array<{ id: string; window: { startMin: number; endMin: number } | null }>,
): Map<string, JobLane> {
  const placed = items
    .filter(
      (
        row,
      ): row is {
        id: string;
        window: { startMin: number; endMin: number };
      } => row.window != null,
    )
    .sort(
      (a, b) =>
        a.window.startMin - b.window.startMin ||
        a.window.endMin - b.window.endMin,
    );

  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const row of placed) {
    let lane = laneEnds.findIndex((end) => end <= row.window.startMin);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(row.window.endMin);
    } else {
      laneEnds[lane] = row.window.endMin;
    }
    laneOf.set(row.id, lane);
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const unite = (a: string, b: string) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(left, right);
  };
  for (const row of placed) parent.set(row.id, row.id);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const earlier = placed[i]!;
      const later = placed[j]!;
      if (later.window.startMin >= earlier.window.endMin) continue;
      if (earlier.window.startMin < later.window.endMin) {
        unite(earlier.id, later.id);
      }
    }
  }

  const laneCountOf = new Map<string, number>();
  for (const row of placed) {
    const root = find(row.id);
    const lanes = (laneOf.get(row.id) ?? 0) + 1;
    laneCountOf.set(root, Math.max(laneCountOf.get(root) ?? 1, lanes));
  }

  const layout = new Map<string, JobLane>();
  for (const row of placed) {
    layout.set(row.id, {
      lane: laneOf.get(row.id) ?? 0,
      laneCount: laneCountOf.get(find(row.id)) ?? 1,
    });
  }
  return layout;
}

function JobBlock({
  order,
  onClick,
  dispatcher,
  lane,
  laneCount,
  liftDrag = false,
}: {
  order: WorkOrderListItem;
  onClick: () => void;
  dispatcher: boolean;
  lane: number;
  laneCount: number;
  liftDrag?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `job:${order._id}`,
      disabled: !dispatcher,
    });

  if (!order.scheduledStart) return null;
  const start = new Date(order.scheduledStart);
  const duration = order.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES;
  const end = order.scheduledEnd
    ? new Date(order.scheduledEnd)
    : new Date(start.getTime() + duration * 60_000);
  const parts = nyDateParts(start);
  const startMin = parts.hour * 60 + parts.minute;
  const boardStart = BOARD_HOUR_START * 60;
  const boardEnd = BOARD_HOUR_END * 60;
  const span = boardEnd - boardStart;
  const topPct =
    ((Math.max(startMin, boardStart) - boardStart) / span) * 100;
  const heightPct = Math.max(3, (duration / span) * 100);
  const city = properCaseCity(
    order.address?.city?.trim() || order.customerCity?.trim() || "",
  );
  const typeLabel = order.workOrderType?.label?.trim() || "";
  const customerName = properCaseCity(order.customerName?.trim() || "") || "Job";
  const timeLabel = `${formatLocalClock(start)} – ${formatLocalClock(end)}`;
  const detail = [city, typeLabel, minutesToLabel(duration)]
    .filter(Boolean)
    .join(" · ");

  const accent = jobAccent(order);
  const columns = Math.max(1, laneCount);
  const style: CSSProperties = {
    top: `${topPct}%`,
    height: `${heightPct}%`,
    left: `calc(${(lane / columns) * 100}% + 3px)`,
    width: `calc(${100 / columns}% - 5px)`,
    transform: transform && !liftDrag ? CSS.Translate.toString(transform) : undefined,
    backgroundColor: `color-mix(in srgb, ${accent} 34%, var(--staff-surface))`,
    borderLeftColor: accent,
    zIndex: 10 + lane,
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...(dispatcher ? listeners : {})}
      {...(dispatcher ? attributes : {})}
      onClick={onClick}
      title={[customerName, timeLabel, detail].filter(Boolean).join(" · ")}
      className={`absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight text-brand-dark transition-shadow hover:shadow-md ${
        isDragging ? "z-20 opacity-30 pointer-events-none" : ""
      }`}
    >
      <div className="truncate font-semibold">{customerName}</div>
      <div className="truncate text-neutral-500">{timeLabel}</div>
      {detail ? (
        <div className="mt-0.5 truncate text-neutral-600">{detail}</div>
      ) : null}
    </button>
  );
}

function taskWindowMinutes(task: TaskItem): {
  startMin: number;
  endMin: number;
} | null {
  if (!task.scheduledStart) return null;
  const start = new Date(task.scheduledStart);
  const parts = nyDateParts(start);
  const startMin = parts.hour * 60 + parts.minute;
  return { startMin, endMin: startMin + (task.scheduledMinutes || 30) };
}

function TaskBlock({
  task,
  dispatcher,
  canManage,
  lane,
  laneCount,
  liftDrag = false,
  onDone,
  onEdit,
  onRemove,
}: {
  task: TaskItem;
  dispatcher: boolean;
  canManage: boolean;
  lane: number;
  laneCount: number;
  liftDrag?: boolean;
  onDone: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `task:${task.id}`,
      disabled: !dispatcher,
    });

  if (!task.scheduledStart) return null;
  const start = new Date(task.scheduledStart);
  const duration = task.scheduledMinutes || 30;
  const end = new Date(start.getTime() + duration * 60_000);
  const parts = nyDateParts(start);
  const startMin = parts.hour * 60 + parts.minute;
  const boardStart = BOARD_HOUR_START * 60;
  const boardEnd = BOARD_HOUR_END * 60;
  const span = boardEnd - boardStart;
  const topPct = ((Math.max(startMin, boardStart) - boardStart) / span) * 100;
  const heightPct = Math.max(3, (duration / span) * 100);
  const timeLabel = `${formatLocalClock(start)} – ${formatLocalClock(end)}`;
  const done = task.status === "done";
  const columns = Math.max(1, laneCount);
  const style: CSSProperties = {
    top: `${topPct}%`,
    height: `${heightPct}%`,
    left: `calc(${(lane / columns) * 100}% + 3px)`,
    width: `calc(${100 / columns}% - 5px)`,
    transform: transform && !liftDrag ? CSS.Translate.toString(transform) : undefined,
    zIndex: menu ? 30 : 10 + lane,
  };

  return (
    <div ref={setNodeRef} style={style} className="absolute">
      <button
        type="button"
        {...(dispatcher ? listeners : {})}
        {...(dispatcher ? attributes : {})}
        onClick={() => setMenu((open) => !open)}
        title={[task.title, timeLabel, "Task"].join(" · ")}
        className={`h-full w-full overflow-hidden rounded-md border-l-[3px] border-violet-500 bg-violet-50 px-1.5 py-1 text-left text-[11px] leading-tight text-brand-dark transition-shadow hover:shadow-md ${
          done ? "opacity-60" : ""
        } ${isDragging ? "opacity-30 pointer-events-none" : ""}`}
      >
        <div className="flex items-center gap-1 truncate font-semibold">
          {done ? <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden /> : null}
          {task.title}
        </div>
        <div className="truncate text-neutral-500">{timeLabel}</div>
        <div className="mt-0.5 truncate text-violet-700">Task</div>
      </button>
      {menu ? (
        <div className="absolute left-0 top-full z-40 mt-1 w-40 rounded-md border border-neutral-200 bg-white py-1 text-xs shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onDone();
            }}
            className="block w-full px-2 py-1.5 text-left hover:bg-neutral-50"
          >
            {done ? "Reopen" : "Mark done"}
          </button>
          {canManage ? (
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                onEdit();
              }}
              className="block w-full px-2 py-1.5 text-left hover:bg-neutral-50"
            >
              Edit
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                onRemove();
              }}
              className="block w-full px-2 py-1.5 text-left text-red-600 hover:bg-neutral-50"
            >
              Remove from schedule
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskCardFace({
  task,
  setNodeRef,
  listeners,
  attributes,
  isDragging,
}: {
  task: TaskItem;
  setNodeRef?: (node: HTMLElement | null) => void;
  listeners?: DraggableSyntheticListeners;
  attributes?: DraggableAttributes;
  isDragging?: boolean;
}) {
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-left text-xs ${
        listeners ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="truncate font-semibold text-brand-dark">{task.title}</div>
      <div className="truncate text-neutral-500">
        {task.scheduledTechnicianName || "No technician yet"}
      </div>
    </div>
  );
}

function DraggableRailTaskCard({ task }: { task: TaskItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task:${task.id}`,
  });
  return (
    <TaskCardFace
      task={task}
      setNodeRef={setNodeRef}
      listeners={listeners}
      attributes={attributes}
      isDragging={isDragging}
    />
  );
}

export function RailTaskCard({
  task,
  draggable,
}: {
  task: TaskItem;
  draggable: boolean;
}) {
  if (!draggable) return <TaskCardFace task={task} />;
  return <DraggableRailTaskCard task={task} />;
}

type DriveGap = {
  key: string;
  startMin: number;
  endMin: number;
  label: string;
  tight: boolean;
};

function jobWindowMinutes(job: WorkOrderListItem): {
  startMin: number;
  endMin: number;
} | null {
  if (!job.scheduledStart) return null;
  const start = new Date(job.scheduledStart);
  const duration = job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES;
  const end = job.scheduledEnd
    ? new Date(job.scheduledEnd)
    : new Date(start.getTime() + duration * 60_000);
  const startParts = nyDateParts(start);
  const endParts = nyDateParts(end);
  return {
    startMin: startParts.hour * 60 + startParts.minute,
    endMin: endParts.hour * 60 + endParts.minute,
  };
}

function stopKey(stop: ScheduleRouteStop): string {
  return stop.kind === "home" ? "home" : `job:${stop.workOrderId ?? ""}`;
}

function legsByHop(
  stops: ScheduleRouteStop[],
  legs: ScheduleRouteLeg[],
): Map<string, ScheduleRouteLeg> {
  const hops = new Map<string, ScheduleRouteLeg>();
  for (let i = 0; i < legs.length; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    const leg = legs[i];
    if (!from || !to || !leg) continue;
    hops.set(`${stopKey(from)}>${stopKey(to)}`, leg);
  }
  return hops;
}

function buildDriveGaps(
  jobs: WorkOrderListItem[],
  stops: ScheduleRouteStop[],
  legs: ScheduleRouteLeg[],
): DriveGap[] {
  const windows = jobs
    .map((job) => ({ job, window: jobWindowMinutes(job) }))
    .filter(
      (
        row,
      ): row is {
        job: WorkOrderListItem;
        window: { startMin: number; endMin: number };
      } => row.window != null,
    )
    .sort((a, b) => a.window.startMin - b.window.startMin);
  if (windows.length === 0) return [];

  const hops = legsByHop(stops, legs);
  const located = new Set(
    stops
      .filter((stop) => stop.kind === "job" && stop.workOrderId)
      .map((stop) => stop.workOrderId as string),
  );
  const hasHome = stops.some(
    (stop) => stop.kind === "home" && stop.lat != null && stop.lng != null,
  );
  const gaps: DriveGap[] = [];

  const first = windows[0]!;
  if (hasHome) {
    const leg = hops.get(`home>job:${first.job._id}`);
    if (leg && located.has(first.job._id)) {
      gaps.push({
        key: `home-${first.job._id}`,
        startMin: first.window.startMin - leg.durationMinutes,
        endMin: first.window.startMin,
        label: `Home · ${formatDriveLeg(leg.durationMinutes, leg.distanceMeters)}`,
        tight: false,
      });
    } else {
      gaps.push({
        key: `home-${first.job._id}`,
        startMin: first.window.startMin - 28,
        endMin: first.window.startMin,
        label: "Drive unknown",
        tight: false,
      });
    }
  }

  for (let i = 0; i < windows.length - 1; i += 1) {
    const prev = windows[i]!;
    const next = windows[i + 1]!;
    if (next.window.startMin <= prev.window.endMin) continue;
    const leg = hops.get(`job:${prev.job._id}>job:${next.job._id}`);
    const known = Boolean(
      leg && located.has(prev.job._id) && located.has(next.job._id),
    );
    const gapMin = next.window.startMin - prev.window.endMin;
    const tight = Boolean(known && leg && leg.durationMinutes > gapMin);
    gaps.push({
      key: `${prev.job._id}-${next.job._id}`,
      startMin: prev.window.endMin,
      endMin: next.window.startMin,
      label:
        known && leg
          ? formatDriveLeg(leg.durationMinutes, leg.distanceMeters)
          : "Drive unknown",
      tight,
    });
  }

  const last = windows[windows.length - 1]!;
  if (hasHome) {
    const leg = hops.get(`job:${last.job._id}>home`);
    if (leg && located.has(last.job._id)) {
      gaps.push({
        key: `${last.job._id}-home`,
        startMin: last.window.endMin,
        endMin: last.window.endMin + leg.durationMinutes,
        label: `Home · ${formatDriveLeg(leg.durationMinutes, leg.distanceMeters)}`,
        tight: false,
      });
    } else {
      gaps.push({
        key: `${last.job._id}-home`,
        startMin: last.window.endMin,
        endMin: last.window.endMin + 28,
        label: "Drive unknown",
        tight: false,
      });
    }
  }

  return gaps;
}

function DriveGapBand({ gap, dimmed = false }: { gap: DriveGap; dimmed?: boolean }) {
  const boardStart = BOARD_HOUR_START * 60;
  const boardEnd = BOARD_HOUR_END * 60;
  const start = Math.max(gap.startMin, boardStart);
  const end = Math.min(gap.endMin, boardEnd);
  if (end - start < 1) return null;
  const span = boardEnd - boardStart;
  const top = ((start - boardStart) / span) * 100;
  const height = ((end - start) / span) * 100;
  const pixelHeight = (height / 100) * HOURS.length * HOUR_PX;
  return (
    <div
      title={gap.label}
      className={`drive-gap pointer-events-none absolute inset-x-1 z-0 flex items-center overflow-hidden rounded-md px-2.5 text-[10px] font-medium leading-none transition-opacity duration-150 ${
        dimmed ? "opacity-25" : ""
      } ${gap.tight ? "drive-gap-tight" : ""}`}
      style={{ top: `${top}%`, height: `${height}%` }}
    >
      {pixelHeight >= DRIVE_LABEL_MIN_PX ? (
        <span className="min-w-0 truncate">{gap.label}</span>
      ) : null}
    </div>
  );
}

function StaffColumnDropSlot({
  staffId,
  index,
  label,
  subLabel,
  topPct,
  heightPct,
  minHeightPx = 38,
  gapMinutes,
  draggedDuration,
}: {
  staffId: string;
  index: number;
  label: string;
  subLabel?: string;
  topPct: number;
  heightPct: number;
  minHeightPx?: number;
  gapMinutes?: number;
  draggedDuration?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${staffId}:${index}`,
  });

  const fits =
    gapMinutes != null && draggedDuration != null && gapMinutes > 0
      ? gapMinutes >= draggedDuration
      : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        top: `${topPct}%`,
        height: heightPct > 0 ? `max(${heightPct}%, ${minHeightPx}px)` : `${minHeightPx}px`,
      }}
      className={`absolute inset-x-1 z-20 flex flex-col justify-center rounded-lg border-2 border-dashed px-2 py-1 select-none transition-all duration-150 ${
        isOver
          ? "z-30 border-brand-orange bg-brand-orange/20 shadow-md ring-2 ring-brand-orange/30 scale-[1.01]"
          : "border-brand-orange/45 bg-brand-orange/[0.04] hover:border-brand-orange/70 hover:bg-brand-orange/[0.08]"
      }`}
    >
      <div className="pointer-events-none flex items-center justify-between gap-1 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              isOver ? "bg-brand-orange text-white" : "bg-brand-orange/20 text-brand-orange"
            }`}
          >
            +
          </span>
          <span
            className={`truncate text-[11px] font-semibold ${
              isOver ? "text-brand-orange" : "text-neutral-700"
            }`}
          >
            {isOver ? "Drop to insert here" : label}
          </span>
        </div>
        {subLabel ? (
          <span className="shrink-0 text-[10px] font-medium text-neutral-500">
            {subLabel}
          </span>
        ) : null}
      </div>
      {fits != null && !isOver ? (
        <div className="mt-0.5 pointer-events-none flex items-center gap-1 text-[9px]">
          {fits ? (
            <span className="rounded bg-emerald-50 px-1 font-medium text-emerald-700 border border-emerald-200/60">
              Fits ({gapMinutes}m gap)
            </span>
          ) : (
            <span className="rounded bg-amber-50 px-1 font-medium text-amber-700 border border-amber-200/60">
              Pushes next stops ({gapMinutes}m gap)
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EmptyColumnDropSlot({
  staff,
}: {
  staff: ScheduleStaffMember;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${staff._id}:0`,
  });

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-x-2 top-4 bottom-4 z-20 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center select-none transition-all duration-150 ${
        isOver
          ? "border-brand-orange bg-brand-orange/20 shadow-lg ring-2 ring-brand-orange/30 scale-[1.01]"
          : "border-brand-orange/35 bg-brand-orange/[0.03] hover:border-brand-orange/60 hover:bg-brand-orange/[0.06]"
      }`}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
          isOver ? "bg-brand-orange text-white" : "bg-brand-orange/10 text-brand-orange"
        }`}
      >
        <span className="text-xl font-bold">+</span>
      </div>
      <div
        className={`mt-2 text-xs font-semibold ${
          isOver ? "text-brand-orange" : "text-neutral-700"
        }`}
      >
        {isOver ? `Assign first stop to ${staff.first_name}` : `Start schedule for ${staff.first_name}`}
      </div>
      <div className="mt-1 text-[11px] text-neutral-400">
        Drop here to start their day
      </div>
    </div>
  );
}

function StaffColumn({
  staff,
  jobs,
  tasks,
  gaps,
  selectedDate,
  onJobClick,
  onMap,
  dispatcher,
  draggingJob,
  canManageTasks,
  onTaskDone,
  onTaskEdit,
  onTaskRemove,
}: {
  staff: ScheduleStaffMember;
  jobs: WorkOrderListItem[];
  tasks: TaskItem[];
  gaps: DriveGap[];
  selectedDate: string;
  onJobClick: (job: WorkOrderListItem) => void;
  onMap: () => void;
  dispatcher: boolean;
  draggingJob?: WorkOrderListItem | null;
  canManageTasks: boolean;
  onTaskDone: (task: TaskItem) => void;
  onTaskEdit: (task: TaskItem) => void;
  onTaskRemove: (task: TaskItem) => void;
}) {
  const { active } = useDndContext();
  const isDraggingAnyJob = Boolean(
    dispatcher && active && String(active.id).startsWith("job:")
  );
  const draggedJobId = isDraggingAnyJob ? String(active!.id).slice(4) : null;
  const activeJob =
    draggingJob && draggingJob._id === draggedJobId
      ? draggingJob
      : jobs.find((j) => j._id === draggedJobId) ?? draggingJob;
  const draggedDuration =
    activeJob?.estimatedMinutes ?? DEFAULT_ESTIMATED_MINUTES;

  const boardStart = BOARD_HOUR_START * 60;
  const boardEnd = BOARD_HOUR_END * 60;
  const span = boardEnd - boardStart;

  const placedJobs = jobs
    .map((job) => ({ job, window: jobWindowMinutes(job) }))
    .filter(
      (
        row,
      ): row is {
        job: WorkOrderListItem;
        window: { startMin: number; endMin: number };
      } => row.window != null,
    )
    .sort((a, b) => a.window.startMin - b.window.startMin);

  const dropSlots: ReactNode[] = [];
  if (isDraggingAnyJob) {
    if (placedJobs.length === 0) {
      dropSlots.push(
        <EmptyColumnDropSlot key={`empty-${staff._id}`} staff={staff} />
      );
    } else {
      const first = placedJobs[0]!;
      const firstCustomer = orderCustomerName(first.job);
      const firstStart = first.window.startMin;
      const gapBefore = Math.max(0, firstStart - boardStart);
      const slot0TopPct = 0;
      const slot0HeightPct = Math.max(0, ((firstStart - boardStart) / span) * 100);
      dropSlots.push(
        <StaffColumnDropSlot
          key={`slot-0`}
          staffId={staff._id}
          index={0}
          label="Start of Day"
          subLabel={`Before ${firstCustomer}`}
          topPct={slot0TopPct}
          heightPct={slot0HeightPct}
          minHeightPx={38}
          gapMinutes={gapBefore}
          draggedDuration={draggedDuration}
        />
      );

      for (let i = 1; i < placedJobs.length; i += 1) {
        const prev = placedJobs[i - 1]!;
        const next = placedJobs[i]!;
        const prevCustomer = orderCustomerName(prev.job);
        const nextCustomer = orderCustomerName(next.job);
        const prevEnd = prev.window.endMin;
        const nextStart = next.window.startMin;
        const gapMinutes = Math.max(0, nextStart - prevEnd);
        const topPct = ((prevEnd - boardStart) / span) * 100;
        const heightPct = ((Math.max(0, nextStart - prevEnd)) / span) * 100;
        dropSlots.push(
          <StaffColumnDropSlot
            key={`slot-${i}`}
            staffId={staff._id}
            index={i}
            label={`Between ${prevCustomer} & ${nextCustomer}`}
            subLabel={`~${formatMinutesClock(prevEnd)}`}
            topPct={topPct}
            heightPct={heightPct}
            minHeightPx={38}
            gapMinutes={gapMinutes}
            draggedDuration={draggedDuration}
          />
        );
      }

      const last = placedJobs[placedJobs.length - 1]!;
      const lastCustomer = orderCustomerName(last.job);
      const lastEnd = last.window.endMin;
      const gapAfter = Math.max(0, boardEnd - lastEnd);
      const lastTopPct = ((lastEnd - boardStart) / span) * 100;
      const lastHeightPct = Math.max(
        0,
        ((Math.min(boardEnd, lastEnd + draggedDuration) - lastEnd) / span) * 100
      );
      dropSlots.push(
        <StaffColumnDropSlot
          key={`slot-${placedJobs.length}`}
          staffId={staff._id}
          index={placedJobs.length}
          label="End of Day"
          subLabel={`After ${lastCustomer}`}
          topPct={lastTopPct}
          heightPct={lastHeightPct}
          minHeightPx={38}
          gapMinutes={gapAfter}
          draggedDuration={draggedDuration}
        />
      );
    }
  }

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `col:${staff._id}`,
    disabled: !dispatcher,
  });
  const { setNodeRef: setHeaderDropRef, isOver: headerOver } = useDroppable({
    id: `col:${staff._id}`,
    disabled: !dispatcher,
  });
  const { setNodeRef, isOver } = useDroppable({
    id: `row:${staff._id}`,
    disabled: !dispatcher,
  });

  const initials =
    staff.initials?.trim() ||
    `${staff.first_name?.[0] ?? ""}${staff.last_name?.[0] ?? ""}`.toUpperCase() ||
    "?";
  const boardHeight = HOURS.length * HOUR_PX;
  const cities = citiesByAppointmentCount(jobs);
  const lanes = assignTimeLanes([
    ...jobs.map((job) => ({ id: `job:${job._id}`, window: jobWindowMinutes(job) })),
    ...tasks.map((task) => ({ id: `task:${task.id}`, window: taskWindowMinutes(task) })),
  ]);

  return (
    <div className="flex min-w-[11rem] flex-1 flex-col">
      <div
        ref={(node) => {
          setDragRef(node);
          setHeaderDropRef(node);
        }}
        style={{
          transform: transform ? CSS.Translate.toString(transform) : undefined,
        }}
        className={`group sticky top-0 z-20 flex h-[4.25rem] items-center gap-1.5 border-b border-l border-neutral-200 bg-white px-2 ${
          headerOver ? "bg-brand-orange/10" : ""
        } ${isDragging ? "z-30 opacity-60" : ""}`}
      >
        {dispatcher ? (
          <button
            type="button"
            aria-label={`Reorder ${staff.first_name} ${staff.last_name}`}
            className="shrink-0 cursor-grab rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-brand-dark active:cursor-grabbing"
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <span
          aria-hidden
          className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 px-1 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200"
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-brand-dark">
            {staff.first_name} {staff.last_name}
          </div>
          {cities.length > 0 ? (
            <div className="truncate text-[10px] text-neutral-400">
              {cities.map((row) => row.city).join(" · ")}
            </div>
          ) : null}
        </div>
        {cities.length > 0 && !isDragging ? (
          <div className="pointer-events-none absolute inset-x-2 top-full z-30 mt-1 hidden rounded-lg border border-neutral-200 bg-white p-2 shadow-lg group-hover:block">
            <ul className="space-y-1">
              {cities.map((row) => (
                <li
                  key={row.city}
                  className="flex items-baseline justify-between gap-3 text-[11px] leading-tight"
                >
                  <span className="min-w-0 text-brand-dark">{row.city}</span>
                  <span className="shrink-0 tabular-nums text-neutral-500">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <TextScheduleButton
          userId={staff._id}
          date={selectedDate}
          variant="icon"
          className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          onClick={onMap}
          aria-label={`Open ${staff.first_name} ${staff.last_name}'s route on the map`}
          title="Route map"
          className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-brand-orange"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div
        ref={setNodeRef}
        data-schedule-day={staff._id}
        style={{ height: boardHeight }}
        className={`relative border-l border-neutral-200/70 transition-colors ${
          isOver ? "bg-brand-orange/10" : ""
        }`}
      >
        <div className="pointer-events-none absolute inset-0">
          {HOURS.map((hour, index) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-neutral-200/60"
              style={{ top: index * HOUR_PX }}
            />
          ))}
        </div>
        {gaps.map((gap) => (
          <DriveGapBand key={gap.key} gap={gap} dimmed={isDraggingAnyJob} />
        ))}
        {dropSlots}
        {jobs.map((job) => {
          const layout = lanes.get(`job:${job._id}`) ?? { lane: 0, laneCount: 1 };
          return (
            <JobBlock
              key={job._id}
              order={job}
              dispatcher={dispatcher}
              lane={layout.lane}
              laneCount={layout.laneCount}
              liftDrag={true}
              onClick={() => onJobClick(job)}
            />
          );
        })}
        {tasks.map((task) => {
          const layout = lanes.get(`task:${task.id}`) ?? { lane: 0, laneCount: 1 };
          return (
            <TaskBlock
              key={task.id}
              task={task}
              dispatcher={dispatcher}
              canManage={canManageTasks}
              lane={layout.lane}
              laneCount={layout.laneCount}
              liftDrag={true}
              onDone={() => onTaskDone(task)}
              onEdit={() => onTaskEdit(task)}
              onRemove={() => onTaskRemove(task)}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function WeekBoard({
  staff,
  jobs,
  tasks = [],
  selectedDate,
  dispatcher,
  draggingJob,
  onJobClick,
  onMap,
  canManageTasks = false,
  onTaskDone,
  onTaskEdit,
  onTaskRemove,
}: {
  staff: ScheduleStaffMember[];
  jobs: WorkOrderListItem[];
  tasks?: TaskItem[];
  selectedDate: string;
  dispatcher: boolean;
  draggingJob?: WorkOrderListItem | null;
  onJobClick: (job: WorkOrderListItem) => void;
  onMap: (userId: string) => void;
  canManageTasks?: boolean;
  onTaskDone?: (task: TaskItem) => void;
  onTaskEdit?: (task: TaskItem) => void;
  onTaskRemove?: (task: TaskItem) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const jobsByUser = new Map<string, WorkOrderListItem[]>();
  for (const job of jobs) {
    if (!isScheduledOnDate(job, selectedDate)) continue;
    for (const uid of workOrderCrewIds(job)) {
      const list = jobsByUser.get(uid) ?? [];
      list.push(job);
      jobsByUser.set(uid, list);
    }
  }
  const tasksByUser = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    if (!task.scheduledTechnicianId || !isScheduledOnDate(task, selectedDate)) continue;
    const list = tasksByUser.get(task.scheduledTechnicianId) ?? [];
    list.push(task);
    tasksByUser.set(task.scheduledTechnicianId, list);
  }

  const routeKey = [
    selectedDate,
    ...staff.map((person) => {
      const list = jobsByUser.get(person._id) ?? [];
      const sig = list
        .map((job) => `${job._id}:${job.scheduledStart ?? ""}`)
        .sort()
        .join(",");
      return `${person._id}=${sig}`;
    }),
  ].join("|");

  const [routes, setRoutes] = useState<
    Record<string, { stops: ScheduleRouteStop[]; legs: ScheduleRouteLeg[] }>
  >({});
  const [loadedKey, setLoadedKey] = useState("");

  useEffect(() => {
    const ids = routeKey
      .split("|")
      .slice(1)
      .filter((part) => part.includes("=") && !part.endsWith("="))
      .map((part) => part.slice(0, part.indexOf("=")))
      .filter(Boolean);
    if (!token || ids.length === 0) {
      queueMicrotask(() => {
        setRoutes({});
        setLoadedKey(routeKey);
      });
      return;
    }
    let cancelled = false;
    void Promise.all(
      ids.map((id) =>
        getScheduleRoute(token, id, selectedDate)
          .then((result) => ({
            id,
            stops: result.stops,
            legs: result.route?.legs ?? [],
          }))
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<
        string,
        { stops: ScheduleRouteStop[]; legs: ScheduleRouteLeg[] }
      > = {};
      for (const row of rows) {
        if (!row) continue;
        next[row.id] = { stops: row.stops, legs: row.legs };
      }
      setRoutes(next);
      setLoadedKey(routeKey);
    });
    return () => {
      cancelled = true;
    };
  }, [token, routeKey, selectedDate]);

  const routesReady = loadedKey === routeKey;
  const boardHeight = HOURS.length * HOUR_PX;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
      {staff.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-neutral-500">
          No technicians on the board. Assign the Technician role under Users,
          then set hours on the Technicians tab.
        </div>
      ) : (
        <div className="flex min-w-full">
          <div className="sticky left-0 z-30 w-16 shrink-0 bg-white">
            <div className="sticky top-0 z-40 h-[4.25rem] border-b border-neutral-200 bg-white" />
            <div style={{ height: boardHeight }}>
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  style={{ height: HOUR_PX }}
                  className="border-t border-neutral-200/60 px-1.5 pt-1 text-[11px] tabular-nums text-neutral-400"
                >
                  {hourLabel(hour)}
                </div>
              ))}
            </div>
          </div>
          {staff.map((person) => (
            <StaffColumn
              key={person._id}
              staff={person}
              jobs={jobsByUser.get(person._id) ?? []}
              tasks={tasksByUser.get(person._id) ?? []}
              canManageTasks={canManageTasks}
              onTaskDone={onTaskDone ?? (() => {})}
              onTaskEdit={onTaskEdit ?? (() => {})}
              onTaskRemove={onTaskRemove ?? (() => {})}
              gaps={
                routesReady
                  ? buildDriveGaps(
                      jobsByUser.get(person._id) ?? [],
                      routes[person._id]?.stops ?? [],
                      routes[person._id]?.legs ?? [],
                    )
                  : []
              }
              selectedDate={selectedDate}
              dispatcher={dispatcher}
              draggingJob={draggingJob}
              onJobClick={onJobClick}
              onMap={() => onMap(person._id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { HOURS };
