/**
 * Selectable city zones for the technician territory map.
 * Each zone is a Census place (incorporated city or CDP) plus the share of
 * unclaimed land and coastal water nearest to it, so the zones tile the state.
 * Results are cached in memory per state.
 */
import { Delaunay } from "d3-delaunay";
import polygonClipping, {
  type MultiPolygon as ClipMultiPolygon,
  type Pair,
  type Polygon as ClipPolygon,
} from "polygon-clipping";
import { isUsStateCode } from "../constants/usStates";

const TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
const PLACES_QUERY = `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/4/query`;
const CDP_QUERY = `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/5/query`;
const STATES_QUERY = `${TIGERWEB}/State_County/MapServer/0/query`;
const UNAVAILABLE = "City boundaries are unavailable. Click the map to add a city.";
/** Boundary vertices per place used as extra Voronoi seeds, so gaps go to the nearest edge. */
const EDGE_SEEDS_PER_PLACE = 16;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PAGE_SIZE = 2000;
/** About 200m. Keeps city shapes recognizable without shipping raw TIGER rings. */
const SIMPLIFY_TOLERANCE = 0.002;

const STATE_FIPS: Record<string, string> = {
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
  DE: "10",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
};

export class CityBoundaryError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CityBoundaryError";
    this.status = status;
  }
}

export type CityBoundaryCollection = {
  type: "FeatureCollection";
  features: CityBoundaryFeature[];
};

export type CityZoneKind = "city" | "cdp";

export type CityBoundaryFeature = {
  type: "Feature";
  properties: {
    name: string;
    state: string;
    kind: CityZoneKind;
    geoid: string;
    lat: number | null;
    lng: number | null;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
};

type Position = [number, number];

type CensusCollection = {
  type?: string;
  features?: unknown[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
};

const cache = new Map<string, { at: number; geojson: CityBoundaryCollection }>();
const inflight = new Map<string, Promise<CityBoundaryCollection>>();

function roundCoord(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function asPosition(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = value[0];
  const lat = value[1];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function distSq(point: Position, start: Position, end: Position): number {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function closeRing(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/** Douglas–Peucker. Rings that collapse below 4 points are thinned instead. */
export function simplifyRing(points: Position[], tolerance = SIMPLIFY_TOLERANCE): Position[] {
  if (points.length <= 4) {
    return closeRing(points.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]));
  }

  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const [first, last] = next;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const dist = distSq(points[i]!, points[first]!, points[last]!);
      if (dist > maxDist) {
        index = i;
        maxDist = dist;
      }
    }
    if (index !== -1 && maxDist > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const simplified: Position[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (!keep[i]) continue;
    const point = points[i]!;
    simplified.push([roundCoord(point[0]), roundCoord(point[1])]);
  }

  if (simplified.length < 4) {
    const step = Math.max(1, Math.ceil((points.length - 1) / 40));
    const thinned: Position[] = [];
    for (let i = 0; i < points.length - 1; i += step) {
      const point = points[i]!;
      thinned.push([roundCoord(point[0]), roundCoord(point[1])]);
    }
    const last = points[points.length - 1]!;
    thinned.push([roundCoord(last[0]), roundCoord(last[1])]);
    return closeRing(thinned);
  }

  return closeRing(simplified);
}

function simplifyCoordinates(
  type: "Polygon" | "MultiPolygon",
  coordinates: unknown,
): number[][][] | number[][][][] | null {
  if (type === "Polygon") {
    if (!Array.isArray(coordinates)) return null;
    const rings = coordinates
      .map((ring) => {
        if (!Array.isArray(ring)) return null;
        const positions = ring
          .map(asPosition)
          .filter((position): position is Position => position !== null);
        if (positions.length < 4) return null;
        return simplifyRing(positions);
      })
      .filter((ring): ring is Position[] => ring !== null && ring.length >= 4);
    return rings.length > 0 ? rings : null;
  }

  if (!Array.isArray(coordinates)) return null;
  const polygons = coordinates
    .map((polygon) => {
      if (!Array.isArray(polygon)) return null;
      const rings = polygon
        .map((ring) => {
          if (!Array.isArray(ring)) return null;
          const positions = ring
            .map(asPosition)
            .filter((position): position is Position => position !== null);
          if (positions.length < 4) return null;
          return simplifyRing(positions);
        })
        .filter((ring): ring is Position[] => ring !== null && ring.length >= 4);
      return rings.length > 0 ? rings : null;
    })
    .filter((polygon): polygon is Position[][] => polygon !== null);
  return polygons.length > 0 ? polygons : null;
}

function cityName(properties: Record<string, unknown>): string {
  const basename = typeof properties.BASENAME === "string" ? properties.BASENAME.trim() : "";
  if (basename) return basename;
  const name = typeof properties.NAME === "string" ? properties.NAME.trim() : "";
  return name
    .replace(/\s+(city|town|village|borough|municipality|CDP)$/i, "")
    .trim();
}

function numberProp(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A Census place reduced to what the zone builder needs. */
export type PlaceShape = {
  name: string;
  kind: CityZoneKind;
  geoid: string;
  lat: number | null;
  lng: number | null;
  polygon: ClipMultiPolygon;
};

function toMultiPolygon(
  type: "Polygon" | "MultiPolygon",
  coordinates: number[][][] | number[][][][],
): ClipMultiPolygon {
  return (type === "Polygon" ? [coordinates] : coordinates) as ClipMultiPolygon;
}

/** Parse a Census GeoJSON payload into simplified place shapes. */
export function placesFromCensus(raw: CensusCollection, kind: CityZoneKind): PlaceShape[] {
  const places: PlaceShape[] = [];
  for (const entry of raw.features ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const feature = entry as {
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown } | null;
    };
    const properties = feature.properties ?? {};
    const name = cityName(properties);
    const geometry = feature.geometry;
    if (!name || !geometry) continue;
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") continue;
    const coordinates = simplifyCoordinates(geometry.type, geometry.coordinates);
    if (!coordinates) continue;
    places.push({
      name,
      kind,
      geoid: typeof properties.GEOID === "string" ? properties.GEOID.trim() : "",
      lat: numberProp(properties.INTPTLAT),
      lng: numberProp(properties.INTPTLON),
      polygon: toMultiPolygon(geometry.type, coordinates),
    });
  }
  return places;
}

function featureFor(
  state: string,
  place: Omit<PlaceShape, "polygon">,
  polygon: ClipMultiPolygon,
): CityBoundaryFeature | null {
  const coordinates = polygon
    .map((poly) =>
      poly
        .map((ring) => ring.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]))
        .filter((ring) => ring.length >= 4),
    )
    .filter((poly) => poly.length > 0);
  if (coordinates.length === 0) return null;
  return {
    type: "Feature",
    properties: {
      name: place.name,
      state,
      kind: place.kind,
      geoid: place.geoid,
      lat: place.lat,
      lng: place.lng,
    },
    geometry: { type: "MultiPolygon", coordinates },
  };
}

/** Turn a Census GeoJSON payload into the small feature collection the map draws. */
export function boundariesFromCensus(
  state: string,
  raw: CensusCollection,
): CityBoundaryCollection {
  const code = state.trim().toUpperCase();
  const features = placesFromCensus(raw, "city")
    .map((place) => featureFor(code, place, place.polygon))
    .filter((feature): feature is CityBoundaryFeature => feature !== null);
  return { type: "FeatureCollection", features };
}

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function bboxOf(geom: ClipMultiPolygon | ClipPolygon[]): BBox {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const poly of geom) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < box.minX) box.minX = x;
        if (y < box.minY) box.minY = y;
        if (x > box.maxX) box.maxX = x;
        if (y > box.maxY) box.maxY = y;
      }
    }
  }
  return box;
}

