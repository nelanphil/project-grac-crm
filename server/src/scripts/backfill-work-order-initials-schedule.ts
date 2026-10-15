/**
 * Assign work orders whose tech field is a schedulable technician's initials
 * onto that person's calendar. A value with two or more current initials
 * becomes one shared visit at a time both people are free that day.
 *
 * Exact single codes are placed first, at the written start time, so crew
 * placement can see those appointments.
 *
 *   npx tsx src/scripts/backfill-work-order-initials-schedule.ts --dry-run
 *   npx tsx src/scripts/backfill-work-order-initials-schedule.ts
 *   NODE_ENV=production npx tsx src/scripts/backfill-work-order-initials-schedule.ts
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
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB, getMongoStatus } from "../config/mongodb";
import { User, activeUserFilter } from "../models/mongo/User";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  estimatedMinutesForWorkOrder,
  findSharedSlot,
  staffDisplayName,
} from "../services/schedule.service";
import {
  addMinutes,
  DEFAULT_DAY_START,
  formatLocalTime,
  isHhMm,
  localDateToUtc,
  storedTicketDateKey,
} from "../utils/scheduleTime";
import { crewIdStrings } from "../utils/workOrderCrew";

const DRY_RUN = process.argv.includes("--dry-run");

type TechUser = {
  _id: mongoose.Types.ObjectId;
  first_name: string;
  last_name: string;
  initials: string;
};

function log(message: string): void {
  console.log(`[backfill-work-order-initials-schedule] ${message}`);
}

function tokens(tech: string): string[] {
  return tech.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
}

async function main(): Promise<void> {
  const envName = process.env.NODE_ENV === "production" ? "production" : "development";
  log(`Environment: ${envName}${DRY_RUN ? " (dry-run)" : ""}`);
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error("MongoDB is not connected.");
    process.exit(1);
  }
  log(`Database: ${mongoose.connection.host}/${mongoose.connection.name}`);

  const staff = await User.find({
    ...activeUserFilter,
    userType: "staff",
    schedulable: true,
    initials: { $type: "string", $ne: "" },
  })
    .select("first_name last_name initials")
    .lean();

  const byInitials = new Map<string, TechUser>();
  for (const user of staff) {
    const code = (user.initials ?? "").trim().toUpperCase();
    if (!code) continue;
    if (byInitials.has(code)) {
      log(`Skipping duplicate initials ${code}.`);
      byInitials.delete(code);
      continue;
    }
    byInitials.set(code, {
      _id: user._id,
      first_name: user.first_name,
      last_name: user.last_name,
      initials: code,
    });
  }
  log(
    `Schedulable initials: ${[...byInitials.entries()]
      .map(([code, user]) => `${code} ${staffDisplayName(user)}`)
      .join(", ")}`,
  );

  const rows = await WorkOrder.find({
    tech: { $type: "string", $nin: ["", null] },
  })
    .select(
      "tech assignedUserRef assignedUserRefs date startTime estimatedMinutes laborHours",
    )
    .lean();

  type Single = {
    id: mongoose.Types.ObjectId;
    user: TechUser;
    dateKey: string;
    startTime: string;
    minutes: number;
  };
  type Crew = {
    id: mongoose.Types.ObjectId;
    users: TechUser[];
    dateKey: string;
    startTime: string;
    minutes: number;
  };

  const singles: Single[] = [];
  const crews: Crew[] = [];
  let skippedOutsideCrew = 0;
  let skippedNoDate = 0;
  const singleCounts = new Map<string, number>();
  const crewCounts = new Map<string, number>();

  for (const row of rows) {
    const raw = String(row.tech ?? "");
    const parts = tokens(raw);
    const known = [...new Set(parts.filter((part) => byInitials.has(part)))].map(
      (part) => byInitials.get(part)!,
    );
    const exact =
      parts.length === 1 &&
      known.length === 1 &&
      raw.trim().toUpperCase() === known[0]!.initials;
    const crewMatch = !exact && known.length >= 2;
    if (!exact && !crewMatch) continue;

    const users = exact ? [known[0]!] : known;
    const existing = crewIdStrings(row);
    const allowed = new Set(users.map((user) => String(user._id)));
    if (existing.some((id) => !allowed.has(id))) {
      skippedOutsideCrew += 1;
      continue;
    }
    const dateKey = storedTicketDateKey(row.date);
    if (!dateKey) {
      skippedNoDate += 1;
      continue;
    }
    const minutes = estimatedMinutesForWorkOrder(row);
    const startTime = isHhMm((row.startTime ?? "").trim())
      ? row.startTime.trim()
      : "";
    if (exact) {
      singles.push({
        id: row._id,
        user: users[0]!,
        dateKey,
        startTime,
        minutes,
      });
      singleCounts.set(users[0]!.initials, (singleCounts.get(users[0]!.initials) ?? 0) + 1);
    } else {
      crews.push({ id: row._id, users, dateKey, startTime, minutes });
      const label = users
        .map((user) => user.initials)
        .sort()
        .join("+");
      crewCounts.set(label, (crewCounts.get(label) ?? 0) + 1);
    }
  }

  log(`Single-technician tickets: ${singles.length}`);
  for (const [code, count] of [...singleCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${code}: ${count}`);
  }
  log(`Crew tickets: ${crews.length}`);
  for (const [code, count] of [...crewCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${code}: ${count}`);
  }
  log(`Skipped, already assigned outside the parsed crew: ${skippedOutsideCrew}`);
  log(`Skipped, no ticket date: ${skippedNoDate}`);

  if (DRY_RUN) {
    log("dry-run: no changes written.");
    await disconnectMongoDB();
    return;
  }

  let singleUpdated = 0;
  const ops = singles.map((row) => {
    const clock = row.startTime || DEFAULT_DAY_START;
    const start = localDateToUtc(row.dateKey, clock);
    const end = addMinutes(start, row.minutes);
    return {
      updateOne: {
        filter: { _id: row.id },
        update: {
          $set: {
            assignedUserRef: row.user._id,
            assignedUserRefs: [row.user._id],
            tech: staffDisplayName(row.user),
            scheduledStart: start,
            scheduledEnd: end,
            estimatedMinutes: row.minutes,
            date: localDateToUtc(row.dateKey, "00:00"),
            startTime: clock,
            endTime: formatLocalTime(end),
            appointmentCanceledAt: null,
            appointmentCanceledBy: null,
          },
        },
      },
    };
  });
  for (let index = 0; index < ops.length; index += 400) {
    const batch = ops.slice(index, index + 400);
    if (batch.length === 0) continue;
    const result = await WorkOrder.bulkWrite(batch);
    singleUpdated += result.modifiedCount;
  }
  log(`Updated single-technician tickets: ${singleUpdated}`);

  crews.sort((a, b) => {
    const date = a.dateKey.localeCompare(b.dateKey);
    if (date !== 0) return date;
    return (a.startTime || DEFAULT_DAY_START).localeCompare(b.startTime || DEFAULT_DAY_START);
  });

  let crewsPlaced = 0;
  let crewsUnscheduled = 0;
  for (const row of crews) {
    const names = row.users.map((user) => staffDisplayName(user)).join(", ");
    const userIds = row.users.map((user) => String(user._id));
    const slot = await findSharedSlot({
      userIds,
      date: row.dateKey,
      minutes: row.minutes,
      startTime: row.startTime || null,
      excludeWorkOrderId: String(row.id),
    });
    if (!slot.ok) {
      crewsUnscheduled += 1;
      await WorkOrder.updateOne(
        { _id: row.id },
        {
          $set: {
            assignedUserRef: row.users[0]!._id,
            assignedUserRefs: row.users.map((user) => user._id),
            tech: names,
            scheduledStart: null,
            scheduledEnd: null,
          },
        },
      );
      log(`Unscheduled ${String(row.id)} (${names}) on ${row.dateKey}: ${slot.message}`);
      continue;
    }
    await WorkOrder.updateOne(
      { _id: row.id },
      {
        $set: {
          assignedUserRef: row.users[0]!._id,
          assignedUserRefs: row.users.map((user) => user._id),
          tech: names,
          scheduledStart: slot.start,
          scheduledEnd: slot.end,
          estimatedMinutes: row.minutes,
          date: localDateToUtc(row.dateKey, "00:00"),
          startTime: formatLocalTime(slot.start),
          endTime: formatLocalTime(slot.end),
          appointmentCanceledAt: null,
          appointmentCanceledBy: null,
        },
      },
    );
    crewsPlaced += 1;
  }
  log(`Crews placed: ${crewsPlaced}`);
  log(`Crews left unscheduled: ${crewsUnscheduled}`);
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[backfill-work-order-initials-schedule] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
