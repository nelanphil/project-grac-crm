"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useDroppable } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, Lock, LockOpen, X } from "lucide-react";
import type { RouteObjective, ScheduleRouteLeg, ScheduleRouteStop } from "@/lib/api";
import { formatLocalClock } from "@/lib/schedule";

const ROUTE_LIST_HEIGHT_KEY = "schedule-route-list-height";
const ROUTE_LIST_MIN = 160;
const ROUTE_LIST_MAX = 720;
const ROUTE_LIST_DEFAULT = 160;

function clampRouteListHeight(value: number): number {
  if (!Number.isFinite(value)) return ROUTE_LIST_DEFAULT;
  return Math.min(ROUTE_LIST_MAX, Math.max(ROUTE_LIST_MIN, Math.round(value)));
}

let memoryRouteListHeight: number | null = null;

function readRouteListHeight(): number {
  if (memoryRouteListHeight != null) return memoryRouteListHeight;
  try {
    const raw = window.localStorage.getItem(ROUTE_LIST_HEIGHT_KEY);
    memoryRouteListHeight = clampRouteListHeight(
      raw ? Number(raw) : ROUTE_LIST_DEFAULT,
    );
  } catch {
    memoryRouteListHeight = ROUTE_LIST_DEFAULT;
  }
  return memoryRouteListHeight;
}

function writeRouteListHeight(value: number) {
  memoryRouteListHeight = clampRouteListHeight(value);
  try {
    window.localStorage.setItem(ROUTE_LIST_HEIGHT_KEY, String(memoryRouteListHeight));
  } catch {
    /* ignore private-mode storage failures */
  }
  window.dispatchEvent(new Event("schedule-route-list-height"));
}

function subscribeRouteListHeight(onStoreChange: () => void) {
  window.addEventListener("schedule-route-list-height", onStoreChange);
  return () => window.removeEventListener("schedule-route-list-height", onStoreChange);
}

function useRouteListHeight(): [number, (value: number) => void] {
  const height = useSyncExternalStore(
    subscribeRouteListHeight,
    readRouteListHeight,
    () => ROUTE_LIST_DEFAULT,
  );
  return [height, writeRouteListHeight];
}

export type MapJobFilter = "scheduled" | "unscheduled";

type RoutePlannerJob = {
  id: string;
  label: string;
  arrival?: string | null;
  departure?: string | null;
};

function formatStopWindow(arrival?: string | null, departure?: string | null): string | null {
  if (!arrival || !departure) return null;
  const start = new Date(arrival);
  const end = new Date(departure);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return `${formatLocalClock(start)}–${formatLocalClock(end)}`;
}

type RoutePlannerPanelProps = {
  staff: Array<{ _id: string; first_name: string; last_name: string }>;
  techId: string | null;
  onTech: (id: string) => void;
  techLocked: boolean;
  filter: MapJobFilter;
  onFilter: (value: MapJobFilter) => void;
  allowUnscheduled: boolean;
  roundTrip: boolean;
  onRoundTrip: (value: boolean) => void;
  objective: RouteObjective;
  onObjective: (value: RouteObjective) => void;
  onOptimize: () => void;
  onApply: () => void;
  canApply: boolean;
  optimizing: boolean;
  applying: boolean;
  planning: boolean;
  message: string | null;
  warnings: string[];
  jobs: RoutePlannerJob[];
  stops: ScheduleRouteStop[];
  legs: ScheduleRouteLeg[];
  orderedWorkOrderIds: string[];
  totalMinutes?: number;
  totalMeters?: number;
  showTotals: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove?: (id: string) => void;
  confirmingRemoveId?: string | null;
  onConfirmRemove?: (id: string) => void;
  onCancelRemove?: () => void;
  removing?: boolean;
  dayCounts: Record<string, number>;
  locks: Record<string, string>;
  onToggleLock: (id: string) => void;
  onLockTime: (id: string, time: string) => void;
};