function bboxesTouch(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

type PlaceGroup = Omit<PlaceShape, "polygon"> & {
  own: ClipMultiPolygon;
  box: BBox;
  seeds: Pair[];
};

function groupPlaces(places: PlaceShape[]): PlaceGroup[] {
  const byName = new Map<string, PlaceShape[]>();
  for (const place of places) {
    const key = place.name.toLowerCase();
    const list = byName.get(key);
    if (list) list.push(place);
    else byName.set(key, [place]);
  }

  const groups: PlaceGroup[] = [];
  for (const list of byName.values()) {
    const lead = list.find((place) => place.kind === "city") ?? list[0]!;
    let own: ClipMultiPolygon = lead.polygon;
    if (list.length > 1) {
      try {
        const [first, ...rest] = list.map((place) => place.polygon);
        own = polygonClipping.union(first!, ...rest);
      } catch {
        own = list.flatMap((place) => place.polygon);
      }
    }
    if (own.length === 0) continue;

    const seeds: Pair[] = [];
    for (const place of list) {
      if (place.lat != null && place.lng != null) seeds.push([place.lng, place.lat]);
    }
    const vertices = own.flatMap((poly) => poly[0] ?? []);
    const step = Math.max(1, Math.floor(vertices.length / EDGE_SEEDS_PER_PLACE));
    for (let i = 0; i < vertices.length; i += step) seeds.push(vertices[i]!);

    groups.push({
      name: lead.name,
      kind: list.some((place) => place.kind === "city") ? "city" : "cdp",
      geoid: lead.geoid,
      lat: lead.lat,
      lng: lead.lng,
      own,
      box: bboxOf(own),
      seeds,
    });
  }
  return groups;
}

/**
 * Tile the state outline: each zone is its own place polygon plus the part of
 * its Voronoi region (nearest place seed) that no other place covers.
 */
export function buildCityZones(
  state: string,
  places: PlaceShape[],
  outline: ClipMultiPolygon,
): CityBoundaryCollection {
  const code = state.trim().toUpperCase();
  const groups = groupPlaces(places);
  if (groups.length === 0) return { type: "FeatureCollection", features: [] };

  const outlineBox = bboxOf(outline);
  const midLat = (outlineBox.minY + outlineBox.maxY) / 2;
  const scale = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const pad = 0.5;

  const points: number[] = [];
  const owners: number[] = [];
  groups.forEach((group, index) => {
    for (const [lng, lat] of group.seeds) {
      points.push(lng * scale, lat);
      owners.push(index);
    }
  });

  const voronoi = new Delaunay(Float64Array.from(points)).voronoi([
    (outlineBox.minX - pad) * scale,
    outlineBox.minY - pad,
    (outlineBox.maxX + pad) * scale,
    outlineBox.maxY + pad,
  ]);

  const cellsByGroup: ClipPolygon[][] = groups.map(() => []);
  for (let i = 0; i < owners.length; i += 1) {
    const cell = voronoi.cellPolygon(i);
    if (!cell || cell.length < 4) continue;
    const ring = cell.map(([x, y]) => [x / scale, y] as Pair);
    cellsByGroup[owners[i]!]!.push([ring]);
  }

  const features: CityBoundaryFeature[] = [];
  groups.forEach((group, index) => {
    let zone: ClipMultiPolygon = group.own;
    const cells = cellsByGroup[index]!;
    if (cells.length > 0) {
      try {
        const [firstCell, ...otherCells] = cells;
        const region = polygonClipping.intersection(
          polygonClipping.union(firstCell!, ...otherCells),
          outline,
        );
        if (region.length > 0) {
          const regionBox = bboxOf(region);
          const neighbors = groups
            .filter((other, otherIndex) => otherIndex !== index && bboxesTouch(other.box, regionBox))
            .map((other) => other.own);
          const share =
            neighbors.length > 0
              ? polygonClipping.difference(region, ...neighbors)
              : region;
          zone = polygonClipping.union(group.own, share);
        }
      } catch {
        zone = group.own;
      }
    }
    const feature = featureFor(code, group, zone);
    if (feature) features.push(feature);
  });

  return { type: "FeatureCollection", features };
}

async function fetchCensusPage(
  url: string,
  fips: string,
  outFields: string,
  offset: number,
): Promise<CensusCollection> {
  const params = new URLSearchParams({
    where: `STATE='${fips}'`,
    outFields,
    returnGeometry: "true",
    f: "geojson",
    outSR: "4326",
    geometryPrecision: "4",
    maxAllowableOffset: "0.003",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });

  let response: Response;
  try {
    response = await fetch(`${url}?${params.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new CityBoundaryError(503, UNAVAILABLE);
  }

  let data: CensusCollection;
  try {
    data = (await response.json()) as CensusCollection;
  } catch {
    throw new CityBoundaryError(503, UNAVAILABLE);
  }

  if (!response.ok || data.error) {
    throw new CityBoundaryError(503, UNAVAILABLE);
  }
  return data;
}

async function fetchCensusLayer(
  url: string,
  fips: string,
  outFields: string,
): Promise<CensusCollection> {
  const features: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const data = await fetchCensusPage(url, fips, outFields, offset);
    const batch = data.features ?? [];
    features.push(...batch);
    if (!data.exceededTransferLimit || batch.length === 0) break;
    offset += batch.length;
  }
  return { type: "FeatureCollection", features };
}

function outlineFromCensus(raw: CensusCollection): ClipMultiPolygon {
  return placesFromCensus(raw, "city").flatMap((shape) => shape.polygon);
}

const PLACE_FIELDS = "BASENAME,NAME,GEOID,INTPTLAT,INTPTLON";

async function loadState(state: string, fips: string): Promise<CityBoundaryCollection> {
  const [incorporated, cdps, outline] = await Promise.allSettled([
    fetchCensusLayer(PLACES_QUERY, fips, PLACE_FIELDS),
    fetchCensusLayer(CDP_QUERY, fips, PLACE_FIELDS),
    fetchCensusLayer(STATES_QUERY, fips, "NAME"),
  ]);
  if (incorporated.status !== "fulfilled") throw incorporated.reason;

  const cities = placesFromCensus(incorporated.value, "city");
  if (cities.length === 0) throw new CityBoundaryError(503, UNAVAILABLE);

  const outlinePolygon =
    outline.status === "fulfilled" ? outlineFromCensus(outline.value) : [];
  if (cdps.status === "fulfilled" && outlinePolygon.length > 0) {
    const zones = buildCityZones(
      state,
      [...cities, ...placesFromCensus(cdps.value, "cdp")],
      outlinePolygon,
    );
    if (zones.features.length > 0) return zones;
  }

  const fallback = boundariesFromCensus(state, incorporated.value);
  if (fallback.features.length === 0) throw new CityBoundaryError(503, UNAVAILABLE);
  return fallback;
}

export async function cityBoundariesForState(
  state: string,
): Promise<CityBoundaryCollection> {
  const code = state.trim().toUpperCase();
  if (!isUsStateCode(code) || !STATE_FIPS[code]) {
    throw new CityBoundaryError(400, "state must be a US state code");
  }

  const cached = cache.get(code);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.geojson;

  const pending = inflight.get(code);
  if (pending) return pending;

  const job = loadState(code, STATE_FIPS[code]!)
    .then((geojson) => {
      cache.set(code, { at: Date.now(), geojson });
      return geojson;
    })
    .finally(() => {
      inflight.delete(code);
    });
  inflight.set(code, job);
  return job;
}
