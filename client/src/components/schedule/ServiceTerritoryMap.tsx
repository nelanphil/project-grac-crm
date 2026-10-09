"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Minus, Plus } from "lucide-react";
import {
  ApiError,
  CityBoundaryCollection,
  CityZone,
  getCityBoundaries,
  getGoogleMapsBrowserKey,
  resolveServiceCityAt,
  ServiceCity,
} from "@/lib/api";
import { US_STATE_BOUNDS } from "@/lib/usStateBounds";
import { useAuthStore } from "@/store/useAuthStore";
import { mapStylesForTheme } from "@/components/schedule/ScheduleMap";

const FL_CENTER = { lat: 27.8, lng: -81.7 };
const PIN_COLOR = "#E87722";
const LABEL_ZOOM = 9;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

export type ServiceTerritoryMapProps = {
  states: string[];
  activeState: string | null;
  cities: ServiceCity[];
  onAddCity: (city: ServiceCity) => boolean;
  onAddCityFromZone: (zone: CityZone) => Promise<void>;
  onRemoveCity: (placeId: string) => void;
  onActiveStateChange: (state: string) => void;
};

function stateLabel(code: string): string {
  return US_STATE_BOUNDS[code]?.name ?? code;
}

function cityInZone(city: ServiceCity, zone: Pick<CityZone, "name" | "state" | "geoid">): boolean {
  if (zone.geoid && city.placeId === `census:${zone.geoid}`) return true;
  return (
    city.state === zone.state &&
    city.city.trim().toLowerCase() === zone.name.trim().toLowerCase()
  );
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function zoneFromFeature(
  feature: google.maps.Data.Feature,
  fallbackState: string | null,
): CityZone {
  const kind = feature.getProperty("kind");
  return {
    name: String(feature.getProperty("name") ?? "").trim(),
    state: String(feature.getProperty("state") ?? fallbackState ?? "").trim(),
    kind: kind === "cdp" ? "cdp" : "city",
    geoid: String(feature.getProperty("geoid") ?? "").trim(),
    lat: optionalNumber(feature.getProperty("lat")),
    lng: optionalNumber(feature.getProperty("lng")),
  };
}

function extendBounds(
  box: google.maps.LatLngBounds,
  coordinates: unknown,
) {
  if (!Array.isArray(coordinates)) return;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    box.extend({ lng: coordinates[0], lat: coordinates[1] });
    return;
  }
  for (const child of coordinates) extendBounds(box, child);
}

function frameMap(
  map: google.maps.Map,
  stateCode: string | null,
  pins: ServiceCity[],
) {
  const bounds = stateCode ? US_STATE_BOUNDS[stateCode] : undefined;
  if (bounds) {
    map.fitBounds(
      new google.maps.LatLngBounds(
        { lat: bounds.south, lng: bounds.west },
        { lat: bounds.north, lng: bounds.east },
      ),
    );
    return;
  }

  const located = pins.filter(
    (city) => city.lat != null && city.lng != null,
  );
  if (located.length === 0) {
    map.setCenter(FL_CENTER);
    map.setZoom(6);
    return;
  }

  const box = new google.maps.LatLngBounds();
  for (const city of located) {
    box.extend({ lat: city.lat as number, lng: city.lng as number });
  }
  if (located.length === 1) {
    map.setCenter(box.getCenter());
    map.setZoom(9);
    return;
  }
  map.fitBounds(box, 48);
}

