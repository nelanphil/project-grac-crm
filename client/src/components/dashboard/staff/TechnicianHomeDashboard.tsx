"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TextScheduleButton } from "@/components/schedule/TextScheduleDialog";
import {
  ApiError,
  geocodeMissingScheduleAddresses,
  getScheduleRoute,
  getTechnicians,
  getWorkOrder,
  type TechnicianListItem,
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
  formatWeekdayDate,
  isScheduledOnDate,
  startOfWeekSunday,
} from "@/lib/schedule";
import { useAuthStore } from "@/store/useAuthStore";
import { useDashboardStore } from "@/store/useDashboardStore";
import {
  assignedToUser,
  isScheduledAppointment,
} from "@/lib/dashboardSchedule";

const TECH_STORAGE_KEY = "grac.todoTechnicianId";
const EMPTY_JOBS: WorkOrderListItem[] = [];

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
  const snapshot = [
    job.customerAddress,
    job.customerCity,
    job.customerState,
    job.customerZip,
  ]
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

const SWATCH =
  "inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition";

function AppointmentCard({
  job,
  canWrite,
  selected,
  onToggleOpen,
  onMarkComplete,
  onResend,
  mobilePanel,
}: {
  job: WorkOrderListItem;
  canWrite: boolean;
  selected: boolean;
  onToggleOpen: () => void;
  onMarkComplete: () => void;
  onResend: () => void;
  mobilePanel: ReactNode;
}) {
  const service = serviceLabel(job);
  const note = noteLabel(job, service);
  const address = jobAddress(job);
  const number = workOrderNumber(job);

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
        {job.completed ? (
          <span className={`${SWATCH} bg-emerald-50 text-emerald-800 ring-emerald-200`}>
            Complete
          </span>
        ) : null}
        {canWrite && job.completed ? (
          <button
            type="button"
            onClick={onResend}
            className={`${SWATCH} bg-sky-50 text-sky-800 ring-sky-200 hover:bg-sky-100`}
          >
            Resend
          </button>
        ) : null}
        {canWrite && job.paid ? (
          <span className={`${SWATCH} bg-emerald-50 text-emerald-800 ring-emerald-200`}>
            Paid
          </span>
        ) : null}
        {canWrite && !job.completed ? (
          <button
            type="button"
            onClick={onMarkComplete}
            className={`${SWATCH} bg-orange-50 text-orange-800 ring-orange-200 hover:bg-orange-100`}
          >
            Mark complete
          </button>
        ) : null}
      </div>
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
  const isFieldStaff = useAuthStore((s) => s.hasRole("field-staff"));
  const canSwitchTechnicians = !(
    (user?.jobRoleSlugs ?? []).includes("technician") && isFieldStaff
  );
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));
  const layout = useTodoLayout();

  const today = formatLocalDate(new Date());

  const [technicians, setTechnicians] = useState<TechnicianListItem[]>([]);
  const [techId, setTechId] = useState<string | null>(null);
  const [techsLoading, setTechsLoading] = useState(canSwitchTechnicians);
  const [techsError, setTechsError] = useState<string | null>(null);
  const jobs = useDashboardStore((s) => s.jobs) ?? EMPTY_JOBS;
  const loading = useDashboardStore((s) => s.scheduleLoading);
  const error = useDashboardStore((s) => s.scheduleError);
  const loadSchedule = useDashboardStore((s) => s.loadSchedule);
  const clearSchedule = useDashboardStore((s) => s.clearSchedule);
  const updateJobs = useDashboardStore((s) => s.updateJobs);
  const setRoute = useDashboardStore((s) => s.setRoute);
  const clearRoute = useDashboardStore((s) => s.clearRoute);
  const setScheduleFocus = useDashboardStore((s) => s.setScheduleFocus);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoCompleteId, setAutoCompleteId] = useState<string | null>(null);
  const [autoResendId, setAutoResendId] = useState<string | null>(null);
  const [completeToken, setCompleteToken] = useState(0);
  const [order, setOrder] = useState<WorkOrderListItem | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState(today);
  const weekStart = startOfWeekSunday(focusDate);
  const weekEnd = addDays(weekStart, 6);
  const routeStops = useDashboardStore((s) => s.routeStops);
  const routePolyline = useDashboardStore((s) => s.routePolyline);
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
    setScheduleFocus(focusDate);
  }, [focusDate, setScheduleFocus]);

  useEffect(() => {
    if (!token) return;
    if (!subjectId) {
      if (!techsLoading) clearSchedule();
      return;
    }
    loadSchedule(token, {
      subjectId,
      weekStart,
      weekEnd,
      focusDate,
      whose: scheduleWhose,
    });
    // Day changes inside the week update focus through setScheduleFocus.
    // Reloading jobs here would flash the schedule loading line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    subjectId,
    weekStart,
    weekEnd,
    techsLoading,
    scheduleWhose,
    loadSchedule,
    clearSchedule,
  ]);

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
          updateJobs((current) => applyAddressCoords(current, updated));
        }
      } catch {
        missing.forEach((id) => requestedGeocodeRef.current.add(id));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, jobs, updateJobs]);

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

  const dayJobs = jobs.filter((job) => isScheduledOnDate(job, focusDate));
  const mapCoordKey = dayJobs
    .map(
      (job) =>
        `${job._id}:${job.address?.lat ?? ""},${job.address?.lng ?? ""}`,
    )
    .join("|");

  const routeScopeRef = useRef("");

  useEffect(() => {
    if (!token || !subjectId) return;
    let cancelled = false;
    const key = `${subjectId}|${focusDate}`;
    const navigated = routeScopeRef.current !== key;
    routeScopeRef.current = key;
    if (navigated) clearRoute();
    getScheduleRoute(token, subjectId, focusDate)
      .then((result) => {
        if (cancelled) return;
        setRoute(result.stops, result.route?.encodedPolyline);
      })
      .catch(() => {
        if (cancelled || !navigated) return;
        clearRoute();
      });
    return () => {
      cancelled = true;
    };
  }, [token, subjectId, focusDate, mapCoordKey, clearRoute, setRoute]);

  const periodLabel = formatWeekdayDate(focusDate);
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
  const emptyToday =
    focusDate === today
      ? `Nothing on ${scheduleWhose} schedule today.`
      : `Nothing on ${scheduleWhose} schedule for ${formatWeekdayDate(focusDate)}.`;

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
    setAutoCompleteId(null);
    setAutoResendId(null);
  }

  function clearOpenJob() {
    setAutoCompleteId(null);
    setAutoResendId(null);
    setOrder(null);
    setOrderError(null);
    setSelectedId(null);
  }

  function shiftFocus(direction: -1 | 1) {
    setFocusDate(addDays(focusDate, direction));
    clearOpenJob();
  }

  function toggleOpen(id: string) {
    setAutoCompleteId(null);
    setAutoResendId(null);
    setOrder(null);
    setOrderError(null);
    setSelectedId((current) => (current === id ? null : id));
  }

  function openForComplete(id: string) {
    setCompleteToken((current) => current + 1);
    setAutoResendId(null);
    setAutoCompleteId(id);
    if (selectedId !== id) {
      setOrder(null);
      setOrderError(null);
      setSelectedId(id);
    }
  }

  function openForResend(id: string) {
    setCompleteToken((current) => current + 1);
    setAutoCompleteId(null);
    setAutoResendId(id);
    if (selectedId !== id) {
      setOrder(null);
      setOrderError(null);
      setSelectedId(id);
    }
  }

  function closeWorkOrder() {
    setAutoCompleteId(null);
    setAutoResendId(null);
    setOrder(null);
    setOrderError(null);
    setSelectedId(null);
  }

  function handleOrderSaved(updated: WorkOrderListItem) {
    setOrder(updated);
    const stillScheduled =
      assignedToUser(updated, subjectId) && isScheduledAppointment(updated);
    if (!stillScheduled) {
      updateJobs((current) => current.filter((job) => job._id !== updated._id));
      setSelectedId(null);
      return;
    }
    updateJobs((current) =>
      current.map((job) =>
        job._id === updated._id
          ? {
              ...job,
              paid: updated.paid,
              completed: updated.completed,
              customerName: updated.customerName,
              descPerform: updated.descPerform,
              scheduledStart: updated.scheduledStart,
              scheduledEnd: updated.scheduledEnd,
              estimatedMinutes: updated.estimatedMinutes,
              appointmentCanceledAt: updated.appointmentCanceledAt,
              assignedUserRef: updated.assignedUserRef,
              assignee: updated.assignee,
            }
          : job,
      ),
    );
  }

  const split = layout === "desktop" && Boolean(selectedId);
  const showMap = !selectedId && layout !== null;

  function cardProps(job: WorkOrderListItem) {
    const selected = selectedId === job._id;
    return {
      job,
      canWrite,
      selected,
      onToggleOpen: () => toggleOpen(job._id),
      onMarkComplete: () => openForComplete(job._id),
      onResend: () => openForResend(job._id),
      mobilePanel:
        selected && layout === "mobile" ? (
          <MobileWorkOrderPanel
            order={order}
            loading={orderLoading}
            error={orderError}
            token={token}
            user={user}
            canWrite={canWrite}
            autoStart={autoCompleteId === job._id}
            autoResend={autoResendId === job._id}
            startToken={completeToken}
            onClose={closeWorkOrder}
            onSaved={handleOrderSaved}
          />
        ) : null,
    };
  }

  const desktopMap = showMap && layout === "desktop";

  return (
    <div
      className={`w-full min-w-0 ${
        desktopMap
          ? "flex h-full min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-stretch"
          : split
            ? "pb-6 lg:flex lg:h-full lg:min-h-0 lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0"
            : "pb-6"
      }`}
    >
    <div
      className={`min-w-0 space-y-5 transition-[width,max-width,margin] duration-300 ease-out ${
        split
          ? "w-full lg:mx-0 lg:min-h-0 lg:w-[22rem] lg:max-w-[22rem] lg:shrink-0 lg:overflow-y-auto"
          : desktopMap
            ? "w-full min-h-0 overflow-y-auto lg:mx-0 lg:w-[min(36rem,40%)] lg:max-w-xl lg:shrink-0"
            : "mx-auto w-full max-w-3xl"
      }`}
    >
      <div className="space-y-3">
        <h2 className="text-2xl font-bold text-[var(--staff-ink)]">Schedule</h2>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4">
          <div className="min-w-0 overflow-hidden">
            {canSwitchTechnicians && technicians.length > 0 ? (
              <select
                aria-label="Technician"
                value={subjectId}
                onChange={(event) => selectTechnician(event.target.value)}
                className="max-w-full truncate rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-1.5 text-sm font-medium text-[var(--staff-ink)]"
              >
                {technicians.map((tech) => (
                  <option key={tech._id} value={tech._id}>
                    {technicianName(tech)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center justify-center gap-1.5">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => shiftFocus(-1)}
              className="shrink-0 rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] p-1 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <p className="min-w-0 truncate text-sm text-[var(--staff-muted)]">
              {pageLoading
                ? loadingLabel
                : pageError
                  ? periodLabel
                  : `${periodLabel} · ${jobCountLabel(dayJobs.length)}`}
            </p>
            <button
              type="button"
              aria-label="Next day"
              onClick={() => shiftFocus(1)}
              className="shrink-0 rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] p-1 text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex justify-end">
            <TextScheduleButton
              userId={subjectId}
              date={focusDate}
              variant="label"
              disabled={!subjectId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-1.5 text-sm font-medium text-[var(--staff-ink)] hover:bg-[var(--staff-cream)] disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>
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
      ) : dayJobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--staff-border)] px-4 py-10 text-center text-sm text-[var(--staff-muted)]">
          {emptyToday}
        </p>
      ) : (
        <div className="space-y-3">
          {dayJobs.map((job) => (
            <AppointmentCard key={job._id} {...cardProps(job)} />
          ))}
        </div>
      )}
      {showMap && layout === "mobile" ? (
        <ScheduleMap
          unscheduled={[]}
          scheduled={dayJobs}
          pinMode="scheduled"
          selectedId={null}
          droppable={false}
          surfaceClassName="h-[clamp(16rem,50dvh,24rem)]"
          routeStops={routeStops}
          encodedPolyline={routePolyline}
          onSelect={(job) => toggleOpen(job._id)}
        />
      ) : null}
    </div>
    {split ? (
      <div className="min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto">
        <DesktopWorkOrderPanel
          order={order}
          loading={orderLoading}
          error={orderError}
          token={token}
          user={user}
          canWrite={canWrite}
          autoStart={autoCompleteId === selectedId}
          autoResend={autoResendId === selectedId}
          startToken={completeToken}
          onClose={closeWorkOrder}
          onSaved={handleOrderSaved}
        />
      </div>
    ) : null}
    {desktopMap ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScheduleMap
          unscheduled={[]}
          scheduled={dayJobs}
          pinMode="scheduled"
          selectedId={null}
          droppable={false}
          surfaceClassName="h-full min-h-[16rem]"
          routeStops={routeStops}
          encodedPolyline={routePolyline}
          onSelect={(job) => toggleOpen(job._id)}
        />
      </div>
    ) : null}
    </div>
  );
}
