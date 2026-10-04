"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { MapPin } from "lucide-react";
import type { ScheduleStaffMember, WorkOrderListItem } from "@/lib/api";
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

const HOURS = Array.from(
  { length: BOARD_HOUR_END - BOARD_HOUR_START },
  (_, i) => BOARD_HOUR_START + i,
);

function UnscheduledCardShell({
  order,
  selected,
  onSelect,
  isDragging,
  setNodeRef,
  style,
  dragHandle,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
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

  return (
    <div
      ref={setNodeRef}
      style={style}
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
        <button
          type="button"
          {...(dragHandle?.listeners ?? {})}
          {...(dragHandle?.attributes ?? {})}
          onClick={onSelect}
          className="w-full text-left"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="truncate text-[13px] font-semibold text-brand-dark">
              {order.customerName || "Customer"}
            </div>
            <span
              className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${
                order.scheduledStart
                  ? "bg-blue-500/15 text-blue-500"
                  : "bg-brand-orange/15 text-brand-orange"
              }`}
            >
              {order.scheduledStart ? "Scheduled" : "Unscheduled"}
            </span>
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
        </button>
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
    </div>
  );
}

function DraggableUnscheduledCard({
  order,
  selected,
  onSelect,
  lift = false,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
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
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
  draggable?: boolean;
  lift?: boolean;
}) {
  if (!draggable || Boolean(order.scheduledStart)) {
    return (
      <UnscheduledCardShell
        order={order}
        selected={selected}
        onSelect={onSelect}
      />
    );
  }
  return (
    <DraggableUnscheduledCard
      order={order}
      selected={selected}
      onSelect={onSelect}
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
  const leftPct =
    ((Math.max(startMin, boardStart) - boardStart) / (boardEnd - boardStart)) *
    100;
  const widthPct = Math.max(
    4,
    (duration / (boardEnd - boardStart)) * 100,
  );

  const accent = jobAccent(order);
  const style: CSSProperties = {
    left: `${leftPct}%`,
    width: `${widthPct}%`,
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
      title={`${order.customerName || "Job"} · ${formatLocalClock(start)} – ${formatLocalClock(end)}`}
      className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11px] text-brand-dark transition-shadow hover:shadow-md ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="truncate font-semibold">
        {order.customerName || "Job"}
      </div>
      <div className="truncate text-neutral-500">
        {formatLocalClock(start)} – {formatLocalClock(end)}
      </div>
    </button>
  );
}

function StaffRow({
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
  const { setNodeRef, isOver } = useDroppable({
    id: `row:${staff._id}`,
    disabled: !dispatcher,
  });

  const initials =
    `${staff.first_name?.[0] ?? ""}${staff.last_name?.[0] ?? ""}`.toUpperCase() ||
    "?";

  return (
    <div className="grid grid-cols-[5.5rem_1fr] border-b border-neutral-200/70 last:border-b-0 md:grid-cols-[11rem_1fr]">
      <div className="flex items-center justify-between gap-1.5 px-2 py-2 md:px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-600 ring-1 ring-neutral-200 md:flex"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-brand-dark">
              {staff.first_name} {staff.last_name}
            </div>
            <div className="truncate text-[10px] text-neutral-400">
              {(staff.roles?.length ? staff.roles : [staff.role]).join(", ")}
            </div>
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
        className={`relative min-h-[60px] transition-colors ${isOver ? "bg-brand-orange/10" : ""}`}
      >
        <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${HOURS.length}, minmax(0, 1fr))` }}>
          {HOURS.map((h) => (
            <div key={h} className="border-l border-neutral-200/60" />
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

  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="min-w-[36rem] md:min-w-[720px]">
        <div className="grid grid-cols-[5.5rem_1fr] border-b border-neutral-200 md:grid-cols-[11rem_1fr]">
          <div className="px-2 py-2.5 text-[11px] font-medium text-neutral-400 md:px-3">
            Technician
          </div>
          <div
            className="grid text-[11px] text-neutral-400"
            style={{ gridTemplateColumns: `repeat(${HOURS.length}, minmax(0, 1fr))` }}
          >
            {HOURS.map((h) => (
              <div key={h} className="border-l border-neutral-200/60 px-1.5 py-2.5 tabular-nums">
                {h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}
              </div>
            ))}
          </div>
        </div>
        {staff.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-neutral-500">
            No technicians on the board. Assign the Technician role under Users,
            then set hours on the Technicians tab.
          </div>
        ) : (
          staff.map((person) => (
            <StaffRow
              key={person._id}
              staff={person}
              jobs={jobsByUser.get(person._id) ?? []}
              dispatcher={dispatcher}
              onJobClick={onJobClick}
              onMap={() => onMap(person._id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export { HOURS };
