"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Maximize2,
  Minimize2,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import type { ScheduleRecommendation, WorkOrderListItem } from "@/lib/api";
import {
  addDays,
  blendColors,
  daysInMonth,
  DEFAULT_ESTIMATED_MINUTES,
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

const DEFAULT_EXPANDED_DRAWER_WIDTH = 384;
const MIN_EXPANDED_DRAWER_WIDTH = 280;
const MIN_CALENDAR_GRID_WIDTH = 480;
const STORAGE_KEY_EXPANDED_DRAWER_WIDTH = "grac_month_calendar_drawer_width";

function readExpandedDrawerWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_EXPANDED_DRAWER_WIDTH;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_EXPANDED_DRAWER_WIDTH);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= MIN_EXPANDED_DRAWER_WIDTH) {
        return Math.min(parsed, Math.max(MIN_EXPANDED_DRAWER_WIDTH, window.innerWidth - MIN_CALENDAR_GRID_WIDTH));
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_EXPANDED_DRAWER_WIDTH;
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

const EARTH_MILES = 3958.8;
const FALLBACK_MPH = 30;

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function haversineDriveMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const miles = haversineMiles(a, b);
  return Math.max(1, Math.round((miles / FALLBACK_MPH) * 60));
}

function getJobCoordinates(job?: WorkOrderListItem | null): { lat: number; lng: number } | null {
  if (!job) return null;
  const lat = job.address?.lat;
  const lng = job.address?.lng;
  if (lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
    return { lat: Number(lat), lng: Number(lng) };
  }
  return null;
}

