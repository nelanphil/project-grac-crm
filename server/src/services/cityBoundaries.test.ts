import assert from "node:assert/strict";
import { describe, it } from "node:test";
import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import {
  boundariesFromCensus,
  buildCityZones,
  simplifyRing,
  type PlaceShape,
} from "./cityBoundaries";

function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return Math.abs(sum) / 2;
}

function area(geom: MultiPolygon): number {
  let total = 0;
  for (const poly of geom) {
    poly.forEach((ring, index) => {
      total += (index === 0 ? 1 : -1) * ringArea(ring);
    });
  }
  return total;
}

function square(x: number, y: number, size: number): MultiPolygon {
  return [
    [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  ];
}

describe("simplifyRing", () => {
  it("keeps a closed ring and drops points on a straight line", () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 2],
      [0, 2],
      [0, 0],
    ];
    const simplified = simplifyRing(ring, 0.01);
    assert.deepEqual(simplified[0], simplified[simplified.length - 1]);
    assert.ok(simplified.length < ring.length);
    assert.ok(simplified.length >= 4);
  });
});

describe("boundariesFromCensus", () => {
  it("uses the place basename and keeps a polygon", () => {
    const geojson = boundariesFromCensus("fl", {
      features: [
        {
          properties: {
            BASENAME: "New Smyrna Beach",
            NAME: "New Smyrna Beach city",
            GEOID: "1248625",
            INTPTLAT: "+29.0200",
            INTPTLON: "-080.9600",
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-81.05, 29.05],
                [-81.04, 28.97],
                [-80.95, 28.98],
                [-80.96, 29.02],
                [-81.05, 29.05],
              ],
            ],
          },
        },
        {
          properties: { NAME: "" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });

    assert.equal(geojson.features.length, 1);
    assert.deepEqual(geojson.features[0]?.properties, {
      name: "New Smyrna Beach",
      state: "FL",
      kind: "city",
      geoid: "1248625",
      lat: 29.02,
      lng: -80.96,
    });
  });
});

describe("buildCityZones", () => {
  it("tiles the state outline with no gaps or overlaps", () => {
    const outline = square(0, 0, 10);
    const places: PlaceShape[] = [
      {
        name: "West",
        kind: "city",
        geoid: "1",
        lat: 5,
        lng: 2,
        polygon: square(1, 4, 2),
      },
      {
        name: "East",
        kind: "cdp",
        geoid: "2",
        lat: 5,
        lng: 8,
        polygon: square(7, 4, 2),
      },
    ];

    const zones = buildCityZones("FL", places, outline).features.map(
      (feature) => feature.geometry.coordinates as unknown as MultiPolygon,
    );
    assert.equal(zones.length, 2);
    const [west, east] = zones as [MultiPolygon, MultiPolygon];

    const covered = polygonClipping.union(west, east);
    assert.ok(Math.abs(area(covered) - area(outline)) < 1e-6);
    assert.ok(area(polygonClipping.intersection(west, east)) < 1e-6);
    assert.ok(area(polygonClipping.difference(places[0]!.polygon, west)) < 1e-6);
    assert.ok(area(polygonClipping.difference(places[1]!.polygon, east)) < 1e-6);
  });
});
