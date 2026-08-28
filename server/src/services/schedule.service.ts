import mongoose from "mongoose";
import { User, activeUserFilter, IUser } from "../models/mongo/User";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { customerDisplayName } from "./notification.service";
import {
  addMinutes,
  DEFAULT_ESTIMATED_MINUTES,
  defaultWeeklyHours,
  formatLocalDate,
  localDateToUtc,
  rangesOverlap,
  resolveDayWindow,
  SCHEDULE_TIMEZONE,
  windowToUtcRange,
  type HomeLocation,
  type WeeklyHours,
  type ScheduleException,
} from "../utils/scheduleTime";
import {
  computeDayRoute,
  computeDriveMinutes,
  type LatLng,
} from "../utils/googleRoutes";
import { resolveGeocodedAddress } from "../utils/resolveGeocodedAddress";

export const DISPATCHER_ROLES = ["super-admin", "admin", "owner"] as const;

export function isDispatcherRole(role: string | undefined): boolean {
  return Boolean(role && (DISPATCHER_ROLES as readonly string[]).includes(role));
}

export function staffDisplayName(user: {
  first_name?: string;
  last_name?: string;
}): string {
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
}

export function estimatedMinutesForWorkOrder(wo: {
  estimatedMinutes?: number | null;
  laborHours?: number | null;
}): number {
  if (typeof wo.estimatedMinutes === "number" && wo.estimatedMinutes > 0) {
    return wo.estimatedMinutes;
  }
  if (typeof wo.laborHours === "number" && wo.laborHours > 0) {
    return Math.round(wo.laborHours * 60);
  }
  return DEFAULT_ESTIMATED_MINUTES;
}

export function rangeUtc(fromLocal: string, toLocalInclusive: string): {
  start: Date;
  end: Date;
} {
  return {
    start: localDateToUtc(fromLocal, "00:00"),
    end: localDateToUtc(toLocalInclusive, "23:59"),
  };
}

type LeanUser = {
  _id: mongoose.Types.ObjectId;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  schedulable?: boolean;
  homeLocation?: HomeLocation | null;
  weeklyHours?: WeeklyHours | null;
  scheduleExceptions?: ScheduleException[] | null;
};

export type PublicStaff = {
  _id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  schedulable: boolean;
  homeLocation: HomeLocation;
  weeklyHours: WeeklyHours;
  scheduleExceptions: ScheduleException[];
};

export function toPublicStaff(user: LeanUser): PublicStaff {
  return {
    _id: String(user._id),
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    role: user.role,
    schedulable: Boolean(user.schedulable),
    homeLocation: {
      address: user.homeLocation?.address ?? "",
      city: user.homeLocation?.city ?? "",
      state: user.homeLocation?.state ?? "",
      zip: user.homeLocation?.zip ?? "",
      lat: user.homeLocation?.lat ?? null,
      lng: user.homeLocation?.lng ?? null,
    },
    weeklyHours: user.weeklyHours ?? defaultWeeklyHours(Boolean(user.schedulable)),
    scheduleExceptions: user.scheduleExceptions ?? [],
  };
}

export async function findOverlappingJob(opts: {
  userId: string;
  start: Date;
  end: Date;
  excludeId?: string;
}): Promise<{ _id: mongoose.Types.ObjectId } | null> {
  const filter: Record<string, unknown> = {
    assignedUserRef: opts.userId,
    scheduledStart: { $ne: null },
    scheduledEnd: { $ne: null },
    $expr: {
      $and: [
        { $lt: ["$scheduledStart", opts.end] },
        { $gt: ["$scheduledEnd", opts.start] },
      ],
    },
  };
  if (opts.excludeId && mongoose.Types.ObjectId.isValid(opts.excludeId)) {
    filter._id = { $ne: new mongoose.Types.ObjectId(opts.excludeId) };
  }
  return WorkOrder.findOne(filter).select("_id").lean();
}

