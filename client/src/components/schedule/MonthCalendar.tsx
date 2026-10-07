"use client";

import type { WorkOrderListItem } from "@/lib/api";
import {
  addDays,
  daysInMonth,
  formatLocalClock,
  formatLocalDate,
  jobAccent,
  nyDateParts,
  startOfMonth,
  localDateTimeToIso,
} from "@/lib/schedule";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

function jobDateKey(job: WorkOrderListItem): string {
  if (job.scheduledStart) return formatLocalDate(new Date(job.scheduledStart));
  return job.date ? String(job.date).slice(0, 10) : "";
}

function chipLabel(job: WorkOrderListItem): string {
  return [job.customerName || "Work order", job.workOrderType?.label]
    .filter(Boolean)
    .join(" – ");
}

export default function MonthCalendar({
  monthDate,
  jobs,
  selectedDate,
  onSelectDate,
  onJobClick,
}: {
  monthDate: string;
  jobs: WorkOrderListItem[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onJobClick?: (job: WorkOrderListItem) => void;
}) {
  const start = startOfMonth(monthDate);
  const count = daysInMonth(start);
  const firstWeekday = nyDateParts(
    new Date(localDateTimeToIso(start, "12:00")),
  ).weekdayIndex;
  const today = formatLocalDate(new Date());

  const byDate = new Map<string, WorkOrderListItem[]>();
  for (const job of jobs) {
    const key = jobDateKey(job);
    if (!key) continue;
    const list = byDate.get(key) ?? [];
    list.push(job);
    byDate.set(key, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) =>
      (a.scheduledStart ?? "~").localeCompare(b.scheduledStart ?? "~"),
    );
  }

  const gridStart = addDays(start, -firstWeekday);
  const totalCells = Math.ceil((firstWeekday + count) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) =>
    addDays(gridStart, i),
  );
  const monthKey = start.slice(0, 7);

  const rows = totalCells / 7;

  return (
    <div className="flex h-full min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:min-h-0">
      <div className="grid shrink-0 grid-cols-7 border-b border-neutral-200 text-center text-[11px] text-neutral-400">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2.5">
            <span className="sm:hidden">{d.slice(0, 1)}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(4.5rem, 1fr))` }}
      >
        {cells.map((date, index) => {
          const inMonth = date.slice(0, 7) === monthKey;
          const dayJobs = inMonth ? (byDate.get(date) ?? []) : [];
          const shown = dayJobs.slice(0, MAX_CHIPS);
          const hidden = dayJobs.length - shown.length;
          const selected = date === selectedDate;
          const isToday = date === today;
          const lastCol = index % 7 === 6;
          const lastRow = index >= totalCells - 7;
          return (
            <div
              key={date}
              onClick={() => onSelectDate(date)}
              className={`group relative flex h-full min-h-0 cursor-pointer flex-col gap-1 overflow-hidden p-1 transition-colors sm:p-1.5 ${
                lastCol ? "" : "border-r"
              } ${lastRow ? "" : "border-b"} border-neutral-200/70 ${
                selected ? "bg-neutral-100" : "hover:bg-neutral-50"
              } ${inMonth ? "" : "opacity-40"}`}
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                {shown.map((job) => (
                  <button
                    key={job._id}
                    type="button"
                    title={chipLabel(job)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (onJobClick) onJobClick(job);
                      else onSelectDate(date);
                    }}
                    className="flex w-full min-w-0 items-center gap-1 rounded px-0.5 text-left text-[10px] leading-4 text-neutral-600 hover:bg-neutral-100 hover:text-brand-dark sm:text-[11px]"
                  >
                    <span
                      aria-hidden
                      className="h-3 w-[3px] shrink-0 rounded-full"
                      style={{ backgroundColor: jobAccent(job) }}
                    />
                    <span className="hidden truncate sm:inline">
                      {job.scheduledStart
                        ? `${formatLocalClock(new Date(job.scheduledStart))} `
                        : ""}
                      {chipLabel(job)}
                    </span>
                  </button>
                ))}
                {hidden > 0 && (
                  <div className="px-1 text-[10px] font-medium text-neutral-400">
                    +{hidden} more
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label={`Show ${date} in the job list${
                  dayJobs.length
                    ? `, ${dayJobs.length} job${dayJobs.length === 1 ? "" : "s"}`
                    : ""
                }`}
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectDate(date);
                }}
                className={`self-end rounded-md px-1.5 text-xs font-semibold tabular-nums sm:text-sm ${
                  isToday
                    ? "bg-brand-orange text-white"
                    : "text-brand-dark group-hover:text-brand-orange"
                }`}
              >
                {Number(date.slice(8))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
