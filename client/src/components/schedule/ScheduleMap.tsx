"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { ApiError, getGoogleMapsBrowserKey, WorkOrderListItem } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const FL_CENTER = { lat: 28.5, lng: -81.4 };
const UNSCHEDULED_COLOR = "#f36c21";
const SCHEDULED_COLOR = "#2563eb";

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

function pinIcon(color: string, selected: boolean): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: selected ? 12 : 8,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: selected ? 3 : 2,
  };
}

type ScheduleMapProps = {
  unscheduled: WorkOrderListItem[];
  scheduled: WorkOrderListItem[];
  showScheduled: boolean;
  selectedId: string | null;
  onSelect: (job: WorkOrderListItem) => void;
};

export default function ScheduleMap({
  unscheduled,
  scheduled,
  showScheduled,
  selectedId,
  onSelect,
}: ScheduleMapProps) {
  const token = useAuthStore((s) => s.token);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  const fittedKeyRef = useRef<string>("");
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

  const pinKey = useMemo(() => {
    const ids = mappedUnscheduled.map((job) => `u:${job._id}`);
    if (showScheduled) {
      ids.push(...mappedScheduled.map((job) => `s:${job._id}`));
    }
    return ids.sort().join(",");
  }, [mappedUnscheduled, mappedScheduled, showScheduled]);

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
        if (cancelled || !mapEl.current) return;

        mapRef.current = new google.maps.Map(mapEl.current, {
          center: FL_CENTER,
          zoom: 8,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
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
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let count = 0;

    function addMarker(job: WorkOrderListItem, color: string) {
      const lat = parseCoord(job.address?.lat);
      const lng = parseCoord(job.address?.lng);
      if (lat == null || lng == null) return;
      const position = { lat, lng };
      bounds.extend(position);
      count += 1;
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

    mappedUnscheduled.forEach((job) => addMarker(job, UNSCHEDULED_COLOR));
    if (showScheduled) {
      mappedScheduled.forEach((job) => addMarker(job, SCHEDULED_COLOR));
    }

    if (count > 0 && fittedKeyRef.current !== pinKey) {
      if (count === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(12);
      } else {
        map.fitBounds(bounds, 48);
      }
      fittedKeyRef.current = pinKey;
    } else if (count === 0) {
      map.setCenter(FL_CENTER);
      map.setZoom(8);
      fittedKeyRef.current = pinKey;
    }
  }, [
    status,
    mapGeneration,
    mappedUnscheduled,
    mappedScheduled,
    showScheduled,
    selectedId,
    pinKey,
  ]);

  return (
    <div className="space-y-3">
      {status === "error" && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: UNSCHEDULED_COLOR }}
          />
          Needs scheduling
        </span>
        {showScheduled && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: SCHEDULED_COLOR }}
            />
            Scheduled
          </span>
        )}
      </div>
      <div
        ref={mapEl}
        className="h-[32rem] w-full rounded-lg border border-neutral-200"
      />
    </div>
  );
}
