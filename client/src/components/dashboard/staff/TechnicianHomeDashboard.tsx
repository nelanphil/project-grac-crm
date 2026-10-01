"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from "react";
import {
  ApiError,
  geocodeMissingScheduleAddresses,
  getScheduleRoute,
  getScheduleStaff,
  getTechnicians,
  getWorkOrder,
  type TechnicianListItem,
  updateWorkOrder,
  type ScheduleRouteStop,
  type WorkOrderListItem,
} from "@/lib/api";
import {
  DesktopWorkOrderPanel,
  MobileWorkOrderPanel,
} from "@/components/dashboard/staff/TechnicianWorkOrderPanel";
import ScheduleMap, { jobHasCoordinates } from "@/components/schedule/ScheduleMap";
import {
  addDays,
  formatAddressLine,
  formatLocalClock,
  formatLocalDate,
  formatMonthDayYear,
  formatWeekdayDate,
  startOfWeekSunday,
  workOrderLocalDate,
} from "@/lib/schedule";
import { useAuthStore } from "@/store/useAuthStore";

const TECH_STORAGE_KEY = "grac.todoTechnicianId";

function technicianName(tech: {
  first_name: string;
  last_name: string;
}): string {
  return [tech.first_name, tech.last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function possessive(name: string): string {
  return `${name}'s`;
}

type RangeMode = "day" | "week";

function assignedToUser(job: WorkOrderListItem, userId: string): boolean {
  if (job.assignee?._id === userId) return true;
  return typeof job.assignedUserRef === "string" && job.assignedUserRef === userId;
}

function isOpenAppointment(job: WorkOrderListItem): boolean {
  return !job.completed && !job.appointmentCanceledAt;
}

function startMillis(job: WorkOrderListItem): number {
  if (!job.scheduledStart) return Number.MAX_SAFE_INTEGER;
  const time = new Date(job.scheduledStart).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function compareJobs(a: WorkOrderListItem, b: WorkOrderListItem): number {
  return startMillis(a) - startMillis(b);
}

function timeWindow(job: WorkOrderListItem): string {
  if (!job.scheduledStart) return "Time not set";
  const start = new Date(job.scheduledStart);
  const startLabel = formatLocalClock(start);
  if (job.scheduledEnd) {
    return `${startLabel} – ${formatLocalClock(new Date(job.scheduledEnd))}`;
  }
  const minutes = job.estimatedMinutes ?? 0;
  if (minutes > 0) {
    const end = new Date(start.getTime() + minutes * 60_000);
    return `${startLabel} – ${formatLocalClock(end)}`;
  }
  return startLabel;
}

function jobAddress(job: WorkOrderListItem): string {
  const line = formatAddressLine(job.address);
  if (line !== "—") return line;
  const snapshot = [job.customerAddress, job.customerCity, job.customerZip]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  return snapshot;
}

function serviceLabel(job: WorkOrderListItem): string {
  return job.workOrderType?.label?.trim() || job.descPerform?.trim() || "";
}

function noteLabel(job: WorkOrderListItem, service: string): string {
  const note = job.scheduleNote?.trim() ?? "";
  if (!note || note === service) return "";
  return note;
}

function workOrderNumber(job: WorkOrderListItem): string {
  if (job.number?.trim()) return job.number.trim();
  if (job.legacyId) return String(job.legacyId);
  return "";
}

function jobCountLabel(count: number): string {
  return count === 1 ? "1 job" : `${count} jobs`;
}

function applyAddressCoords(
  jobs: WorkOrderListItem[],
  updated: Array<{ addressId: string; lat: number; lng: number }>,
): WorkOrderListItem[] {
  if (updated.length === 0) return jobs;
  const byId = new Map(updated.map((row) => [row.addressId, row]));
  return jobs.map((job) => {
    const id = job.address?._id;
    const hit = id ? byId.get(id) : undefined;
    if (!hit || !job.address) return job;
    return {
      ...job,
      address: { ...job.address, lat: hit.lat, lng: hit.lng },
    };
  });
}

const SWIPE_THRESHOLD = 48;
const SLIDE_MS = 180;

function WeekDayCarousel({
  days,
  date,
  onDateChange,
  children,
}: {
  days: { date: string; jobs: WorkOrderListItem[] }[];
  date: string;
  onDateChange: (date: string) => void;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const gesture = useRef({
    x: 0,
    y: 0,
    dx: 0,
    axis: null as "x" | "y" | null,
  });
  const [dragX, setDragX] = useState(0);
  const [animate, setAnimate] = useState(false);
  const index = Math.max(
    0,
    days.findIndex((day) => day.date === date),
  );

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1 || timerRef.current != null) return;
    const touch = event.touches[0];
    gesture.current = { x: touch.clientX, y: touch.clientY, dx: 0, axis: null };
    setAnimate(false);
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch || timerRef.current != null) return;
    const dx = touch.clientX - gesture.current.x;
    const dy = touch.clientY - gesture.current.y;
    if (!gesture.current.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      gesture.current.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (gesture.current.axis !== "x") return;
    const atStart = index <= 0 && dx > 0;
    const atEnd = index >= days.length - 1 && dx < 0;
    const next = atStart || atEnd ? dx * 0.35 : dx;
    gesture.current.dx = next;
    setDragX(next);
  }

  function onTouchEnd() {
    if (gesture.current.axis !== "x" || timerRef.current != null) {
      gesture.current.axis = null;
      return;
    }
    const dx = gesture.current.dx;
    gesture.current.axis = null;
    const width = frameRef.current?.offsetWidth ?? 1;
    const nextIndex = dx < 0 ? index + 1 : index - 1;
    if (Math.abs(dx) < SWIPE_THRESHOLD || nextIndex < 0 || nextIndex >= days.length) {
      setAnimate(true);
      setDragX(0);
      return;
    }
    const direction = dx < 0 ? -1 : 1;
    setAnimate(true);
    setDragX(direction * width);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setAnimate(false);
      setDragX(direction * -width);
      onDateChange(days[nextIndex].date);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setAnimate(true);
          setDragX(0);
        });
      });
    }, SLIDE_MS);
  }

  return (
    <div
      ref={frameRef}
      className="overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className="min-w-0"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: animate ? `transform ${SLIDE_MS}ms ease-out` : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

type CardAction = "complete" | "paid";

const SWATCH =
  "inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition";

function AppointmentCard({
  job,
  canWrite,
  selected,
  pendingAction,
  busy,
  error,
  onToggleOpen,
  onAsk,
  onConfirm,
  onCancel,
  mobilePanel,
}: {
  job: WorkOrderListItem;
  canWrite: boolean;
  selected: boolean;
  pendingAction: CardAction | null;
  busy: boolean;
  error: string | null;
  onToggleOpen: () => void;
  onAsk: (action: CardAction) => void;
  onConfirm: () => void;
  onCancel: () => void;
  mobilePanel: ReactNode;
}) {
  const service = serviceLabel(job);
  const note = noteLabel(job, service);
  const address = jobAddress(job);
  const number = workOrderNumber(job);
  const confirmCopy =
    pendingAction === "paid"
      ? "Mark this job paid?"
      : "Mark this job complete?";

  return (
    <div className="min-w-0 space-y-2">
    <article
      className={`min-w-0 rounded-xl border bg-[var(--staff-surface)] p-4 ${
        selected
          ? "border-brand-orange ring-2 ring-brand-orange"
          : "border-[var(--staff-border)]"
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 break-words text-sm font-semibold text-brand-orange">
          {timeWindow(job)}
        </p>
        {number ? (
          <p className="min-w-0 break-all text-xs font-medium text-[var(--staff-muted)]">
            {number}
          </p>
        ) : null}
      </div>
      <h3 className="mt-1 break-words text-base font-semibold text-[var(--staff-ink)]">
        {job.customerName?.trim() || "Customer"}
      </h3>
      {address ? (
        <p className="mt-1 break-words text-sm text-[var(--staff-muted)]">{address}</p>
      ) : null}
      {service ? (
        <p className="mt-2 break-words text-sm text-[var(--staff-ink)]">{service}</p>
      ) : null}
      {note ? (
        <p className="mt-1 break-words text-sm text-[var(--staff-muted)]">{note}</p>
      ) : null}

      {pendingAction ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="break-words">{confirmCopy}</p>
          {error ? <p className="mt-2 break-words text-sm text-red-700">{error}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="rounded-md bg-brand-dark px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={selected}
            onClick={onToggleOpen}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--staff-cream)] ${
              selected
                ? "border-brand-orange text-brand-orange"
                : "border-[var(--staff-border)] text-[var(--staff-ink)]"
            }`}
          >
            {selected ? "Close" : "Open"}
          </button>
          {canWrite && job.paid ? (
            <span className={`${SWATCH} bg-emerald-50 text-emerald-800 ring-emerald-200`}>
              Paid
            </span>
          ) : null}
          {canWrite && !job.paid ? (
            <button
              type="button"
              onClick={() => onAsk("paid")}
              className={`${SWATCH} bg-sky-50 text-sky-800 ring-sky-200 hover:bg-sky-100`}
            >
              Mark paid
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={() => onAsk("complete")}
              className={`${SWATCH} bg-orange-50 text-orange-800 ring-orange-200 hover:bg-orange-100`}
            >
              Mark complete
            </button>
          ) : null}
        </div>
      )}
    </article>
    {mobilePanel}
    </div>
  );
}