function estimateDriveMinutes(
  fromJob?: WorkOrderListItem | null,
  toJob?: WorkOrderListItem | null,
): { minutes: number; isEstimate: boolean } {
  if (!fromJob || !toJob) return { minutes: 0, isEstimate: false };

  const fromCoords = getJobCoordinates(fromJob);
  const toCoords = getJobCoordinates(toJob);

  if (fromCoords && toCoords) {
    const mins = haversineDriveMinutes(fromCoords, toCoords);
    return { minutes: mins, isEstimate: false };
  }

  // If coordinates are missing, estimate based on cities:
  const cityFrom = (fromJob.address?.city || fromJob.customerCity || "").trim().toLowerCase();
  const cityTo = (toJob.address?.city || toJob.customerCity || "").trim().toLowerCase();

  if (cityFrom && cityTo && cityFrom === cityTo) {
    return { minutes: 12, isEstimate: true };
  }

  // If both jobs have scheduled times on the same day, check their scheduled gap:
  if (fromJob.scheduledStart && toJob.scheduledStart) {
    const fromStart = new Date(fromJob.scheduledStart).getTime();
    const fromDur = (fromJob.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES) * 60_000;
    const fromEnd = fromJob.scheduledEnd ? new Date(fromJob.scheduledEnd).getTime() : fromStart + fromDur;
    const toStart = new Date(toJob.scheduledStart).getTime();
    const gapMins = Math.round((toStart - fromEnd) / 60_000);
    if (gapMins > 0 && gapMins <= 90) {
      return { minutes: gapMins, isEstimate: false };
    }
  }

  // Fallback average transit time:
  return { minutes: 20, isEstimate: true };
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
    estimatedMinutes?: number,
  ) => Promise<boolean | void> | void;
  onJobClick?: (job: WorkOrderListItem) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDrawerOpen = isExpanded && drawerOpen;

  // Assignment Menu State for Unscheduled Cards
  const [assigningJob, setAssigningJob] = useState<WorkOrderListItem | null>(null);
  const [selectedTechId, setSelectedTechId] = useState<string>("");
  const [selectedOrderIndex, setSelectedOrderIndex] = useState<number>(0);
  const [jobDuration, setJobDuration] = useState<number>(DEFAULT_ESTIMATED_MINUTES);
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Dynamically Resizable Modal State
  const [modalDimensions, setModalDimensions] = useState<{ width: number; height: number }>(readModalDimensions);
  const [isModalMaximized, setIsModalMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const isResizingRef = useRef(false);

  // Dynamically Resizable Expanded Drawer State
  const [drawerWidth, setDrawerWidth] = useState<number>(readExpandedDrawerWidth);
  const [isDraggingDrawer, setIsDraggingDrawer] = useState(false);
  const drawerWidthRef = useRef(drawerWidth);
  const expandedBodyRef = useRef<HTMLDivElement | null>(null);
  const drawerResizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    drawerWidthRef.current = drawerWidth;
  }, [drawerWidth]);

  useEffect(() => () => drawerResizeCleanupRef.current?.(), []);

  useEffect(() => {
    function onWindowResize() {
      if (!expandedBodyRef.current) return;
      const containerWidth = expandedBodyRef.current.clientWidth;
      const maxAllowed = Math.max(MIN_EXPANDED_DRAWER_WIDTH, containerWidth - MIN_CALENDAR_GRID_WIDTH - 12);
      if (drawerWidthRef.current > maxAllowed) {
        drawerWidthRef.current = maxAllowed;
        setDrawerWidth(maxAllowed);
      }
    }
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  function startDrawerResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    drawerResizeCleanupRef.current?.();

    const startX = e.clientX;
    const startWidth = drawerWidthRef.current;
    const containerWidth = expandedBodyRef.current?.clientWidth ?? window.innerWidth;
    const maxAllowedWidth = Math.max(MIN_EXPANDED_DRAWER_WIDTH, containerWidth - MIN_CALENDAR_GRID_WIDTH - 12);

    setIsDraggingDrawer(true);
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onPointerMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX;
      const targetWidth = startWidth - deltaX;
      const clamped = Math.min(maxAllowedWidth, Math.max(MIN_EXPANDED_DRAWER_WIDTH, targetWidth));
      drawerWidthRef.current = clamped;
      setDrawerWidth(clamped);
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      setIsDraggingDrawer(false);
      drawerResizeCleanupRef.current = null;

      try {
        window.localStorage.setItem(STORAGE_KEY_EXPANDED_DRAWER_WIDTH, String(drawerWidthRef.current));
      } catch {
        // ignore
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    drawerResizeCleanupRef.current = onPointerUp;
  }

  function resetDrawerWidth() {
    drawerWidthRef.current = DEFAULT_EXPANDED_DRAWER_WIDTH;
    setDrawerWidth(DEFAULT_EXPANDED_DRAWER_WIDTH);
    try {
      window.localStorage.removeItem(STORAGE_KEY_EXPANDED_DRAWER_WIDTH);
    } catch {
      // ignore
    }
  }

  function onSplitterKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 16;
    const containerWidth = expandedBodyRef.current?.clientWidth ?? window.innerWidth;
    const maxAllowedWidth = Math.max(MIN_EXPANDED_DRAWER_WIDTH, containerWidth - MIN_CALENDAR_GRID_WIDTH - 12);

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = Math.min(maxAllowedWidth, drawerWidthRef.current + step);
      drawerWidthRef.current = next;
      setDrawerWidth(next);
      try {
        window.localStorage.setItem(STORAGE_KEY_EXPANDED_DRAWER_WIDTH, String(next));
      } catch {
        // ignore
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = Math.max(MIN_EXPANDED_DRAWER_WIDTH, drawerWidthRef.current - step);
      drawerWidthRef.current = next;
      setDrawerWidth(next);
      try {
        window.localStorage.setItem(STORAGE_KEY_EXPANDED_DRAWER_WIDTH, String(next));
      } catch {
        // ignore
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      resetDrawerWidth();
    } else if (event.key === "Home") {
      event.preventDefault();
      drawerWidthRef.current = MIN_EXPANDED_DRAWER_WIDTH;
      setDrawerWidth(MIN_EXPANDED_DRAWER_WIDTH);
      try {
        window.localStorage.setItem(STORAGE_KEY_EXPANDED_DRAWER_WIDTH, String(MIN_EXPANDED_DRAWER_WIDTH));
      } catch {
        // ignore
      }
    } else if (event.key === "End") {
      event.preventDefault();
      drawerWidthRef.current = maxAllowedWidth;
      setDrawerWidth(maxAllowedWidth);
      try {
        window.localStorage.setItem(STORAGE_KEY_EXPANDED_DRAWER_WIDTH, String(maxAllowedWidth));
      } catch {
        // ignore
      }
    }
  }

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

  // Calculated Landing Stops with ETAs, drive times, and visit windows
  const calculatedStops = useMemo(() => {
    if (!assigningJob) return [];

    if (techDayAppointments.length === 0) {
      const dayStartIso = localDateTimeToIso(selectedDate, "08:00");
      const eta = new Date(dayStartIso);
      const departure = new Date(eta.getTime() + jobDuration * 60_000);
      return [
        {
          index: 0,
          positionTitle: "1st Stop (Start of Day)",
          positionDetail: "First appointment of the day",
          eta,
          departure,
          driveFromPrevMinutes: 0,
          driveFromPrevLabel: "Direct start at shift opening",
          driveToNextMinutes: undefined as number | undefined,
          driveToNextLabel: undefined as string | undefined,
          nextJobProjectedStart: undefined as Date | undefined,
          nextJobCustomerName: undefined as string | undefined,
          nextJobDelayMinutes: 0,
        },
      ];
    }

    return Array.from({ length: techDayAppointments.length + 1 }, (_, i) => {
      const isFirst = i === 0;
      const isLast = i === techDayAppointments.length;

      let positionTitle = `${i + 1}${ordinalSuffix(i + 1)} Stop`;
      let positionDetail = "";
      let eta: Date;
      let departure: Date;
      let driveFromPrevMinutes = 0;
      let driveFromPrevLabel = "";
      let driveToNextMinutes: number | undefined = undefined;
      let driveToNextLabel: string | undefined = undefined;
      let nextJobProjectedStart: Date | undefined = undefined;
      let nextJobCustomerName: string | undefined = undefined;
      let nextJobDelayMinutes = 0;

      if (isFirst) {
        positionTitle = "1st Stop (Start of Day)";
        const nextJob = techDayAppointments[0];
        nextJobCustomerName = nextJob.customerName || "first appointment";
        const nextJobCurrentStart = nextJob.scheduledStart
          ? new Date(nextJob.scheduledStart)
          : new Date(localDateTimeToIso(selectedDate, "08:00"));

        eta = new Date(localDateTimeToIso(selectedDate, "08:00"));
        departure = new Date(eta.getTime() + jobDuration * 60_000);

        const driveEst = estimateDriveMinutes(assigningJob, nextJob);
        driveToNextMinutes = driveEst.minutes;
        driveToNextLabel = `~${driveEst.minutes}m drive to ${nextJobCustomerName}`;
        nextJobProjectedStart = new Date(departure.getTime() + driveEst.minutes * 60_000);
        nextJobDelayMinutes = Math.max(
          0,
          Math.round((nextJobProjectedStart.getTime() - nextJobCurrentStart.getTime()) / 60_000),
        );

        driveFromPrevLabel = "Direct start at day opening";
        positionDetail = `Before ${nextJobCustomerName} (${formatLocalClock(nextJobCurrentStart)})`;
      } else if (isLast) {
        positionTitle = `${i + 1}${ordinalSuffix(i + 1)} Stop (End of Day)`;
        const prevJob = techDayAppointments[techDayAppointments.length - 1];
        const prevCustomer = prevJob.customerName || "last appointment";
        const prevStart = prevJob.scheduledStart
          ? new Date(prevJob.scheduledStart)
          : new Date(localDateTimeToIso(selectedDate, "08:00"));
        const prevDur = prevJob.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES;
        const prevEnd = prevJob.scheduledEnd
          ? new Date(prevJob.scheduledEnd)
          : new Date(prevStart.getTime() + prevDur * 60_000);

        const driveEst = estimateDriveMinutes(prevJob, assigningJob);
        driveFromPrevMinutes = driveEst.minutes;
        driveFromPrevLabel = `~${driveEst.minutes}m drive from ${prevCustomer}`;

        eta = new Date(prevEnd.getTime() + driveEst.minutes * 60_000);
        departure = new Date(eta.getTime() + jobDuration * 60_000);

        positionDetail = `After ${prevCustomer} (${formatLocalClock(prevStart)})`;
      } else {
        const prevJob = techDayAppointments[i - 1];
        const nextJob = techDayAppointments[i];
        const prevCustomer = prevJob.customerName || "previous appointment";
        nextJobCustomerName = nextJob.customerName || "next appointment";

        const prevStart = prevJob.scheduledStart
          ? new Date(prevJob.scheduledStart)
          : new Date(localDateTimeToIso(selectedDate, "08:00"));
        const prevDur = prevJob.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES;
        const prevEnd = prevJob.scheduledEnd
          ? new Date(prevJob.scheduledEnd)
          : new Date(prevStart.getTime() + prevDur * 60_000);

        const driveEstPrev = estimateDriveMinutes(prevJob, assigningJob);
        driveFromPrevMinutes = driveEstPrev.minutes;
        driveFromPrevLabel = `~${driveEstPrev.minutes}m drive from ${prevCustomer}`;

        eta = new Date(prevEnd.getTime() + driveEstPrev.minutes * 60_000);
        departure = new Date(eta.getTime() + jobDuration * 60_000);

        const driveEstNext = estimateDriveMinutes(assigningJob, nextJob);
        driveToNextMinutes = driveEstNext.minutes;
        driveToNextLabel = `~${driveEstNext.minutes}m drive to ${nextJobCustomerName}`;

        const nextJobCurrentStart = nextJob.scheduledStart
          ? new Date(nextJob.scheduledStart)
          : new Date(localDateTimeToIso(selectedDate, "08:00"));
        nextJobProjectedStart = new Date(departure.getTime() + driveEstNext.minutes * 60_000);
        nextJobDelayMinutes = Math.max(
          0,
          Math.round((nextJobProjectedStart.getTime() - nextJobCurrentStart.getTime()) / 60_000),
        );

        positionDetail = `Between ${prevCustomer} and ${nextJobCustomerName}`;
      }

      return {
        index: i,
        positionTitle,
        positionDetail,
        eta,
        departure,
        driveFromPrevMinutes,
        driveFromPrevLabel,
        driveToNextMinutes,
        driveToNextLabel,
        nextJobProjectedStart,
        nextJobCustomerName,
        nextJobDelayMinutes,
      };
    });
  }, [assigningJob, techDayAppointments, selectedDate, jobDuration]);

  // When opening assignment menu for a job, compute initial recommendation and default order
  function openAssignMenu(job: WorkOrderListItem) {
    setAssigningJob(job);
    setAssignError(null);
    setJobDuration(job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES);

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

      {/* Expanded Main Body: Grid + Splitter + Drawer */}
      <div
        ref={expandedBodyRef}
        className="flex min-h-0 flex-1 flex-row overflow-hidden pt-3"
      >
        {/* Calendar Grid Container */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {renderGrid()}
        </div>

        {/* Resizable Splitter Divider (visible when drawer is open) */}
        {isDrawerOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize appointments drawer"
            aria-valuemin={MIN_EXPANDED_DRAWER_WIDTH}
            aria-valuenow={drawerWidth}
            tabIndex={0}
            onPointerDown={startDrawerResize}
            onDoubleClick={resetDrawerWidth}
            onKeyDown={onSplitterKeyDown}
            className={`group relative flex w-3 shrink-0 cursor-col-resize items-center justify-center focus:outline-none select-none transition-colors ${
              isDraggingDrawer ? "z-30" : "z-10"
            }`}
            title="Drag to resize calendar and appointments drawer (Double-click to reset)"
          >
            {/* Splitter Accent Bar / Gripper Pill */}
            <div
              className={`h-16 w-1 rounded-full transition-all duration-150 ${
                isDraggingDrawer
                  ? "h-24 bg-brand-orange ring-4 ring-brand-orange/20 shadow-sm"
                  : "bg-neutral-300 dark:bg-neutral-700 group-hover:bg-brand-orange group-focus:bg-brand-orange group-hover:h-24"
              }`}
            />
          </div>
        )}

        {/* Quick-view Side Drawer for Selected Day */}
        {isDrawerOpen && (
          <div
            style={{ width: `${drawerWidth}px` }}
            className={`flex shrink-0 flex-col rounded-xl border border-neutral-200 bg-neutral-50/70 overflow-hidden shadow-sm ${
              isDraggingDrawer ? "select-none" : "transition-[width] duration-75"
            }`}
          >
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

        const selectedStopCalc = calculatedStops[selectedOrderIndex];

        const durationSelector = (
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-neutral-100">
            <div className="flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                Appointment Length:
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[15, 30, 45, 60, 90, 120].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setJobDuration(mins)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all ${
                    jobDuration === mins
                      ? "bg-brand-orange text-white shadow-xs"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                </button>
              ))}
            </div>
          </div>
        );

        const routeOrderContent = (
          <div className="space-y-2">
            {durationSelector}

            {techDayAppointments.length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs text-emerald-900">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                    <Check className="h-4 w-4" />
                    <span>1st Stop · First appointment of the day</span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/15 border border-emerald-600/30 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                    <Clock className="h-3 w-3 text-emerald-700" />
                    ETA ~8:00 AM
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-emerald-700">
                  This technician has no other scheduled work orders on {formatPrettyDate(selectedDate)}.
                </p>
                <div className="mt-2.5 flex items-center gap-3 text-[11px] text-emerald-800 pt-2 border-t border-emerald-200/60">
                  <span className="inline-flex items-center gap-1">
                    <Timer className="h-3 w-3 text-emerald-600" />
                    <span>
                      {jobDuration}m visit (8:00 AM –{" "}
                      {formatLocalClock(
                        new Date(
                          new Date(localDateTimeToIso(selectedDate, "08:00")).getTime() +
                            jobDuration * 60_000,
                        ),
                      )}
                      )
                    </span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {calculatedStops.map((item) => {
                  const isPositionSelected = selectedOrderIndex === item.index;

                  return (
                    <button
                      key={item.index}
                      type="button"
                      onClick={() => setSelectedOrderIndex(item.index)}
                      className={`flex w-full flex-col rounded-xl border p-3 text-left transition-all ${
                        isPositionSelected
                          ? "border-brand-orange bg-brand-orange/10 ring-1 ring-brand-orange shadow-xs"
                          : "border-neutral-200 bg-white hover:bg-neutral-50/80 hover:border-neutral-300"
                      }`}
                    >
                      {/* Top Row: Stop Badge, Title, and ETA Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                              isPositionSelected
                                ? "border-brand-orange bg-brand-orange text-white"
                                : "border-neutral-300 text-neutral-600 bg-neutral-100"
                            }`}
                          >
                            {item.index + 1}
                          </div>
                          <span
                            className={`text-xs font-bold ${
                              isPositionSelected ? "text-brand-orange" : "text-brand-dark"
                            } truncate`}
                          >
                            {item.positionTitle}
                          </span>
                        </div>

                        {/* ETA Pill */}
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:text-amber-300 shadow-2xs">
                            <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                            ETA ~{formatLocalClock(item.eta)}
                          </span>
                          {isPositionSelected && (
                            <span className="hidden sm:inline-block rounded-md bg-brand-orange px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                              Selected
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Second Row: Placement Context (Before / Between / After) */}
                      <p className="mt-1.5 text-xs text-neutral-600 font-medium">
                        {item.positionDetail}
                      </p>

                      {/* Third Row: Drive Time and Visit Window Metrics */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500 pt-1.5 border-t border-neutral-100">
                        <span className="inline-flex items-center gap-1">
                          <Car className="h-3 w-3 text-neutral-400" />
                          <span>{item.driveFromPrevLabel}</span>
                        </span>

                        <span className="inline-flex items-center gap-1">
                          <Timer className="h-3 w-3 text-neutral-400" />
                          <span>
                            {jobDuration}m appointment ({formatLocalClock(item.eta)} –{" "}
                            {formatLocalClock(item.departure)})
                          </span>
                        </span>

                        {item.driveToNextLabel && (
                          <span className="inline-flex items-center gap-1 text-neutral-500">
                            <ArrowRight className="h-3 w-3 text-neutral-400" />
                            <span>{item.driveToNextLabel}</span>
                            {item.nextJobDelayMinutes > 0 && (
                              <span className="text-amber-600 font-medium">
                                (shifts +{item.nextJobDelayMinutes}m)
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Expanded Route Timeline Preview when Selected */}
                      {isPositionSelected && techDayAppointments.length > 0 && (
                        <div className="mt-3 rounded-lg bg-neutral-50 p-2.5 border border-neutral-200/80 text-[11px]">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                            Projected Route Schedule:
                          </div>
                          <div className="space-y-1.5 pl-1 font-mono text-[11px]">
                            {/* Prior jobs */}
                            {techDayAppointments.slice(0, item.index).map((j, idx) => (
                              <div key={j._id} className="flex items-center justify-between text-neutral-600">
                                <span className="truncate">
                                  Stop #{idx + 1}: {j.customerName || "Customer"}
                                </span>
                                <span className="shrink-0 tabular-nums text-neutral-500">
                                  {j.scheduledStart ? formatLocalClock(new Date(j.scheduledStart)) : ""}
                                </span>
                              </div>
                            ))}

                            {/* This job */}
                            <div className="flex items-center justify-between font-bold text-brand-orange bg-brand-orange/10 px-1.5 py-0.5 rounded">
                              <span className="truncate flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-brand-orange" />
                                Stop #{item.index + 1}: {assigningJob.customerName || "Customer"} (New)
                              </span>
                              <span className="shrink-0 tabular-nums">
                                ETA {formatLocalClock(item.eta)} – {formatLocalClock(item.departure)}
                              </span>
                            </div>

                            {/* Subsequent jobs */}
                            {techDayAppointments.slice(item.index).map((j, idx) => {
                              const subsequentIndex = item.index + 1 + idx;
                              const origTime = j.scheduledStart ? new Date(j.scheduledStart) : null;
                              const adjustedTime =
                                origTime && item.nextJobDelayMinutes > 0
                                  ? new Date(origTime.getTime() + item.nextJobDelayMinutes * 60_000)
                                  : origTime;
                              return (
                                <div key={j._id} className="flex items-center justify-between text-neutral-600">
                                  <span className="truncate">
                                    Stop #{subsequentIndex + 1}: {j.customerName || "Customer"}
                                  </span>
                                  <span className="shrink-0 tabular-nums text-neutral-500">
                                    {adjustedTime ? formatLocalClock(adjustedTime) : ""}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
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
                      const result = await onAssignTechnician(
                        assigningJob,
                        selectedTechId,
                        selectedOrderIndex,
                        jobDuration,
                      );
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
                        {selectedStopCalc ? ` (ETA ~${formatLocalClock(selectedStopCalc.eta)})` : ""}
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
