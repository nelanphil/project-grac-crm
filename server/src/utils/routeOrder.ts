export const MAX_ROUTE_JOBS = 25;
export const EXACT_ROUTE_JOBS = 12;

export type RouteObjective = "time" | "distance";

export type RouteLegMetric = {
  durationMinutes: number;
  distanceMeters: number;
};

export function metricCost(
  metric: RouteLegMetric,
  objective: RouteObjective,
): number {
  return objective === "time" ? metric.durationMinutes : metric.distanceMeters;
}

export function limitRouteJobs<T>(jobs: T[]): { jobs: T[]; truncated: boolean } {
  if (jobs.length <= MAX_ROUTE_JOBS) return { jobs, truncated: false };
  return { jobs: jobs.slice(0, MAX_ROUTE_JOBS), truncated: true };
}

/**
 * Reorder job stops for a shortest-time or shortest-distance route.
 *
 * `cost[0]` is home. `cost[1..jobCount]` are the jobs in their current order.
 * Round trip keeps home first and last and reorders every job.
 * One way keeps home first and the current last job last.
 * Returns job indexes (1-based into `cost`) in visit order.
 */
export function optimizeJobOrder(opts: {
  cost: number[][];
  jobCount: number;
  roundTrip: boolean;
}): number[] {
  const { cost, jobCount, roundTrip } = opts;
  if (jobCount <= 0) return [];
  if (cost.length < jobCount + 1) {
    throw new Error("Cost matrix is smaller than the stop list.");
  }
  if (jobCount === 1) return [1];

  const jobs = Array.from({ length: jobCount }, (_, index) => index + 1);
  if (roundTrip) {
    if (jobCount <= EXACT_ROUTE_JOBS) {
      return heldKarp(cost, 0, jobs, 0);
    }
    const visited = nearestNeighbor(cost, 0, jobs, null);
    return twoOpt(cost, [0, ...visited, 0], 1, 1).slice(1, -1);
  }

  const fixedLast = jobCount;
  const middles = jobs.slice(0, -1);
  if (jobCount <= EXACT_ROUTE_JOBS) {
    return [...heldKarp(cost, 0, middles, fixedLast), fixedLast];
  }
  const visited = nearestNeighbor(cost, 0, middles, fixedLast);
  return twoOpt(cost, [0, ...visited], 1, 1).slice(1);
}

/**
 * Reorder stops while keeping locked jobs at their desired offsets from the
 * day start. Free jobs are packed into the gaps around those times.
 * Returns job indexes (1-based into `cost`) in visit order.
 */
export function optimizeAroundLocks(opts: {
  cost: number[][];
  driveMinutes: number[][];
  serviceMinutes: number[];
  lockedOffsetMinutes: Array<number | null>;
  roundTrip: boolean;
}): number[] {
  const jobCount = opts.serviceMinutes.length - 1;
  if (jobCount <= 0) return [];
  if (opts.cost.length < jobCount + 1 || opts.driveMinutes.length < jobCount + 1) {
    throw new Error("Cost matrix is smaller than the stop list.");
  }
  const locks = [];
  for (let index = 1; index <= jobCount; index += 1) {
    const offset = opts.lockedOffsetMinutes[index];
    if (offset == null) continue;
    locks.push({
      index,
      arrive: offset,
      depart: offset + opts.serviceMinutes[index]!,
    });
  }
  if (locks.length === 0) {
    return optimizeJobOrder({
      cost: opts.cost,
      jobCount,
      roundTrip: opts.roundTrip,
    });
  }
  locks.sort((a, b) => a.arrive - b.arrive || a.index - b.index);
  const lockedIds = new Set(locks.map((lock) => lock.index));
  const remaining = new Set<number>();
  for (let index = 1; index <= jobCount; index += 1) {
    if (!lockedIds.has(index)) remaining.add(index);
  }

  const order: number[] = [];
  let fromNode = 0;
  let depart = 0;
  let firstGap = true;
  for (const lock of locks) {
    order.push(
      ...packGap({
        ...opts,
        fromNode,
        depart,
        toNode: lock.index,
        arriveBy: lock.arrive,
        remaining,
        firstGap,
      }),
    );
    order.push(lock.index);
    fromNode = lock.index;
    depart = lock.depart;
    firstGap = false;
  }
  order.push(
    ...optimizeFreePath(
      opts.cost,
      fromNode,
      [...remaining],
      opts.roundTrip ? 0 : null,
    ),
  );
  return order;
}

function packGap(opts: {
  cost: number[][];
  driveMinutes: number[][];
  serviceMinutes: number[];
  fromNode: number;
  depart: number;
  toNode: number;
  arriveBy: number;
  remaining: Set<number>;
  firstGap: boolean;
}): number[] {
  const chosen: number[] = [];
  let current = opts.fromNode;
  let time = opts.depart;
  let firstOfDay = opts.firstGap;
  while (opts.remaining.size > 0) {
    let best: number | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const job of opts.remaining) {
      if (
        !gapFits({
          ...opts,
          current,
          time,
          firstOfDay,
          job,
        })
      ) {
        continue;
      }
      const score = opts.cost[current]![job]!;
      if (score < bestCost || (score === bestCost && (best == null || job < best))) {
        best = job;
        bestCost = score;
      }
    }
    if (best == null) break;
    const travel = opts.driveMinutes[current]![best]!;
    const start = firstOfDay && current === 0 ? time : time + travel;
    time = start + opts.serviceMinutes[best]!;
    current = best;
    firstOfDay = false;
    opts.remaining.delete(best);
    chosen.push(best);
  }
  if (
    opts.toNode != null &&
    chosen.length > 1 &&
    chosen.length <= EXACT_ROUTE_JOBS
  ) {
    const better = heldKarp(opts.cost, opts.fromNode, chosen, opts.toNode);
    if (
      pathReachesLock({
        ...opts,
        order: better,
      })
    ) {
      return better;
    }
  }
  return chosen;
}

