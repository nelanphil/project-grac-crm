"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import type { WorkOrderListItem } from "@/lib/api";
import {
  addDays,
  blendColors,
  daysInMonth,
  formatLocalDate,
  formatLocalClock,
  formatMonthYear,
  formatPrettyDate,
  nyDateParts,
  opaqueTechnicianTint,
  properCaseCity,
  startOfMonth,
  localDateTimeToIso,
  technicianColor,
  workOrderCrewIds,
} from "@/lib/schedule";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 4;

type CityTechnician = {
  name: string;
  color: string;
};

type CityChip = {
  city: string;
  color: string;
  count: number;
  technicians: CityTechnician[];
};

function jobDateKey(job: WorkOrderListItem): string {
  if (job.scheduledStart) return formatLocalDate(new Date(job.scheduledStart));
  return job.date ? String(job.date).slice(0, 10) : "";
}

function jobCity(job: WorkOrderListItem): string {
  return (job.address?.city || job.customerCity || "").trim();
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
  recommendedByJobId: Record<string, string>,
  technicianNames: Record<string, string>,
): CityChip[] {
  const byCity = new Map<
    string,
    { label: string; count: number; techs: Map<string, CityTechnician> }
  >();
  for (const job of jobs) {
    const city = jobCity(job);
    if (!city) continue;
    const key = city.toLowerCase();
    const entry = byCity.get(key) ?? { label: city, count: 0, techs: new Map() };
    entry.count += 1;
    byCity.set(key, entry);
    const crew = workOrderCrewIds(job);
    const techIds = crew.length > 0 ? crew : [recommendedByJobId[job._id] || ""];
    for (const techId of techIds) {
      if (!techId || entry.techs.has(techId)) continue;
      const named = job.assignees?.find((person) => person._id === techId);
      const name = named
        ? `${named.first_name} ${named.last_name}`.trim()
        : crew.length === 1
          ? jobAssigneeName(job)
          : technicianNames[techId] || job.tech.trim() || "Technician";
      entry.techs.set(techId, {
        name,
        color: colors[techId] || technicianColor(techId),
      });
    }
  }
  return [...byCity.values()]
    .map((entry) => {
      const techIds = [...entry.techs.keys()];
      const color =
        techIds.length > 0
          ? blendColors(techIds.map((id) => colors[id] || technicianColor(id)))
          : "#737373";
      return {
        city: properCaseCity(entry.label),
        color,
        count: entry.count,
        technicians: [...entry.techs.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
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
  recommendedByJobId = {},
  technicianNames = {},
  onSelectDate,
  isExpanded = false,
  onToggleExpand,
  onStepMonth,
  onToday,
  today: propToday,
  technicianLegend = [],
  onJobClick,
}: {
  monthDate: string;
  jobs: WorkOrderListItem[];
  selectedDate: string;
  technicianColors: Record<string, string>;
  recommendedByJobId?: Record<string, string>;
  technicianNames?: Record<string, string>;
  onSelectDate: (date: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onStepMonth?: (direction: -1 | 1) => void;
  onToday?: () => void;
  today?: string;
  technicianLegend?: Array<{ id: string; name: string; color: string }>;
  onJobClick?: (job: WorkOrderListItem) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDrawerOpen = isExpanded && drawerOpen;
  const start = startOfMonth(monthDate);
  const count = daysInMonth(start);
  const firstWeekday = nyDateParts(
    new Date(localDateTimeToIso(start, "12:00")),
  ).weekdayIndex;
  const today = propToday ?? formatLocalDate(new Date());

  const byDate = useMemo(() => {
    const map = new Map<string, WorkOrderListItem[]>();
    for (const job of jobs) {
      const key = jobDateKey(job);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(job);
      map.set(key, list);
    }
    return map;
  }, [jobs]);

  const selectedDayJobs = useMemo(() => {
    if (!selectedDate) return [];
    const list = byDate.get(selectedDate) ?? [];
    return [...list].sort((a, b) => {
      const aTime = a.scheduledStart || a.startTime || "";
      const bTime = b.scheduledStart || b.startTime || "";
      return aTime.localeCompare(bTime);
    });
  }, [byDate, selectedDate]);

  useEffect(() => {
    if (!isExpanded || !onToggleExpand) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDrawerOpen) {
          setDrawerOpen(false);
        } else {
          onToggleExpand();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, onToggleExpand, isDrawerOpen]);

  useEffect(() => {
    if (!isExpanded) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isExpanded]);

  const gridStart = addDays(start, -firstWeekday);
  const totalCells = Math.ceil((firstWeekday + count) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) =>
    addDays(gridStart, i),
  );
  const monthKey = start.slice(0, 7);
  const rows = totalCells / 7;
  const maxChips = isExpanded ? (isDrawerOpen ? 6 : 9) : MAX_CHIPS;

  const renderGrid = () => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="grid shrink-0 grid-cols-7 border-b border-neutral-200 text-center text-[11px] font-medium text-neutral-400">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2.5">
            <span className="sm:hidden">{d.slice(0, 1)}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{
          gridTemplateRows: `repeat(${rows}, minmax(${isExpanded ? "5rem" : "4.5rem"}, 1fr))`,
        }}
      >
        {cells.map((date, index) => {
          const inMonth = date.slice(0, 7) === monthKey;
          const dayCities = inMonth
            ? citiesForDay(
                byDate.get(date) ?? [],
                technicianColors,
                recommendedByJobId,
                technicianNames,
              )
            : [];
          const shown = dayCities.slice(0, maxChips);
          const extra = dayCities.slice(maxChips);
          const selected = date === selectedDate;
          const isToday = date === today;
          const lastCol = index % 7 === 6;
          const lastRow = index >= totalCells - 7;
          return (
            <div
              key={date}
              onClick={() => {
                onSelectDate(date);
                if (isExpanded) {
                  setDrawerOpen(true);
                }
              }}
              className={`group relative z-0 flex h-full min-h-0 cursor-pointer flex-col gap-1 overflow-visible p-1 transition-colors hover:z-20 sm:p-1.5 ${
                lastCol ? "" : "border-r"
              } ${lastRow ? "" : "border-b"} border-neutral-200/70 ${
                selected
                  ? "bg-neutral-100 ring-1 ring-inset ring-neutral-300 dark:ring-neutral-700"
                  : "hover:bg-neutral-50"
              } ${inMonth ? "" : "opacity-40"}`}
            >
              <div className="min-h-0 min-w-0 flex-1 space-y-0.5 overflow-hidden">
                {shown.map((chip) => (
                  <div
                    key={chip.city}
                    title={`${chip.city}: ${chip.count} ${
                      chip.count === 1 ? "appointment" : "appointments"
                    }${
                      chip.technicians.length
                        ? ` · ${chip.technicians.map((tech) => tech.name).join(", ")}`
                        : ""
                    }`}
                    className="flex items-center gap-1 rounded border-l-[3px] px-1 text-[10px] font-medium leading-4 sm:text-[11px]"
                    style={{
                      backgroundColor: opaqueTechnicianTint(chip.color),
                      borderLeftColor: chip.color,
                      color: "#231f20",
                    }}
                  >
                    <span className="min-w-0 truncate">{chip.city}</span>
                    <span className="shrink-0 tabular-nums">{chip.count}</span>
                  </div>
                ))}
              </div>
              {extra.length > 0 && (
                <div
                  className="group/more relative z-10 hover:z-30"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="px-1 text-[10px] font-medium text-neutral-400 hover:text-brand-orange transition-colors">
                    +{extra.length} more
                  </div>
                  <div
                    className={`pointer-events-none absolute left-0 z-30 hidden w-48 rounded-lg border border-neutral-200 bg-white p-2.5 shadow-lg group-hover/more:block ${
                      lastRow ? "bottom-full mb-1" : "top-full mt-1"
                    }`}
                  >
                    <ul className="space-y-1.5">
                      {extra.map((chip) => (
                        <li
                          key={chip.city}
                          className="flex items-center justify-between gap-3 text-[11px] leading-tight"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            {chip.technicians.length > 0 ? (
                              <span className="flex shrink-0 items-center gap-0.5">
                                {chip.technicians.map((tech) => (
                                  <span
                                    key={`${chip.city}-${tech.name}`}
                                    title={tech.name}
                                    aria-label={tech.name}
                                    className="inline-block h-2.5 w-2.5 rounded-sm"
                                    style={{ backgroundColor: tech.color }}
                                  />
                                ))}
                              </span>
                            ) : null}
                            <span className="min-w-0 truncate text-brand-dark">
                              {chip.city}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums text-neutral-500">
                            {chip.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
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
                  if (isExpanded) {
                    setDrawerOpen(true);
                  }
                }}
                className={`self-end rounded-md px-1.5 text-xs font-semibold tabular-nums sm:text-sm ${
                  isToday
                    ? "bg-brand-orange text-white shadow-2xs"
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

  const standardCard = (
    <div className="flex h-full min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:min-h-0">
      {/* Top Bar on Calendar Card with Expand Button */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Month Grid
          </span>
          <span className="text-xs text-neutral-300">·</span>
          <span className="text-xs font-medium text-neutral-600">
            {formatMonthYear(monthKey)}
          </span>
        </div>
        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            title="Expand calendar to full screen"
            aria-label="Expand calendar to full screen"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-brand-dark transition-colors shadow-2xs"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Expand</span>
          </button>
        )}
      </div>

      {renderGrid()}
    </div>
  );

  const expandedOverlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expanded month calendar"
      className="fixed inset-0 z-[60] flex h-dvh w-dvw flex-col overflow-hidden bg-white text-brand-dark p-3 sm:p-5 shadow-2xl"
    >
      {/* Expanded Fullscreen Top Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        {/* Left: Brand / Title / Legend */}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-brand-orange" aria-hidden />
            <span className="font-semibold text-brand-dark">Schedule</span>
            <span className="text-neutral-400">/</span>
            <span className="text-sm font-medium text-neutral-500">Month Grid</span>
          </div>

          {technicianLegend.length > 0 && (
            <div className="hidden xl:flex items-center gap-2 pl-3 border-l border-neutral-200 text-xs">
              <span className="text-neutral-400">Technicians:</span>
              <ul className="flex flex-wrap items-center gap-2">
                {technicianLegend.slice(0, 6).map((tech) => (
                  <li key={tech.id} className="flex items-center gap-1 text-brand-dark">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tech.color }}
                    />
                    <span className="truncate max-w-[100px]">{tech.name}</span>
                  </li>
                ))}
                {technicianLegend.length > 6 && (
                  <li className="text-neutral-400">+{technicianLegend.length - 6} more</li>
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Center: < Month Year > Picker & Today */}
        <div className="flex items-center gap-2">
          {onStepMonth && (
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => onStepMonth(-1)}
              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <h2 className="min-w-[160px] text-center text-lg sm:text-xl font-bold tracking-tight text-brand-dark">
            {formatMonthYear(monthKey)}
          </h2>
          {onStepMonth && (
            <button
              type="button"
              aria-label="Next month"
              onClick={() => onStepMonth(1)}
              className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
          {onToday && today && (
            <button
              type="button"
              onClick={onToday}
              disabled={selectedDate.slice(0, 7) === today.slice(0, 7) && selectedDate === today}
              className="ml-2 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600 hover:text-brand-dark hover:bg-neutral-200 transition-colors disabled:opacity-40"
            >
              Today
            </button>
          )}
        </div>

        {/* Right: Drawer toggle & Exit Fullscreen */}
        <div className="flex items-center gap-2">
          {selectedDate && (
            <button
              type="button"
              onClick={() => setDrawerOpen((prev) => !prev)}
              aria-pressed={isDrawerOpen}
              title={isDrawerOpen ? "Hide appointments drawer" : "Show appointments drawer"}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                isDrawerOpen
                  ? "border-brand-orange bg-brand-orange/10 text-brand-orange"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 hover:text-brand-dark"
              }`}
            >
              <span>{formatPrettyDate(selectedDate)}</span>
              <span className="tabular-nums font-semibold">
                ({selectedDayJobs.length})
              </span>
            </button>
          )}
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              title="Exit full screen (Esc)"
              aria-label="Exit full screen"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-neutral-200 transition-colors shadow-2xs"
            >
              <Minimize2 className="h-3.5 w-3.5" aria-hidden />
              <span>Exit Fullscreen</span>
              <kbd className="hidden sm:inline text-[10px] text-neutral-400 font-mono ml-1 px-1 rounded bg-neutral-200/60">Esc</kbd>
            </button>
          )}
        </div>
      </div>

      {/* Expanded Main Body: Grid + Drawer */}
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden pt-3 gap-3">
        {/* Calendar Grid Container */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {renderGrid()}
        </div>

        {/* Quick-view Side Drawer for Selected Day */}
        {isDrawerOpen && (
          <div className="flex w-80 sm:w-96 shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50/70 overflow-hidden shadow-sm animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-brand-dark">
                  {formatPrettyDate(selectedDate)}
                </h3>
                <p className="text-xs text-neutral-500">
                  {selectedDayJobs.length} {selectedDayJobs.length === 1 ? "appointment" : "appointments"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
                aria-label="Close drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {selectedDayJobs.length === 0 ? (
                <div className="py-12 text-center text-xs text-neutral-400">
                  No appointments scheduled on this date.
                </div>
              ) : (
                selectedDayJobs.map((job) => {
                  const techColor =
                    technicianColors[job.assignee?._id || ""] ||
                    technicianColor(job.assignee?._id || "");
                  const time = job.scheduledStart
                    ? formatLocalClock(new Date(job.scheduledStart))
                    : job.startTime || "Unscheduled";
                  return (
                    <div
                      key={job._id}
                      onClick={() => onJobClick?.(job)}
                      className={`rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-2xs transition-colors ${
                        onJobClick
                          ? "cursor-pointer hover:border-brand-orange hover:shadow-xs"
                          : ""
                      }`}
                      style={{ borderLeftWidth: "4px", borderLeftColor: techColor }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-brand-dark truncate">
                          {job.customerName || "Customer"}
                        </span>
                        <span className="shrink-0 font-medium text-neutral-500 tabular-nums">
                          {time}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-neutral-500 text-[11px]">
                        <span className="truncate">{jobCity(job) || "No address"}</span>
                        <span
                          className="truncate max-w-[120px] font-medium"
                          style={{ color: techColor }}
                        >
                          {jobAssigneeName(job)}
                        </span>
                      </div>
                      {job.descPerform && (
                        <p className="mt-1.5 text-[11px] text-neutral-400 line-clamp-2">
                          {job.descPerform}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (isExpanded && typeof document !== "undefined") {
    return (
      <>
        {standardCard}
        {createPortal(expandedOverlay, document.body)}
      </>
    );
  }

  return standardCard;
}
