import mongoose from "mongoose";
import { User, activeUserFilter, IUser } from "../models/mongo/User";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderNote } from "../models/mongo/WorkOrderNote";
import { WorkOrderType } from "../models/mongo/WorkOrderType";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { customerDisplayName } from "./notification.service";
import {
  addMinutes,
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  DEFAULT_ESTIMATED_MINUTES,
  defaultWeeklyHours,
  formatLocalDate,
  isHhMm,
  localDateToUtc,
  rangesOverlap,
  resolveDayWindow,
  SCHEDULE_TIMEZONE,
  windowToUtcRange,
  type DayWindow,
  type HomeLocation,
  type WeeklyHours,
  type ScheduleException,
} from "../utils/scheduleTime";
import {
  computeDayRoute,
  computeDriveMinutes,
  computeDriveMinutesMatrix,
  haversineDriveMinutes,
  haversineMiles,
  type LatLng,
  type RouteMatrixCell,
} from "../utils/googleRoutes";
import {
  limitRouteJobs,
  metricCost,
  optimizeAroundLocks,
  optimizeJobOrder,
  type RouteObjective,
} from "../utils/routeOrder";
import { stateCodeOrFlorida } from "../constants/usStates";
import {
  geocodeSitePoint,
  shouldKeepStoredSitePoint,
  type SitePoint,
} from "../utils/siteGeocode";
export { DISPATCHER_ROLES, isDispatcherRole } from "../utils/roles";

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
  roles?: string[];
  schedulable?: boolean;
  homeLocation?: HomeLocation | null;
  weeklyHours?: WeeklyHours | null;
  scheduleExceptions?: ScheduleException[] | null;
  serviceCities?: Array<{
    city?: string;
    state?: string;
    lat?: number | null;
    lng?: number | null;
  }> | null;
};

export type PublicStaff = {
  _id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  roles: string[];
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
    roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role],
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
  workOrderTypeRef: string | null;
  workOrderType: { _id: string; label: string } | null;
  scheduleNote: string | null;
};

