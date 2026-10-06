"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useDroppable } from "@dnd-kit/core";
import {
  ApiError,
  getGoogleMapsBrowserKey,
  ScheduleRouteStop,
  WorkOrderListItem,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const EMPTY_STOPS: ScheduleRouteStop[] = [];
const FL_CENTER = { lat: 28.5, lng: -81.4 };
const FIT_PADDING = 48;
const DEFAULT_SURFACE_HEIGHT = "h-[32rem]";
const UNSCHEDULED_COLOR = "#f36c21";
const SCHEDULED_COLOR = "#2563eb";
const HOME_COLOR = "#404040";

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1f1c1a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a89c93" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1715" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#4a423c" }],
  },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#3a3430" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#2a2522" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#4d4540" }],
  },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#121a22" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5c6b78" }],
  },
];

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function mapStylesForTheme(): google.maps.MapTypeStyle[] | null {
  return isDarkTheme() ? DARK_MAP_STYLES : null;
}

function parseCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function jobHasCoordinates(job: WorkOrderListItem): boolean {
  return (
    parseCoord(job.address?.lat) != null && parseCoord(job.address?.lng) != null
  );
}

function pinIcon(
  color: string,
  selected: boolean,
  numbered = false,
): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: numbered ? 14 : selected ? 12 : 8,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: selected ? 3 : 2,
  };
}

function decodePath(encoded: string): google.maps.LatLng[] {
  const encoding = google.maps.geometry?.encoding;
  if (!encoding) return [];
  return encoding.decodePath(encoded);
}

type MapFrame = {
  count: number;
  bounds: google.maps.LatLngBounds | null;
};

function applyMapFrame(map: google.maps.Map, frame: MapFrame) {
  if (frame.count > 1 && frame.bounds) {
    map.fitBounds(frame.bounds, FIT_PADDING);
    return;
  }
  if (frame.count === 1 && frame.bounds) {
    map.setCenter(frame.bounds.getCenter());
    map.setZoom(12);
    return;
  }
  map.setCenter(FL_CENTER);
  map.setZoom(8);
}

type ScheduleMapProps = {
  unscheduled: WorkOrderListItem[];
  scheduled: WorkOrderListItem[];
  pinMode: "scheduled" | "unscheduled";
  selectedId: string | null;
  onSelect: (job: WorkOrderListItem) => void;
  routeStops?: ScheduleRouteStop[];
  encodedPolyline?: string;
  /** Schedule board accepts drops onto the map. Read-only maps leave this off. */
  droppable?: boolean;
  /** Replaces the default 32rem height. `h-full` fills a sized parent. */
  surfaceClassName?: string;
};

function DroppableMapSurface({
  surfaceClassName,
  children,
}: {
  surfaceClassName: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "schedule-map" });
  const fill = surfaceClassName.includes("h-full");
  return (
    <div
      ref={setNodeRef}
      className={`relative w-full overflow-hidden rounded-2xl border bg-neutral-100 shadow-sm ${surfaceClassName}${
        fill ? " min-h-0 flex-1" : ""
      } ${
        isOver
          ? "border-brand-orange ring-2 ring-brand-orange"
          : "border-neutral-200"
      }`}
    >
      {children}
      {isOver ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-orange-500/10">
          <span className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-brand-dark shadow">
            Add to this route
          </span>
        </div>
      ) : null}
    </div>
  );
}