function gapFits(opts: {
  driveMinutes: number[][];
  serviceMinutes: number[];
  current: number;
  time: number;
  firstOfDay: boolean;
  job: number;
  toNode: number;
  arriveBy: number;
}): boolean {
  const travel = opts.driveMinutes[opts.current]![opts.job]!;
  const start =
    opts.firstOfDay && opts.current === 0 ? opts.time : opts.time + travel;
  const leave = start + opts.serviceMinutes[opts.job]!;
  return leave + opts.driveMinutes[opts.job]![opts.toNode]! <= opts.arriveBy;
}

function pathReachesLock(opts: {
  driveMinutes: number[][];
  serviceMinutes: number[];
  fromNode: number;
  depart: number;
  toNode: number;
  arriveBy: number;
  firstGap: boolean;
  order: number[];
}): boolean {
  let current = opts.fromNode;
  let time = opts.depart;
  let firstOfDay = opts.firstGap;
  for (const job of opts.order) {
    const travel = opts.driveMinutes[current]![job]!;
    const start = firstOfDay && current === 0 ? time : time + travel;
    time = start + opts.serviceMinutes[job]!;
    current = job;
    firstOfDay = false;
  }
  return time + opts.driveMinutes[current]![opts.toNode]! <= opts.arriveBy;
}

function optimizeFreePath(
  cost: number[][],
  start: number,
  jobs: number[],
  end: number | null,
): number[] {
  if (jobs.length === 0) return [];
  if (jobs.length === 1) return jobs;
  if (end != null && jobs.length <= EXACT_ROUTE_JOBS) {
    return heldKarp(cost, start, jobs, end);
  }
  const visited = nearestNeighbor(cost, start, jobs, end);
  const seq = twoOpt(cost, [start, ...visited], 1, end == null ? 0 : 1);
  return end == null ? seq.slice(1) : seq.slice(1, -1);
}

function heldKarp(
  cost: number[][],
  home: number,
  jobs: number[],
  closeTo: number,
): number[] {
  const n = jobs.length;
  if (n === 0) return [];
  const full = (1 << n) - 1;
  const dp = Array.from({ length: full + 1 }, () =>
    Array<number>(n).fill(Number.POSITIVE_INFINITY),
  );
  const prev = Array.from({ length: full + 1 }, () => Array<number>(n).fill(-1));

  for (let j = 0; j < n; j += 1) {
    dp[1 << j]![j] = cost[home]![jobs[j]!]!;
  }

  for (let mask = 0; mask <= full; mask += 1) {
    for (let j = 0; j < n; j += 1) {
      if ((mask & (1 << j)) === 0) continue;
      const base = dp[mask]![j]!;
      if (!Number.isFinite(base)) continue;
      for (let k = 0; k < n; k += 1) {
        if ((mask & (1 << k)) !== 0) continue;
        const next = mask | (1 << k);
        const candidate = base + cost[jobs[j]!]![jobs[k]!]!;
        if (candidate < dp[next]![k]!) {
          dp[next]![k] = candidate;
          prev[next]![k] = j;
        }
      }
    }
  }

  let bestLast = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let j = 0; j < n; j += 1) {
    const trip = dp[full]![j]! + cost[jobs[j]!]![closeTo]!;
    if (trip < bestCost) {
      bestCost = trip;
      bestLast = j;
    }
  }

  const local: number[] = [];
  let mask = full;
  let cursor = bestLast;
  while (cursor !== -1) {
    local.push(cursor);
    const parent = prev[mask]![cursor]!;
    mask ^= 1 << cursor;
    cursor = parent;
  }
  local.reverse();
  return local.map((index) => jobs[index]!);
}

function nearestNeighbor(
  cost: number[][],
  home: number,
  candidates: number[],
  end: number | null,
): number[] {
  const remaining = new Set(candidates);
  const order: number[] = [];
  let current = home;
  while (remaining.size > 0) {
    let best = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const job of remaining) {
      const leg = cost[current]![job]!;
      if (leg < bestCost || (leg === bestCost && job < best)) {
        best = job;
        bestCost = leg;
      }
    }
    if (best < 0) break;
    order.push(best);
    remaining.delete(best);
    current = best;
  }
  if (end != null) order.push(end);
  return order;
}

function twoOpt(
  cost: number[][],
  sequence: number[],
  fixedPrefix: number,
  fixedSuffix: number,
): number[] {
  const seq = sequence.slice();
  const first = fixedPrefix;
  const last = seq.length - 1 - fixedSuffix;
  if (last - first < 1) return seq;

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = first; i < last && !improved; i += 1) {
      for (let j = i + 1; j <= last; j += 1) {
        const before = seq[i - 1]!;
        const start = seq[i]!;
        const end = seq[j]!;
        const after = seq[j + 1]!;
        const current = cost[before]![start]! + cost[end]![after]!;
        const swapped = cost[before]![end]! + cost[start]![after]!;
        if (swapped < current) {
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const tmp = seq[lo]!;
            seq[lo] = seq[hi]!;
            seq[hi] = tmp;
            lo += 1;
            hi -= 1;
          }
          improved = true;
          break;
        }
      }
    }
  }
  return seq;
}