async function latestScheduleNotes(
  workOrderIds: string[],
): Promise<Map<string, string>> {
  const ids = workOrderIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (ids.length === 0) return new Map();
  const rows = await WorkOrderNote.aggregate<{
    _id: mongoose.Types.ObjectId;
    content: string;
  }>([
    {
      $match: {
        workOrderRef: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      },
    },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$workOrderRef", content: { $first: "$content" } } },
  ]);
  const notes = new Map<string, string>();
  for (const row of rows) {
    const content = row.content.trim();
    if (content) notes.set(String(row._id), content);
  }
  return notes;
}

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
  const missingLegacyIds = [
    ...new Set(
      workOrders
        .filter((wo) => !wo.customerRef)
        .map((wo) => wo.customerId)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const userIds = [
    ...new Set(
      workOrders
        .map((wo) => wo.assignedUserRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];
  const typeIds = [
    ...new Set(
      workOrders
        .map((wo) => wo.workOrderTypeRef?.toString())
        .filter(Boolean) as string[],
    ),
  ];

  const [addresses, customers, fallbackCustomers, users, types] =
    await Promise.all([
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
    missingLegacyIds.length
      ? Customer.find({
          legacyId: { $in: missingLegacyIds },
          deletedAt: null,
          $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
        })
          .select("_id legacyId accountName first last")
          .lean()
      : [],
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("_id first_name last_name")
          .lean()
      : [],
    typeIds.length
      ? WorkOrderType.find({ _id: { $in: typeIds } })
          .select("_id label")
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
  const customerByLegacy = new Map<number, string>();
  for (const customer of fallbackCustomers) {
    const name = customerDisplayName(customer);
    customerById.set(customer._id.toString(), name);
    if (typeof customer.legacyId === "number") {
      customerByLegacy.set(customer.legacyId, customer._id.toString());
    }
  }
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
  const typeById = new Map(
    types.map((t) => [
      t._id.toString(),
      { _id: t._id.toString(), label: t.label },
    ]),
  );

  const noteByWorkOrder = await latestScheduleNotes(
    workOrders.map((wo) => wo._id?.toString() ?? "").filter(Boolean),
  );

  return workOrders.map((wo) => {
    const resolvedRef =
      wo.customerRef?.toString() ??
      (typeof wo.customerId === "number"
        ? (customerByLegacy.get(wo.customerId) ?? null)
        : null);
    const lookedUpName = resolvedRef
      ? (customerById.get(resolvedRef) ?? null)
      : null;
    const snapshotName =
      typeof wo.customerName === "string" && wo.customerName.trim()
        ? wo.customerName.trim()
        : null;
    const note = noteByWorkOrder.get(wo._id?.toString() ?? "") ?? "";
    const description =
      typeof wo.descPerform === "string" ? wo.descPerform.trim() : "";
    return {
      ...wo,
      customerRef: resolvedRef,
      workOrderTypeRef: wo.workOrderTypeRef?.toString() ?? null,
      workOrderType: typeById.get(wo.workOrderTypeRef?.toString() ?? "") ?? null,
      address: addressById.get(wo.addressRef?.toString() ?? "") ?? null,
      customerName: lookedUpName ?? snapshotName,
      assignee: userById.get(wo.assignedUserRef?.toString() ?? "") ?? null,
      scheduleNote: note || description || null,
    };
  });
}

export async function listSchedulableStaff(): Promise<LeanUser[]> {
  return User.find({
    ...activeUserFilter,
    userType: "staff",
    schedulable: true,
  })
    .select(
      "first_name last_name email role roles schedulable homeLocation weeklyHours scheduleExceptions serviceCities",
    )
    .sort({ last_name: 1, first_name: 1 })
    .lean();
}

export async function countTechnicianJobsOnDate(opts: {
  userIds: Array<mongoose.Types.ObjectId | string>;
  localDate: string;
  excludeWorkOrderId?: string;
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (opts.userIds.length === 0) return counts;

  const { start, end } = rangeUtc(opts.localDate, opts.localDate);
  const utcDateStart = new Date(`${opts.localDate}T00:00:00.000Z`);
  const utcDateEnd = new Date(`${opts.localDate}T23:59:59.999Z`);

  const filter: Record<string, unknown> = {
    assignedUserRef: { $in: opts.userIds },
    $or: [
      { scheduledStart: { $gte: start, $lte: end } },
      {
        scheduledStart: null,
        date: { $gte: utcDateStart, $lte: utcDateEnd },
      },
    ],
  };
  if (
    opts.excludeWorkOrderId &&
    mongoose.Types.ObjectId.isValid(opts.excludeWorkOrderId)
  ) {
    filter._id = { $ne: new mongoose.Types.ObjectId(opts.excludeWorkOrderId) };
  }

  const rows = await WorkOrder.find(filter).select("assignedUserRef").lean();
  for (const row of rows) {
    const key = String(row.assignedUserRef);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
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

function scheduleState(
  site: { city?: string | null; state?: string | null } | null | undefined,
): string {
  if (!site) return "";
  const city = (site.city ?? "").trim();
  const state = (site.state ?? "").trim();
  if (!city && !state) return "";
  return stateCodeOrFlorida(state);
}

type AddressSite = {
  _id: unknown;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: unknown;
  lng?: unknown;
  coordSource?: string | null;
  geocodedStreet?: string | null;
};

const ADDRESS_POINT_FIELDS =
  "_id lat lng address city state zip coordSource geocodedStreet";

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
  const city = (input.city ?? "").trim();
  if (!street && !city) return null;
  const key = geocodeCacheKey({
    ...input,
    state: stateCodeOrFlorida(input.state),
  });
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const hit = await geocodeSitePoint(input);
    const coords = hit ? { lat: hit.lat, lng: hit.lng } : null;
    cache.set(key, coords);
    return coords;
  } catch (err) {
    console.error("suggestAssignees geocode error:", err);
    cache.set(key, null);
    return null;
  }
}

async function ensureAddressPoint(
  site: AddressSite,
  cache: Map<string, SitePoint | null>,
): Promise<LatLng | null> {
  if (shouldKeepStoredSitePoint(site)) return addressCoords(site);

  const key = geocodeCacheKey({
    address: site.address ?? "",
    city: site.city ?? "",
    state: stateCodeOrFlorida(site.state),
    zip: site.zip ?? "",
  });
  let hit: SitePoint | null;
  if (cache.has(key)) {
    hit = cache.get(key) ?? null;
  } else {
    try {
      hit = await geocodeSitePoint(site);
    } catch (err) {
      console.error("schedule address geocode error:", err);
      hit = null;
    }
    cache.set(key, hit);
  }
  if (!hit) return addressCoords(site);

  const street = (site.address ?? "").trim();
  const stateBlank = !(site.state ?? "").trim() && Boolean((site.city ?? "").trim());
  const current = addressCoords(site);
  const unchanged =
    current?.lat === hit.lat &&
    current?.lng === hit.lng &&
    site.coordSource === hit.source &&
    (site.geocodedStreet ?? "").trim() === street &&
    !stateBlank;
  if (!unchanged) {
    await CustomerAddress.updateOne(
      { _id: site._id },
      {
        $set: {
          lat: hit.lat,
          lng: hit.lng,
          coordSource: hit.source,
          geocodedStreet: street,
          ...(stateBlank ? { state: "FL" } : {}),
        },
      },
    );
  }
  return { lat: hit.lat, lng: hit.lng };
}

const GEOCODE_CONCURRENCY = 5;

export async function hydrateMissingAddressCoordinates(
  addressIds: string[],
): Promise<Array<{ addressId: string; lat: number; lng: number }>> {
  const unique = [
    ...new Set(
      addressIds.filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  if (unique.length === 0) return [];

  const docs = await CustomerAddress.find({
    _id: { $in: unique },
    $or: [
      { lat: null },
      { lng: null },
      { lat: { $exists: false } },
      { lng: { $exists: false } },
    ],
  })
    .select(ADDRESS_POINT_FIELDS)
    .lean();

  const cache = new Map<string, SitePoint | null>();
  const updated: Array<{ addressId: string; lat: number; lng: number }> = [];

  for (let i = 0; i < docs.length; i += GEOCODE_CONCURRENCY) {
    const batch = docs.slice(i, i + GEOCODE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (site) => {
        const dest = await ensureAddressPoint(site, cache);
        if (!dest) return null;
        return {
          addressId: String(site._id),
          lat: dest.lat,
          lng: dest.lng,
        };
      }),
    );
    for (const row of results) {
      if (row) updated.push(row);
    }
  }

  return updated;
}

/** Miles from a service-city center that still counts as covering that area. */
const TERRITORY_NEAR_MILES = 15;

function territoryTier(
  cities:
    | Array<{
        city?: string;
        state?: string;
        lat?: unknown;
        lng?: unknown;
      }>
    | null
    | undefined,
  jobCity: string,
  jobState: string,
  jobCoords: LatLng | null,
): 0 | 1 | 2 {
  const city = jobCity.trim().toLowerCase();
  const state = jobState.trim().toLowerCase();
  const list = cities ?? [];
  if (city && state) {
    const exact = list.some(
      (entry) =>
        (entry.city ?? "").trim().toLowerCase() === city &&
        (entry.state ?? "").trim().toLowerCase() === state,
    );
    if (exact) return 0;
  }
  if (jobCoords) {
    for (const entry of list) {
      const coords = latLngFrom(entry);
      if (!coords) continue;
      if (haversineMiles(jobCoords, coords) <= TERRITORY_NEAR_MILES) return 1;
    }
  }
  return 2;
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
  /** False when this date is outside the technician's working schedule. */
  available: boolean;
  fits: boolean;
  reason: string;
  driveSource: "google" | "haversine" | "none";
  driveFrom: "previousJob" | "home" | "unknown";
  driveFromLabel: string;
  driveKnown: boolean;
  /** True when the job's city is one of this technician's service cities. */
  inTerritory: boolean;
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

/**
 * Hours used to propose a start. When the technician is not scheduled, fall
 * back to their usual clock times so an override still has a concrete slot.
 */
function proposalRange(
  localDate: string,
  window: DayWindow,
): { start: Date; end: Date; available: boolean } | null {
  const scheduled = windowToUtcRange(localDate, window);
  if (scheduled) return { ...scheduled, available: true };

  const startHhmm = isHhMm(window.start) ? window.start : DEFAULT_DAY_START;
  const endHhmm = isHhMm(window.end) ? window.end : DEFAULT_DAY_END;
  let start = localDateToUtc(localDate, startHhmm);
  let end = localDateToUtc(localDate, endHhmm);
  if (end.getTime() <= start.getTime()) {
    start = localDateToUtc(localDate, DEFAULT_DAY_START);
    end = localDateToUtc(localDate, DEFAULT_DAY_END);
  }
  if (end.getTime() <= start.getTime()) return null;
  return { start, end, available: false };
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
  const siteCache = new Map<string, SitePoint | null>();

  let dest: LatLng | null = null;
  let jobCity = "";
  let jobState = "";
  const rememberPlace = (
    site: { city?: string | null; state?: string | null } | null | undefined,
  ) => {
    if (!site) return;
    if (!jobCity && site.city) jobCity = site.city.trim();
    if (!jobState) jobState = scheduleState(site);
  };
  if (workOrder.addressRef) {
    const site = await CustomerAddress.findById(workOrder.addressRef)
      .select(ADDRESS_POINT_FIELDS)
      .lean();
    rememberPlace(site);
    if (site) dest = await ensureAddressPoint(site, siteCache);
  }
  if (!dest && workOrder.customerRef) {
    const fallback = await CustomerAddress.findOne({
      customerRef: workOrder.customerRef,
    })
      .sort({ isPrimary: -1 })
      .select(ADDRESS_POINT_FIELDS)
      .lean();
    rememberPlace(fallback);
    if (fallback) dest = await ensureAddressPoint(fallback, siteCache);
  }

  let staff = await listSchedulableStaff();
  const typeId = workOrder.workOrderTypeRef?.toString();
  if (typeId) {
    const type = await WorkOrderType.findById(typeId)
      .select("qualifiedUserRefs")
      .lean();
    const qualifiedIds = (type?.qualifiedUserRefs ?? []).map((id) =>
      id.toString(),
    );
    if (qualifiedIds.length > 0) {
      const matched = staff.filter((user) =>
        qualifiedIds.includes(String(user._id)),
      );
      if (matched.length > 0) {
        staff = matched;
      }
    }
  }
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
          .select(ADDRESS_POINT_FIELDS)
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
    const addr = jobAddressById.get(id);
    if (!addr) continue;
    if (coords && shouldKeepStoredSitePoint(addr)) continue;
    const geocoded = await ensureAddressPoint(addr, siteCache);
    if (!geocoded) continue;
    jobCoords.set(id, geocoded);
  }

  const suggestions: SuggestCandidate[] = [];
  const tierByUser = new Map<string, number>();

  for (const tech of staff) {
    const tier = territoryTier(
      tech.serviceCities,
      jobCity,
      jobState,
      dest,
    );
    tierByUser.set(String(tech._id), tier);
    const inTerritory = tier === 0;
    const window = resolveDayWindow(
      tech.weeklyHours,
      tech.scheduleExceptions,
      opts.date,
    );
    const proposed = proposalRange(opts.date, window);
    if (!proposed) {
      suggestions.push({
        userId: String(tech._id),
        first_name: tech.first_name,
        last_name: tech.last_name,
        proposedStart: "",
        proposedEnd: "",
        driveMinutes: 0,
        remainingMinutes: 0,
        existingJobCount: 0,
        available: false,
        fits: false,
        reason: window.off ? "Marked off this day" : "Not working this weekday",
        driveSource: "none",
        inTerritory,
        ...emptyDriveFields(),
      });
      continue;
    }
    const range = proposed;
    const available = proposed.available;

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
    const withinHours =
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
    const fits = available && withinHours;

    let reason: string;
    if (!available) {
      reason = window.off ? "Marked off this day" : "Not working this weekday";
    } else if (fits && driveKnown) {
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
      available,
      fits,
      reason,
      driveSource,
      driveFrom,
      driveFromLabel,
      driveKnown,
      inTerritory,
    });
  }

  suggestions.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const aTier = tierByUser.get(a.userId) ?? 2;
    const bTier = tierByUser.get(b.userId) ?? 2;
    if (aTier !== bTier) return aTier - bTier;
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

export type AssigneeRecommendation = {
  userId: string;
  first_name: string;
  last_name: string;
  /** False when this date is outside the technician's working schedule. */
  available: boolean;
  reason: string;
};

function recommendationReason(pick: {
  tier: number;
  fits: boolean;
  available: boolean;
  miles: number;
  kind: "job" | "home" | null;
}): string {
  if (!pick.available) return "Not working this day";
  const parts: string[] = [];
  if (pick.tier === 0) parts.push("In territory");
  else if (pick.tier === 1) parts.push("Near territory");
  if (pick.kind && Number.isFinite(pick.miles)) {
    const rounded = Math.round(pick.miles);
    const miles = rounded < 1 ? "<1" : String(rounded);
    parts.push(
      pick.kind === "job"
        ? `${miles} mi from another job`
        : `${miles} mi from home`,
    );
  }
  if (!pick.fits) parts.push("day is full");
  return parts.join(" · ") || "Available";
}

function occupiedMinutes(
  jobs: Array<{ scheduledStart?: Date | null; scheduledEnd?: Date | null }>,
): number {
  return jobs.reduce((sum, job) => {
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
}

/**
 * Cheap assignee pick for a list of work orders. Uses territory cities,
 * straight-line distance to home and that day's jobs, and remaining capacity.
 * Does not call Google for drive times.
 */
export async function recommendAssignees(opts: {
  date: string;
  workOrderIds: string[];
}): Promise<{
  date: string;
  recommendations: Array<{
    workOrderId: string;
    recommendation: AssigneeRecommendation | null;
    /** Best match first. */
    technicians: AssigneeRecommendation[];
  }>;
}> {
  const ids = [
    ...new Set(
      opts.workOrderIds.filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ].slice(0, 200);

  if (ids.length === 0) {
    return { date: opts.date, recommendations: [] };
  }

  const [workOrders, staff] = await Promise.all([
    WorkOrder.find({ _id: { $in: ids } })
      .select(
        "addressRef customerRef workOrderTypeRef estimatedMinutes laborHours",
      )
      .lean(),
    listSchedulableStaff(),
  ]);

  const typeIds = [
    ...new Set(
      workOrders
        .map((wo) => wo.workOrderTypeRef?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const types =
    typeIds.length > 0
      ? await WorkOrderType.find({ _id: { $in: typeIds } })
          .select("qualifiedUserRefs")
          .lean()
      : [];
  const qualifiedByType = new Map(
    types.map((type) => [
      type._id.toString(),
      (type.qualifiedUserRefs ?? []).map((id) => id.toString()),
    ]),
  );

  const addressIds = new Set<string>();
  const fallbackCustomerIds: string[] = [];
  for (const wo of workOrders) {
    if (wo.addressRef) addressIds.add(wo.addressRef.toString());
    else if (wo.customerRef) fallbackCustomerIds.push(wo.customerRef.toString());
  }

  const { start: dayStart, end: dayEnd } = rangeUtc(opts.date, opts.date);
  const dayJobs =
    staff.length > 0
      ? await WorkOrder.find({
          assignedUserRef: { $in: staff.map((tech) => tech._id) },
          scheduledStart: { $gte: dayStart, $lte: dayEnd },
          completed: { $ne: true },
          $or: [
            { appointmentCanceledAt: null },
            { appointmentCanceledAt: { $exists: false } },
          ],
        })
          .select("assignedUserRef scheduledStart scheduledEnd addressRef")
          .lean()
      : [];

  for (const job of dayJobs) {
    if (job.addressRef) addressIds.add(job.addressRef.toString());
  }

  const [addresses, fallbacks] = await Promise.all([
    addressIds.size > 0
      ? CustomerAddress.find({ _id: { $in: [...addressIds] } })
          .select("_id lat lng city state")
          .lean()
      : [],
    fallbackCustomerIds.length > 0
      ? CustomerAddress.find({ customerRef: { $in: fallbackCustomerIds } })
          .sort({ isPrimary: -1 })
          .select("_id customerRef lat lng city state")
          .lean()
      : [],
  ]);

  const addressById = new Map(
    addresses.map((address) => [address._id.toString(), address]),
  );
  const fallbackByCustomer = new Map<string, (typeof fallbacks)[number]>();
  for (const address of fallbacks) {
    const key = address.customerRef?.toString() ?? "";
    if (key && !fallbackByCustomer.has(key)) fallbackByCustomer.set(key, address);
  }

  type JobSite = {
    city: string;
    state: string;
    coords: LatLng | null;
  };
  const siteFrom = (
    address:
      | { city?: string | null; state?: string | null; lat?: unknown; lng?: unknown }
      | null
      | undefined,
  ): JobSite => ({
    city: (address?.city ?? "").trim(),
    state: scheduleState(address),
    coords: addressCoords(address ?? null),
  });

  const dayJobsByUser = new Map<
    string,
    Array<{
      id: string;
      scheduledStart: Date | null;
      scheduledEnd: Date | null;
      coords: LatLng | null;
    }>
  >();
  for (const job of dayJobs) {
    const key = job.assignedUserRef?.toString() ?? "";
    if (!key) continue;
    const address = job.addressRef
      ? addressById.get(job.addressRef.toString())
      : undefined;
    const list = dayJobsByUser.get(key) ?? [];
    list.push({
      id: job._id.toString(),
      scheduledStart: job.scheduledStart ? new Date(job.scheduledStart) : null,
      scheduledEnd: job.scheduledEnd ? new Date(job.scheduledEnd) : null,
      coords: addressCoords(address ?? null),
    });
    dayJobsByUser.set(key, list);
  }

  const ranked = new Map<string, AssigneeRecommendation[]>();

  for (const wo of workOrders) {
    const site = wo.addressRef
      ? siteFrom(addressById.get(wo.addressRef.toString()))
      : siteFrom(
          wo.customerRef
            ? fallbackByCustomer.get(wo.customerRef.toString())
            : null,
        );
    const estimated = estimatedMinutesForWorkOrder(wo);
    const qualifiedIds = wo.workOrderTypeRef
      ? (qualifiedByType.get(wo.workOrderTypeRef.toString()) ?? [])
      : [];
    let candidates = staff;
    if (qualifiedIds.length > 0) {
      const matched = staff.filter((tech) =>
        qualifiedIds.includes(String(tech._id)),
      );
      if (matched.length > 0) candidates = matched;
    }

    const picks: Array<{
      tech: LeanUser;
      tier: number;
      fits: boolean;
      available: boolean;
      miles: number;
      kind: "job" | "home" | null;
    }> = [];

    for (const tech of candidates) {
      const window = resolveDayWindow(
        tech.weeklyHours,
        tech.scheduleExceptions,
        opts.date,
      );
      const range = windowToUtcRange(opts.date, window);
      const available = range != null;

      const existing = (dayJobsByUser.get(String(tech._id)) ?? []).filter(
        (job) => job.id !== wo._id.toString(),
      );
      const windowMinutes = range
        ? Math.round((range.end.getTime() - range.start.getTime()) / 60000)
        : 0;
      const remaining = Math.max(
        0,
        windowMinutes - occupiedMinutes(existing),
      );
      const tier = territoryTier(
        tech.serviceCities,
        site.city,
        site.state,
        site.coords,
      );

      let miles = Number.POSITIVE_INFINITY;
      let kind: "job" | "home" | null = null;
      const home = homeCoords(tech.homeLocation);
      if (home && site.coords) {
        miles = haversineMiles(site.coords, home);
        kind = "home";
      }
      if (site.coords) {
        for (const job of existing) {
          if (!job.coords) continue;
          const distance = haversineMiles(site.coords, job.coords);
          if (distance < miles) {
            miles = distance;
            kind = "job";
          }
        }
      }

      picks.push({
        tech,
        tier,
        available,
        fits: available && remaining >= estimated,
        miles,
        kind,
      });
    }

    picks.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      const aKnown = Number.isFinite(a.miles);
      const bKnown = Number.isFinite(b.miles);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && bKnown && a.miles !== b.miles) return a.miles - b.miles;
      return staffDisplayName(a.tech).localeCompare(staffDisplayName(b.tech));
    });

    ranked.set(
      wo._id.toString(),
      picks.map((pick) => ({
        userId: String(pick.tech._id),
        first_name: pick.tech.first_name,
        last_name: pick.tech.last_name,
        available: pick.available,
        reason: recommendationReason(pick),
      })),
    );
  }

  return {
    date: opts.date,
    recommendations: ids.map((id) => {
      const technicians = ranked.get(id) ?? [];
      return {
        workOrderId: id,
        recommendation: technicians.find((tech) => tech.available) ?? null,
        technicians,
      };
    }),
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
      "first_name last_name email role roles schedulable homeLocation weeklyHours scheduleExceptions",
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

const ROUTE_MATRIX_ELEMENTS = 625;

function routeError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

async function fullDriveMatrix(points: LatLng[]): Promise<RouteMatrixCell[]> {
  if (points.length === 0) return [];
  const originBatch = Math.max(
    1,
    Math.floor(ROUTE_MATRIX_ELEMENTS / points.length),
  );
  const cells: RouteMatrixCell[] = [];
  for (let offset = 0; offset < points.length; offset += originBatch) {
    const origins = points.slice(offset, offset + originBatch);
    const batch = await computeDriveMinutesMatrix(origins, points);
    for (const cell of batch) {
      cells.push({ ...cell, originIndex: cell.originIndex + offset });
    }
  }
  return cells;
}

function denseRouteCost(
  points: LatLng[],
  cells: RouteMatrixCell[],
  objective: RouteObjective,
): number[][] {
  const size = points.length;
  const cost = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const seen = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const cell of cells) {
    if (
      cell.originIndex < 0 ||
      cell.originIndex >= size ||
      cell.destinationIndex < 0 ||
      cell.destinationIndex >= size
    ) {
      continue;
    }
    cost[cell.originIndex]![cell.destinationIndex] = metricCost(cell, objective);
    seen[cell.originIndex]![cell.destinationIndex] = true;
  }
  for (let from = 0; from < size; from += 1) {
    for (let to = 0; to < size; to += 1) {
      if (from === to || seen[from]![to]) continue;
      const start = points[from]!;
      const end = points[to]!;
      cost[from]![to] =
        objective === "time"
          ? haversineDriveMinutes(start, end)
          : Math.round(haversineMiles(start, end) * 1609.34);
    }
  }
  return cost;
}

function denseDriveMinutes(
  points: LatLng[],
  cells: RouteMatrixCell[],
): number[][] {
  const size = points.length;
  const minutes = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const seen = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const cell of cells) {
    if (
      cell.originIndex < 0 ||
      cell.originIndex >= size ||
      cell.destinationIndex < 0 ||
      cell.destinationIndex >= size
    ) {
      continue;
    }
    minutes[cell.originIndex]![cell.destinationIndex] = cell.durationMinutes;
    seen[cell.originIndex]![cell.destinationIndex] = true;
  }
  for (let from = 0; from < size; from += 1) {
    for (let to = 0; to < size; to += 1) {
      if (from === to || seen[from]![to]) continue;
      minutes[from]![to] = haversineDriveMinutes(points[from]!, points[to]!);
    }
  }
  return minutes;
}

function lockArrivalById(
  locks: Array<{ workOrderId: string; arrival: string }> | undefined,
): Map<string, Date> {
  const byId = new Map<string, Date>();
  for (const lock of locks ?? []) {
    const arrival = new Date(lock.arrival);
    if (Number.isNaN(arrival.getTime())) continue;
    byId.set(lock.workOrderId, arrival);
  }
  return byId;
}

function formatRouteClock(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function loadRouteAssignee(userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw routeError("Invalid user.");
  }
  const user = await User.findOne({
    _id: userId,
    ...activeUserFilter,
  }).select(
    "first_name last_name email role roles schedulable homeLocation weeklyHours scheduleExceptions",
  );
  if (!user) {
    throw routeError("User not found", 404);
  }
  if (!user.schedulable) {
    throw routeError("Assigned user cannot be scheduled for work orders.");
  }
  return user;
}

async function ensureRouteHome(user: {
  _id: mongoose.Types.ObjectId;
  homeLocation?: HomeLocation | null;
}): Promise<LatLng> {
  const geocodeCache = new Map<string, LatLng | null>();
  let home = homeCoords(user.homeLocation);
  if (!home && user.homeLocation?.address?.trim()) {
    home = await geocodeToLatLng(user.homeLocation, geocodeCache);
    if (home) {
      await User.updateOne(
        { _id: user._id },
        { $set: { "homeLocation.lat": home.lat, "homeLocation.lng": home.lng } },
      );
    }
  }
  if (!home) {
    throw routeError(
      "Add a home location for this technician before planning a route.",
    );
  }
  return home;
}

async function loadOrderedWorkOrders(ids: string[]) {
  if (new Set(ids).size !== ids.length) {
    throw routeError("Duplicate work orders in the route.");
  }
  for (const id of ids) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw routeError("Invalid work order.");
    }
  }
  if (ids.length === 0) return [];
  const docs = await WorkOrder.find({ _id: { $in: ids } });
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  return ids.map((id) => {
    const doc = byId.get(id);
    if (!doc) throw routeError("Work order not found.");
    return doc;
  });
}

function assertJobCanJoinRoute(
  job: { completed?: boolean; scheduledStart?: Date | null; assignedUserRef?: { toString(): string } | null; customerName?: string | null },
  userId: string,
  date: string,
): void {
  if (job.completed) {
    throw routeError("Completed work orders cannot be rescheduled.");
  }
  const assigneeId = job.assignedUserRef?.toString() ?? "";
  if (assigneeId && assigneeId !== userId) {
    throw routeError(
      `${placeJobLabel(job)} is already assigned to another technician.`,
    );
  }
  if (!job.scheduledStart) return;
  if (formatLocalDate(job.scheduledStart) !== date) {
    throw routeError(`${placeJobLabel(job)} is already scheduled on another day.`);
  }
}

export type PlannedRouteStop = {
  kind: "home" | "job";
  label: string;
  lat: number | null;
  lng: number | null;
  workOrderId?: string;
  scheduledStart?: string | null;
  arrival?: string | null;
  departure?: string | null;
};

export type PlannedRoute = {
  stops: PlannedRouteStop[];
  route: Awaited<ReturnType<typeof computeDayRoute>>;
  orderedWorkOrderIds: string[];
  warnings: string[];
};

export async function planRouteForUser(opts: {
  userId: string;
  date: string;
  workOrderIds: string[];
  roundTrip: boolean;
  objective: RouteObjective;
  optimize: boolean;
  lockedStops?: Array<{ workOrderId: string; arrival: string }>;
}): Promise<PlannedRoute> {
  const user = await loadRouteAssignee(opts.userId);
  const home = await ensureRouteHome(user);
  const jobs = await loadOrderedWorkOrders(opts.workOrderIds);
  for (const job of jobs) {
    assertJobCanJoinRoute(job, String(user._id), opts.date);
  }

  const warnings: string[] = [];
  const addressIds = [
    ...new Set(
      jobs
        .map((job) => job.addressRef?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const addressPoints = await coordsByAddressId(addressIds);
  const located: Array<{
    job: (typeof jobs)[number];
    coords: LatLng;
  }> = [];
  const missingLabels: string[] = [];
  for (const job of jobs) {
    const addressId = job.addressRef?.toString();
    const coords = addressId ? (addressPoints.get(addressId) ?? null) : null;
    if (!coords) {
      missingLabels.push(placeJobLabel(job));
      continue;
    }
    located.push({ job, coords });
  }
  if (missingLabels.length > 0) {
    warnings.push(
      `Some jobs have no map location and were left off the route: ${missingLabels.join(", ")}.`,
    );
  }

  const limited = limitRouteJobs(located);
  if (limited.truncated) {
    warnings.push(
      `Only the first ${limited.jobs.length} stops can be routed. Extra stops were left off the route.`,
    );
  }
  let visit = limited.jobs;
  const lockById = lockArrivalById(opts.lockedStops);
  const dayWindow = resolveDayWindow(
    user.weeklyHours,
    user.scheduleExceptions,
    opts.date,
  );
  const workRange = windowToUtcRange(opts.date, dayWindow);
  if (opts.optimize && visit.length > 1) {
    const points = [home, ...visit.map((row) => row.coords)];
    const cells = await fullDriveMatrix(points);
    const cost = denseRouteCost(points, cells, opts.objective);
    const lockedHere = visit.some((row) => lockById.has(String(row.job._id)));
    const order =
      lockedHere && workRange
        ? optimizeAroundLocks({
            cost,
            driveMinutes: denseDriveMinutes(points, cells),
            serviceMinutes: [
              0,
              ...visit.map((row) => estimatedMinutesForWorkOrder(row.job)),
            ],
            lockedOffsetMinutes: [
              null,
              ...visit.map((row) => {
                const locked = lockById.get(String(row.job._id));
                if (!locked) return null;
                return Math.round(
                  (locked.getTime() - workRange.start.getTime()) / 60000,
                );
              }),
            ],
            roundTrip: opts.roundTrip,
          })
        : optimizeJobOrder({
            cost,
            jobCount: visit.length,
            roundTrip: opts.roundTrip,
          });
    visit = order.map((index) => visit[index - 1]!);
  }
  const visitIds = new Set(visit.map((row) => String(row.job._id)));
  for (const [workOrderId] of lockById) {
    if (visitIds.has(workOrderId)) continue;
    const job = jobs.find((row) => String(row._id) === workOrderId);
    warnings.push(
      `${job ? placeJobLabel(job) : "A locked stop"} is not on the route, so its time was not kept.`,
    );
  }

  const stops: PlannedRouteStop[] = [
    { kind: "home", label: "Home", lat: home.lat, lng: home.lng },
  ];
  for (const row of visit) {
    stops.push({
      kind: "job",
      label: placeJobLabel(row.job),
      lat: row.coords.lat,
      lng: row.coords.lng,
      workOrderId: String(row.job._id),
      scheduledStart: row.job.scheduledStart
        ? row.job.scheduledStart.toISOString()
        : null,
    });
  }
  if (opts.roundTrip) {
    stops.push({
      kind: "home",
      label: "Home (return)",
      lat: home.lat,
      lng: home.lng,
    });
  }

  const points = visit.map((row) => row.coords);
  let route: PlannedRoute["route"] = null;
  if (points.length > 0) {
    route = opts.roundTrip
      ? await computeDayRoute(home, home, points)
      : points.length === 1
        ? await computeDayRoute(home, points[0]!, [])
        : await computeDayRoute(
            home,
            points[points.length - 1]!,
            points.slice(0, -1),
          );
  }

  if (workRange) {
    const legs = route?.legs ?? [];
    let cursorEnd = workRange.start;
    visit.forEach((row, index) => {
      const driveMinutes =
        index === 0 ? 0 : (legs[index]?.durationMinutes ?? 0);
      const earliest =
        index === 0
          ? new Date(workRange.start)
          : addMinutes(cursorEnd, driveMinutes);
      const locked = lockById.get(String(row.job._id)) ?? null;
      const arrival = locked ?? earliest;
      if (locked && locked.getTime() + 1000 < earliest.getTime()) {
        warnings.push(
          `${placeJobLabel(row.job)} stays at ${formatRouteClock(locked)}, which is earlier than the stop before it allows.`,
        );
      }
      const departure = addMinutes(
        arrival,
        estimatedMinutesForWorkOrder(row.job),
      );
      cursorEnd = departure;
      const stop = stops.find(
        (item) => item.workOrderId === String(row.job._id),
      );
      if (!stop) return;
      stop.arrival = arrival.toISOString();
      stop.departure = departure.toISOString();
    });
  }

  return {
    stops,
    route,
    orderedWorkOrderIds: visit.map((row) => String(row.job._id)),
    warnings,
  };
}

export async function applyPlannedRoute(opts: {
  userId: string;
  date: string;
  orderedWorkOrderIds: string[];
  lockedStops?: Array<{ workOrderId: string; arrival: string }>;
}): Promise<{ workOrders: EnrichedWorkOrder[]; warnings: string[] }> {
  if (opts.orderedWorkOrderIds.length === 0) {
    throw routeError("Choose at least one stop.");
  }
  const user = await loadRouteAssignee(opts.userId);
  const dayWindow = resolveDayWindow(
    user.weeklyHours,
    user.scheduleExceptions,
    opts.date,
  );
  const workRange = windowToUtcRange(opts.date, dayWindow);
  if (!workRange) {
    throw routeError("This day is marked unavailable for the assigned technician.");
  }

  const sequence = await loadOrderedWorkOrders(opts.orderedWorkOrderIds);
  for (const job of sequence) {
    assertJobCanJoinRoute(job, String(user._id), opts.date);
  }

  const dayStart = localDateToUtc(opts.date, "00:00");
  const dayEnd = localDateToUtc(opts.date, "23:59");
  const existing = await WorkOrder.find({
    assignedUserRef: user._id,
    scheduledStart: { $gte: dayStart, $lte: dayEnd },
    completed: { $ne: true },
  }).select("_id customerName");
  const included = new Set(opts.orderedWorkOrderIds);
  const omitted = existing.filter((job) => !included.has(String(job._id)));
  if (omitted.length > 0) {
    throw routeError(
      `Route must include every job already scheduled for this technician on this day: ${omitted.map((job) => placeJobLabel(job)).join(", ")}.`,
    );
  }

  const addressIds = [
    ...new Set(
      sequence
        .map((job) => job.addressRef?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const addressPoints = await coordsByAddressId(addressIds);
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const pointFor = (job: (typeof sequence)[number]): LatLng | null => {
    const id = job.addressRef?.toString();
    if (!id) return null;
    return addressPoints.get(id) ?? null;
  };
  const driveBetween = async (
    from: LatLng | null,
    to: LatLng | null,
    fromLabel: string,
    toLabel: string,
  ): Promise<number> => {
    if (!from || !to) {
      warn(
        `Drive time from ${fromLabel} to ${toLabel} is unknown and was treated as 0 minutes.`,
      );
      return 0;
    }
    const drive = await computeDriveMinutes(from, to);
    return drive.minutes;
  };

  let cursorEnd: Date | null = null;
  let cursorPoint: LatLng | null = null;
  let cursorLabel = "home";
  const lockById = lockArrivalById(opts.lockedStops);
  for (let index = 0; index < sequence.length; index += 1) {
    const job = sequence[index]!;
    const duration = estimatedMinutesForWorkOrder(job);
    const point = pointFor(job);
    const earliest =
      index === 0
        ? new Date(workRange.start)
        : addMinutes(
            cursorEnd ?? workRange.start,
            await driveBetween(
              cursorPoint,
              point,
              cursorLabel,
              placeJobLabel(job),
            ),
          );
    const locked = lockById.get(String(job._id)) ?? null;
    const start = locked ?? earliest;
    if (locked && locked.getTime() + 1000 < earliest.getTime()) {
      warn(
        `${placeJobLabel(job)} stays at ${formatRouteClock(locked)}, which is earlier than the stop before it allows.`,
      );
    }
    const end = addMinutes(start, duration);
    job.scheduledStart = start;
    job.scheduledEnd = end;
    job.estimatedMinutes = duration;
    job.assignedUserRef = user._id;
    job.appointmentCanceledAt = null;
    job.appointmentCanceledBy = null;
    await applyAssignmentSideEffects(job, user);
    const hoursWarn = availabilityWarning({
      weeklyHours: user.weeklyHours,
      exceptions: user.scheduleExceptions,
      localDate: opts.date,
      start,
      end,
    });
    if (hoursWarn) warn(`${placeJobLabel(job)}: ${hoursWarn}`);
    cursorEnd = end;
    cursorPoint = point;
    cursorLabel = placeJobLabel(job);
  }

  for (const job of sequence) {
    await job.save();
  }

  const workOrders = await enrichScheduleWorkOrders(
    sequence.map((job) => job.toObject() as unknown as Record<string, unknown>),
  );
  return { workOrders, warnings };
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

function placeJobLabel(workOrder: { customerName?: string | null }): string {
  const name = workOrder.customerName?.trim();
  return name || "Work order";
}

async function coordsByAddressId(
  addressIds: string[],
): Promise<Map<string, LatLng | null>> {
  const coords = new Map<string, LatLng | null>();
  if (addressIds.length === 0) return coords;
  const addresses = await CustomerAddress.find({ _id: { $in: addressIds } })
    .select(ADDRESS_POINT_FIELDS)
    .lean();
  const siteCache = new Map<string, SitePoint | null>();
  for (const address of addresses) {
    const point = await ensureAddressPoint(address, siteCache);
    coords.set(String(address._id), point);
  }
  return coords;
}

export type ScheduleStartOptions = {
  isFirst: boolean;
  earliestStart: string | null;
  driveMinutes: number | null;
  driveFromLabel: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  warning: string | null;
  date: string;
  assignedUserRef: string;
};

export async function startOptionsForWorkOrder(
  workOrderId: string,
): Promise<ScheduleStartOptions> {
  if (!mongoose.Types.ObjectId.isValid(workOrderId)) {
    throw Object.assign(new Error("Invalid workOrderId"), { status: 400 });
  }

  const job = await WorkOrder.findById(workOrderId);
  if (!job) {
    throw Object.assign(new Error("Work order not found"), { status: 404 });
  }
  if (!job.scheduledStart) {
    throw Object.assign(new Error("Work order is not scheduled"), { status: 400 });
  }
  if (!job.assignedUserRef) {
    throw Object.assign(new Error("Work order is not assigned"), { status: 400 });
  }

  const assignee = await User.findOne({
    _id: job.assignedUserRef,
    ...activeUserFilter,
  }).select("homeLocation weeklyHours scheduleExceptions");
  if (!assignee) {
    throw Object.assign(new Error("Assigned user not found"), { status: 400 });
  }

  const date = formatLocalDate(job.scheduledStart);
  const dayStart = localDateToUtc(date, "00:00");
  const earlier = await WorkOrder.find({
    assignedUserRef: assignee._id,
    scheduledStart: { $gte: dayStart, $lt: job.scheduledStart },
    _id: { $ne: job._id },
  }).sort({ scheduledStart: -1 });
  const previous = earlier[0] ?? null;

  const dayWindow = resolveDayWindow(
    assignee.weeklyHours,
    assignee.scheduleExceptions,
    date,
  );
  const workRange = windowToUtcRange(date, dayWindow);
  const addressIds = [job.addressRef?.toString(), previous?.addressRef?.toString()].filter(
    (id): id is string => Boolean(id),
  );
  const addressPoints = await coordsByAddressId([...new Set(addressIds)]);
  const pointFor = (row: { addressRef?: { toString(): string } | null }): LatLng | null => {
    const id = row.addressRef?.toString();
    if (!id) return null;
    return addressPoints.get(id) ?? null;
  };

  const geocodeCache = new Map<string, LatLng | null>();
  let home = homeCoords(assignee.homeLocation);
  if (!home && assignee.homeLocation?.address?.trim()) {
    home = await geocodeToLatLng(assignee.homeLocation, geocodeCache);
    if (home) {
      await User.updateOne(
        { _id: assignee._id },
        { $set: { "homeLocation.lat": home.lat, "homeLocation.lng": home.lng } },
      );
    }
  }

  const base = {
    date,
    assignedUserRef: String(assignee._id),
    windowStart: workRange?.start.toISOString() ?? null,
    windowEnd: workRange?.end.toISOString() ?? null,
  };

  if (!previous) {
    const dest = pointFor(job);
    if (home && dest) {
      const drive = await computeDriveMinutes(home, dest);
      return {
        ...base,
        isFirst: true,
        earliestStart: null,
        driveMinutes: drive.minutes,
        driveFromLabel: "home",
        warning: null,
      };
    }
    return {
      ...base,
      isFirst: true,
      earliestStart: null,
      driveMinutes: null,
      driveFromLabel: null,
      warning: null,
    };
  }

  const previousDuration = estimatedMinutesForWorkOrder(previous);
  const previousEnd =
    previous.scheduledEnd ??
    (previous.scheduledStart
      ? addMinutes(previous.scheduledStart, previousDuration)
      : job.scheduledStart);
  const from = pointFor(previous);
  const to = pointFor(job);
  const fromLabel = placeJobLabel(previous);
  const toLabel = placeJobLabel(job);
  let driveMinutes = 0;
  let warning: string | null = null;
  if (!from || !to) {
    warning = `Drive time from ${fromLabel} to ${toLabel} is unknown and was treated as 0 minutes.`;
  } else {
    const drive = await computeDriveMinutes(from, to);
    driveMinutes = drive.minutes;
  }

  return {
    ...base,
    isFirst: false,
    earliestStart: addMinutes(previousEnd, driveMinutes).toISOString(),
    driveMinutes: warning ? null : driveMinutes,
    driveFromLabel: fromLabel,
    warning,
  };
}

export async function placeWorkOrder(opts: {
  workOrderId: string;
  assignedUserRef: string;
  date: string;
  scheduledStart: Date;
  estimatedMinutes?: number;
}): Promise<{ workOrders: EnrichedWorkOrder[]; warnings: string[] }> {
  if (!mongoose.Types.ObjectId.isValid(opts.workOrderId)) {
    throw Object.assign(new Error("Invalid workOrderId"), { status: 400 });
  }
  if (!mongoose.Types.ObjectId.isValid(opts.assignedUserRef)) {
    throw Object.assign(new Error("Invalid assignedUserRef"), { status: 400 });
  }
  if (Number.isNaN(opts.scheduledStart.getTime())) {
    throw Object.assign(new Error("Invalid scheduledStart"), { status: 400 });
  }

  const dropped = await WorkOrder.findById(opts.workOrderId);
  if (!dropped) {
    throw Object.assign(new Error("Work order not found"), { status: 404 });
  }
  if (dropped.completed) {
    throw Object.assign(new Error("Completed work orders cannot be rescheduled"), {
      status: 400,
    });
  }

  const assignee = await User.findOne({
    _id: opts.assignedUserRef,
    ...activeUserFilter,
  }).select(
    "first_name last_name schedulable homeLocation weeklyHours scheduleExceptions",
  );
  if (!assignee) {
    throw Object.assign(new Error("Assigned user not found"), { status: 400 });
  }
  if (!assignee.schedulable) {
    throw Object.assign(
      new Error("Assigned user cannot be scheduled for work orders"),
      { status: 400 },
    );
  }

  const dayStart = localDateToUtc(opts.date, "00:00");
  const dayEnd = localDateToUtc(opts.date, "23:59");
  const existing = await WorkOrder.find({
    assignedUserRef: assignee._id,
    scheduledStart: { $gte: dayStart, $lte: dayEnd },
    _id: { $ne: dropped._id },
  }).sort({ scheduledStart: 1 });

  const insertAt = existing.findIndex((job) => {
    const start = job.scheduledStart?.getTime() ?? Number.POSITIVE_INFINITY;
    return start >= opts.scheduledStart.getTime();
  });
  const index = insertAt === -1 ? existing.length : insertAt;
  const sequence = [...existing];
  sequence.splice(index, 0, dropped);

  const addressIds = [
    ...new Set(
      sequence
        .map((job) => job.addressRef?.toString())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const addressPoints = await coordsByAddressId(addressIds);
  const geocodeCache = new Map<string, LatLng | null>();
  let home = homeCoords(assignee.homeLocation);
  if (!home && assignee.homeLocation?.address?.trim()) {
    home = await geocodeToLatLng(assignee.homeLocation, geocodeCache);
    if (home) {
      await User.updateOne(
        { _id: assignee._id },
        { $set: { "homeLocation.lat": home.lat, "homeLocation.lng": home.lng } },
      );
    }
  }

  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const pointFor = (job: InstanceType<typeof WorkOrder>): LatLng | null => {
    const id = job.addressRef?.toString();
    if (!id) return null;
    return addressPoints.get(id) ?? null;
  };
  const driveBetween = async (
    from: LatLng | null,
    to: LatLng | null,
    fromLabel: string,
    toLabel: string,
  ): Promise<number> => {
    if (!from || !to) {
      warn(
        `Drive time from ${fromLabel} to ${toLabel} is unknown and was treated as 0 minutes.`,
      );
      return 0;
    }
    const drive = await computeDriveMinutes(from, to);
    return drive.minutes;
  };

  const dayWindow = resolveDayWindow(
    assignee.weeklyHours,
    assignee.scheduleExceptions,
    opts.date,
  );
  const workRange = windowToUtcRange(opts.date, dayWindow);

  let previousEnd: Date | null = null;
  let previousPoint: LatLng | null = null;
  let previousLabel = "home";
  if (index === 0) {
    previousPoint = home;
    previousEnd = workRange?.start ?? null;
  } else {
    const previous = sequence[index - 1];
    if (previous) {
      previousPoint = pointFor(previous);
      previousLabel = placeJobLabel(previous);
      const previousDuration = estimatedMinutesForWorkOrder(previous);
      previousEnd =
        previous.scheduledEnd ??
        (previous.scheduledStart
          ? addMinutes(previous.scheduledStart, previousDuration)
          : null);
    }
  }

  const inserted = sequence[index];
  if (!inserted) {
    throw Object.assign(new Error("Work order not found"), { status: 404 });
  }
  if (typeof opts.estimatedMinutes === "number" && opts.estimatedMinutes > 0) {
    inserted.estimatedMinutes = opts.estimatedMinutes;
  }
  const insertedDuration = estimatedMinutesForWorkOrder(inserted);
  const isFirstStop = index === 0;
  const inboundDrive = isFirstStop
    ? 0
    : await driveBetween(
        previousPoint,
        pointFor(inserted),
        previousLabel,
        placeJobLabel(inserted),
      );
  const earliestInserted =
    !isFirstStop && previousEnd
      ? addMinutes(previousEnd, inboundDrive)
      : opts.scheduledStart;
  const insertedStart = new Date(
    Math.max(opts.scheduledStart.getTime(), earliestInserted.getTime()),
  );
  const insertedEnd = addMinutes(insertedStart, insertedDuration);
  inserted.scheduledStart = insertedStart;
  inserted.scheduledEnd = insertedEnd;
  inserted.estimatedMinutes = insertedDuration;
  inserted.assignedUserRef = assignee._id;
  inserted.appointmentCanceledAt = null;
  inserted.appointmentCanceledBy = null;
  await applyAssignmentSideEffects(inserted, assignee);

  const hoursWarn = availabilityWarning({
    weeklyHours: assignee.weeklyHours,
    exceptions: assignee.scheduleExceptions,
    localDate: opts.date,
    start: insertedStart,
    end: insertedEnd,
  });
  if (hoursWarn) warn(`${placeJobLabel(inserted)}: ${hoursWarn}`);

  const changed: Array<InstanceType<typeof WorkOrder>> = [inserted];
  let cursorEnd = insertedEnd;
  let cursorPoint = pointFor(inserted);
  let cursorLabel = placeJobLabel(inserted);

  for (let i = index + 1; i < sequence.length; i += 1) {
    const job = sequence[i];
    if (!job) break;
    const duration = estimatedMinutesForWorkOrder(job);
    const drive = await driveBetween(
      cursorPoint,
      pointFor(job),
      cursorLabel,
      placeJobLabel(job),
    );
    const earliest = addMinutes(cursorEnd, drive);
    const currentStart = job.scheduledStart;
    if (currentStart && currentStart.getTime() >= earliest.getTime()) break;

    const start = earliest;
    const end = addMinutes(start, duration);
    job.scheduledStart = start;
    job.scheduledEnd = end;
    job.estimatedMinutes = duration;
    await applyAssignmentSideEffects(job, assignee);
    changed.push(job);
    const jobWarn = availabilityWarning({
      weeklyHours: assignee.weeklyHours,
      exceptions: assignee.scheduleExceptions,
      localDate: opts.date,
      start,
      end,
    });
    if (jobWarn) warn(`${placeJobLabel(job)}: ${jobWarn}`);
    cursorEnd = end;
    cursorPoint = pointFor(job);
    cursorLabel = placeJobLabel(job);
  }

  for (const job of changed) {
    await job.save();
  }

  const workOrders = await enrichScheduleWorkOrders(
    changed.map((job) => job.toObject() as unknown as Record<string, unknown>),
  );
  return { workOrders, warnings };
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
  /** With a date range, also return unscheduled work orders that have no date. */
  includeUndated?: boolean;
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
  };
  if (dateWindow && opts.includeUndated) {
    unscheduledFilter.$or = [
      dateWindow,
      { date: null },
      { date: { $exists: false } },
    ];
  } else if (dateWindow) {
    Object.assign(unscheduledFilter, dateWindow);
  } else {
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

/** Next open appointment windows on schedulable staff (next ~14 days). */
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
