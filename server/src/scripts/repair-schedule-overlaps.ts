/**
 * Reports appointments that overlap on the same technician, then optionally
 * re-flows the open ones. Completed visits and multi-technician visits stay
 * where they are. Note times slide to the next open slot.
 *
 * Dry run: npx tsx src/scripts/repair-schedule-overlaps.ts
 * Apply:   npx tsx src/scripts/repair-schedule-overlaps.ts --apply [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { User } from "../models/mongo/User";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { applyPlannedRoute } from "../services/schedule.service";
import { crewIdStrings } from "../utils/workOrderCrew";
import {
  addMinutes,
  formatLocalDate,
  formatLocalTime,
  rangesOverlap,
} from "../utils/scheduleTime";

const APPLY = process.argv.includes("--apply");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1]?.trim() ?? "";
  if (!DATE.test(value)) {
    throw new Error(`${flag} must be YYYY-MM-DD`);
  }
  return value;
}

type Visit = {
  id: string;
  label: string;
  start: Date;
  end: Date;
  completed: boolean;
};

function clock(date: Date): string {
  return formatLocalTime(date);
}

async function main() {
  const from = argValue("--from");
  const to = argValue("--to");
  await connectMongoDB();

  const jobs = await WorkOrder.find({
    $and: [
      { scheduledStart: { $ne: null } },
      {
        $or: [
          { appointmentCanceledAt: null },
          { appointmentCanceledAt: { $exists: false } },
        ],
      },
    ],
  })
    .select(
      "customerName scheduledStart scheduledEnd completed estimatedMinutes assignedUserRef assignedUserRefs",
    )
    .lean();

  const groups = new Map<string, Visit[]>();
  for (const job of jobs) {
    if (!job.scheduledStart) continue;
    const start = new Date(job.scheduledStart);
    if (Number.isNaN(start.getTime())) continue;
    const end = job.scheduledEnd
      ? new Date(job.scheduledEnd)
      : addMinutes(start, job.estimatedMinutes || 30);
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) continue;
    const date = formatLocalDate(start);
    if (from && date < from) continue;
    if (to && date > to) continue;
    const visit: Visit = {
      id: String(job._id),
      label: job.customerName?.trim() || "Work order",
      start,
      end,
      completed: Boolean(job.completed),
    };
    for (const userId of crewIdStrings(job)) {
      const key = `${userId}|${date}`;
      const list = groups.get(key);
      if (list) list.push(visit);
      else groups.set(key, [visit]);
    }
  }

  const overlapping: Array<{ userId: string; date: string; visits: Visit[] }> = [];
  for (const [key, visits] of groups) {
    const [userId, date] = key.split("|");
    if (!userId || !date) continue;
    visits.sort(
      (a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id),
    );
    let hit = false;
    for (let i = 0; i < visits.length; i += 1) {
      const left = visits[i]!;
      for (let j = i + 1; j < visits.length; j += 1) {
        const right = visits[j]!;
        if (right.start.getTime() >= left.end.getTime()) break;
        if (!rangesOverlap(left.start, left.end, right.start, right.end)) continue;
        hit = true;
        break;
      }
      if (hit) break;
    }
    if (hit) overlapping.push({ userId, date, visits });
  }

  const users = await User.find({
    _id: { $in: [...new Set(overlapping.map((row) => row.userId))] },
  })
    .select("first_name last_name")
    .lean();
  const names = new Map(
    users.map((user) => [
      String(user._id),
      `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || String(user._id),
    ]),
  );

  overlapping.sort((a, b) => a.date.localeCompare(b.date) || a.userId.localeCompare(b.userId));
  console.log(
    `${APPLY ? "Applying" : "[dry-run]"} ${overlapping.length} technician-day${overlapping.length === 1 ? "" : "s"} with overlaps.`,
  );

  for (const row of overlapping) {
    const name = names.get(row.userId) ?? row.userId;
    console.log(`\n${name} · ${row.date}`);
    const sorted = [...row.visits].sort(
      (a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const left = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const right = sorted[j]!;
        if (right.start.getTime() >= left.end.getTime()) break;
        if (!rangesOverlap(left.start, left.end, right.start, right.end)) continue;
        const leftMark = left.completed ? " completed" : "";
        const rightMark = right.completed ? " completed" : "";
        console.log(
          `  ${left.label}${leftMark} ${clock(left.start)}–${clock(left.end)} overlaps ${right.label}${rightMark} ${clock(right.start)}–${clock(right.end)}`,
        );
      }
    }
    if (!APPLY) continue;

    const open = sorted.filter((visit) => !visit.completed);
    if (open.length === 0) {
      console.log("  Completed visits overlap. They were left in place.");
      continue;
    }
    const before = new Map(open.map((visit) => [visit.id, visit.start.toISOString()]));
    try {
      const applied = await applyPlannedRoute({
        userId: row.userId,
        date: row.date,
        orderedWorkOrderIds: open.map((visit) => visit.id),
      });
      for (const job of applied.workOrders) {
        const id = String(job._id ?? "");
        const previous = before.get(id);
        const rawStart = job.scheduledStart;
        const next =
          typeof rawStart === "string" || rawStart instanceof Date
            ? new Date(rawStart).toISOString()
            : "";
        if (!previous || !next || previous === next) continue;
        console.log(
          `  moved ${job.customerName?.trim() || "Work order"}: ${clock(new Date(previous))} -> ${clock(new Date(next))}`,
        );
      }
      for (const warning of applied.warnings) console.log(`  ${warning}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to repair this day";
      console.log(`  Could not repair: ${message}`);
    }
  }

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongoDB();
  process.exit(1);
});
