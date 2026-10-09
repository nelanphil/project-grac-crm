"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, MapPin } from "lucide-react";
import type {
  ScheduleRecommendation,
  ScheduleStaffMember,
  WorkOrderListItem,
} from "@/lib/api";
import {
  BOARD_HOUR_END,
  BOARD_HOUR_START,
  DEFAULT_ESTIMATED_MINUTES,
  formatLocalClock,
  formatMonthDayYear,
  formatTimeWindow,
  jobAccent,
  minutesToLabel,
  nyDateParts,
  workOrderViewHref,
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
const HOUR_PX = 72;

function hourLabel(hour: number): string {
  if (hour === 12) return "12 PM";
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

function personName(
  person?: { first_name?: string; last_name?: string } | null,
): string {
  return [person?.first_name, person?.last_name].filter(Boolean).join(" ");
}

function TechnicianAssignMenu({
  x,
  y,
  technicians,
  assignedId,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  technicians: ScheduleRecommendation[];
  assignedId: string;
  onPick: (userId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y, technicians]);

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

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Assign technician"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-[80] w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        Assign technician
      </div>
      {technicians.length === 0 ? (
        <p className="px-3 py-2 text-xs text-neutral-500">
          No technicians available
        </p>
      ) : (
        technicians.map((tech) => {
          const name = personName(tech);
          const current = tech.userId === assignedId;
          return (
            <button
              key={tech.userId}
              type="button"
              role="menuitem"
              onClick={() => onPick(tech.userId)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-neutral-50"
            >
              <Check
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  current ? "text-emerald-600" : "text-transparent"
                }`}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-brand-dark">
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
        })
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
  onAssignTechnician,
  onUnschedule,
  isDragging,
  setNodeRef,
  style,
  dragHandle,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
  recommendation?: ScheduleRecommendation | null;
  technicians?: ScheduleRecommendation[];
  onAssignTechnician?: (userId: string) => void;
  onUnschedule?: () => void;
  isDragging?: boolean;
  setNodeRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragHandle?: {
    attributes: ReturnType<typeof useDraggable>["attributes"];
    listeners: ReturnType<typeof useDraggable>["listeners"];
  };
}) {
  const href = workOrderViewHref(order);
  const windowLabel = formatTimeWindow(order.startTime, order.endTime);
  const accent = jobAccent(order);
  const assignedName = personName(order.assignee);
  const recommendedName = recommendation ? personName(recommendation) : "";
  const assignedId = order.assignee?._id ?? order.assignedUserRef ?? "";
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
      style={{ ...style, touchAction: narrow ? "pan-y" : style?.touchAction }}
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
      className={`flex w-full gap-2.5 rounded-xl border bg-neutral-50 px-3 py-2.5 text-left text-xs transition-colors hover:border-neutral-300 ${
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
                order.address?.city?.trim() || order.customerCity?.trim() || "—",
                order.workOrderType?.label,
                minutesToLabel(order.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {order.scheduleNote ? (
              <div className="mt-1 line-clamp-2 text-neutral-600">
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
              className={`rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${
                order.scheduledStart
                  ? "bg-blue-500/15 text-blue-500"
                  : "bg-brand-orange/15 text-brand-orange"
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
          </div>
        </div>
        {href ? (
          <Link
            href={href}
            onPointerDown={(event) => event.stopPropagation()}
            className="mt-1.5 inline-block text-[11px] font-medium text-brand-orange hover:underline"
          >
            View
          </Link>
        ) : null}
      </div>
      {menu && onAssignTechnician ? (
        <TechnicianAssignMenu
          x={menu.x}
          y={menu.y}
          technicians={technicians ?? []}
          assignedId={assignedId}
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
  onAssignTechnician,
  onUnschedule,
  lift = false,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
  recommendation?: ScheduleRecommendation | null;
  technicians?: ScheduleRecommendation[];
  onAssignTechnician?: (userId: string) => void;
  onUnschedule?: () => void;
  lift?: boolean;
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
      onAssignTechnician={onAssignTechnician}
      onUnschedule={onUnschedule}
      isDragging={isDragging}
      setNodeRef={setNodeRef}
      style={style}
      dragHandle={{ attributes, listeners }}
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
  onAssignTechnician,
  onUnschedule,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
  draggable?: boolean;
  lift?: boolean;
  recommendation?: ScheduleRecommendation | null;
  technicians?: ScheduleRecommendation[];
  onAssignTechnician?: (userId: string) => void;
  onUnschedule?: () => void;
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
        onAssignTechnician={onAssignTechnician}
        onUnschedule={onUnschedule}
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
      onAssignTechnician={onAssignTechnician}
      onUnschedule={onUnschedule}
      lift={lift}
    />
  );
}

function JobBlock({
  order,
  onClick,
  dispatcher,
}: {
  order: WorkOrderListItem;
  onClick: () => void;
  dispatcher: boolean;
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
  const city =
    order.address?.city?.trim() || order.customerCity?.trim() || "";
  const typeLabel = order.workOrderType?.label?.trim() || "";
  const detail = [city, typeLabel, minutesToLabel(duration)]
    .filter(Boolean)
    .join(" · ");
  const showDetail = duration >= 60 && detail.length > 0;

  const accent = jobAccent(order);
  const style: CSSProperties = {
    top: `${topPct}%`,
    height: `${heightPct}%`,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    backgroundColor: `${accent}26`,
    borderLeftColor: accent,
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...(dispatcher ? listeners : {})}
      {...(dispatcher ? attributes : {})}
      onClick={onClick}
      title={[
        order.customerName || "Job",
        `${formatLocalClock(start)} – ${formatLocalClock(end)}`,
        detail,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={`absolute inset-x-1 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight text-brand-dark transition-shadow hover:shadow-md ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="font-semibold break-words">
        {order.customerName || "Job"}
      </div>
      <div className="text-neutral-500">
        {formatLocalClock(start)} – {formatLocalClock(end)}
      </div>
      {showDetail ? (
        <div className="mt-0.5 text-neutral-600 break-words">{detail}</div>
      ) : null}
    </button>
  );
}

function StaffColumn({
  staff,
  jobs,
  onJobClick,
  onMap,
  dispatcher,
}: {
  staff: ScheduleStaffMember;
  jobs: WorkOrderListItem[];
  onJobClick: (job: WorkOrderListItem) => void;
  onMap: () => void;
  dispatcher: boolean;
}) {
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
    `${staff.first_name?.[0] ?? ""}${staff.last_name?.[0] ?? ""}`.toUpperCase() ||
    "?";
  const boardHeight = HOURS.length * HOUR_PX;

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
        className={`sticky top-0 z-20 flex h-[4.25rem] items-center gap-1.5 border-b border-l border-neutral-200 bg-white px-2 ${
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
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200"
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-brand-dark">
            {staff.first_name} {staff.last_name}
          </div>
          <div className="truncate text-[10px] text-neutral-400">
            {(staff.roles?.length ? staff.roles : [staff.role]).join(", ")}
          </div>
        </div>
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
        {jobs.map((job) => (
          <JobBlock
            key={job._id}
            order={job}
            dispatcher={dispatcher}
            onClick={() => onJobClick(job)}
          />
        ))}
      </div>
    </div>
  );
}

export default function WeekBoard({
  staff,
  jobs,
  selectedDate,
  dispatcher,
  onJobClick,
  onMap,
}: {
  staff: ScheduleStaffMember[];
  jobs: WorkOrderListItem[];
  selectedDate: string;
  dispatcher: boolean;
  onJobClick: (job: WorkOrderListItem) => void;
  onMap: (userId: string) => void;
}) {
  const jobsByUser = new Map<string, WorkOrderListItem[]>();
  for (const job of jobs) {
    if (!job.scheduledStart) continue;
    const local = job.scheduledStart;
    const date = new Date(local);
    const ymd = `${nyDateParts(date).year}-${String(nyDateParts(date).month).padStart(2, "0")}-${String(nyDateParts(date).day).padStart(2, "0")}`;
    if (ymd !== selectedDate) continue;
    const uid = job.assignedUserRef ?? job.assignee?._id ?? "";
    if (!uid) continue;
    const list = jobsByUser.get(uid) ?? [];
    list.push(job);
    jobsByUser.set(uid, list);
  }

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
              dispatcher={dispatcher}
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
