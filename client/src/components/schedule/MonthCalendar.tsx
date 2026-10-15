"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from "lucide-react";
import type { ScheduleRecommendation, WorkOrderListItem } from "@/lib/api";
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

const DEFAULT_ASSIGN_MODAL_WIDTH = 540;
const DEFAULT_ASSIGN_MODAL_HEIGHT = 640;
const MIN_ASSIGN_MODAL_WIDTH = 420;
const MIN_ASSIGN_MODAL_HEIGHT = 420;
const STORAGE_KEY_ASSIGN_MODAL = "grac_assign_modal_dimensions";

function readModalDimensions(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: DEFAULT_ASSIGN_MODAL_WIDTH, height: DEFAULT_ASSIGN_MODAL_HEIGHT };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_ASSIGN_MODAL);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.width === "number" && typeof parsed?.height === "number") {
        return {
          width: Math.max(MIN_ASSIGN_MODAL_WIDTH, Math.min(window.innerWidth - 32, parsed.width)),
          height: Math.max(MIN_ASSIGN_MODAL_HEIGHT, Math.min(window.innerHeight - 32, parsed.height)),
        };
      }
    }
  } catch {
    // ignore
  }
  return { width: DEFAULT_ASSIGN_MODAL_WIDTH, height: DEFAULT_ASSIGN_MODAL_HEIGHT };
}

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
  return name || job.tech?.trim() || "Technician";
}

function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "st";
  if (n % 10 === 2 && n % 100 !== 12) return "nd";
  if (n % 10 === 3 && n % 100 !== 13) return "rd";
  return "th";
}

