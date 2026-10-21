"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { ChevronLeft, ChevronRight, MapPin, Navigation, X } from "lucide-react";
import {
  ApiError,
  getGoogleMapsBrowserKey,
  getScheduleRoute,
  getScheduleStaff,
  type ScheduleRouteLeg,
  type ScheduleRouteStop,
  type ScheduleStaffMember,
  type WorkOrderListItem,
} from "@/lib/api";
import {
  addDays,
  formatAddressLine,
  formatLocalClock,
  formatTimeWindow,
  formatWeekdayDate,
  resolvedTechnicianColor,
  startOfWeekSunday,
  workOrderCrewIds,
  workOrderLocalDate,
} from "@/lib/schedule";
import { mapStylesForTheme } from "@/components/schedule/ScheduleMap";
import { useAuthStore } from "@/store/useAuthStore";

const FL_CENTER = { lat: 28.5, lng: -81.4 };
const FIT_PADDING = 52;

type TechRouteData = {
  tech: ScheduleStaffMember;
  color: string;
  stops: ScheduleRouteStop[];
  jobs: WorkOrderListItem[];
  encodedPolyline?: string;
  legs: ScheduleRouteLeg[];
  durationMinutes?: number;
  distanceMeters?: number;
};

type DayRoutesModalProps = {
  open: boolean;
  initialDate: string;
  initialTechId?: string | null;
  onClose: () => void;
  onSelectDateAndTech?: (date: string, tech: ScheduleStaffMember) => void;
};

function decodePath(encoded: string): google.maps.LatLng[] {
  const encoding = google.maps.geometry?.encoding;
  if (!encoding) return [];
  return encoding.decodePath(encoded);
}

function pinSymbol(
  color: string,
  emphasized: boolean,
  isHome = false,
): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: isHome ? (emphasized ? 14 : 12) : emphasized ? 15 : 13,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: isHome ? "#171717" : "#ffffff",
    strokeWeight: emphasized ? 3 : 2,
  };
}

function formatMiles(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatJobWindow(job?: WorkOrderListItem): string | null {
  if (!job) return null;
  if (job.scheduledStart && job.scheduledEnd) {
    const s = new Date(job.scheduledStart);
    const e = new Date(job.scheduledEnd);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      return `${formatLocalClock(s)} – ${formatLocalClock(e)}`;
    }
  }
  const byClock = formatTimeWindow(job.startTime, job.endTime);
  if (byClock) return byClock;
  if (job.scheduledStart) {
    const s = new Date(job.scheduledStart);
    if (!Number.isNaN(s.getTime())) return formatLocalClock(s);
  }
  return null;
}

