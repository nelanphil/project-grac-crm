import type {
  CityBoundaryCollection,
  ServiceCity,
  WorkOrderListItem,
} from "@/lib/api";

type CityZoneMatch = { name: string; state: string; geoid: string };

export function cityMatchesZone(city: ServiceCity, zone: CityZoneMatch): boolean {
  if (zone.geoid && city.placeId === `census:${zone.geoid}`) return true;
  return (
    city.state.trim().toLowerCase() === zone.state.trim().toLowerCase() &&
    city.city.trim().toLowerCase() === zone.name.trim().toLowerCase()
  );
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const start = ring[i];
    const end = ring[j];
    if (!start || !end) continue;
    const xi = start[0];
    const yi = start[1];
    const xj = end[0];
    const yj = end[1];
    if (xi == null || yi == null || xj == null || yj == null) continue;
    const crosses = yi > lat !== yj > lat;
    if (!crosses || yj === yi) continue;
    const xAtLat = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lng < xAtLat) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  const outer = rings[0];
  if (!outer || !pointInRing(lng, lat, outer)) return false;
  for (let i = 1; i < rings.length; i += 1) {
    const hole = rings[i];
    if (hole && pointInRing(lng, lat, hole)) return false;
  }
  return true;
}

function geometryContains(
  geometry: CityBoundaryCollection["features"][number]["geometry"],
  lng: number,
  lat: number,
): boolean {
  if (geometry.type === "Polygon") {
    return pointInPolygon(lng, lat, geometry.coordinates as number[][][]);
  }
  return (geometry.coordinates as number[][][][]).some((polygon) =>
    pointInPolygon(lng, lat, polygon),
  );
}

function jobPlace(job: WorkOrderListItem): { city: string; state: string } {
  return {
    city: (job.address?.city || job.customerCity || "").trim(),
    state: (job.address?.state || job.customerState || "").trim(),
  };
}

export function territoryPlaceLabel(job: WorkOrderListItem): string {
  const { city, state } = jobPlace(job);
  return [city, state].filter(Boolean).join(", ");
}

/** True when the technician has service cities and this job sits outside them. */
export function jobOutsideServiceCities(
  job: WorkOrderListItem,
  cities: ServiceCity[],
  features: CityBoundaryCollection["features"],
): boolean {
  if (cities.length === 0) return false;
  const relevant = features.filter((feature) =>
    cities.some((city) => cityMatchesZone(city, feature.properties)),
  );
  const lat = job.address?.lat;
  const lng = job.address?.lng;
  if (
    relevant.length > 0 &&
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  ) {
    return !relevant.some((feature) =>
      geometryContains(feature.geometry, lng, lat),
    );
  }
  const { city, state } = jobPlace(job);
  if (!city || !state) return false;
  const cityKey = city.toLowerCase();
  const stateKey = state.toLowerCase();
  return !cities.some(
    (entry) =>
      entry.city.trim().toLowerCase() === cityKey &&
      entry.state.trim().toLowerCase() === stateKey,
  );
}
