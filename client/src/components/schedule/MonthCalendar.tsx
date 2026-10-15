"use client";

import type { WorkOrderListItem } from "@/lib/api";
import {
  addDays,
  blendColors,
  contrastTextColor,
  daysInMonth,
  formatLocalDate,
  nyDateParts,
  properCaseCity,
  startOfMonth,
  localDateTimeToIso,
  technicianColor,
} from "@/lib/schedule";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 4;

type CityChip = {
  city: string;
  color: string;
  textColor: string;
  technicians: string[];
};

function jobDateKey(job: WorkOrderListItem): string {
  if (job.scheduledStart) return formatLocalDate(new Date(job.scheduledStart));
  return job.date ? String(job.date).slice(0, 10) : "";
}

function jobCity(job: WorkOrderListItem): string {
  return (job.address?.city || job.customerCity || "").trim();
}

function jobAssigneeId(job: WorkOrderListItem): string {
  return job.assignedUserRef || job.assignee?._id || "";
}

function jobAssigneeName(job: WorkOrderListItem): string {
  const name = [job.assignee?.first_name, job.assignee?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || job.tech.trim() || "Technician";
}

function citiesForDay(
  jobs: WorkOrderListItem[],
  colors: Record<string, string>,
): CityChip[] {
  const byCity = new Map<
    string,
    { label: string; techs: Map<string, string> }
  >();
  for (const job of jobs) {
    const city = jobCity(job);
    const assigneeId = jobAssigneeId(job);
    if (!city || !assigneeId) continue;
    const key = city.toLowerCase();
    const entry = byCity.get(key) ?? { label: city, techs: new Map() };
    if (!entry.techs.has(assigneeId)) {
      entry.techs.set(assigneeId, jobAssigneeName(job));
    }
    byCity.set(key, entry);
  }
  return [...byCity.values()]
    .map((entry) => {
      const color = blendColors(
        [...entry.techs.keys()].map(
          (id) => colors[id] || technicianColor(id),
        ),
      );
      return {
        city: properCaseCity(entry.label),
        color,
        textColor: contrastTextColor(color),
        technicians: [...entry.techs.values()].sort((a, b) =>
          a.localeCompare(b),
        ),
      };
    })
    .sort((a, b) => a.city.localeCompare(b.city));
}

export default function MonthCalendar({
  monthDate,
  jobs,
  selectedDate,
  technicianColors,
  onSelectDate,
}: {
  monthDate: string;
  jobs: WorkOrderListItem[];
  selectedDate: string;
  technicianColors: Record<string, string>;
  onSelectDate: (date: string) => void;
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
          const dayCities = inMonth
            ? citiesForDay(byDate.get(date) ?? [], technicianColors)
            : [];
          const shown = dayCities.slice(0, MAX_CHIPS);
          const hidden = dayCities.length - shown.length;
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
                {shown.map((chip) => (
                  <div
                    key={chip.city}
                    title={chip.technicians.join(", ")}
                    className="truncate rounded px-1 text-[10px] font-medium leading-4 sm:text-[11px]"
                    style={{
                      backgroundColor: chip.color,
                      color: chip.textColor,
                    }}
                  >
                    {chip.city}
                  </div>
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
                  dayCities.length
                    ? `, ${dayCities.length} ${dayCities.length === 1 ? "city" : "cities"}`
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
