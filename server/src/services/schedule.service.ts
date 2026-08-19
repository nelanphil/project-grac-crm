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

function homeCoords(home?: HomeLocation | null): LatLng | null {
  if (
    home &&
    typeof home.lat === "number" &&
    typeof home.lng === "number" &&
    Number.isFinite(home.lat) &&
    Number.isFinite(home.lng)
  ) {
    return { lat: home.lat, lng: home.lng };
  }
  return null;
}

function addressCoords(
  addr: { lat?: number | null; lng?: number | null } | null,
): LatLng | null {
  if (
    addr &&
    typeof addr.lat === "number" &&
    typeof addr.lng === "number" &&
    Number.isFinite(addr.lat) &&
    Number.isFinite(addr.lng)
  ) {
    return { lat: addr.lat, lng: addr.lng };
  }
  return null;
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
};

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

  let dest: LatLng | null = null;
  if (workOrder.addressRef) {
    const site = await CustomerAddress.findById(workOrder.addressRef)
      .select("lat lng")
      .lean();
    dest = addressCoords(site);
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
      "assignedUserRef scheduledStart scheduledEnd estimatedMinutes addressRef",
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
  const jobAddresses =
    jobAddressIds.length > 0
      ? await CustomerAddress.find({ _id: { $in: jobAddressIds } })
          .select("_id lat lng")
          .lean()
      : [];
  const jobCoords = new Map(
    jobAddresses.map((a) => [a._id.toString(), addressCoords(a)]),
  );

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
    const fromCoords = lastJob?.addressRef
      ? (jobCoords.get(lastJob.addressRef.toString()) ??
        homeCoords(tech.homeLocation))
      : homeCoords(tech.homeLocation);

    let driveMinutes = 0;
    let driveSource: SuggestCandidate["driveSource"] = "none";
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
      reason: fits
        ? "Fits after existing jobs"
        : remainingMinutes < estimatedMinutes
          ? "Not enough remaining capacity"
          : "Does not fit before end of day",
      driveSource,
    });
  }

  suggestions.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1;
    if (a.driveMinutes !== b.driveMinutes) {
      return a.driveMinutes - b.driveMinutes;
    }
    return a.existingJobCount - b.existingJobCount;
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
