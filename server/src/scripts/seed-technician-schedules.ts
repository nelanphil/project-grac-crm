/**
 * Fills the development database with scheduled work orders for every
 * schedulable technician, so the schedule calendar can be tested.
 *
 *   npx tsx src/scripts/seed-technician-schedules.ts
 *
 * Refuses to run when NODE_ENV=production or when the URI points at the
 * production cluster. Re-running replaces earlier seed appointments
 * (userId 900000001) and leaves real work orders in place.
 */
import dotenv from "dotenv";
import path from "path";

const envCandidates = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../../.env"),
];
for (const envPath of envCandidates) {
  dotenv.config({ path: envPath });
}

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { env } from "../config/env";
import { User, activeUserFilter } from "../models/mongo/User";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { customerDisplayName } from "../services/notification.service";
import {
  addMinutes,
  formatLocalDate,
  formatLocalTime,
  localDateToUtc,
  rangesOverlap,
  resolveDayWindow,
  windowToUtcRange,
} from "../utils/scheduleTime";

/** Legacy numeric user id reserved for these test appointments. Not shown in the app. */
const SEED_USER_ID = 900_000_001;
const SEED_MARKER = "dev-schedule-seed";
const CALENDAR_DAYS = 14;
const SLOTS = [
  { start: "08:00", minutes: 90 },
  { start: "10:00", minutes: 90 },
  { start: "13:00", minutes: 90 },
  { start: "15:00", minutes: 90 },
] as const;
const JOBS = [
  "Annual generator service",
  "No-start diagnostic",
  "Transfer switch inspection",
  "Battery and charger check",
  "Oil and filter service",
  "Load bank test",
  "Exercise failure follow-up",
  "Coolant leak inspection",
];

type Site = {
  customerId: number;
  customerRef: mongoose.Types.ObjectId;
  addressRef: mongoose.Types.ObjectId;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerZip: string;
  customerPhone: string;
  customerEmail: string;
  serialNumber: string;
  generatorModel: string;
};

type Busy = { start: Date; end: Date };

function assertDevelopment(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed schedules while NODE_ENV=production.");
  }
  if (env.mongodbUri.includes("production.wkbxjzd")) {
    throw new Error("Refusing to seed the production cluster.");
  }
}

function localDatesFromToday(count: number): string[] {
  const dates: string[] = [];
  let local = formatLocalDate(new Date());
  for (let i = 0; i < count; i += 1) {
    dates.push(local);
    local = formatLocalDate(addMinutes(localDateToUtc(local, "12:00"), 24 * 60));
  }
  return dates;
}

async function loadSites(): Promise<Site[]> {
  const addresses = await CustomerAddress.find({
    lat: { $type: "number" },
    lng: { $type: "number" },
    address: { $nin: ["", null] },
  })
    .select("customerRef address city zip")
    .lean();

  const customerIds = [
    ...new Set(addresses.map((address) => String(address.customerRef))),
  ];
  const customers = await Customer.find({
    _id: { $in: customerIds },
    deletedAt: null,
    mergedIntoRef: null,
    isTemporary: { $ne: true },
  })
    .select("legacyId accountName first last phone email serial generatorModel")
    .lean();
  const customerById = new Map(customers.map((customer) => [String(customer._id), customer]));

  const sites: Site[] = [];
  for (const address of addresses) {
    const customer = customerById.get(String(address.customerRef));
    if (!customer || typeof customer.legacyId !== "number") continue;
    sites.push({
      customerId: customer.legacyId,
      customerRef: customer._id,
      addressRef: address._id,
      customerName: customerDisplayName(customer),
      customerAddress: address.address ?? "",
      customerCity: address.city ?? "",
      customerZip: address.zip ?? "",
      customerPhone: customer.phone ?? "",
      customerEmail: customer.email ?? "",
      serialNumber: customer.serial ?? "",
      generatorModel: customer.generatorModel ?? "",
    });
  }
  return sites;
}