function getTechnicianDayAppointments(
  jobs: WorkOrderListItem[],
  userId: string,
  date: string,
): WorkOrderListItem[] {
  return jobs
    .filter((job) => {
      if (!job.scheduledStart) return false;
      const jDate = jobDateKey(job);
      if (jDate !== date) return false;
      const crew = workOrderCrewIds(job);
      return crew.includes(userId) || job.assignedUserRef === userId;
    })
    .sort((a, b) => {
      const aTime = a.scheduledStart ?? "";
      const bTime = b.scheduledStart ?? "";
      return aTime.localeCompare(bTime);
    });
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
          : technicianNames[techId] || job.tech?.trim() || "Technician";
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
  recommendations = {},
  staff = [],
  onAssignTechnician,
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
  recommendations?: Record<string, ScheduleRecommendation[]>;
  staff?: Array<{ _id: string; first_name?: string; last_name?: string; email?: string; isActive?: boolean }>;
  onAssignTechnician?: (
    job: WorkOrderListItem,
    userId: string,
    insertIndex?: number,
  ) => Promise<boolean | void> | void;
  onJobClick?: (job: WorkOrderListItem) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDrawerOpen = isExpanded && drawerOpen;

  // Assignment Menu State for Unscheduled Cards
  const [assigningJob, setAssigningJob] = useState<WorkOrderListItem | null>(null);
  const [selectedTechId, setSelectedTechId] = useState<string>("");
  const [selectedOrderIndex, setSelectedOrderIndex] = useState<number>(0);
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Dynamically Resizable Modal State
  const [modalDimensions, setModalDimensions] = useState<{ width: number; height: number }>(readModalDimensions);
  const [isModalMaximized, setIsModalMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const isResizingRef = useRef(false);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  function closeAssignMenu() {
    resizeCleanupRef.current?.();
    setAssigningJob(null);
  }

  function startModalResize(
    e: React.PointerEvent,
    dir: "e" | "w" | "s" | "n" | "se" | "sw" | "ne" | "nw",
  ) {
    e.preventDefault();
    e.stopPropagation();
    resizeCleanupRef.current?.();

    if (isModalMaximized) {
      setIsModalMaximized(false);
    }

    const modalEl = modalRef.current;
    if (!modalEl) return;

    const rect = modalEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let currentWidth = rect.width;
    let currentHeight = rect.height;

    setIsResizing(true);
    isResizingRef.current = true;

    let cursor = "se-resize";
    if (dir === "e" || dir === "w") cursor = "ew-resize";
    else if (dir === "s" || dir === "n") cursor = "ns-resize";
    else if (dir === "sw" || dir === "ne") cursor = "nesw-resize";
    else if (dir === "se" || dir === "nw") cursor = "nwse-resize";

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    function onPointerMove(moveEvent: PointerEvent) {
      const maxWidth = Math.max(MIN_ASSIGN_MODAL_WIDTH, window.innerWidth - 32);
      const maxHeight = Math.max(MIN_ASSIGN_MODAL_HEIGHT, window.innerHeight - 32);

      let nextWidth = currentWidth;
      let nextHeight = currentHeight;

      if (dir.includes("e")) {
        nextWidth = Math.max(MIN_ASSIGN_MODAL_WIDTH, Math.min(maxWidth, (moveEvent.clientX - centerX) * 2));
      } else if (dir.includes("w")) {
        nextWidth = Math.max(MIN_ASSIGN_MODAL_WIDTH, Math.min(maxWidth, (centerX - moveEvent.clientX) * 2));
      }

      if (dir.includes("s")) {
        nextHeight = Math.max(MIN_ASSIGN_MODAL_HEIGHT, Math.min(maxHeight, (moveEvent.clientY - centerY) * 2));
      } else if (dir.includes("n")) {
        nextHeight = Math.max(MIN_ASSIGN_MODAL_HEIGHT, Math.min(maxHeight, (centerY - moveEvent.clientY) * 2));
      }

      currentWidth = nextWidth;
      currentHeight = nextHeight;
      setModalDimensions({ width: Math.round(nextWidth), height: Math.round(nextHeight) });
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      resizeCleanupRef.current = null;
      setTimeout(() => {
        setIsResizing(false);
        isResizingRef.current = false;
      }, 50);

      try {
        localStorage.setItem(
          STORAGE_KEY_ASSIGN_MODAL,
          JSON.stringify({ width: Math.round(currentWidth), height: Math.round(currentHeight) }),
        );
      } catch {
        // ignore
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    resizeCleanupRef.current = onPointerUp;
  }

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
      // Unscheduled appointments first, then chronological
      const aSched = a.scheduledStart ? 1 : 0;
      const bSched = b.scheduledStart ? 1 : 0;
      if (aSched !== bSched) return aSched - bSched;
      const aTime = a.scheduledStart || a.startTime || "";
      const bTime = b.scheduledStart || b.startTime || "";
      return aTime.localeCompare(bTime);
    });
  }, [byDate, selectedDate]);

  // Technicians available for assignment
  const technicianList = useMemo(() => {
    const activeStaff = staff.filter((s) => s.isActive !== false);
    const sourceList = activeStaff.length > 0 ? activeStaff : technicianLegend.map((t) => ({ _id: t.id, first_name: t.name }));

    return sourceList.map((tech) => {
      const id = tech._id;
      const firstName = "first_name" in tech ? tech.first_name : "";
      const lastName = "last_name" in tech ? tech.last_name : "";
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || ("name" in tech ? (tech as { name: string }).name : "") || "Technician";
      const color = technicianColors[id] || technicianColor(id);
      return { id, name: fullName, color };
    });
  }, [staff, technicianLegend, technicianColors]);

  // Existing appointments for selected technician on this date
  const techDayAppointments = useMemo(() => {
    if (!selectedTechId || !selectedDate) return [];
    return getTechnicianDayAppointments(jobs, selectedTechId, selectedDate);
  }, [jobs, selectedTechId, selectedDate]);

  // When opening assignment menu for a job, compute initial recommendation and default order
  function openAssignMenu(job: WorkOrderListItem) {
    setAssigningJob(job);
    setAssignError(null);

    const jobRecs = recommendations[job._id] ?? [];
    const bestRec = jobRecs.find((r) => r.available) ?? jobRecs[0];
    const initialTechId =
      bestRec?.userId ||
      recommendedByJobId[job._id] ||
      technicianList[0]?.id ||
      "";

    setSelectedTechId(initialTechId);

    const existing = getTechnicianDayAppointments(jobs, initialTechId, selectedDate);
    // Default to appending at the end of the technician's existing schedule
    setSelectedOrderIndex(existing.length);
  }

  // When selected technician changes in the popup, update the default order index
  function handleSelectTech(techId: string) {
    setSelectedTechId(techId);
    const existing = getTechnicianDayAppointments(jobs, techId, selectedDate);
    setSelectedOrderIndex(existing.length);
  }

  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (assigningJob) {
          closeAssignMenu();
        } else if (isDrawerOpen) {
          setDrawerOpen(false);
        } else if (onToggleExpand) {
          onToggleExpand();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded, onToggleExpand, isDrawerOpen, assigningJob]);

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
                  const isUnscheduled = !job.scheduledStart;
                  const techColor =
                    technicianColors[job.assignee?._id || ""] ||
                    technicianColor(job.assignee?._id || "");
                  const time = job.scheduledStart
                    ? formatLocalClock(new Date(job.scheduledStart))
                    : job.startTime || "Unscheduled";

                  const jobRecs = recommendations[job._id] ?? [];
                  const recTechId = jobRecs.find((r) => r.available)?.userId || recommendedByJobId[job._id];
                  const recTechName = recTechId ? technicianNames[recTechId] || "" : "";
                  const recInitials = recTechName
                    ? recTechName
                        .split(" ")
                        .map((w) => w[0])
                        .join("")
                        .toUpperCase()
                    : "";
                  const recColor = recTechId ? technicianColors[recTechId] || technicianColor(recTechId) : techColor;

                  return (
                    <div
                      key={job._id}
                      onClick={() => {
                        if (isUnscheduled && onAssignTechnician) {
                          openAssignMenu(job);
                        } else {
                          onJobClick?.(job);
                        }
                      }}
                      onContextMenu={(e) => {
                        if (isUnscheduled && onAssignTechnician) {
                          e.preventDefault();
                          openAssignMenu(job);
                        }
                      }}
                      className={`group relative rounded-xl border p-3 text-xs shadow-2xs transition-all ${
                        isUnscheduled
                          ? "cursor-pointer border-neutral-300 bg-white hover:border-brand-orange hover:shadow-xs"
                          : onJobClick
                            ? "cursor-pointer border-neutral-200 bg-white hover:border-brand-orange hover:shadow-xs"
                            : "border-neutral-200 bg-white"
                      }`}
                      style={{ borderLeftWidth: "4px", borderLeftColor: isUnscheduled ? (recColor || "#c2410c") : techColor }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-brand-dark uppercase tracking-tight truncate">
                          {job.customerName || "Customer"}
                        </span>
                        <div className="flex shrink-0 flex-col items-end">
                          <span
                            className={`rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${
                              isUnscheduled
                                ? "bg-[#c2410c] text-white"
                                : "bg-blue-500/15 text-blue-700"
                            }`}
                          >
                            {isUnscheduled ? "Unscheduled" : time}
                          </span>
                          {isUnscheduled && recInitials && (
                            <span
                              className="mt-0.5 text-[11px] font-bold"
                              style={{ color: recColor }}
                              title={`Recommended: ${recTechName}`}
                            >
                              {recInitials}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
                        <span className="truncate">{jobCity(job) || "No address"}</span>
                        {!isUnscheduled && (
                          <span
                            className="truncate max-w-[120px] font-medium"
                            style={{ color: techColor }}
                          >
                            {jobAssigneeName(job)}
                          </span>
                        )}
                      </div>

                      {job.descPerform && (
                        <p className="mt-1.5 text-[11px] uppercase text-neutral-400 line-clamp-2">
                          {job.descPerform}
                        </p>
                      )}

                      <div className="mt-2 flex items-center justify-between pt-1 border-t border-neutral-100 dark:border-neutral-800">
                        {isUnscheduled && onAssignTechnician ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-orange group-hover:underline">
                            <Sparkles className="h-3 w-3" />
                            <span>Assign Technician ▾</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-neutral-400">Scheduled</span>
                        )}

                        {onJobClick && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onJobClick(job);
                            }}
                            className="text-[11px] text-neutral-400 hover:text-brand-orange hover:underline"
                          >
                            View
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pop Up Menu for Unscheduled Appointment Assignment & Route Ordering */}
      {assigningJob && (() => {
        const isWide = isModalMaximized || modalDimensions.width >= 720;

        const technicianItems = technicianList.map((tech) => {
          const isSelected = tech.id === selectedTechId;
          const techRecs = recommendations[assigningJob._id] ?? [];
          const rec = techRecs.find((r) => r.userId === tech.id);
          const isRecommended = (rec && rec.available) || recommendedByJobId[assigningJob._id] === tech.id;
          const existingCount = getTechnicianDayAppointments(jobs, tech.id, selectedDate).length;

          return (
            <button
              key={tech.id}
              type="button"
              onClick={() => handleSelectTech(tech.id)}
              className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-all ${
                isSelected
                  ? "border-brand-orange bg-brand-orange/10 ring-1 ring-brand-orange"
                  : "border-neutral-200 bg-white hover:bg-neutral-50"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: tech.color }}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-semibold ${isSelected ? "text-brand-orange" : "text-brand-dark"} truncate`}>
                      {tech.name}
                    </span>
                    {isRecommended && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-bold text-emerald-700">
                        <Sparkles className="h-2.5 w-2.5" />
                        Recommended
                      </span>
                    )}
                  </div>
                  {rec?.reason && (
                    <p className="text-[11px] text-neutral-500 truncate">
                      {rec.reason}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 pl-2">
                <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                  {existingCount} {existingCount === 1 ? "job" : "jobs"}
                </span>
                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  isSelected ? "border-brand-orange bg-brand-orange text-white" : "border-neutral-300"
                }`}>
                  {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                </div>
              </div>
            </button>
          );
        });

        const routeOrderContent = techDayAppointments.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
              <Check className="h-4 w-4" />
              <span>1st Stop · First appointment of the day</span>
            </div>
            <p className="mt-1 text-[11px] text-emerald-700">
              This technician has no other scheduled work orders on {formatPrettyDate(selectedDate)}.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {Array.from({ length: techDayAppointments.length + 1 }, (_, i) => {
              const isPositionSelected = selectedOrderIndex === i;
              const isFirst = i === 0;
              const isLast = i === techDayAppointments.length;

              let positionTitle = `${i + 1}${ordinalSuffix(i + 1)} Stop`;
              let positionDetail = "";

              if (isFirst) {
                positionTitle = "1st Stop (Start of Day)";
                const firstJob = techDayAppointments[0];
                const timeStr = firstJob.scheduledStart ? formatLocalClock(new Date(firstJob.scheduledStart)) : "";
                positionDetail = `Before ${firstJob.customerName || "first job"}${timeStr ? ` (${timeStr})` : ""}`;
              } else if (isLast) {
                positionTitle = `${i + 1}${ordinalSuffix(i + 1)} Stop (End of Day)`;
                const lastJob = techDayAppointments[techDayAppointments.length - 1];
                const timeStr = lastJob.scheduledStart ? formatLocalClock(new Date(lastJob.scheduledStart)) : "";
                positionDetail = `After ${lastJob.customerName || "last job"}${timeStr ? ` (${timeStr})` : ""}`;
              } else {
                const prevJob = techDayAppointments[i - 1];
                const nextJob = techDayAppointments[i];
                positionDetail = `Between ${prevJob.customerName || "Job"} and ${nextJob.customerName || "Job"}`;
              }

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedOrderIndex(i)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-all ${
                    isPositionSelected
                      ? "border-brand-orange bg-brand-orange/10 ring-1 ring-brand-orange"
                      : "border-neutral-200 bg-white hover:bg-neutral-50"
                  }`}
                >
                  <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    isPositionSelected
                      ? "border-brand-orange bg-brand-orange text-white"
                      : "border-neutral-300 text-neutral-500"
                  }`}>
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold ${isPositionSelected ? "text-brand-orange" : "text-brand-dark"}`}>
                        {positionTitle}
                      </span>
                      {isPositionSelected && (
                        <span className="text-[10px] font-bold uppercase text-brand-orange">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-neutral-500 truncate">
                      {positionDetail}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        );

        return (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px]"
            onClick={() => {
              if (isResizingRef.current) return;
              closeAssignMenu();
            }}
          >
            <div
              ref={modalRef}
              onClick={(e) => e.stopPropagation()}
              style={
                isModalMaximized
                  ? {
                      width: "min(1280px, calc(100vw - 32px))",
                      height: "calc(100vh - 32px)",
                    }
                  : {
                      width: `min(${modalDimensions.width}px, calc(100vw - 32px))`,
                      height: `min(${modalDimensions.height}px, calc(100vh - 32px))`,
                    }
              }
              className={`relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-brand-dark shadow-2xl transition-[box-shadow,border-color] duration-150 ${
                isResizing ? "ring-2 ring-brand-orange/40 select-none" : ""
              }`}
            >
              {/* Edge & Corner Resize Handles (active when not maximized) */}
              {!isModalMaximized && (
                <>
                  {/* Right edge */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "e")}
                    className="absolute top-0 right-0 h-full w-2.5 cursor-ew-resize hover:bg-brand-orange/20 transition-colors z-20"
                    title="Drag to resize horizontally"
                  />
                  {/* Left edge */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "w")}
                    className="absolute top-0 left-0 h-full w-2.5 cursor-ew-resize hover:bg-brand-orange/20 transition-colors z-20"
                    title="Drag to resize horizontally"
                  />
                  {/* Bottom edge */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "s")}
                    className="absolute bottom-0 left-0 w-full h-2.5 cursor-ns-resize hover:bg-brand-orange/20 transition-colors z-20"
                    title="Drag to resize vertically"
                  />
                  {/* Top edge */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "n")}
                    className="absolute top-0 left-0 w-full h-2 cursor-ns-resize hover:bg-brand-orange/20 transition-colors z-20"
                    title="Drag to resize vertically"
                  />
                  {/* Bottom-right corner handle with 6-dot gripper */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "se")}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setModalDimensions({ width: DEFAULT_ASSIGN_MODAL_WIDTH, height: DEFAULT_ASSIGN_MODAL_HEIGHT });
                      try {
                        localStorage.removeItem(STORAGE_KEY_ASSIGN_MODAL);
                      } catch {
                        // ignore
                      }
                    }}
                    className="group absolute bottom-1 right-1 z-30 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 text-neutral-300 hover:text-brand-orange transition-colors"
                    title="Drag to resize (double-click to reset default size)"
                    aria-label="Resize modal handle"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <circle cx="8.5" cy="8.5" r="1" />
                      <circle cx="5" cy="8.5" r="1" />
                      <circle cx="8.5" cy="5" r="1" />
                      <circle cx="1.5" cy="8.5" r="1" />
                      <circle cx="5" cy="5" r="1" />
                      <circle cx="8.5" cy="1.5" r="1" />
                    </svg>
                  </div>
                  {/* Bottom-left corner handle */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "sw")}
                    className="absolute bottom-0 left-0 z-30 h-5 w-5 cursor-nesw-resize"
                  />
                  {/* Top-right corner handle */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "ne")}
                    className="absolute top-0 right-0 z-20 h-4 w-4 cursor-nesw-resize"
                  />
                  {/* Top-left corner handle */}
                  <div
                    onPointerDown={(e) => startModalResize(e, "nw")}
                    className="absolute top-0 left-0 z-20 h-4 w-4 cursor-nwse-resize"
                  />
                </>
              )}

              {/* Popup Header */}
              <div
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  setIsModalMaximized((prev) => !prev);
                }}
                className="flex shrink-0 select-none items-start justify-between border-b border-neutral-200 px-5 py-4 bg-neutral-50/70 cursor-default"
                title="Double-click header to maximize or restore"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#c2410c] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                      Unscheduled
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      Assign & Place
                    </span>
                  </div>
                  <h3 className="mt-1 text-base font-bold text-brand-dark">
                    {assigningJob.customerName || "Customer"}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    {[jobCity(assigningJob), assigningJob.workOrderType?.label, formatPrettyDate(selectedDate)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="relative z-30 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsModalMaximized((prev) => !prev)}
                    className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
                    title={isModalMaximized ? "Restore size" : "Maximize dialog"}
                    aria-label={isModalMaximized ? "Restore size" : "Maximize dialog"}
                  >
                    {isModalMaximized ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={closeAssignMenu}
                    className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
                    aria-label="Close dialog"
                    title="Close (Esc)"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Popup Body */}
              <div className="flex-1 min-h-0 overflow-hidden px-5 py-4 flex flex-col">
                {assignError && (
                  <div className="shrink-0 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {assignError}
                  </div>
                )}

                {isWide ? (
                  <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
                    {/* Col 1: Technician Selection */}
                    <div className="flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-2 shrink-0">
                        <label className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                          1. Select Technician
                        </label>
                        <span className="text-[11px] text-neutral-400 font-medium">
                          {technicianList.length} technicians
                        </span>
                      </div>
                      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1.5">
                        {technicianItems}
                      </div>
                    </div>

                    {/* Col 2: Route Landing Order */}
                    <div className="flex flex-col min-h-0 border-l border-neutral-100 pl-6">
                      {selectedTechId ? (
                        <>
                          <div className="flex items-center justify-between mb-2 shrink-0">
                            <label className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                              2. Route Landing Order
                            </label>
                            <span className="text-[11px] text-neutral-400 font-medium">
                              {techDayAppointments.length === 0
                                ? "1st stop (No existing jobs)"
                                : `Landing position ${selectedOrderIndex + 1} of ${techDayAppointments.length + 1}`}
                            </span>
                          </div>
                          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1.5">
                            {routeOrderContent}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 p-6 text-center text-neutral-400">
                          <p className="text-xs font-medium">Select a technician to configure route order</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
                    {/* 1. Technician Selection */}
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
                        1. Select Technician
                      </label>
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {technicianItems}
                      </div>
                    </div>

                    {/* 2. Route Landing Order */}
                    {selectedTechId && (
                      <div className="pt-2 border-t border-neutral-100">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                            2. Route Landing Order
                          </label>
                          <span className="text-[11px] text-neutral-400 font-medium">
                            {techDayAppointments.length === 0
                              ? "1st stop (No existing jobs)"
                              : `Landing position ${selectedOrderIndex + 1} of ${techDayAppointments.length + 1}`}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {routeOrderContent}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Popup Action Buttons */}
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-5 py-3">
                <button
                  type="button"
                  onClick={closeAssignMenu}
                  disabled={isAssigning}
                  className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isAssigning || !selectedTechId || !onAssignTechnician}
                  onClick={async () => {
                    if (!onAssignTechnician || !selectedTechId) return;
                    setIsAssigning(true);
                    setAssignError(null);
                    try {
                      const result = await onAssignTechnician(assigningJob, selectedTechId, selectedOrderIndex);
                      if (result !== false) {
                        closeAssignMenu();
                      }
                    } catch (err: unknown) {
                      setAssignError(err instanceof Error ? err.message : "Failed to assign appointment");
                    } finally {
                      setIsAssigning(false);
                    }
                  }}
                  className="btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold shadow-xs"
                >
                  {isAssigning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Assigning…</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>
                        Assign as Stop #{selectedOrderIndex + 1}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
