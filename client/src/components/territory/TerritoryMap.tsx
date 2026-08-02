"use client";

import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { ApiError, getGoogleMapsBrowserKey, TerritoryOwner } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const FL_CENTER = { lat: 27.8, lng: -81.7 };
/** In ZIP mode, only load ZIP polygons once the user is zoomed in enough. */
const ZIP_ZOOM_THRESHOLD = 8;

type SelectMode = "county" | "zip";

function slugCounty(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "-");
}

export type TerritoryMapProps = {
  counties: string[];
  zips: string[];
  otherOwners: TerritoryOwner[];
  onToggleCounty: (county: string) => void;
  onToggleZip: (zip: string) => void;
  disabled?: boolean;
};

export default function TerritoryMap({
  counties,
  zips,
  otherOwners,
  onToggleCounty,
  onToggleZip,
  disabled = false,
}: TerritoryMapProps) {
  const token = useAuthStore((s) => s.token);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const countyLayerRef = useRef<google.maps.Data | null>(null);
  const zipLayersRef = useRef<Map<string, google.maps.Data>>(new Map());
  const loadedZipCountiesRef = useRef<Set<string>>(new Set());
  const selectionRef = useRef({ counties, zips, disabled });
  const modeRef = useRef<SelectMode>("county");
  const claimsRef = useRef({
    counties: new Map<string, string>(),
    zips: new Map<string, string>(),
  });
  const handlersRef = useRef({ onToggleCounty, onToggleZip });

  const [selectMode, setSelectMode] = useState<SelectMode>("county");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [zoom, setZoom] = useState(6);

  useEffect(() => {
    selectionRef.current = { counties, zips, disabled };
    modeRef.current = selectMode;
    handlersRef.current = { onToggleCounty, onToggleZip };

    const claimedCounties = new Map<string, string>();
    const claimedZips = new Map<string, string>();
    for (const owner of otherOwners) {
      const label =
        `${owner.first_name} ${owner.last_name}`.trim() || owner.email;
      for (const c of owner.territories.counties ?? []) {
        claimedCounties.set(c, label);
      }
      for (const z of owner.territories.zips ?? []) {
        claimedZips.set(z, label);
      }
    }
    claimsRef.current = { counties: claimedCounties, zips: claimedZips };
  });

  function styleCountyFeature(
    feature: google.maps.Data.Feature,
  ): google.maps.Data.StyleOptions {
    const name = String(feature.getProperty("name") ?? "");
    const selected = selectionRef.current.counties.includes(name);
    const claimedBy = claimsRef.current.counties.get(name);
    const countyMode = modeRef.current === "county";
    const clickable = countyMode && !selectionRef.current.disabled;

    if (selected) {
      return {
        fillColor: "#E87722",
        fillOpacity: countyMode ? 0.45 : 0.22,
        strokeColor: "#C45F12",
        strokeWeight: 1.5,
        clickable,
        zIndex: 2,
      };
    }
    if (claimedBy) {
      return {
        fillColor: "#6B7280",
        fillOpacity: countyMode ? 0.35 : 0.12,
        strokeColor: "#4B5563",
        strokeWeight: 1,
        clickable,
        zIndex: 1,
      };
    }
    return {
      fillColor: "#94A3B8",
      fillOpacity: countyMode ? 0.12 : 0.04,
      strokeColor: "#64748B",
      strokeWeight: 1,
      clickable,
      zIndex: 1,
    };
  }

  function styleZipFeature(
    feature: google.maps.Data.Feature,
  ): google.maps.Data.StyleOptions {
    const zip = String(feature.getProperty("zip") ?? "");
    const selected = selectionRef.current.zips.includes(zip);
    const claimedBy = claimsRef.current.zips.get(zip);
    const zipMode = modeRef.current === "zip";
    const clickable = zipMode && !selectionRef.current.disabled;

    if (selected) {
      return {
        fillColor: "#0EA5E9",
        fillOpacity: 0.35,
        strokeColor: "#0369A1",
        strokeWeight: 1,
        strokeOpacity: 0.9,
        clickable,
        zIndex: 4,
      };
    }
    if (claimedBy) {
      return {
        fillColor: "#9CA3AF",
        fillOpacity: 0.22,
        strokeColor: "#6B7280",
        strokeWeight: 0.75,
        strokeOpacity: 0.7,
        clickable,
        zIndex: 3,
      };
    }
    return {
      fillColor: "#38BDF8",
      fillOpacity: 0.1,
      strokeColor: "#0284C7",
      strokeWeight: 0.6,
      strokeOpacity: 0.65,
      clickable,
      zIndex: 3,
    };
  }

  function refreshStyles() {
    countyLayerRef.current?.setStyle((f) => styleCountyFeature(f));
    for (const layer of zipLayersRef.current.values()) {
      layer.setStyle((f) => styleZipFeature(f));
    }
  }

  function clearZipLayers() {
    for (const [county, layer] of zipLayersRef.current) {
      layer.setMap(null);
      zipLayersRef.current.delete(county);
      loadedZipCountiesRef.current.delete(county);
    }
  }

  async function ensureZipLayer(county: string) {
    if (!mapRef.current || loadedZipCountiesRef.current.has(county)) return;
    loadedZipCountiesRef.current.add(county);
    try {
      const res = await fetch(
        `/geo/fl-zctas-by-county/${slugCounty(county)}.json`,
      );
      if (!res.ok) return;
      const geo = await res.json();
      const layer = new google.maps.Data();
      // Only attach if still in ZIP mode (mode may have switched mid-fetch).
      if (modeRef.current === "zip") {
        layer.setMap(mapRef.current);
      }
      layer.addGeoJson(geo);
      layer.setStyle((f) => styleZipFeature(f));
      layer.addListener("click", (e: google.maps.Data.MouseEvent) => {
        if (selectionRef.current.disabled || modeRef.current !== "zip") return;
        const zip = String(e.feature.getProperty("zip") ?? "");
        if (!zip) return;
        const claimedBy = claimsRef.current.zips.get(zip);
        if (claimedBy && !selectionRef.current.zips.includes(zip)) {
          setHint(`ZIP ${zip} is claimed by ${claimedBy}.`);
          return;
        }
        setHint(null);
        handlersRef.current.onToggleZip(zip);
      });
      zipLayersRef.current.set(county, layer);
    } catch {
      loadedZipCountiesRef.current.delete(county);
    }
  }

  function countyIntersectsBounds(
    feature: google.maps.Data.Feature,
    bounds: google.maps.LatLngBounds,
  ): boolean {
    const minLng = Number(feature.getProperty("minLng"));
    const minLat = Number(feature.getProperty("minLat"));
    const maxLng = Number(feature.getProperty("maxLng"));
    const maxLat = Number(feature.getProperty("maxLat"));
    if (
      Number.isFinite(minLng) &&
      Number.isFinite(minLat) &&
      Number.isFinite(maxLng) &&
      Number.isFinite(maxLat)
    ) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      return !(
        maxLng < sw.lng() ||
        minLng > ne.lng() ||
        maxLat < sw.lat() ||
        minLat > ne.lat()
      );
    }

    const geomBounds = new google.maps.LatLngBounds();
    let hasPoint = false;
    feature.getGeometry()?.forEachLatLng((ll) => {
      geomBounds.extend(ll);
      hasPoint = true;
    });
    return hasPoint && bounds.intersects(geomBounds);
  }

  async function syncZipLayers(currentZoom: number) {
    const map = mapRef.current;
    if (!map) return;

    if (modeRef.current !== "zip" || currentZoom < ZIP_ZOOM_THRESHOLD) {
      clearZipLayers();
      return;
    }

    const bounds = map.getBounds();
    if (!bounds || !countyLayerRef.current) return;

    const toLoad = new Set<string>(selectionRef.current.counties);
    countyLayerRef.current.forEach((feature) => {
      const name = String(feature.getProperty("name") ?? "");
      if (!name || toLoad.has(name)) return;
      if (countyIntersectsBounds(feature, bounds)) toLoad.add(name);
    });

    await Promise.all([...toLoad].map((c) => ensureZipLayer(c)));

    for (const [county, layer] of zipLayersRef.current) {
      layer.setMap(
        toLoad.has(county) && modeRef.current === "zip" ? map : null,
      );
    }
  }

  useEffect(() => {
    if (!token || !mapEl.current) return;
    let cancelled = false;

    async function init() {
      setStatus("loading");
      setError(null);
      try {
        let apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "";
        try {
          const res = await getGoogleMapsBrowserKey(token!);
          apiKey = res.apiKey || apiKey;
        } catch (err) {
          if (!apiKey) {
            throw err instanceof ApiError
              ? err
              : new Error("Maps API key not available.");
          }
        }

        setOptions({ key: apiKey, v: "weekly" });
        const { Map } = await importLibrary("maps");
        if (cancelled || !mapEl.current) return;

        const map = new Map(mapEl.current, {
          center: FL_CENTER,
          zoom: 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: "greedy",
        });
        mapRef.current = map;

        const countyLayer = new google.maps.Data({ map });
        countyLayerRef.current = countyLayer;
        const countiesGeo = await fetch("/geo/fl-counties.json").then((r) =>
          r.json(),
        );
        if (cancelled) return;
        countyLayer.addGeoJson(countiesGeo);
        countyLayer.setStyle((f) => styleCountyFeature(f));

        countyLayer.addListener("click", (e: google.maps.Data.MouseEvent) => {
          if (selectionRef.current.disabled || modeRef.current !== "county") {
            return;
          }
          const name = String(e.feature.getProperty("name") ?? "");
          if (!name) return;
          const claimedBy = claimsRef.current.counties.get(name);
          if (claimedBy && !selectionRef.current.counties.includes(name)) {
            setHint(`${name} County is claimed by ${claimedBy}.`);
            return;
          }
          setHint(null);
          handlersRef.current.onToggleCounty(name);
        });

        map.addListener("zoom_changed", () => {
          const z = map.getZoom() ?? 6;
          setZoom(z);
          void syncZipLayers(z);
        });
        map.addListener("idle", () => {
          void syncZipLayers(map.getZoom() ?? 6);
        });

        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load Google Maps.",
        );
      }
    }

    void init();

    return () => {
      cancelled = true;
      clearZipLayers();
      countyLayerRef.current?.setMap(null);
      countyLayerRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once per token
  }, [token]);

  useEffect(() => {
    refreshStyles();
    void syncZipLayers(zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counties, zips, otherOwners, disabled, zoom, selectMode]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-brand-dark">Territory map</p>
          <p className="text-xs text-neutral-500">
            {selectMode === "county"
              ? "County mode: click a county to add or remove it."
              : "ZIP mode: zoom in, then click a ZIP to add or remove a carve-out."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-neutral-300 p-0.5 bg-white">
            <button
              type="button"
              onClick={() => {
                setSelectMode("county");
                setHint(null);
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                selectMode === "county"
                  ? "bg-brand-dark text-white"
                  : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              Counties
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectMode("zip");
                setHint(null);
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                selectMode === "zip"
                  ? "bg-brand-dark text-white"
                  : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              ZIP codes
            </button>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-neutral-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#E87722]" />
              Selected county
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0EA5E9]" />
              Selected ZIP
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#6B7280]" />
              Claimed by other
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error.includes("not configured") || error.includes("404")
            ? "Add a Maps JavaScript API key in Control Panel → Google credentials (or set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)."
            : error}
        </div>
      ) : null}

      {hint ? (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          {hint}
        </div>
      ) : null}

      {selectMode === "zip" && zoom < ZIP_ZOOM_THRESHOLD ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Zoom in to load and select ZIP code boundaries.
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
        {status === "loading" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 text-sm text-neutral-500">
            Loading map…
          </div>
        ) : null}
        <div ref={mapEl} className="h-[360px] w-full sm:h-[420px]" />
      </div>
    </div>
  );
}