export default function DayRoutesModal({
  open,
  initialDate,
  initialTechId = null,
  onClose,
  onSelectDateAndTech,
}: DayRoutesModalProps) {
  const token = useAuthStore((s) => s.token);
  const [activeDate, setActiveDate] = useState(initialDate);
  const [selectedTechId, setSelectedTechId] = useState<string | null>(
    initialTechId,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [techRoutes, setTechRoutes] = useState<TechRouteData[]>([]);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setActiveDate(initialDate);
      setSelectedTechId(initialTechId);
    });
  }, [open, initialDate, initialTechId]);

  // Mini calendar week days around activeDate
  const weekDays = useMemo(() => {
    if (!activeDate) return [];
    const sunday = startOfWeekSunday(activeDate);
    return Array.from({ length: 7 }, (_, idx) => {
      const dateStr = addDays(sunday, idx);
      const [, , dayNum] = dateStr.split("-");
      const weekdayShort = new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(
        "en-US",
        { weekday: "short", timeZone: "UTC" },
      );
      return {
        date: dateStr,
        dayNumber: Number(dayNum),
        weekdayShort,
      };
    });
  }, [activeDate]);

  // Load Google Map instance when modal opens
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;

    async function initMap() {
      if (!mapEl.current) return;
      setMapError(null);
      try {
        const { apiKey } = await getGoogleMapsBrowserKey(token!);
        if (cancelled) return;
        setOptions({ key: apiKey, v: "weekly" });
        await importLibrary("maps");
        try {
          await importLibrary("geometry");
        } catch {
          // Straight-line fallback still works if geometry fails to load
        }
        if (cancelled || !mapEl.current) return;

        mapRef.current = new google.maps.Map(mapEl.current, {
          center: FL_CENTER,
          zoom: 8,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          styles: mapStylesForTheme(),
        });
        if (!cancelled) {
          setMapReady(true);
        }
      } catch (err) {
        if (cancelled) return;
        setMapError(
          err instanceof ApiError
            ? err.message
            : "Map could not be loaded. Check Google Maps credentials.",
        );
      }
    }

    void initMap();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
      mapRef.current = null;
      setMapReady(false);
    };
  }, [open, token]);

  // Load staff & routes for activeDate
  useEffect(() => {
    if (!open || !token || !activeDate) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    async function loadDayRoutes() {
      try {
        const board = await getScheduleStaff(token!, activeDate, activeDate);
        if (cancelled) return;

        const jobsByTech = new Map<string, WorkOrderListItem[]>();
        for (const job of board.workOrders) {
          const jobDate = workOrderLocalDate(job);
          if (jobDate && jobDate !== activeDate) continue;
          for (const techId of workOrderCrewIds(job)) {
            const list = jobsByTech.get(techId) ?? [];
            list.push(job);
            jobsByTech.set(techId, list);
          }
        }

        const routeResults = await Promise.all(
          board.staff.map(async (tech): Promise<TechRouteData> => {
            const color = resolvedTechnicianColor(
              tech._id,
              tech.scheduleColor,
            );
            const rawJobs = (jobsByTech.get(tech._id) ?? []).sort((a, b) => {
              const aTime = a.scheduledStart
                ? new Date(a.scheduledStart).getTime()
                : Number.MAX_SAFE_INTEGER;
              const bTime = b.scheduledStart
                ? new Date(b.scheduledStart).getTime()
                : Number.MAX_SAFE_INTEGER;
              return aTime - bTime;
            });

            if (rawJobs.length === 0) {
              const homeStops: ScheduleRouteStop[] =
                typeof tech.homeLocation?.lat === "number" &&
                typeof tech.homeLocation?.lng === "number"
                  ? [
                      {
                        kind: "home",
                        label: `Home (${tech.homeLocation.city || tech.first_name})`,
                        lat: tech.homeLocation.lat,
                        lng: tech.homeLocation.lng,
                      },
                    ]
                  : [];
              return {
                tech,
                color,
                stops: homeStops,
                jobs: [],
                legs: [],
              };
            }

            try {
              const res = await getScheduleRoute(token!, tech._id, activeDate);
              return {
                tech,
                color,
                stops: res.stops,
                jobs: rawJobs,
                encodedPolyline: res.route?.encodedPolyline,
                legs: res.route?.legs ?? [],
                durationMinutes: res.route?.durationMinutes,
                distanceMeters: res.route?.distanceMeters,
              };
            } catch {
              const fallbackStops: ScheduleRouteStop[] = [];
              if (
                typeof tech.homeLocation?.lat === "number" &&
                typeof tech.homeLocation?.lng === "number"
              ) {
                fallbackStops.push({
                  kind: "home",
                  label: "Home",
                  lat: tech.homeLocation.lat,
                  lng: tech.homeLocation.lng,
                });
              }
              for (const job of rawJobs) {
                fallbackStops.push({
                  kind: "job",
                  label: job.customerName || "Work order",
                  lat:
                    typeof job.address?.lat === "number"
                      ? job.address.lat
                      : null,
                  lng:
                    typeof job.address?.lng === "number"
                      ? job.address.lng
                      : null,
                  workOrderId: job._id,
                  scheduledStart: job.scheduledStart,
                });
              }
              return {
                tech,
                color,
                stops: fallbackStops,
                jobs: rawJobs,
                legs: [],
              };
            }
          }),
        );

        if (!cancelled) {
          setTechRoutes(routeResults);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not load routes for this date.",
          );
          setTechRoutes([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDayRoutes();
    return () => {
      cancelled = true;
    };
  }, [open, token, activeDate]);

  // Draw all technician routes and markers on the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let pointCount = 0;

    for (const entry of techRoutes) {
      const isSelected = selectedTechId === entry.tech._id;
      const dimmed = selectedTechId != null && !isSelected;
      const techName =
        `${entry.tech.first_name} ${entry.tech.last_name}`.trim();

      let homeDrawn = false;
      let jobIndex = 0;

      for (const stop of entry.stops) {
        if (typeof stop.lat !== "number" || typeof stop.lng !== "number") {
          continue;
        }
        const position = { lat: stop.lat, lng: stop.lng };

        if (stop.kind === "home") {
          if (homeDrawn) continue;
          homeDrawn = true;
          // Only include home in bounds if this tech has jobs or is selected
          if (entry.jobs.length > 0 || isSelected) {
            bounds.extend(position);
            pointCount += 1;
          }
          const marker = new google.maps.Marker({
            map,
            position,
            icon: pinSymbol(entry.color, isSelected, true),
            label: {
              text: "H",
              color: "#ffffff",
              fontWeight: "700",
              fontSize: "10px",
            },
            title: `${techName} · ${stop.label}`,
            opacity: dimmed ? 0.5 : 1,
            zIndex: isSelected ? 20 : 5,
          });
          marker.addListener("click", () => {
            setSelectedTechId(entry.tech._id);
          });
          markersRef.current.push(marker);
          continue;
        }

        jobIndex += 1;
        bounds.extend(position);
        pointCount += 1;

        const marker = new google.maps.Marker({
          map,
          position,
          icon: pinSymbol(entry.color, isSelected, false),
          label: {
            text: String(jobIndex),
            color: "#ffffff",
            fontWeight: "700",
            fontSize: "11px",
          },
          title: `${techName} · Stop #${jobIndex}: ${stop.label}`,
          opacity: dimmed ? 0.55 : 1,
          zIndex: isSelected ? 30 + jobIndex : 10 + jobIndex,
        });
        marker.addListener("click", () => {
          setSelectedTechId(entry.tech._id);
        });
        markersRef.current.push(marker);
      }

      const decoded = entry.encodedPolyline
        ? decodePath(entry.encodedPolyline)
        : [];
      const straight = entry.stops
        .filter(
          (s): s is ScheduleRouteStop & { lat: number; lng: number } =>
            typeof s.lat === "number" && typeof s.lng === "number",
        )
        .map((s) => ({ lat: s.lat, lng: s.lng }));
      const path = decoded.length > 1 ? decoded : straight;

      if (path.length > 1) {
        const polyline = new google.maps.Polyline({
          map,
          path,
          strokeColor: entry.color,
          strokeOpacity: dimmed ? 0.35 : 0.9,
          strokeWeight: isSelected ? 6 : 4,
          clickable: true,
          zIndex: isSelected ? 25 : 8,
        });
        polyline.addListener("click", () => {
          setSelectedTechId(entry.tech._id);
        });
        polylinesRef.current.push(polyline);
      }
    }

    if (pointCount > 1) {
      map.fitBounds(bounds, FIT_PADDING);
    } else if (pointCount === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(12);
    } else {
      map.setCenter(FL_CENTER);
      map.setZoom(8);
    }
  }, [mapReady, techRoutes, selectedTechId]);

  // Trigger map resize when the right-hand side panel opens/closes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const timer = window.setTimeout(() => {
      google.maps.event.trigger(map, "resize");
    }, 50);
    return () => window.clearTimeout(timer);
  }, [mapReady, selectedTechId]);

  const selectedRoute = useMemo(
    () => techRoutes.find((r) => r.tech._id === selectedTechId) ?? null,
    [techRoutes, selectedTechId],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Schedule routes for ${formatWeekdayDate(activeDate)}`}
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header + Mini Calendar Bar */}
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Daily Route Map &amp; Schedule
              </p>
              <h3 className="text-base font-semibold text-brand-dark">
                {activeDate ? formatWeekdayDate(activeDate) : "Select a date"}
              </h3>
            </div>

            {/* Mini calendar navigation */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveDate((d) => addDays(d, -1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                aria-label="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1">
                {weekDays.map((day) => {
                  const isCurrent = day.date === activeDate;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => setActiveDate(day.date)}
                      className={`flex flex-col items-center rounded px-2 py-1 text-xs transition-colors ${
                        isCurrent
                          ? "bg-brand-orange font-semibold text-white"
                          : "text-neutral-700 hover:bg-neutral-100"
                      }`}
                    >
                      <span className="text-[10px] uppercase opacity-80">
                        {day.weekdayShort}
                      </span>
                      <span>{day.dayNumber}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setActiveDate((d) => addDays(d, 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                aria-label="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <input
                type="date"
                value={activeDate}
                onChange={(e) => {
                  if (e.target.value) setActiveDate(e.target.value);
                }}
                aria-label="Jump to date"
                className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs text-brand-dark"
              />
              <button
                type="button"
                onClick={onClose}
                className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
                aria-label="Close schedule modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Color-coded technician route pills */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-neutral-500">
              Technicians (click a route or tech to view stops):
            </span>
            {techRoutes.map((entry) => {
              const isSelected = selectedTechId === entry.tech._id;
              const name =
                `${entry.tech.first_name} ${entry.tech.last_name}`.trim();
              const stopCount = entry.jobs.length;
              return (
                <button
                  key={entry.tech._id}
                  type="button"
                  onClick={() =>
                    setSelectedTechId((prev) =>
                      prev === entry.tech._id ? null : entry.tech._id,
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                    isSelected
                      ? "border-brand-dark bg-neutral-900 text-white shadow-sm"
                      : "border-neutral-300 bg-white text-brand-dark hover:bg-neutral-100"
                  }`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span>{name}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {stopCount} {stopCount === 1 ? "stop" : "stops"}
                  </span>
                </button>
              );
            })}
            {selectedTechId ? (
              <button
                type="button"
                onClick={() => setSelectedTechId(null)}
                className="text-xs font-medium text-brand-orange hover:underline"
              >
                Show all routes equally
              </button>
            ) : null}
          </div>
        </div>

        {/* Main Body: Map + Right-Hand Side Route Panel */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Map Area */}
          <div className="relative flex-1 bg-neutral-100">
            <div ref={mapEl} className="h-full w-full" />
            {loading ? (
              <div className="pointer-events-none absolute top-3 left-3 z-10 rounded-md border border-neutral-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm">
                Loading routes for {formatWeekdayDate(activeDate)}…
              </div>
            ) : null}
            {error || mapError ? (
              <div className="absolute top-3 left-3 z-10 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-sm">
                {error || mapError}
              </div>
            ) : null}
          </div>

          {/* Right-Hand Side Panel: Selected Route from First to Last */}
          {selectedRoute ? (
            <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white sm:w-96">
              <div className="flex items-start justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: selectedRoute.color }}
                    />
                    <h4 className="truncate text-sm font-semibold text-brand-dark">
                      {selectedRoute.tech.first_name}{" "}
                      {selectedRoute.tech.last_name}
                    </h4>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {selectedRoute.jobs.length}{" "}
                    {selectedRoute.jobs.length === 1
                      ? "scheduled stop"
                      : "scheduled stops"}
                    {typeof selectedRoute.durationMinutes === "number" &&
                    typeof selectedRoute.distanceMeters === "number"
                      ? ` · ${selectedRoute.durationMinutes} min drive · ${formatMiles(
                          selectedRoute.distanceMeters,
                        )}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTechId(null)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200/60 hover:text-brand-dark"
                  aria-label="Close route panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {selectedRoute.stops.length === 0 ? (
                  <p className="py-6 text-center text-xs text-neutral-500">
                    No stops scheduled for this technician on{" "}
                    {formatWeekdayDate(activeDate)}.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {(() => {
                      let jobOrder = 0;
                      const jobsById = new Map(
                        selectedRoute.jobs.map((j) => [j._id, j]),
                      );
                      return selectedRoute.stops.map((stop, idx) => {
                        const isHome = stop.kind === "home";
                        if (!isHome) jobOrder += 1;
                        const job = stop.workOrderId
                          ? jobsById.get(stop.workOrderId)
                          : undefined;
                        const timeLabel = formatJobWindow(job);
                        const addressLine = job
                          ? formatAddressLine(job.address)
                          : stop.kind === "home"
                            ? formatAddressLine(
                                selectedRoute.tech.homeLocation,
                              )
                            : "";
                        const leg = selectedRoute.legs[idx];

                        return (
                          <li key={`${stop.kind}-${stop.workOrderId ?? idx}`}>
                            <div className="rounded-lg border border-neutral-200 bg-white p-2.5 shadow-2xs">
                              <div className="flex items-start gap-2.5">
                                <span
                                  className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                                  style={{
                                    backgroundColor: isHome
                                      ? "#404040"
                                      : selectedRoute.color,
                                  }}
                                >
                                  {isHome ? "H" : jobOrder}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-xs font-semibold text-brand-dark">
                                      {isHome
                                        ? stop.label
                                        : `${jobOrder}. ${stop.label}`}
                                    </p>
                                    {timeLabel ? (
                                      <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700">
                                        {timeLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                  {job?.workOrderType?.label ? (
                                    <p className="mt-0.5 text-[11px] font-medium text-neutral-600">
                                      {job.workOrderType.label}
                                      {job.number || job.legacyId
                                        ? ` · WO #${job.number || job.legacyId}`
                                        : ""}
                                    </p>
                                  ) : null}
                                  {addressLine && addressLine !== "—" ? (
                                    <p className="mt-0.5 flex items-start gap-1 text-[11px] text-neutral-500">
                                      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-neutral-400" />
                                      <span>{addressLine}</span>
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            {leg ? (
                              <div className="my-1.5 flex items-center gap-1.5 pl-4 text-[11px] text-neutral-500">
                                <Navigation className="h-3 w-3 text-neutral-400" />
                                <span>
                                  {leg.durationMinutes} min ·{" "}
                                  {formatMiles(leg.distanceMeters)} drive to
                                  next stop
                                </span>
                              </div>
                            ) : null}
                          </li>
                        );
                      });
                    })()}
                  </ol>
                )}
              </div>

              {onSelectDateAndTech ? (
                <div className="border-t border-neutral-200 bg-neutral-50 p-3">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectDateAndTech(activeDate, selectedRoute.tech);
                      onClose();
                    }}
                    className="w-full rounded-md bg-brand-orange px-3 py-2 text-xs font-semibold text-white shadow-xs hover: opacity-95"
                  >
                    Assign {selectedRoute.tech.first_name}{" "}
                    {selectedRoute.tech.last_name} on{" "}
                    {formatWeekdayDate(activeDate)}
                  </button>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
