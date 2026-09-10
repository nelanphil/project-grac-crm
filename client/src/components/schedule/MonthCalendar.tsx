"use client";

import type { WorkOrderListItem } from "@/lib/api";
import {
  addDays,
  daysInMonth,
  formatLocalDate,
  nyDateParts,
  startOfMonth,
  localDateTimeToIso,
} from "@/lib/schedule";

export default function MonthCalendar({
  monthDate,
  jobs,
  selectedDate,
  onSelectDate,
}: {
  monthDate: string;
  jobs: WorkOrderListItem[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const start = startOfMonth(monthDate);
  const count = daysInMonth(start);
  const firstWeekday = nyDateParts(
    new Date(localDateTimeToIso(start, "12:00")),
  ).weekdayIndex;

  const counts = new Map<string, number>();
  for (const job of jobs) {
    const key = job.scheduledStart
      ? formatLocalDate(new Date(job.scheduledStart))
      : job.date
        ? String(job.date).slice(0, 10)
        : "";
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const cells: Array<{ date: string | null }> = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push({ date: null });
  for (let d = 0; d < count; d += 1) {
    cells.push({ date: addDays(start, d) });
  }

  const label = new Date(`${start}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm sm:p-4">
      <h2 className="mb-3 text-sm font-semibold text-brand-dark">{label}</h2>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-400 sm:text-[11px]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1">
            <span className="sm:hidden">{d.slice(0, 1)}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell.date) {
            return <div key={`empty-${i}`} className="min-h-11 sm:min-h-[64px]" />;
          }
          const n = counts.get(cell.date) ?? 0;
          const selected = cell.date === selectedDate;
          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => onSelectDate(cell.date!)}
              className={`min-h-11 rounded-lg border px-1 py-1 text-left sm:min-h-[64px] sm:px-1.5 ${
                selected
                  ? "border-brand-orange bg-orange-50"
                  : "border-neutral-100 hover:border-neutral-300"
              }`}
            >
              <div className="text-xs font-semibold text-brand-dark">
                {Number(cell.date.slice(8))}
              </div>
              {n > 0 && (
                <div className="mt-1 truncate text-[10px] text-neutral-500">
                  {n} job{n === 1 ? "" : "s"}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