async function nextWorkOrderNumbers(count: number): Promise<string[]> {
  const year = new Date().getUTCFullYear();
  const fullPrefix = `WO-${year}-`;
  const latest = await WorkOrder.findOne({ number: new RegExp(`^${fullPrefix}`) })
    .sort({ number: -1 })
    .select("number")
    .lean();

  let seq = 1;
  if (latest?.number) {
    const n = parseInt(latest.number.slice(fullPrefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }

  return Array.from({ length: count }, (_, index) => {
    return `${fullPrefix}${String(seq + index).padStart(5, "0")}`;
  });
}

function overlapsBusy(start: Date, end: Date, busy: Busy[]): boolean {
  return busy.some((slot) => rangesOverlap(start, end, slot.start, slot.end));
}

async function main(): Promise<void> {
  assertDevelopment();
  await connectMongoDB();

  const removed = await WorkOrder.deleteMany({
    completed: { $ne: true },
    $or: [{ userId: SEED_USER_ID }, { descPerformed: SEED_MARKER }],
  });

  const technicians = await User.find({
    ...activeUserFilter,
    userType: "staff",
    schedulable: true,
  })
    .select("first_name last_name weeklyHours scheduleExceptions")
    .sort({ last_name: 1, first_name: 1 })
    .lean();

  if (technicians.length === 0) {
    console.log("No schedulable technicians found. Nothing to schedule.");
    await disconnectMongoDB();
    return;
  }

  const sites = await loadSites();
  if (sites.length === 0) {
    throw new Error("No geocoded customer sites available to attach appointments to.");
  }

  const dates = localDatesFromToday(CALENDAR_DAYS);
  const rangeStart = localDateToUtc(dates[0] ?? formatLocalDate(new Date()), "00:00");
  const rangeEnd = localDateToUtc(dates[dates.length - 1] ?? dates[0] ?? "", "23:59");
  const existing = await WorkOrder.find({
    assignedUserRef: { $in: technicians.map((tech) => tech._id) },
    scheduledStart: { $gte: rangeStart, $lte: rangeEnd },
    appointmentCanceledAt: null,
  })
    .select("assignedUserRef scheduledStart scheduledEnd estimatedMinutes")
    .lean();

  const busyByTech = new Map<string, Busy[]>();
  for (const job of existing) {
    if (!job.scheduledStart || !job.assignedUserRef) continue;
    const end =
      job.scheduledEnd ??
      addMinutes(job.scheduledStart, job.estimatedMinutes || 60);
    const key = String(job.assignedUserRef);
    const list = busyByTech.get(key) ?? [];
    list.push({ start: job.scheduledStart, end });
    busyByTech.set(key, list);
  }

  const drafts: Array<Record<string, unknown>> = [];
  let siteIndex = 0;
  const skipped: string[] = [];

  for (const tech of technicians) {
    const techName = `${tech.first_name ?? ""} ${tech.last_name ?? ""}`.trim();
    const busy = busyByTech.get(String(tech._id)) ?? [];
    let placed = 0;

    for (const localDate of dates) {
      const window = resolveDayWindow(
        tech.weeklyHours,
        tech.scheduleExceptions,
        localDate,
      );
      const workRange = windowToUtcRange(localDate, window);
      if (!workRange) continue;

      for (const slot of SLOTS) {
        const start = localDateToUtc(localDate, slot.start);
        const end = addMinutes(start, slot.minutes);
        if (start < workRange.start || end > workRange.end) {
          skipped.push(`${techName} ${localDate} ${slot.start} outside hours`);
          continue;
        }
        if (overlapsBusy(start, end, busy)) {
          skipped.push(`${techName} ${localDate} ${slot.start} overlaps an existing job`);
          continue;
        }

        const site = sites[siteIndex % sites.length];
        siteIndex += 1;
        if (!site) continue;

        busy.push({ start, end });
        placed += 1;
        drafts.push({
          customerId: site.customerId,
          customerRef: site.customerRef,
          addressRef: site.addressRef,
          userId: SEED_USER_ID,
          number: "",
          descPerform: JOBS[drafts.length % JOBS.length] ?? JOBS[0],
          descPerformed: "",
          date: localDateToUtc(localDate, "00:00"),
          startTime: formatLocalTime(start),
          endTime: formatLocalTime(end),
          tech: techName,
          assignedUserRef: tech._id,
          scheduledStart: start,
          scheduledEnd: end,
          estimatedMinutes: slot.minutes,
          appointmentCanceledAt: null,
          customerName: site.customerName,
          customerAddress: site.customerAddress,
          customerCity: site.customerCity,
          customerZip: site.customerZip,
          customerPhone: site.customerPhone,
          customerEmail: site.customerEmail,
          serialNumber: site.serialNumber,
          generatorModel: site.generatorModel,
          completed: false,
          paid: false,
        });
      }
    }

    console.log(`${techName}: ${placed} appointments`);
  }

  const numbers = await nextWorkOrderNumbers(drafts.length);
  drafts.forEach((draft, index) => {
    draft.number = numbers[index];
  });

  if (drafts.length > 0) {
    await WorkOrder.insertMany(drafts);
  }

  console.log(
    `Removed ${removed.deletedCount} previous seed appointments. Created ${drafts.length} across ${technicians.length} technicians (${dates[0]} through ${dates[dates.length - 1]}).`,
  );
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} slots:`);
    for (const line of skipped) console.log(`  - ${line}`);
  }

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