export function availabilityWarning(opts: {
  weeklyHours: WeeklyHours | null | undefined;
  exceptions: ScheduleException[] | null | undefined;
  localDate: string;
  start: Date;
  end: Date;
}): string | null {
  const window = resolveDayWindow(
    opts.weeklyHours,
    opts.exceptions,
    opts.localDate,
  );
  const range = windowToUtcRange(opts.localDate, window);
  if (!range) {
    return "This day is marked unavailable for the assigned technician.";
  }
  if (opts.start.getTime() < range.start.getTime()) {
    return "Start time is before the technician's working hours.";
  }
  if (opts.end.getTime() > range.end.getTime()) {
    return "Job overruns the technician's working hours.";
  }
  return null;
}

type AddressSummary = {
  _id: string;
  label: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
  lat: number | null;
  lng: number | null;
};

type AssigneeSummary = {
  _id: string;
  first_name: string;
  last_name: string;
};

export type EnrichedWorkOrder = Record<string, unknown> & {
  address: AddressSummary | null;
  customerName: string | null;
  customerRef: string | null;
  assignee: AssigneeSummary | null;
};

export async function enrichScheduleWorkOrders(
  workOrders: Array<Record<string, unknown>>,
): Promise<EnrichedWorkOrder[]> {
  const addressIds = [
    ...new Set(
      workOrders
        .map((wo) => wo.addressRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];
  const customerIds = [
    ...new Set(
      workOrders
        .map((wo) => wo.customerRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];
  const userIds = [
    ...new Set(
      workOrders
        .map((wo) => wo.assignedUserRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  const [addresses, customers, users] = await Promise.all([
    addressIds.length
      ? CustomerAddress.find({ _id: { $in: addressIds } })
          .select("_id label address city state zip isPrimary lat lng")
          .lean()
      : [],
    customerIds.length
      ? Customer.find({ _id: { $in: customerIds } })
          .select("_id accountName first last")
          .lean()
      : [],
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("_id first_name last_name")
          .lean()
      : [],
  ]);

  const addressById = new Map(
    addresses.map((a) => [
      a._id.toString(),
      {
        _id: a._id.toString(),
        label: a.label,
        address: a.address,
        city: a.city,
        state: a.state,
        zip: a.zip,
        isPrimary: a.isPrimary,
        lat: typeof a.lat === "number" ? a.lat : null,
        lng: typeof a.lng === "number" ? a.lng : null,
      },
    ]),
  );
  const customerById = new Map(
    customers.map((c) => [c._id.toString(), customerDisplayName(c)]),
  );
  const userById = new Map(
    users.map((u) => [
      u._id.toString(),
      {
        _id: u._id.toString(),
        first_name: u.first_name,
        last_name: u.last_name,
      },
    ]),
  );

  return workOrders.map((wo) => ({
    ...wo,
    customerRef: wo.customerRef?.toString() ?? null,
    address: addressById.get(wo.addressRef?.toString() ?? "") ?? null,
    customerName: customerById.get(wo.customerRef?.toString() ?? "") ?? null,
    assignee: userById.get(wo.assignedUserRef?.toString() ?? "") ?? null,
  }));
}

export async function listSchedulableStaff(): Promise<LeanUser[]> {
  return User.find({
    ...activeUserFilter,
    schedulable: true,
    role: { $ne: "customer" },
  })
    .select(
      "first_name last_name email role schedulable homeLocation weeklyHours scheduleExceptions",
    )
    .sort({ last_name: 1, first_name: 1 })
    .lean();
}

function parseCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function latLngFrom(obj: { lat?: unknown; lng?: unknown } | null | undefined): LatLng | null {
  if (!obj) return null;
  const lat = parseCoord(obj.lat);
  const lng = parseCoord(obj.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function homeCoords(home?: HomeLocation | null): LatLng | null {
  return latLngFrom(home);
}

function addressCoords(
  addr: { lat?: unknown; lng?: unknown } | null,
): LatLng | null {
  return latLngFrom(addr);
}

function geocodeCacheKey(input: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}): string {
  return [
    input.address ?? "",
    input.city ?? "",
    input.state ?? "",
    input.zip ?? "",
  ]
    .join("|")
    .trim()
    .toLowerCase();
}

async function geocodeToLatLng(
  input: {
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  },
  cache: Map<string, LatLng | null>,
): Promise<LatLng | null> {
  const street = (input.address ?? "").trim();
  if (!street) return null;
  const key = geocodeCacheKey(input);
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const result = await resolveGeocodedAddress({
      street,
      city: (input.city ?? "").trim(),
      state: (input.state ?? "").trim(),
      zip: (input.zip ?? "").trim(),
    });
    const coords =
      result.ok && result.match.coordinates
        ? {
            lat: result.match.coordinates.lat,
            lng: result.match.coordinates.lng,
          }
        : null;
    cache.set(key, coords);
    return coords;
  } catch (err) {
    console.error("suggestAssignees geocode error:", err);
    cache.set(key, null);
    return null;
  }
}

export type SuggestCandidate = {
  userId: string;
  first_name: string;
  last_name: string;
  proposedStart: string;
  proposedEnd: string;
  driveMinutes: number;
  remainingMinutes: number;
  existingJobCount: number;
  fits: boolean;
  reason: string;
  driveSource: "google" | "haversine" | "none";
  driveFrom: "previousJob" | "home" | "unknown";
  driveFromLabel: string;
  driveKnown: boolean;
};

function emptyDriveFields(): Pick<
  SuggestCandidate,
  "driveFrom" | "driveFromLabel" | "driveKnown"
> {
  return { driveFrom: "unknown", driveFromLabel: "", driveKnown: false };
}

function formatShortAddress(addr: {
  address?: string;
  city?: string;
} | null): string {
  if (!addr) return "";
  return [addr.address?.trim(), addr.city?.trim()].filter(Boolean).join(", ");
}

export async function suggestAssignees(opts: {
  workOrderId: string;
  date: string;
  estimatedMinutes?: number;
}): Promise<{
  workOrderId: string;
  date: string;
  estimatedMinutes: number;
  suggestions: SuggestCandidate[];
}> {
  const workOrder = await WorkOrder.findById(opts.workOrderId).lean();
  if (!workOrder) {
    throw Object.assign(new Error("Work order not found"), { status: 404 });
  }

  const estimatedMinutes =
    opts.estimatedMinutes ?? estimatedMinutesForWorkOrder(workOrder);

  const geocodeCache = new Map<string, LatLng | null>();

  let dest: LatLng | null = null;
  if (workOrder.addressRef) {
    const site = await CustomerAddress.findById(workOrder.addressRef)
      .select("lat lng address city state zip")
      .lean();
    dest = addressCoords(site);
    if (!dest && site) {
      dest = await geocodeToLatLng(site, geocodeCache);
      if (dest) {
        await CustomerAddress.updateOne(
          { _id: site._id },
          { $set: { lat: dest.lat, lng: dest.lng } },
        );
      }
    }
  }
  if (!dest && workOrder.customerRef) {
    const fallback = await CustomerAddress.findOne({
      customerRef: workOrder.customerRef,
    })
      .sort({ isPrimary: -1 })
      .select("lat lng address city state zip")
      .lean();
    dest = addressCoords(fallback);
    if (!dest && fallback) {
      dest = await geocodeToLatLng(fallback, geocodeCache);
      if (dest) {
        await CustomerAddress.updateOne(
          { _id: fallback._id },
          { $set: { lat: dest.lat, lng: dest.lng } },
        );
      }
    }
  }

  const staff = await listSchedulableStaff();
  const dayStart = localDateToUtc(opts.date, "00:00");
  const dayEnd = localDateToUtc(opts.date, "23:59");

  const dayJobs = await WorkOrder.find({
    assignedUserRef: { $in: staff.map((s) => s._id) },
    scheduledStart: { $gte: dayStart, $lte: dayEnd },
    _id: { $ne: workOrder._id },
  })
    .select(
      "assignedUserRef scheduledStart scheduledEnd estimatedMinutes addressRef customerRef",
    )
    .sort({ scheduledStart: 1 })
    .lean();

  const jobsByUser = new Map<string, typeof dayJobs>();
  for (const job of dayJobs) {
    const key = job.assignedUserRef?.toString() ?? "";
    if (!key) continue;
    const list = jobsByUser.get(key) ?? [];
    list.push(job);
    jobsByUser.set(key, list);
  }

  const jobAddressIds = [
    ...new Set(
      dayJobs.map((j) => j.addressRef?.toString()).filter(Boolean) as string[],
    ),
  ];
  const jobCustomerIds = [
    ...new Set(
      dayJobs.map((j) => j.customerRef?.toString()).filter(Boolean) as string[],
    ),
  ];
  const [jobAddresses, jobCustomers] = await Promise.all([
    jobAddressIds.length > 0
      ? CustomerAddress.find({ _id: { $in: jobAddressIds } })
          .select("_id lat lng address city state zip")
          .lean()
      : [],
    jobCustomerIds.length > 0
      ? Customer.find({ _id: { $in: jobCustomerIds } })
          .select("_id accountName first last")
          .lean()
      : [],
  ]);
  const jobCoords = new Map(
    jobAddresses.map((a) => [a._id.toString(), addressCoords(a)]),
  );
  const jobAddressLabel = new Map(
    jobAddresses.map((a) => [a._id.toString(), formatShortAddress(a)]),
  );
  const jobCustomerName = new Map(
    jobCustomers.map((c) => [c._id.toString(), customerDisplayName(c)]),
  );
  const jobAddressById = new Map(
    jobAddresses.map((a) => [a._id.toString(), a]),
  );

  for (const [id, coords] of [...jobCoords.entries()]) {
    if (coords) continue;
    const addr = jobAddressById.get(id);
    if (!addr) continue;
    const geocoded = await geocodeToLatLng(addr, geocodeCache);
    if (!geocoded) continue;
    jobCoords.set(id, geocoded);
    await CustomerAddress.updateOne(
      { _id: addr._id },
      { $set: { lat: geocoded.lat, lng: geocoded.lng } },
    );
  }

  const suggestions: SuggestCandidate[] = [];

  for (const tech of staff) {
    const window = resolveDayWindow(
      tech.weeklyHours,
      tech.scheduleExceptions,
      opts.date,
    );
    const range = windowToUtcRange(opts.date, window);
    if (!range) {
      suggestions.push({
        userId: String(tech._id),
        first_name: tech.first_name,
        last_name: tech.last_name,
        proposedStart: "",
        proposedEnd: "",
        driveMinutes: 0,
        remainingMinutes: 0,
        existingJobCount: 0,
        fits: false,
        reason: window.off ? "Marked off this day" : "Not working this weekday",
        driveSource: "none",
        ...emptyDriveFields(),
      });
      continue;
    }

    const existing = jobsByUser.get(String(tech._id)) ?? [];
    const occupiedMinutes = existing.reduce((sum, job) => {
      if (!job.scheduledStart || !job.scheduledEnd) return sum;
      return (
        sum +
        Math.max(
          0,
          Math.round(
            (new Date(job.scheduledEnd).getTime() -
              new Date(job.scheduledStart).getTime()) /
              60000,
          ),
        )
      );
    }, 0);
    const windowMinutes = Math.round(
      (range.end.getTime() - range.start.getTime()) / 60000,
    );
    const remainingMinutes = Math.max(0, windowMinutes - occupiedMinutes);

    const lastJob = existing[existing.length - 1];
    const lastEnd = lastJob?.scheduledEnd
      ? new Date(lastJob.scheduledEnd)
      : range.start;
    const lastJobCoords = lastJob?.addressRef
      ? (jobCoords.get(lastJob.addressRef.toString()) ?? null)
      : null;
    let home = homeCoords(tech.homeLocation);
    if (!home && tech.homeLocation?.address?.trim()) {
      home = await geocodeToLatLng(tech.homeLocation, geocodeCache);
      if (home) {
        await User.updateOne(
          { _id: tech._id },
          {
            $set: {
              "homeLocation.lat": home.lat,
              "homeLocation.lng": home.lng,
            },
          },
        );
      }
    }

    let driveFrom: SuggestCandidate["driveFrom"] = "unknown";
    let driveFromLabel = "";
    let fromCoords: LatLng | null = null;
    if (lastJobCoords) {
      driveFrom = "previousJob";
      fromCoords = lastJobCoords;
      const name = lastJob?.customerRef
        ? (jobCustomerName.get(lastJob.customerRef.toString()) ?? "")
        : "";
      const addr = lastJob?.addressRef
        ? (jobAddressLabel.get(lastJob.addressRef.toString()) ?? "")
        : "";
      driveFromLabel = [name, addr].filter(Boolean).join(" · ");
    } else if (home) {
      driveFrom = "home";
      fromCoords = home;
      driveFromLabel = "Home";
    }

    let driveMinutes = 0;
    let driveSource: SuggestCandidate["driveSource"] = "none";
    const driveKnown = Boolean(fromCoords && dest);
    if (fromCoords && dest) {
      const drive = await computeDriveMinutes(fromCoords, dest);
      driveMinutes = drive.minutes;
      driveSource = drive.source;
    }

    const proposedStart = addMinutes(lastEnd, driveMinutes);
    const proposedEnd = addMinutes(proposedStart, estimatedMinutes);
    const fits =
      proposedStart.getTime() >= range.start.getTime() &&
      proposedEnd.getTime() <= range.end.getTime() &&
      remainingMinutes >= estimatedMinutes + driveMinutes &&
      !existing.some(
        (job) =>
          job.scheduledStart &&
          job.scheduledEnd &&
          rangesOverlap(
            proposedStart,
            proposedEnd,
            new Date(job.scheduledStart),
            new Date(job.scheduledEnd),
          ),
      );

    let reason: string;
    if (fits && driveKnown) {
      reason =
        driveFrom === "previousJob"
          ? `${driveMinutes} min from last job`
          : `${driveMinutes} min from home`;
    } else if (fits) {
      reason = existing.length
        ? "Fits after existing jobs"
        : "Fits this day";
    } else if (remainingMinutes < estimatedMinutes) {
      reason = "Not enough remaining capacity";
    } else {
      reason = "Does not fit before end of day";
    }

    suggestions.push({
      userId: String(tech._id),
      first_name: tech.first_name,
      last_name: tech.last_name,
      proposedStart: proposedStart.toISOString(),
      proposedEnd: proposedEnd.toISOString(),
      driveMinutes,
      remainingMinutes,
      existingJobCount: existing.length,
      fits,
      reason,
      driveSource,
      driveFrom,
      driveFromLabel,
      driveKnown,
    });
  }

  suggestions.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1;
    if (a.driveKnown !== b.driveKnown) return a.driveKnown ? -1 : 1;
    if (a.driveKnown && b.driveKnown && a.driveMinutes !== b.driveMinutes) {
      return a.driveMinutes - b.driveMinutes;
    }
    return b.remainingMinutes - a.remainingMinutes;
  });

  return {
    workOrderId: String(workOrder._id),
    date: opts.date,
    estimatedMinutes,
    suggestions,
  };
}

export async function dayRouteForUser(opts: {
  userId: string;
  date: string;
}): Promise<{
  user: PublicStaff;
  date: string;
  stops: Array<{
    kind: "home" | "job";
    label: string;
    lat: number | null;
    lng: number | null;
    workOrderId?: string;
    scheduledStart?: string | null;
  }>;
  route: Awaited<ReturnType<typeof computeDayRoute>>;
}> {
  const user = await User.findOne({
    _id: opts.userId,
    ...activeUserFilter,
  })
    .select(
      "first_name last_name email role schedulable homeLocation weeklyHours scheduleExceptions",
    )
    .lean();
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const dayStart = localDateToUtc(opts.date, "00:00");
  const dayEnd = localDateToUtc(opts.date, "23:59");
  const jobs = await WorkOrder.find({
    assignedUserRef: user._id,
    scheduledStart: { $gte: dayStart, $lte: dayEnd },
  })
    .sort({ scheduledStart: 1 })
    .lean();

  const enriched = await enrichScheduleWorkOrders(jobs);
  const home = homeCoords(user.homeLocation);
  const jobPoints = enriched
    .map((wo) => ({
      wo,
      coords: addressCoords(wo.address),
    }))
    .filter((row) => row.coords);

  const stops: Array<{
    kind: "home" | "job";
    label: string;
    lat: number | null;
    lng: number | null;
    workOrderId?: string;
    scheduledStart?: string | null;
  }> = [];

  stops.push({
    kind: "home",
    label: "Home",
    lat: home?.lat ?? null,
    lng: home?.lng ?? null,
  });
  for (const row of jobPoints) {
    stops.push({
      kind: "job",
      label: row.wo.customerName || "Work order",
      lat: row.coords!.lat,
      lng: row.coords!.lng,
      workOrderId: String(row.wo._id),
      scheduledStart:
        row.wo.scheduledStart instanceof Date
          ? row.wo.scheduledStart.toISOString()
          : ((row.wo.scheduledStart as string | null) ?? null),
    });
  }
  if (home) {
    stops.push({
      kind: "home",
      label: "Home (return)",
      lat: home.lat,
      lng: home.lng,
    });
  }

  const intermediates = jobPoints.map((row) => row.coords!);
  const route =
    home && intermediates.length > 0
      ? await computeDayRoute(home, home, intermediates)
      : null;

  return {
    user: toPublicStaff(user),
    date: opts.date,
    stops,
    route,
  };
}

export async function applyAssignmentSideEffects(
  workOrder: InstanceType<typeof WorkOrder>,
  assignee: Pick<IUser, "first_name" | "last_name"> | null,
): Promise<void> {
  if (workOrder.scheduledStart) {
    workOrder.date = localDateToUtc(
      formatLocalDate(workOrder.scheduledStart),
      "00:00",
    );
  }
  if (assignee) {
    workOrder.tech = staffDisplayName(assignee);
  }
}

export const PAST_DUE_LIMIT = 75;

export type ScheduleQueue = {
  unscheduled: EnrichedWorkOrder[];
  today: EnrichedWorkOrder[];
  upcoming: EnrichedWorkOrder[];
  pastDue: EnrichedWorkOrder[];
};

function isCanceledAppointment(wo: {
  appointmentCanceledAt?: Date | null;
}): boolean {
  return Boolean(wo.appointmentCanceledAt);
}

function pastDueSortKey(wo: {
  appointmentCanceledAt?: Date | null;
  scheduledStart?: Date | null;
  updatedAt?: Date;
}): number {
  const stamp =
    wo.appointmentCanceledAt ?? wo.scheduledStart ?? wo.updatedAt ?? new Date(0);
  return new Date(stamp).getTime();
}

export async function listScheduleQueue(opts: {
  dispatcher: boolean;
  userId: string;
  from?: string;
  to?: string;
}): Promise<ScheduleQueue> {
  const today = formatLocalDate(new Date());
  const { start: todayStart, end: todayEnd } = rangeUtc(today, today);

  const base: Record<string, unknown> = { completed: { $ne: true } };
  if (!opts.dispatcher) {
    base.assignedUserRef = opts.userId;
  }

  const dateWindow =
    opts.from && opts.to
      ? {
          date: {
            $gte: new Date(`${opts.from}T00:00:00.000Z`),
            $lte: new Date(`${opts.to}T23:59:59.999Z`),
          },
        }
      : null;

  const unscheduledFilter: Record<string, unknown> = {
    ...base,
    scheduledStart: null,
    ...(dateWindow ?? {}),
  };
  if (!dateWindow) {
    unscheduledFilter.$or = [
      { appointmentCanceledAt: null },
      { appointmentCanceledAt: { $exists: false } },
    ];
  }

  const unscheduledQuery = opts.dispatcher
    ? WorkOrder.find(unscheduledFilter).sort({ date: 1, createdAt: 1 }).lean()
    : Promise.resolve([]);

  const [unscheduledRows, todayRows, upcomingRows, pastDueRows] =
    await Promise.all([
      unscheduledQuery,
      WorkOrder.find({
        ...base,
        scheduledStart: { $gte: todayStart, $lte: todayEnd },
      })
        .sort({ scheduledStart: 1 })
        .lean(),
      WorkOrder.find({
        ...base,
        scheduledStart: { $gt: todayEnd },
      })
        .sort({ scheduledStart: 1 })
        .lean(),
      WorkOrder.find({
        ...base,
        $or: [
          { appointmentCanceledAt: { $type: "date" } },
          { scheduledStart: { $ne: null, $lt: todayStart } },
        ],
      })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean(),
    ]);

  const pastDueSorted = [...pastDueRows]
    .filter(
      (wo) =>
        isCanceledAppointment(wo) ||
        (wo.scheduledStart != null &&
          new Date(wo.scheduledStart).getTime() < todayStart.getTime()),
    )
    .sort((a, b) => pastDueSortKey(b) - pastDueSortKey(a))
    .slice(0, PAST_DUE_LIMIT);

  const [unscheduled, todayJobs, upcoming, pastDue] = await Promise.all([
    enrichScheduleWorkOrders(unscheduledRows as Array<Record<string, unknown>>),
    enrichScheduleWorkOrders(todayRows as Array<Record<string, unknown>>),
    enrichScheduleWorkOrders(upcomingRows as Array<Record<string, unknown>>),
    enrichScheduleWorkOrders(pastDueSorted as Array<Record<string, unknown>>),
  ]);

  return { unscheduled, today: todayJobs, upcoming, pastDue };
}

export type PhoneBookingSlot = {
  start: Date;
  end: Date;
  assignedUserRef: string;
  spokenLabel: string;
};

function speakSlot(start: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

/** Next open 60-minute windows on schedulable staff (next ~14 days). */
export async function listNextAvailableSlots(opts?: {
  estimatedMinutes?: number;
  count?: number;
  daysAhead?: number;
}): Promise<PhoneBookingSlot[]> {
  const estimatedMinutes = opts?.estimatedMinutes ?? DEFAULT_ESTIMATED_MINUTES;
  const count = opts?.count ?? 3;
  const daysAhead = opts?.daysAhead ?? 14;
  const staff = await listSchedulableStaff();
  if (staff.length === 0) return [];

  const now = new Date();
  const firstDate = formatLocalDate(now);
  const lastDate = formatLocalDate(addMinutes(now, daysAhead * 24 * 60));
  const rangeStart = localDateToUtc(firstDate, "00:00");
  const rangeEnd = localDateToUtc(lastDate, "23:59");

  const jobs = await WorkOrder.find({
    assignedUserRef: { $in: staff.map((s) => s._id) },
    scheduledStart: { $gte: rangeStart, $lte: rangeEnd },
    $or: [
      { appointmentCanceledAt: null },
      { appointmentCanceledAt: { $exists: false } },
    ],
  })
    .select("assignedUserRef scheduledStart scheduledEnd estimatedMinutes")
    .lean();

  const jobsByUser = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = job.assignedUserRef?.toString() ?? "";
    if (!key) continue;
    const list = jobsByUser.get(key) ?? [];
    list.push(job);
    jobsByUser.set(key, list);
  }

  const slots: PhoneBookingSlot[] = [];
  const seenStarts = new Set<number>();

  for (let day = 0; day < daysAhead && slots.length < count; day += 1) {
    const localDate = formatLocalDate(addMinutes(localDateToUtc(firstDate, "12:00"), day * 24 * 60));
    const windows = staff
      .map((s) => {
        const window = resolveDayWindow(
          s.weeklyHours ?? defaultWeeklyHours(Boolean(s.schedulable)),
          s.scheduleExceptions,
          localDate,
        );
        const range = windowToUtcRange(localDate, window);
        return { staff: s, range };
      })
      .filter((w): w is { staff: LeanUser; range: { start: Date; end: Date } } =>
        Boolean(w.range),
      );

    if (windows.length === 0) continue;

    const dayStart = Math.min(...windows.map((w) => w.range.start.getTime()));
    const dayEnd = Math.max(...windows.map((w) => w.range.end.getTime()));

    for (
      let cursor = dayStart;
      cursor + estimatedMinutes * 60000 <= dayEnd && slots.length < count;
      cursor += estimatedMinutes * 60000
    ) {
      if (cursor < now.getTime()) continue;
      if (seenStarts.has(cursor)) continue;
      const start = new Date(cursor);
      const end = addMinutes(start, estimatedMinutes);

      const free = windows.find(({ staff: s, range }) => {
        if (start.getTime() < range.start.getTime()) return false;
        if (end.getTime() > range.end.getTime()) return false;
        const existing = jobsByUser.get(String(s._id)) ?? [];
        return !existing.some((job) => {
          const jobStart = job.scheduledStart
            ? new Date(job.scheduledStart)
            : null;
          if (!jobStart) return false;
          const jobEnd = job.scheduledEnd
            ? new Date(job.scheduledEnd)
            : addMinutes(jobStart, estimatedMinutesForWorkOrder(job));
          return rangesOverlap(start, end, jobStart, jobEnd);
        });
      });

      if (!free) continue;
      seenStarts.add(cursor);
      slots.push({
        start,
        end,
        assignedUserRef: String(free.staff._id),
        spokenLabel: speakSlot(start),
      });
    }
  }

  return slots;
}