function useTodoLayout(): "desktop" | "mobile" | null {
  const [layout, setLayout] = useState<"desktop" | "mobile" | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setLayout(media.matches ? "desktop" : "mobile");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return layout;
}

export default function TechnicianHomeDashboard() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? "";
  const canSwitchTechnicians = !(user?.jobRoleSlugs ?? []).includes(
    "technician",
  );
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));
  const layout = useTodoLayout();

  const today = formatLocalDate(new Date());
  const weekStart = startOfWeekSunday(today);
  const weekEnd = addDays(weekStart, 6);

  const [mode, setMode] = useState<RangeMode>("day");
  const [technicians, setTechnicians] = useState<TechnicianListItem[]>([]);
  const [techId, setTechId] = useState<string | null>(null);
  const [techsLoading, setTechsLoading] = useState(canSwitchTechnicians);
  const [techsError, setTechsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<WorkOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    id: string;
    action: CardAction;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [order, setOrder] = useState<WorkOrderListItem | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [mapDate, setMapDate] = useState(today);
  const [routeStops, setRouteStops] = useState<ScheduleRouteStop[]>([]);
  const [routePolyline, setRoutePolyline] = useState<string | undefined>();
  const requestedGeocodeRef = useRef(new Set<string>());
  const subjectId = canSwitchTechnicians ? (techId ?? "") : userId;
  const selectedTech =
    technicians.find((tech) => tech._id === subjectId) ?? null;
  const ownerName = selectedTech ? technicianName(selectedTech) : "";
  const scheduleWhose = canSwitchTechnicians
    ? ownerName
      ? possessive(ownerName)
      : "their"
    : "your";

  useEffect(() => {
    if (!canSwitchTechnicians || !token) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTechsLoading(true);
    setTechsError(null);

    getTechnicians(token, { all: true })
      .then(({ technicians: rows }) => {
        if (cancelled) return;
        setTechnicians(rows);
        let stored: string | null = null;
        try {
          stored = sessionStorage.getItem(TECH_STORAGE_KEY);
        } catch {
          stored = null;
        }
        const match = rows.find((row) => row._id === stored);
        setTechId(match?._id ?? rows[0]?._id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTechsError(
          err instanceof ApiError
            ? err.message
            : "Failed to load technicians.",
        );
      })
      .finally(() => {
        if (!cancelled) setTechsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canSwitchTechnicians, token]);

  useEffect(() => {
    if (!token) return;
    if (!subjectId) {
      if (!techsLoading) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(false);
        setJobs([]);
      }
      return;
    }
    let cancelled = false;

    setLoading(true);
    setError(null);

    getScheduleStaff(token, weekStart, weekEnd, subjectId)
      .then(({ workOrders }) => {
        if (cancelled) return;
        setJobs(
          workOrders
            .filter(
              (job) =>
                assignedToUser(job, subjectId) && isOpenAppointment(job),
            )
            .sort(compareJobs),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) {
          setError("This account cannot read jobs.");
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : `Failed to load ${scheduleWhose} schedule.`,
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, subjectId, weekStart, weekEnd, techsLoading, scheduleWhose]);

  useEffect(() => {
    if (!token || jobs.length === 0) return;
    const missing = [
      ...new Set(
        jobs
          .map((job) => job.address)
          .filter(
            (address): address is NonNullable<WorkOrderListItem["address"]> =>
              Boolean(address?._id) &&
              !jobHasCoordinates({ address } as WorkOrderListItem),
          )
          .map((address) => address._id)
          .filter((id) => !requestedGeocodeRef.current.has(id)),
      ),
    ];
    if (missing.length === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        for (let index = 0; index < missing.length; index += 40) {
          if (cancelled) return;
          const batch = missing.slice(index, index + 40);
          const { updated } = await geocodeMissingScheduleAddresses(token, batch);
          batch.forEach((id) => requestedGeocodeRef.current.add(id));
          if (cancelled || updated.length === 0) continue;
          setJobs((current) => applyAddressCoords(current, updated));
        }
      } catch {
        missing.forEach((id) => requestedGeocodeRef.current.add(id));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, jobs]);

  useEffect(() => {
    if (!token || !selectedId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(null);
    setOrderLoading(true);
    setOrderError(null);
    getWorkOrder(token, selectedId)
      .then((next) => {
        if (!cancelled) setOrder(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOrderError(
          err instanceof ApiError ? err.message : "Failed to load work order.",
        );
      })
      .finally(() => {
        if (!cancelled) setOrderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedId]);

  const dayJobs = jobs.filter((job) => workOrderLocalDate(job) === today);

  const mapDay = mode === "day" ? today : mapDate;
  const mapJobs = jobs.filter((job) => workOrderLocalDate(job) === mapDay);
  const mapCoordKey = mapJobs
    .map(
      (job) =>
        `${job._id}:${job.address?.lat ?? ""},${job.address?.lng ?? ""}`,
    )
    .join("|");

  useEffect(() => {
    if (!token || !subjectId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRouteStops([]);
    setRoutePolyline(undefined);
    getScheduleRoute(token, subjectId, mapDay)
      .then((result) => {
        if (cancelled) return;
        setRouteStops(result.stops);
        setRoutePolyline(result.route?.encodedPolyline);
      })
      .catch(() => {
        if (cancelled) return;
        setRouteStops([]);
        setRoutePolyline(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [token, subjectId, mapDay, mapCoordKey]);

  const weekDays: { date: string; jobs: WorkOrderListItem[] }[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(weekStart, offset);
    const dayJobsForDate = jobs.filter(
      (job) => workOrderLocalDate(job) === date,
    );
    if (dayJobsForDate.length > 0) {
      weekDays.push({ date, jobs: dayJobsForDate });
    }
  }

  const weekCalendar = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(weekStart, offset);
    return {
      date,
      jobs: jobs.filter((job) => workOrderLocalDate(job) === date),
    };
  });
  const mobileWeekDay =
    weekCalendar.find((day) => day.date === mapDate) ?? weekCalendar[0];

  const visibleCount = mode === "day" ? dayJobs.length : jobs.length;
  const periodLabel =
    mode === "day"
      ? formatWeekdayDate(today)
      : `${formatMonthDayYear(weekStart)} – ${formatMonthDayYear(weekEnd)}`;
  const pageError = techsError ?? error;
  const pageLoading =
    (canSwitchTechnicians && techsLoading) || (Boolean(subjectId) && loading);
  const noTechnicians =
    canSwitchTechnicians &&
    !techsLoading &&
    !techsError &&
    technicians.length === 0;
  const loadingLabel = !canSwitchTechnicians
    ? "Loading your schedule…"
    : ownerName
      ? `Loading ${possessive(ownerName)} schedule…`
      : "Loading schedule…";
  const emptyToday = `Nothing on ${scheduleWhose} schedule today.`;
  const emptyDay = `Nothing on ${scheduleWhose} schedule.`;
  const emptyWeek = `Nothing on ${scheduleWhose} schedule this week.`;

  function selectTechnician(id: string) {
    setTechId(id);
    try {
      sessionStorage.setItem(TECH_STORAGE_KEY, id);
    } catch {
      // The choice still applies for this visit when storage is blocked.
    }
    setSelectedId(null);
    setOrder(null);
    setOrderError(null);
    setPending(null);
    setActionError(null);
  }

  function askAction(id: string, action: CardAction) {
    setActionError(null);
    setPending({ id, action });
  }

  function cancelAction() {
    setActionError(null);
    setPending(null);
  }

  async function confirmAction() {
    if (!token || !pending) return;
    const { id, action } = pending;
    setBusyId(id);
    setActionError(null);
    try {
      if (action === "complete") {
        await updateWorkOrder(token, id, { completed: true });
        setJobs((current) => current.filter((job) => job._id !== id));
        setSelectedId((current) => (current === id ? null : current));
      } else {
        await updateWorkOrder(token, id, { paid: true });
        setJobs((current) =>
          current.map((job) => (job._id === id ? { ...job, paid: true } : job)),
        );
      }
      setPending(null);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : action === "complete"
            ? "Failed to mark this job complete."
            : "Failed to mark this job paid.",
      );
    } finally {
      setBusyId(null);
    }
  }

  function showWeekDay(date: string) {
    if (date === mapDate) return;
    setMapDate(date);
    setPending(null);
    setActionError(null);
    setOrder(null);
    setOrderError(null);
    setSelectedId(null);
  }

  function toggleOpen(id: string) {
    setActionError(null);
    setPending(null);
    setOrder(null);
    setOrderError(null);
    setSelectedId((current) => (current === id ? null : id));
  }

  function closeWorkOrder() {
    setOrder(null);
    setOrderError(null);
    setSelectedId(null);
  }

  function handleOrderSaved(updated: WorkOrderListItem) {
    setOrder(updated);
    if (updated.completed || updated.appointmentCanceledAt) {
      setJobs((current) => current.filter((job) => job._id !== updated._id));
      setSelectedId(null);
      return;
    }
    setJobs((current) =>
      current.map((job) =>
        job._id === updated._id
          ? {
              ...job,
              paid: updated.paid,
              customerName: updated.customerName,
              descPerform: updated.descPerform,
            }
          : job,
      ),
    );
  }

  const split = layout === "desktop" && Boolean(selectedId);
  const showMap = !selectedId && layout !== null;

  function cardProps(job: WorkOrderListItem) {
    const isPending = pending?.id === job._id;
    const selected = selectedId === job._id;
    return {
      job,
      canWrite,
      selected,
      pendingAction: isPending ? pending.action : null,
      busy: busyId === job._id,
      error: isPending ? actionError : null,
      onToggleOpen: () => toggleOpen(job._id),
      onAsk: (action: CardAction) => askAction(job._id, action),
      onConfirm: () => void confirmAction(),
      onCancel: cancelAction,
      mobilePanel:
        selected && layout === "mobile" ? (
          <MobileWorkOrderPanel
            order={order}
            loading={orderLoading}
            error={orderError}
            token={token}
            user={user}
            canWrite={canWrite}
            onClose={closeWorkOrder}
            onSaved={handleOrderSaved}
          />
        ) : null,
    };
  }

  return (
    <div
      className={`w-full min-w-0 pb-6 ${
        split || (showMap && layout === "desktop")
          ? "lg:flex lg:items-start lg:gap-6"
          : ""
      }`}
    >
    <div
      className={`min-w-0 space-y-5 transition-[width,max-width,margin] duration-300 ease-out ${
        split
          ? "w-full lg:mx-0 lg:w-[22rem] lg:max-w-[22rem] lg:shrink-0"
          : showMap && layout === "desktop"
            ? "w-full lg:mx-0 lg:max-w-xl lg:shrink-0"
            : "mx-auto w-full max-w-3xl"
      }`}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--staff-ink)]">To Do</h2>
          {canSwitchTechnicians && technicians.length > 0 ? (
            <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-[var(--staff-muted)]">
              Technician
              <select
                value={subjectId}
                onChange={(event) => selectTechnician(event.target.value)}
                className="rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-1.5 text-sm font-medium text-[var(--staff-ink)]"
              >
                {technicians.map((tech) => (
                  <option key={tech._id} value={tech._id}>
                    {technicianName(tech)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="mt-1 text-sm text-[var(--staff-muted)]">
            {pageLoading
              ? loadingLabel
              : pageError
                ? periodLabel
                : `${periodLabel} · ${jobCountLabel(visibleCount)}`}
          </p>
        </div>
        <div className="flex w-fit max-w-full gap-1 rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] p-0.5">
          {(
            [
              { id: "day", label: "Day" },
              { id: "week", label: "Week" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                mode === item.id
                  ? "bg-brand-orange text-white"
                  : "text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {pageError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      ) : null}

      {pageLoading || pageError ? null : noTechnicians ? (
        <p className="rounded-xl border border-dashed border-[var(--staff-border)] px-4 py-10 text-center text-sm text-[var(--staff-muted)]">
          No technicians to show.
        </p>
      ) : mode === "day" ? (
        dayJobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--staff-border)] px-4 py-10 text-center text-sm text-[var(--staff-muted)]">
            {emptyToday}
          </p>
        ) : (
          <div className="space-y-3">
            {dayJobs.map((job) => (
              <AppointmentCard key={job._id} {...cardProps(job)} />
            ))}
          </div>
        )
      ) : layout === "mobile" ? (
        <WeekDayCarousel
          days={weekCalendar}
          date={mapDate}
          onDateChange={showWeekDay}
        >
          <section className="min-w-0 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-orange">
              {formatWeekdayDate(mobileWeekDay.date)}
            </h2>
            {mobileWeekDay.jobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--staff-border)] px-4 py-10 text-center text-sm text-[var(--staff-muted)]">
                {emptyDay}
              </p>
            ) : (
              mobileWeekDay.jobs.map((job) => (
                <AppointmentCard key={job._id} {...cardProps(job)} />
              ))
            )}
          </section>
        </WeekDayCarousel>
      ) : weekDays.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--staff-border)] px-4 py-10 text-center text-sm text-[var(--staff-muted)]">
          {emptyWeek}
        </p>
      ) : (
        <div className="space-y-6">
          {weekDays.map((day) => (
            <section key={day.date} className="min-w-0 space-y-3">
              <h2>
                <button
                  type="button"
                  onClick={() => setMapDate(day.date)}
                  aria-pressed={day.date === mapDate}
                  className={`rounded-md px-2 py-1 text-left text-sm font-semibold uppercase tracking-wide ${
                    day.date === mapDate
                      ? "bg-brand-orange text-white"
                      : "text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
                  }`}
                >
                  {formatWeekdayDate(day.date)}
                </button>
              </h2>
              {day.jobs.map((job) => (
                <AppointmentCard key={job._id} {...cardProps(job)} />
              ))}
            </section>
          ))}
        </div>
      )}
      {showMap && layout === "mobile" ? (
        <ScheduleMap
          unscheduled={[]}
          scheduled={mapJobs}
          pinMode="scheduled"
          selectedId={null}
          droppable={false}
          routeStops={routeStops}
          encodedPolyline={routePolyline}
          onSelect={(job) => toggleOpen(job._id)}
        />
      ) : null}
    </div>
    {split ? (
      <div className="min-w-0 flex-1 lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
        <DesktopWorkOrderPanel
          order={order}
          loading={orderLoading}
          error={orderError}
          token={token}
          user={user}
          canWrite={canWrite}
          onClose={closeWorkOrder}
          onSaved={handleOrderSaved}
        />
      </div>
    ) : null}
    {showMap && layout === "desktop" ? (
      <div className="min-w-0 flex-1 lg:sticky lg:top-4">
        <ScheduleMap
          unscheduled={[]}
          scheduled={mapJobs}
          pinMode="scheduled"
          selectedId={null}
          droppable={false}
          routeStops={routeStops}
          encodedPolyline={routePolyline}
          onSelect={(job) => toggleOpen(job._id)}
        />
      </div>
    ) : null}
    </div>
  );
}
