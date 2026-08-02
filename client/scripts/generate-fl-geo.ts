/**
 * Generate Florida county + ZCTA GeoJSON assets for the Territory map.
 *
 * Run from client/: npx tsx scripts/generate-fl-geo.ts
 */
import fs from "fs";
import path from "path";

const OUT_DIR = path.resolve(__dirname, "../public/geo");
const COUNTY_BY_DIR = path.join(OUT_DIR, "fl-zctas-by-county");

const COUNTIES_URL =
  "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";
const ZIPS_URL =
  "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/fl_florida_zip_codes_geo.min.json";

import { FLORIDA_ZIP_COUNTIES } from "../../server/src/constants/floridaZipCounties";
import { FLORIDA_COUNTIES } from "../src/lib/floridaCounties";

type Position = [number, number];
type Geometry = {
  type: string;
  coordinates: unknown;
};

type Feature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown>;
  geometry: Geometry | null;
};

type BBox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

function roundCoord(n: number, places = 5): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Light Douglas–Peucker–style thinning that keeps ring integrity. */
function simplifyRing(ring: Position[], tolerance: number): Position[] {
  if (ring.length <= 4) {
    return ring.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]);
  }

  const sqTol = tolerance * tolerance;

  function distSq(p: Position, a: Position, b: Position): number {
    let x = a[0];
    let y = a[1];
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b[0];
        y = b[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  }

  function simplifySection(
    points: Position[],
    first: number,
    last: number,
    keep: boolean[],
  ): void {
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = distSq(points[i]!, points[first]!, points[last]!);
      if (d > maxDist) {
        index = i;
        maxDist = d;
      }
    }
    if (maxDist > sqTol && index > 0) {
      keep[index] = true;
      simplifySection(points, first, index, keep);
      simplifySection(points, index, last, keep);
    }
  }

  // Drop closing duplicate for processing
  const closed =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1];
  const pts = closed ? ring.slice(0, -1) : ring.slice();
  if (pts.length < 3) {
    return ring.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]);
  }

  const keep = pts.map(() => false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  simplifySection(pts, 0, pts.length - 1, keep);

  const out: Position[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (keep[i]) {
      out.push([roundCoord(pts[i]![0]), roundCoord(pts[i]![1])]);
    }
  }
  if (out.length < 3) {
    return ring.map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]);
  }
  out.push([...out[0]!]);
  return out;
}

function simplifyCoords(coords: unknown, tolerance: number): unknown {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number") {
    return [
      roundCoord(coords[0] as number),
      roundCoord(coords[1] as number),
    ];
  }
  if (
    Array.isArray(coords[0]) &&
    typeof (coords[0] as unknown[])[0] === "number"
  ) {
    return simplifyRing(coords as Position[], tolerance);
  }
  return (coords as unknown[]).map((c) => simplifyCoords(c, tolerance));
}

function simplifyFeature(f: Feature, tolerance: number): Feature {
  if (!f.geometry) return f;
  return {
    type: "Feature",
    properties: f.properties,
    geometry: {
      type: f.geometry.type,
      coordinates: simplifyCoords(f.geometry.coordinates, tolerance),
    },
  };
}

function expandBBox(bbox: BBox | null, lng: number, lat: number): BBox {
  if (!bbox) {
    return { minLng: lng, minLat: lat, maxLng: lng, maxLat: lat };
  }
  return {
    minLng: Math.min(bbox.minLng, lng),
    minLat: Math.min(bbox.minLat, lat),
    maxLng: Math.max(bbox.maxLng, lng),
    maxLat: Math.max(bbox.maxLat, lat),
  };
}

function bboxFromCoords(coords: unknown, bbox: BBox | null = null): BBox | null {
  if (!Array.isArray(coords)) return bbox;
  if (typeof coords[0] === "number") {
    return expandBBox(bbox, coords[0] as number, coords[1] as number);
  }
  let next = bbox;
  for (const c of coords as unknown[]) {
    next = bboxFromCoords(c, next);
  }
  return next;
}

function pointInRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(
  lng: number,
  lat: number,
  geometry: Geometry | null,
): boolean {
  if (!geometry) return false;
  const coords = geometry.coordinates;
  if (geometry.type === "Polygon") {
    const rings = coords as Position[][];
    if (!rings[0] || !pointInRing(lng, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i += 1) {
      if (pointInRing(lng, lat, rings[i]!)) return false;
    }
    return true;
  }
  if (geometry.type === "MultiPolygon") {
    for (const poly of coords as Position[][][]) {
      if (!poly[0] || !pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i += 1) {
        if (pointInRing(lng, lat, poly[i]!)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

function slugCounty(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "-");
}

function centroidFromProps(f: Feature): Position | null {
  const latRaw = f.properties.INTPTLAT10 ?? f.properties.INTPTLAT20;
  const lngRaw = f.properties.INTPTLON10 ?? f.properties.INTPTLON20;
  if (typeof latRaw === "string" || typeof latRaw === "number") {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
  }
  const bbox = bboxFromCoords(f.geometry?.coordinates);
  if (!bbox) return null;
  return [(bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2];
}

async function main() {
  fs.mkdirSync(COUNTY_BY_DIR, { recursive: true });

  console.log("Downloading counties…");
  const countiesRes = await fetch(COUNTIES_URL);
  if (!countiesRes.ok) throw new Error(`Counties fetch failed: ${countiesRes.status}`);
  const countiesAll = (await countiesRes.json()) as { features: Feature[] };

  const rawCountyFeatures = countiesAll.features.filter((f) =>
    String(f.id ?? "").startsWith("12"),
  );

  const countyFeatures = rawCountyFeatures
    .map((f) => {
      const name = String(f.properties.NAME ?? "");
      const bbox = bboxFromCoords(f.geometry?.coordinates);
      return simplifyFeature(
        {
          type: "Feature",
          properties: {
            name,
            kind: "county",
            ...(bbox
              ? {
                  minLng: roundCoord(bbox.minLng, 4),
                  minLat: roundCoord(bbox.minLat, 4),
                  maxLng: roundCoord(bbox.maxLng, 4),
                  maxLat: roundCoord(bbox.maxLat, 4),
                }
              : {}),
          },
          geometry: f.geometry,
        },
        0.003,
      );
    })
    .filter((f) =>
      (FLORIDA_COUNTIES as readonly string[]).includes(
        String(f.properties.name),
      ),
    );

  // Unsimplified counties for point-in-polygon ZIP assignment.
  const countyLookup = rawCountyFeatures
    .map((f) => ({
      name: String(f.properties.NAME ?? ""),
      geometry: f.geometry,
      bbox: bboxFromCoords(f.geometry?.coordinates),
    }))
    .filter((c) =>
      (FLORIDA_COUNTIES as readonly string[]).includes(c.name),
    );

  fs.writeFileSync(
    path.join(OUT_DIR, "fl-counties.json"),
    JSON.stringify({ type: "FeatureCollection", features: countyFeatures }),
  );
  console.log(`Wrote fl-counties.json (${countyFeatures.length} counties)`);

  console.log("Downloading ZCTAs (large)…");
  const zipsRes = await fetch(ZIPS_URL);
  if (!zipsRes.ok) throw new Error(`Zips fetch failed: ${zipsRes.status}`);
  const zipsAll = (await zipsRes.json()) as { features: Feature[] };

  const byCounty = new Map<string, Feature[]>();
  const index: Record<string, string> = {};
  let mappedByTable = 0;
  let mappedByGeom = 0;
  let skipped = 0;

  for (const f of zipsAll.features) {
    const zip = String(
      f.properties.ZCTA5CE10 ?? f.properties.ZCTA5CE20 ?? "",
    ).padStart(5, "0");
    if (!/^\d{5}$/.test(zip)) {
      skipped += 1;
      continue;
    }

    let county = FLORIDA_ZIP_COUNTIES[zip] ?? "";
    if (county) {
      mappedByTable += 1;
    } else {
      const centroid = centroidFromProps(f);
      if (centroid) {
        const [lng, lat] = centroid;
        for (const c of countyLookup) {
          if (
            c.bbox &&
            (lng < c.bbox.minLng ||
              lng > c.bbox.maxLng ||
              lat < c.bbox.minLat ||
              lat > c.bbox.maxLat)
          ) {
            continue;
          }
          if (pointInGeometry(lng, lat, c.geometry)) {
            county = c.name;
            mappedByGeom += 1;
            break;
          }
        }
      }
    }

    if (!county) {
      skipped += 1;
      continue;
    }

    index[zip] = county;
    const feature = simplifyFeature(
      {
        type: "Feature",
        properties: { zip, county, kind: "zip" },
        geometry: f.geometry,
      },
      0.0015,
    );
    const list = byCounty.get(county) ?? [];
    list.push(feature);
    byCounty.set(county, list);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "fl-zcta-index.json"),
    JSON.stringify(index),
  );
  console.log(
    `Wrote fl-zcta-index.json (${Object.keys(index).length} zips; table=${mappedByTable}, geom=${mappedByGeom}, skipped=${skipped})`,
  );

  for (const file of fs.readdirSync(COUNTY_BY_DIR)) {
    fs.unlinkSync(path.join(COUNTY_BY_DIR, file));
  }

  for (const county of FLORIDA_COUNTIES) {
    const features = byCounty.get(county) ?? [];
    fs.writeFileSync(
      path.join(COUNTY_BY_DIR, `${slugCounty(county)}.json`),
      JSON.stringify({ type: "FeatureCollection", features }),
    );
  }
  console.log(
    `Wrote fl-zctas-by-county/ for ${FLORIDA_COUNTIES.length} counties`,
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
