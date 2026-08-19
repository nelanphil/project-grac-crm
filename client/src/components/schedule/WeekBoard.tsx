"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { ScheduleStaffMember, WorkOrderListItem } from "@/lib/api";
import {
  BOARD_HOUR_END,
  BOARD_HOUR_START,
  DEFAULT_ESTIMATED_MINUTES,
  formatAddressLine,
  formatLocalTime,
  minutesToLabel,
  nyDateParts,
} from "@/lib/schedule";

const HOURS = Array.from(
  { length: BOARD_HOUR_END - BOARD_HOUR_START },
  (_, i) => BOARD_HOUR_START + i,
);

export function UnscheduledCard({
  order,
  selected,
  onSelect,
}: {
  order: WorkOrderListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `job:${order._id}` });
  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      className={`w-full rounded-lg border px-3 py-2 text-left text-xs shadow-sm ${
        selected
          ? "border-brand-orange bg-orange-50"
          : "border-neutral-200 bg-white"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="font-semibold text-brand-dark truncate">
        {order.customerName || "Customer"}
      </div>
      <div className="mt-0.5 text-neutral-500 truncate">
        {formatAddressLine(order.address)}
      </div>
      <div className="mt-1 text-neutral-400">
        {order.date ? order.date.slice(0, 10) : "No date"} ·{" "}
        {minutesToLabel(order.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES)}
      </div>
    </button>
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
  const parts = nyDateParts(start);
  const startMin = parts.hour * 60 + parts.minute;
  const boardStart = BOARD_HOUR_START * 60;
  const boardEnd = BOARD_HOUR_END * 60;
  const duration = order.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES;
  const leftPct =
    ((Math.max(startMin, boardStart) - boardStart) / (boardEnd - boardStart)) *
    100;
  const widthPct = Math.max(
    4,
    (duration / (boardEnd - boardStart)) * 100,
  );

  const style = {
    left: `${leftPct}%`,
    width: `${widthPct}%`,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...(dispatcher ? listeners : {})}
      {...(dispatcher ? attributes : {})}
      onClick={onClick}
      className={`absolute top-1 bottom-1 overflow-hidden rounded bg-brand-orange px-1.5 py-0.5 text-left text-[11px] text-white shadow-sm ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="truncate font-semibold">
        {order.customerName || "Job"}
      </div>
      <div className="truncate opacity-90">
        {formatLocalTime(start)} · {minutesToLabel(duration)}
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

  return (
    <div className="grid grid-cols-[10rem_1fr] border-b border-neutral-100">
      <div className="flex items-start justify-between gap-1 px-2 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-brand-dark">
            {staff.first_name} {staff.last_name}
          </div>
          <div className="text-[10px] text-neutral-400">{staff.role}</div>
        </div>
        <button
          type="button"
          onClick={onMap}
          className="shrink-0 text-[10px] font-medium text-brand-orange hover:underline"
        >
          Map
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={`relative min-h-[56px] ${isOver ? "bg-orange-50/70" : "bg-white"}`}
      >
        <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${HOURS.length}, minmax(0, 1fr))` }}>
          {HOURS.map((h) => (
            <div key={h} className="border-l border-neutral-100" />
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
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[10rem_1fr] border-b border-neutral-200 bg-neutral-50">
          <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Technician
          </div>
          <div
            className="grid text-[11px] font-medium text-neutral-500"
            style={{ gridTemplateColumns: `repeat(${HOURS.length}, minmax(0, 1fr))` }}
          >
            {HOURS.map((h) => (
              <div key={h} className="border-l border-neutral-200 px-1 py-2">
                {h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`}
              </div>
            ))}
          </div>
        </div>
        {staff.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-neutral-500">
            No schedulable staff. Turn on work schedule under Users, then set
            hours on the Technicians tab.
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
