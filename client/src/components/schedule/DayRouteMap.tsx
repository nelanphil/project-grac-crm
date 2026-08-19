"use client";

import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import {
  ApiError,
  getGoogleMapsBrowserKey,
  ScheduleRouteStop,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

type DayRouteMapProps = {
  stops: ScheduleRouteStop[];
  encodedPolyline?: string;
};

export default function DayRouteMap({
  stops,
  encodedPolyline,
}: DayRouteMapProps) {
  const token = useAuthStore((s) => s.token);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const markers: google.maps.Marker[] = [];
    let polyline: google.maps.Polyline | null = null;

    async function load() {
      if (!token || !mapEl.current) return;
      setStatus("loading");
      setError(null);
      try {
        const { apiKey } = await getGoogleMapsBrowserKey(token);
        if (cancelled) return;
        setOptions({ key: apiKey, v: "weekly" });
        await importLibrary("maps");
        if (cancelled || !mapEl.current) return;

        const points = stops.filter(
          (s) => typeof s.lat === "number" && typeof s.lng === "number",
        );
        const center = points[0]
          ? { lat: points[0].lat!, lng: points[0].lng! }
          : { lat: 28.5, lng: -81.4 };

        const map = new google.maps.Map(mapEl.current, {
          center,
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        const bounds = new google.maps.LatLngBounds();
        points.forEach((stop, index) => {
          const position = { lat: stop.lat!, lng: stop.lng! };
          bounds.extend(position);
          const marker = new google.maps.Marker({
            map,
            position,
            label:
              stop.kind === "home"
                ? "H"
                : String(
                    points
                      .slice(0, index + 1)
                      .filter((p) => p.kind === "job").length,
                  ),
            title: stop.label,
          });
          markers.push(marker);
        });

        if (encodedPolyline) {
          polyline = new google.maps.Polyline({
            map,
            path: google.maps.geometry
              ? google.maps.geometry.encoding.decodePath(encodedPolyline)
              : [],
            strokeColor: "#c45c26",
            strokeWeight: 4,
          });
        }

        if (points.length > 1) {
          map.fitBounds(bounds, 48);
        }
        if (!cancelled) setStatus("ready");
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

    void load();
    return () => {
      cancelled = true;
      markers.forEach((m) => m.setMap(null));
      polyline?.setMap(null);
    };
  }, [token, stops, encodedPolyline]);

  return (
    <div className="space-y-2">
      {status === "error" && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      <div ref={mapEl} className="h-72 w-full rounded-lg border border-neutral-200" />
      <ol className="space-y-1 text-xs text-neutral-600">
        {stops.map((stop, i) => (
          <li key={`${stop.kind}-${i}`}>
            {i + 1}. {stop.label}
            {typeof stop.lat !== "number" ? " (no coordinates)" : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}