function MapSurface({
  droppable,
  surfaceClassName = DEFAULT_SURFACE_HEIGHT,
  children,
}: {
  droppable: boolean;
  surfaceClassName?: string;
  children: ReactNode;
}) {
  if (droppable) {
    return (
      <DroppableMapSurface surfaceClassName={surfaceClassName}>
        {children}
      </DroppableMapSurface>
    );
  }
  const fill = surfaceClassName.includes("h-full");
  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100 shadow-sm ${surfaceClassName}${
        fill ? " min-h-0 flex-1" : ""
      }`}
    >
      {children}
    </div>
  );
}

export default function ScheduleMap({
  unscheduled,
  scheduled,
  pinMode,
  selectedId,
  onSelect,
  routeStops = EMPTY_STOPS,
  encodedPolyline,
  droppable = true,
  surfaceClassName,
}: ScheduleMapProps) {
  const token = useAuthStore((s) => s.token);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const onSelectRef = useRef(onSelect);
  const fittedKeyRef = useRef<string>("");
  const frameRef = useRef<MapFrame>({ count: 0, bounds: null });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [mapGeneration, setMapGeneration] = useState(0);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const mappedUnscheduled = useMemo(
    () => unscheduled.filter(jobHasCoordinates),
    [unscheduled],
  );
  const mappedScheduled = useMemo(
    () => scheduled.filter(jobHasCoordinates),
    [scheduled],
  );
  const routeKey = useMemo(
    () =>
      routeStops
        .map((stop) => `${stop.kind}:${stop.workOrderId ?? stop.label}`)
        .join(","),
    [routeStops],
  );

  const pinKey = useMemo(() => {
    const ids =
      pinMode === "scheduled"
        ? mappedScheduled.map((job) => `s:${job._id}`)
        : mappedUnscheduled.map((job) => `u:${job._id}`);
    return `${pinMode}|${ids.sort().join(",")}|${routeKey}`;
  }, [mappedUnscheduled, mappedScheduled, pinMode, routeKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadMap() {
      if (!token || !mapEl.current) return;
      setStatus("loading");
      setError(null);
      try {
        const { apiKey } = await getGoogleMapsBrowserKey(token);
        if (cancelled) return;
        setOptions({ key: apiKey, v: "weekly" });
        await importLibrary("maps");
        try {
          await importLibrary("geometry");
        } catch {
          // Straight stop-to-stop lines still draw without the geometry library.
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
        fittedKeyRef.current = "";
        if (!cancelled) {
          setStatus("ready");
          setMapGeneration((n) => n + 1);
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof ApiError
            ? err.message
            : "Map could not be loaded. Check Google Maps credentials.",
        );
      }
    }

    void loadMap();
    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (status !== "ready") return;
    const observer = new MutationObserver(() => {
      mapRef.current?.setOptions({ styles: mapStylesForTheme() });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [status, mapGeneration]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];
    polylineRef.current?.setMap(null);
    polylineRef.current = null;

    const bounds = new google.maps.LatLngBounds();
    let count = 0;
    const jobsById = new Map<string, WorkOrderListItem>();
    for (const job of [...mappedUnscheduled, ...mappedScheduled]) {
      jobsById.set(job._id, job);
    }
    const routedIds = new Set(
      routeStops
        .map((stop) => stop.workOrderId)
        .filter((id): id is string => Boolean(id)),
    );

    function extend(position: google.maps.LatLngLiteral) {
      bounds.extend(position);
      count += 1;
    }

    function addMarker(job: WorkOrderListItem, color: string) {
      const lat = parseCoord(job.address?.lat);
      const lng = parseCoord(job.address?.lng);
      if (lat == null || lng == null) return;
      const position = { lat, lng };
      extend(position);
      const marker = new google.maps.Marker({
        map,
        position,
        icon: pinIcon(color, job._id === selectedId),
        title: job.customerName || "Work order",
        zIndex: job._id === selectedId ? 1000 : color === UNSCHEDULED_COLOR ? 2 : 1,
      });
      marker.addListener("click", () => onSelectRef.current(job));
      markersRef.current.push(marker);
    }

    const circleJobs =
      pinMode === "scheduled" ? mappedScheduled : mappedUnscheduled;
    const circleColor =
      pinMode === "scheduled" ? SCHEDULED_COLOR : UNSCHEDULED_COLOR;
    circleJobs.forEach((job) => {
      if (routedIds.has(job._id)) return;
      addMarker(job, circleColor);
    });

    let homeDrawn = false;
    let jobNumber = 0;
    routeStops.forEach((stop) => {
      if (stop.lat == null || stop.lng == null) return;
      const position = { lat: stop.lat, lng: stop.lng };
      if (stop.kind === "home") {
        if (homeDrawn) return;
        homeDrawn = true;
        extend(position);
        const marker = new google.maps.Marker({
          map,
          position,
          label: { text: "H", color: "#ffffff", fontWeight: "700" },
          icon: pinIcon(HOME_COLOR, false, true),
          title: stop.label,
          zIndex: 3,
        });
        markersRef.current.push(marker);
        return;
      }
      jobNumber += 1;
      const job = stop.workOrderId ? jobsById.get(stop.workOrderId) : undefined;
      const scheduledStop = job
        ? mappedScheduled.some((row) => row._id === job._id)
        : false;
      extend(position);
      const marker = new google.maps.Marker({
        map,
        position,
        label: {
          text: String(jobNumber),
          color: "#ffffff",
          fontWeight: "700",
          fontSize: "11px",
        },
        icon: pinIcon(
          scheduledStop ? SCHEDULED_COLOR : UNSCHEDULED_COLOR,
          stop.workOrderId === selectedId,
          true,
        ),
        title: stop.label,
        zIndex: 4,
      });
      if (job) marker.addListener("click", () => onSelectRef.current(job));
      markersRef.current.push(marker);
    });

    const decoded = encodedPolyline ? decodePath(encodedPolyline) : [];
    const straight = routeStops
      .filter((stop) => stop.lat != null && stop.lng != null)
      .map((stop) => ({ lat: stop.lat!, lng: stop.lng! }));
    const line = decoded.length > 1 ? decoded : straight;
    if (line.length > 1) {
      polylineRef.current = new google.maps.Polyline({
        map,
        path: line,
        strokeColor: "#c45c26",
        strokeWeight: 4,
      });
    }

    const frame: MapFrame = {
      count,
      bounds: count > 0 ? bounds : null,
    };
    frameRef.current = frame;
    if (count === 0 || fittedKeyRef.current !== pinKey) {
      applyMapFrame(map, frame);
      fittedKeyRef.current = pinKey;
    }
  }, [
    status,
    mapGeneration,
    mappedUnscheduled,
    mappedScheduled,
    pinMode,
    selectedId,
    pinKey,
    routeStops,
    encodedPolyline,
  ]);

  useEffect(() => {
    const el = mapEl.current;
    if (!el || status !== "ready") return;
    let lastWidth = -1;
    let lastHeight = -1;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width < 1 || height < 1) return;
      if (
        Math.abs(width - lastWidth) < 2 &&
        Math.abs(height - lastHeight) < 2
      ) {
        return;
      }
      lastWidth = width;
      lastHeight = height;
      const map = mapRef.current;
      if (!map) return;
      google.maps.event.trigger(map, "resize");
      applyMapFrame(map, frameRef.current);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [status, mapGeneration]);

  const showUnscheduled =
    pinMode === "unscheduled" ||
    routeStops.some(
      (stop) =>
        stop.workOrderId &&
        mappedUnscheduled.some((job) => job._id === stop.workOrderId),
    );
  const showScheduled =
    pinMode === "scheduled" ||
    routeStops.some(
      (stop) =>
        stop.workOrderId &&
        mappedScheduled.some((job) => job._id === stop.workOrderId),
    );

  const showHome = routeStops.some(
    (stop) => stop.kind === "home" && stop.lat != null,
  );

  const fillsParent = surfaceClassName?.includes("h-full") ?? false;

  return (
    <div
      className={
        fillsParent
          ? "flex h-full min-h-0 w-full flex-1 flex-col"
          : "space-y-3"
      }
    >
      {status === "error" && <p className="text-sm text-red-600">{error}</p>}
      <MapSurface droppable={droppable} surfaceClassName={surfaceClassName}>
        <div ref={mapEl} className="h-full w-full" />
        {(showUnscheduled || showScheduled || showHome) && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-3 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-600 shadow-sm">
            {showUnscheduled && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: UNSCHEDULED_COLOR }}
                />
                Needs scheduling
              </span>
            )}
            {showScheduled && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: SCHEDULED_COLOR }}
                />
                Scheduled
              </span>
            )}
            {showHome && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: HOME_COLOR }}
                />
                Home
              </span>
            )}
          </div>
        )}
      </MapSurface>
    </div>
  );
}