function TechDropRow({
  person,
  count,
  selected,
  onSelect,
}: {
  person: { _id: string; first_name: string; last_name: string };
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `tech:${person._id}` });
  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onSelect}
      className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-0 ${
        isOver
          ? "bg-orange-100"
          : selected
            ? "bg-orange-50"
            : "hover:bg-neutral-50"
      }`}
    >
      <span className="truncate font-medium text-brand-dark">
        {person.first_name} {person.last_name}
      </span>
      <span className="text-xs tabular-nums text-neutral-500">{count}</span>
    </button>
  );
}

function formatMiles(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatLeg(minutes: number, meters: number): string {
  return `${minutes} min · ${formatMiles(meters)}`;
}

export default function RoutePlannerPanel({
  staff,
  techId,
  onTech,
  techLocked,
  filter,
  onFilter,
  allowUnscheduled,
  roundTrip,
  onRoundTrip,
  objective,
  onObjective,
  onOptimize,
  onApply,
  canApply,
  optimizing,
  applying,
  planning,
  message,
  warnings,
  jobs,
  stops,
  legs,
  orderedWorkOrderIds,
  totalMinutes,
  totalMeters,
  showTotals,
  onMove,
  onRemove,
  confirmingRemoveId = null,
  onConfirmRemove,
  onCancelRemove,
  removing = false,
  dayCounts,
  locks,
  onToggleLock,
  onLockTime,
}: RoutePlannerPanelProps) {
  const [routeListHeight, setRouteListHeight] = useRouteListHeight();
  const routeListHeightRef = useRef(routeListHeight);
  const routeListDragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    routeListHeightRef.current = routeListHeight;
  }, [routeListHeight]);
  useEffect(() => () => routeListDragCleanup.current?.(), []);

  function onRouteListResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    routeListDragCleanup.current?.();
    const startY = event.clientY;
    const startHeight = routeListHeightRef.current;

    function onMove(moveEvent: PointerEvent) {
      setRouteListHeight(startHeight + (moveEvent.clientY - startY));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      routeListDragCleanup.current = null;
    }

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    routeListDragCleanup.current = onUp;
  }

  function onRouteListResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 80 : 32;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setRouteListHeight(routeListHeightRef.current + step);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setRouteListHeight(routeListHeightRef.current - step);
    }
  }
  const { setNodeRef: setRouteRef, isOver: routeOver } = useDroppable({
    id: "route-table",
    disabled: !techId,
  });
  const legById = new Map<string, ScheduleRouteLeg>();
  stops.forEach((stop, index) => {
    if (stop.kind !== "job" || !stop.workOrderId) return;
    const leg = legs[index - 1];
    if (leg) legById.set(stop.workOrderId, leg);
  });
  const returnLeg =
    roundTrip && stops.at(-1)?.kind === "home" ? legs.at(-1) : undefined;
  const routed = new Set(orderedWorkOrderIds);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={techId ?? ""}
          disabled={techLocked}
          onChange={(event) => onTech(event.target.value)}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm disabled:bg-neutral-50"
        >
          {!techLocked && <option value="">Select technician</option>}
          {staff.map((person) => (
            <option key={person._id} value={person._id}>
              {person.first_name} {person.last_name}
            </option>
          ))}
        </select>
        {allowUnscheduled && (
          <div className="flex rounded-md border border-neutral-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => onFilter("scheduled")}
              className={`rounded px-3 py-1.5 ${
                filter === "scheduled"
                  ? "bg-brand-orange text-white"
                  : "text-neutral-600"
              }`}
            >
              Scheduled
            </button>
            <button
              type="button"
              onClick={() => onFilter("unscheduled")}
              className={`rounded px-3 py-1.5 ${
                filter === "unscheduled"
                  ? "bg-brand-orange text-white"
                  : "text-neutral-600"
              }`}
            >
              Unscheduled
            </button>
          </div>
        )}
        <label className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={roundTrip}
            onChange={(event) => onRoundTrip(event.target.checked)}
          />
          Round trip
        </label>
        <div className="flex rounded-md border border-neutral-200 bg-white p-0.5 text-sm">
          <button
            type="button"
            onClick={() => onObjective("time")}
            className={`rounded px-3 py-1.5 ${
              objective === "time" ? "bg-neutral-800 text-white" : "text-neutral-600"
            }`}
          >
            Shortest time
          </button>
          <button
            type="button"
            onClick={() => onObjective("distance")}
            className={`rounded px-3 py-1.5 ${
              objective === "distance"
                ? "bg-neutral-800 text-white"
                : "text-neutral-600"
            }`}
          >
            Shortest distance
          </button>
        </div>
        <button
          type="button"
          disabled={!techId || jobs.length < 2 || optimizing || applying}
          onClick={onOptimize}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
        >
          {optimizing ? "Optimizing…" : "Optimize"}
        </button>
        {canApply && (
          <button
            type="button"
            disabled={!techId || jobs.length === 0 || optimizing || applying || planning}
            onClick={onApply}
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {applying ? "Applying…" : "Apply to this day"}
          </button>
        )}
      </div>

      {allowUnscheduled && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-neutral-100 px-3 py-2 text-xs font-medium text-neutral-500">
            <span>Technician</span>
            <span>Today</span>
          </div>
          <div className="max-h-36 overflow-y-auto">
            {staff.map((person) => (
              <TechDropRow
                key={person._id}
                person={person}
                count={dayCounts[person._id] ?? 0}
                selected={person._id === techId}
                onSelect={() => onTech(person._id)}
              />
            ))}
          </div>
        </div>
      )}

      {!techId && (
        <p className="text-sm text-neutral-500">
          Select a technician, or drop an appointment on one.
        </p>
      )}
      {allowUnscheduled && (
        <p className="text-xs text-neutral-500">
          Drag an appointment onto a technician, the route, or the map.
          Lock a stop to keep its time while the other stops are optimized.
          {filter === "unscheduled"
            ? " Click an unscheduled job to add or remove it."
            : ""}
        </p>
      )}
      {planning && (
        <p className="text-xs text-neutral-500">Updating route…</p>
      )}
      {message && <p className="text-sm text-red-600">{message}</p>}
      {warnings.map((warning) => (
        <p
          key={warning}
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {warning}
        </p>
      ))}

      {techId && (
        <div
          ref={setRouteRef}
          className={`rounded-lg border bg-white ${
            routeOver
              ? "border-brand-orange ring-2 ring-brand-orange"
              : "border-neutral-200"
          }`}
        >
          {showTotals && totalMinutes != null && totalMeters != null && (
            <p className="border-b border-neutral-100 px-3 py-2 text-sm font-medium text-neutral-700">
              {totalMinutes} min · {formatMiles(totalMeters)}
            </p>
          )}
          {jobs.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-neutral-500">
              {filter === "scheduled"
                ? "No scheduled jobs yet. Drop an appointment here or on the map."
                : "Drop an appointment here or on the map to add it to this route."}
            </p>
          ) : (
          <>
          <ol
            className="divide-y divide-neutral-100 overflow-y-auto text-sm"
            style={{ maxHeight: routeListHeight }}
          >
            <li className="px-3 py-2 text-neutral-600">Home</li>
            {jobs.map((job, index) => {
              const leg = legById.get(job.id);
              const onRoute = !orderedWorkOrderIds.length || routed.has(job.id);
              const windowLabel = formatStopWindow(job.arrival, job.departure);
              const lockedTime = locks[job.id];
              const confirming = confirmingRemoveId === job.id;
              return (
                <li
                  key={job.id}
                  className="px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs font-semibold text-neutral-400">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-neutral-800">
                      {job.label}
                    </span>
                    {(windowLabel || leg || !onRoute) && (
                      <span className="block truncate text-xs text-neutral-500">
                        {windowLabel}
                        {windowLabel && leg ? " · " : ""}
                        {leg
                          ? formatLeg(leg.durationMinutes, leg.distanceMeters)
                          : null}
                        {!onRoute && (
                          <span className="text-amber-700">
                            {windowLabel || leg ? " · " : ""}
                            Not on the route
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  {lockedTime ? (
                    <input
                      type="time"
                      aria-label={`Desired time for ${job.label}`}
                      value={lockedTime}
                      onChange={(event) => onLockTime(job.id, event.target.value)}
                      className="w-[6.5rem] rounded-md border border-neutral-200 px-1.5 py-1 text-xs"
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={Boolean(lockedTime)}
                    aria-label={
                      lockedTime
                        ? `Unlock ${job.label}`
                        : `Lock ${job.label} at this time`
                    }
                    disabled={optimizing || applying || removing}
                    onClick={() => onToggleLock(job.id)}
                    className={`rounded p-1 hover:bg-neutral-100 disabled:opacity-30 ${
                      lockedTime ? "text-brand-orange" : "text-neutral-500"
                    }`}
                  >
                    {lockedTime ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <LockOpen className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${job.label} up`}
                    disabled={index === 0 || optimizing || applying || removing}
                    onClick={() => onMove(job.id, -1)}
                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${job.label} down`}
                    disabled={index === jobs.length - 1 || optimizing || applying || removing}
                    onClick={() => onMove(job.id, 1)}
                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  {onRemove && !confirming ? (
                    <button
                      type="button"
                      aria-label={`Remove ${job.label} from this route`}
                      disabled={optimizing || applying || removing}
                      onClick={() => onRemove(job.id)}
                      className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-30"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  </div>
                  {confirming ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-7 text-xs">
                      <p className="text-neutral-700">Return to unscheduled?</p>
                      <button
                        type="button"
                        onClick={onCancelRemove}
                        disabled={removing}
                        className="rounded border border-neutral-300 px-2 py-1 font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfirmRemove?.(job.id)}
                        disabled={removing || !onConfirmRemove}
                        className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-40"
                      >
                        {removing ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {roundTrip && (
              <li className="px-3 py-2 text-neutral-600">
                Home (return)
                {returnLeg ? (
                  <span className="ml-2 text-xs text-neutral-500">
                    {formatLeg(returnLeg.durationMinutes, returnLeg.distanceMeters)}
                  </span>
                ) : null}
              </li>
            )}
          </ol>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize technician schedule"
            aria-valuemin={ROUTE_LIST_MIN}
            aria-valuemax={ROUTE_LIST_MAX}
            aria-valuenow={routeListHeight}
            tabIndex={0}
            onPointerDown={onRouteListResizeStart}
            onKeyDown={onRouteListResizeKey}
            className="group flex h-3 cursor-row-resize items-center justify-center border-t border-neutral-100 focus:outline-none"
          >
            <span className="h-1 w-10 rounded-full bg-neutral-300 group-hover:bg-brand-orange group-focus:bg-brand-orange" />
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}
