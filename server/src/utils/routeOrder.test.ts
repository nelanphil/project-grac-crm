import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  limitRouteJobs,
  MAX_ROUTE_JOBS,
  metricCost,
  optimizeAroundLocks,
  optimizeJobOrder,
} from "./routeOrder";

const UNIQUE = [
  [0, 10, 1, 10],
  [10, 0, 10, 1],
  [10, 1, 0, 10],
  [1, 10, 10, 0],
];

function pathCost(cost: number[][], path: number[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    total += cost[path[i]!]![path[i + 1]!]!;
  }
  return total;
}

describe("metricCost", () => {
  const leg = { durationMinutes: 12, distanceMeters: 3400 };

  it("uses minutes for shortest time", () => {
    assert.equal(metricCost(leg, "time"), 12);
  });

  it("uses meters for shortest distance", () => {
    assert.equal(metricCost(leg, "distance"), 3400);
  });
});

describe("optimizeJobOrder", () => {
  it("returns an empty route when there are no jobs", () => {
    assert.deepEqual(
      optimizeJobOrder({ cost: [[0]], jobCount: 0, roundTrip: true }),
      [],
    );
  });

  it("keeps a single job in place", () => {
    const cost = [
      [0, 4],
      [4, 0],
    ];
    assert.deepEqual(
      optimizeJobOrder({ cost, jobCount: 1, roundTrip: true }),
      [1],
    );
    assert.deepEqual(
      optimizeJobOrder({ cost, jobCount: 1, roundTrip: false }),
      [1],
    );
  });

  it("reorders a round trip for the unique shortest loop", () => {
    assert.deepEqual(
      optimizeJobOrder({ cost: UNIQUE, jobCount: 3, roundTrip: true }),
      [2, 1, 3],
    );
    assert.equal(pathCost(UNIQUE, [0, 2, 1, 3, 0]), 4);
  });

  it("keeps the last job fixed on a one-way route", () => {
    assert.deepEqual(
      optimizeJobOrder({ cost: UNIQUE, jobCount: 3, roundTrip: false }),
      [2, 1, 3],
    );
    assert.equal(
      optimizeJobOrder({
        cost: UNIQUE,
        jobCount: 3,
        roundTrip: false,
      }).at(-1),
      3,
    );
  });

  it("chooses a different order for time than for distance", () => {
    const time = [
      [0, 9, 2],
      [4, 0, 1],
      [8, 3, 0],
    ];
    const distance = [
      [0, 2, 9],
      [8, 0, 3],
      [4, 1, 0],
    ];
    assert.deepEqual(
      optimizeJobOrder({ cost: time, jobCount: 2, roundTrip: true }),
      [2, 1],
    );
    assert.deepEqual(
      optimizeJobOrder({ cost: distance, jobCount: 2, roundTrip: true }),
      [1, 2],
    );
  });

  it("uses the heuristic past 12 stops and still locks a one-way end", () => {
    const positions = [0, 13, 1, 12, 2, 11, 3, 10, 4, 9, 5, 8, 6, 7];
    const cost = positions.map((from) =>
      positions.map((to) => Math.abs(from - to)),
    );
    const round = optimizeJobOrder({ cost, jobCount: 13, roundTrip: true });
    assert.deepEqual(round, [2, 4, 6, 8, 10, 12, 13, 11, 9, 7, 5, 3, 1]);
    assert.equal(pathCost(cost, [0, ...round, 0]), 26);

    const oneWay = optimizeJobOrder({ cost, jobCount: 13, roundTrip: false });
    assert.equal(oneWay.length, 13);
    assert.equal(new Set(oneWay).size, 13);
    assert.equal(oneWay.at(-1), 13);
    assert.equal(pathCost(cost, [0, ...oneWay]), 19);
  });
});

describe("optimizeAroundLocks", () => {
  const drive = [
    [0, 10, 10, 10],
    [10, 0, 10, 50],
    [10, 10, 0, 10],
    [10, 50, 10, 0],
  ];

  it("keeps a locked stop and fits the others before it", () => {
    const order = optimizeAroundLocks({
      cost: drive,
      driveMinutes: drive,
      serviceMinutes: [0, 30, 30, 30],
      lockedOffsetMinutes: [null, null, 200, null],
      roundTrip: true,
    });
    assert.deepEqual(order.slice().sort(), [1, 2, 3]);
    assert.equal(order.at(-1), 2);
  });

  it("moves a stop that cannot finish before the locked time", () => {
    const order = optimizeAroundLocks({
      cost: drive,
      driveMinutes: drive,
      serviceMinutes: [0, 500, 30, 20],
      lockedOffsetMinutes: [null, null, 60, null],
      roundTrip: false,
    });
    assert.deepEqual(order, [3, 2, 1]);
  });

  it("keeps locked stops in desired-time order", () => {
    const order = optimizeAroundLocks({
      cost: drive,
      driveMinutes: drive,
      serviceMinutes: [0, 30, 30, 15],
      lockedOffsetMinutes: [null, 300, 80, null],
      roundTrip: true,
    });
    assert.deepEqual(order, [3, 2, 1]);
    assert.ok(order.indexOf(2) < order.indexOf(1));
  });

  it("matches an unlocked route when nothing is locked", () => {
    assert.deepEqual(
      optimizeAroundLocks({
        cost: UNIQUE,
        driveMinutes: UNIQUE,
        serviceMinutes: [0, 30, 30, 30],
        lockedOffsetMinutes: [null, null, null, null],
        roundTrip: true,
      }),
      optimizeJobOrder({ cost: UNIQUE, jobCount: 3, roundTrip: true }),
    );
  });
});

describe("limitRouteJobs", () => {
  it("keeps a short list intact", () => {
    const result = limitRouteJobs([1, 2, 3]);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.jobs, [1, 2, 3]);
  });

  it("caps the list at the routing limit", () => {
    const jobs = Array.from({ length: MAX_ROUTE_JOBS + 1 }, (_, index) => index);
    const result = limitRouteJobs(jobs);
    assert.equal(result.truncated, true);
    assert.equal(result.jobs.length, MAX_ROUTE_JOBS);
    assert.equal(result.jobs.at(-1), MAX_ROUTE_JOBS - 1);
  });
});