export default function ServiceTerritoryMap({
  states,
  activeState,
  cities,
  onAddCity,
  onAddCityFromZone,
  onRemoveCity,
  onActiveStateChange,
}: ServiceTerritoryMapProps) {
  const token = useAuthStore((s) => s.token);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const layerRef = useRef<google.maps.Data | null>(null);
  const activeStateRef = useRef(activeState);
  const citiesRef = useRef(cities);
  const tokenRef = useRef(token);
  const resolvingRef = useRef(false);
  const featureClickAtRef = useRef(0);
  const handlersRef = useRef({ onAddCity, onAddCityFromZone, onRemoveCity });

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [mapGeneration, setMapGeneration] = useState(0);
  const [boundaries, setBoundaries] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [zoom, setZoom] = useState(6);
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.dataset.theme === "dark",
  );

  useEffect(() => {
    activeStateRef.current = activeState;
    citiesRef.current = cities;
    tokenRef.current = token;
    handlersRef.current = { onAddCity, onAddCityFromZone, onRemoveCity };
  }, [activeState, cities, token, onAddCity, onAddCityFromZone, onRemoveCity]);

  const styleCityFeature = useCallback(
    (feature: google.maps.Data.Feature): google.maps.Data.StyleOptions => {
      const zone = zoneFromFeature(feature, null);
      const selected = citiesRef.current.some((city) => cityInZone(city, zone));
      if (selected) {
        return {
          fillColor: PIN_COLOR,
          fillOpacity: 0.42,
          strokeColor: "#C45F12",
          strokeWeight: 1.25,
          clickable: true,
          zIndex: 2,
        };
      }
      return {
        fillColor: "#94A3B8",
        fillOpacity: dark ? 0.18 : 0.12,
        strokeColor: dark ? "#e7dfd8" : "#334155",
        strokeOpacity: 0.85,
        strokeWeight: 0.9,
        clickable: true,
        zIndex: 1,
      };
    },
    [dark],
  );
  const styleCityRef = useRef(styleCityFeature);
  useEffect(() => {
    styleCityRef.current = styleCityFeature;
  }, [styleCityFeature]);

  function changeZoom(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (map.getZoom() ?? 6) + delta));
    map.setZoom(next);
  }

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

        const map = new google.maps.Map(mapEl.current, {
          center: FL_CENTER,
          zoom: 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: false,
          cameraControl: false,
          gestureHandling: "greedy",
          styles: mapStylesForTheme(),
          fullscreenControlOptions: {
            position: google.maps.ControlPosition.RIGHT_BOTTOM,
          },
        });
        mapRef.current = map;

        map.addListener("zoom_changed", () => {
          setZoom(map.getZoom() ?? 6);
        });

        map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (Date.now() - featureClickAtRef.current < 250) return;
          const stateCode = activeStateRef.current;
          if (!stateCode) {
            setMessage("Add a state to start selecting cities.");
            return;
          }
          if (resolvingRef.current) return;
          const lat = event.latLng?.lat();
          const lng = event.latLng?.lng();
          const authToken = tokenRef.current;
          if (lat == null || lng == null || !authToken) return;

          resolvingRef.current = true;
          setResolving(true);
          setMessage(null);
          void resolveServiceCityAt(authToken, lat, lng, stateCode)
            .then(({ city }) => {
              const added = handlersRef.current.onAddCity(city);
              setMessage(added ? null : "Already added.");
            })
            .catch((err) => {
              setMessage(
                err instanceof ApiError
                  ? err.message
                  : "Could not add that city.",
              );
            })
            .finally(() => {
              resolvingRef.current = false;
              setResolving(false);
            });
        });

        if (cancelled || !mapEl.current) return;
        resizeObserver.observe(mapEl.current);

        setStatus("ready");
        setZoom(map.getZoom() ?? 6);
        setMapGeneration((n) => n + 1);
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

    const resizeObserver = new ResizeObserver(() => {
      const map = mapRef.current;
      if (map) google.maps.event.trigger(map, "resize");
    });
    void loadMap();
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      layerRef.current?.setMap(null);
      layerRef.current = null;
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (status !== "ready") return;
    const syncTheme = () => {
      setDark(document.documentElement.dataset.theme === "dark");
      mapRef.current?.setOptions({ styles: mapStylesForTheme() });
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [status, mapGeneration]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    frameMap(map, activeState, citiesRef.current);
  }, [status, mapGeneration, activeState]);

  function ensureCityLayer(map: google.maps.Map): google.maps.Data {
    const existing = layerRef.current;
    if (existing) {
      existing.setMap(map);
      return existing;
    }
    const layer = new google.maps.Data({ map });
    layer.addListener("click", (event: google.maps.Data.MouseEvent) => {
      event.stop();
      featureClickAtRef.current = Date.now();
      const zone = zoneFromFeature(event.feature, activeStateRef.current);
      if (!zone.name || !zone.state) return;
      const existingCity = citiesRef.current.find((city) => cityInZone(city, zone));
      if (existingCity) {
        handlersRef.current.onRemoveCity(existingCity.placeId);
        setMessage(null);
        return;
      }
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      setResolving(true);
      setMessage(null);
      void handlersRef.current
        .onAddCityFromZone(zone)
        .catch((err) => {
          setMessage(
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Could not add that city.",
          );
        })
        .finally(() => {
          resolvingRef.current = false;
          setResolving(false);
        });
    });
    layerRef.current = layer;
    return layer;
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const readyMap = map;
    let cancelled = false;

    async function loadBoundaries() {
      if (!activeState || !token) {
        layerRef.current?.setMap(null);
        setBoundaries("idle");
        return;
      }
      setBoundaries("loading");
      try {
        const geojson = await getCityBoundaries(token, activeState);
        if (cancelled || mapRef.current !== readyMap) return;
        const layer = ensureCityLayer(readyMap);
        layer.forEach((feature) => layer.remove(feature));
        layer.addGeoJson(geojson as CityBoundaryCollection);
        layer.setStyle((feature) => styleCityRef.current(feature));
        const selected = citiesRef.current.filter(
          (city) => city.state === activeState,
        );
        if (selected.length > 0) {
          const box = new google.maps.LatLngBounds();
          let matched = false;
          for (const feature of geojson.features) {
            if (!selected.some((city) => cityInZone(city, feature.properties))) {
              continue;
            }
            extendBounds(box, feature.geometry.coordinates);
            matched = true;
          }
          if (matched && !box.isEmpty()) readyMap.fitBounds(box, 72);
        }
        setBoundaries("ready");
      } catch {
        if (cancelled || mapRef.current !== readyMap) return;
        layerRef.current?.setMap(null);
        setBoundaries("error");
      }
    }

    void loadBoundaries();
    return () => {
      cancelled = true;
    };
  }, [status, mapGeneration, activeState, token]);

  useEffect(() => {
    layerRef.current?.setStyle((feature) => styleCityRef.current(feature));
  }, [cities, dark, boundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    const showLabels = zoom >= LABEL_ZOOM;
    const showMarkers = boundaries !== "ready" || showLabels;
    if (!showMarkers) return;

    for (const city of cities) {
      if (city.lat == null || city.lng == null) continue;
      const marker = new google.maps.Marker({
        map,
        position: { lat: city.lat, lng: city.lng },
        title: `${city.city} — click to remove`,
        label: showLabels
          ? {
              text: city.city,
              color: dark ? "#f5f0eb" : "#1a1715",
              fontSize: "12px",
              fontWeight: "600",
            }
          : undefined,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: PIN_COLOR,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          labelOrigin: new google.maps.Point(0, -2.4),
        },
        zIndex: 3,
      });
      marker.addListener("click", (event: google.maps.MapMouseEvent) => {
        event.stop();
        featureClickAtRef.current = Date.now();
        handlersRef.current.onRemoveCity(city.placeId);
      });
      markersRef.current.push(marker);
    }
  }, [status, mapGeneration, cities, dark, zoom, boundaries]);

  const hint =
    boundaries === "ready"
      ? "Click a city area to add it. Click it again to remove it."
      : "Click the map to add the city at that spot. Click a pin to remove it.";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {states.length > 0 ? (
        <div
          className="flex shrink-0 flex-wrap gap-1.5"
          role="group"
          aria-label="State to select cities in"
        >
          {states.map((code) => {
            const selected = code === activeState;
            return (
              <button
                key={code}
                type="button"
                aria-pressed={selected}
                onClick={() => onActiveStateChange(code)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? "bg-brand-dark text-white"
                    : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {stateLabel(code)}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="shrink-0 text-xs text-neutral-400">
          Add a state to start selecting cities.
        </p>
      )}

      {error ? (
        <div className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error.includes("not configured") || error.includes("404")
            ? "Add a Maps JavaScript API key in Control Panel → API Services (or set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)."
            : error}
        </div>
      ) : null}

      <div className="relative min-h-[20rem] flex-1 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 sm:min-h-[24rem] xl:min-h-[32rem]">
        {status === "loading" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-neutral-500">
            Loading map…
          </div>
        ) : null}
        <div ref={mapEl} className="absolute inset-0" />
        {status === "ready" ? (
          <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-md border border-neutral-200 bg-white shadow-sm">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => changeZoom(1)}
              className="flex h-9 w-9 items-center justify-center text-neutral-700 hover:bg-neutral-50"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => changeZoom(-1)}
              className="flex h-9 w-9 items-center justify-center border-t border-neutral-200 text-neutral-700 hover:bg-neutral-50"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        {boundaries === "ready" ? (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex gap-3 rounded-md bg-white/90 px-2 py-1 text-[11px] text-neutral-600 shadow-sm">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#E87722]" />
              Selected
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-neutral-400 bg-[#94A3B8]/40" />
              Available
            </span>
          </div>
        ) : null}
        {boundaries === "loading" && status === "ready" ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-white/90 px-2 py-1 text-xs text-neutral-600 shadow-sm">
            Loading city areas…
          </div>
        ) : null}
      </div>

      {resolving ? (
        <p className="shrink-0 text-xs text-neutral-400">Looking up city…</p>
      ) : null}
      {boundaries === "error" ? (
        <p className="shrink-0 text-xs text-neutral-500">
          City areas could not be loaded. Click the map to add a city.
        </p>
      ) : null}
      {message ? <p className="shrink-0 text-xs text-neutral-500">{message}</p> : null}
      <p className="shrink-0 text-[11px] text-neutral-400">{hint}</p>
    </div>
  );
}
