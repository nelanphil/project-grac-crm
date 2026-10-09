/**
 * Sets optional startTime and endTime from a single hour range in the
 * schedule note (latest work order note, or descPerform when there is none).
 *
 * Dry run: npx tsx src/scripts/backfill-note-time-windows.ts
 * Apply:   npx tsx src/scripts/backfill-note-time-windows.ts --apply
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderNote } from "../models/mongo/WorkOrderNote";
import { parseNoteTimeWindow } from "../utils/noteTimeWindow";

const APPLY = process.argv.includes("--apply");

function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 80);
}

async function latestNotes(): Promise<Map<string, string>> {
  const rows = await WorkOrderNote.aggregate<{
    _id: mongoose.Types.ObjectId;
    content: string;
  }>([
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

async function main() {
  await connectMongoDB();

  const alreadySet = await WorkOrder.countDocuments({
    $or: [{ startTime: { $gt: "" } }, { endTime: { $gt: "" } }],
  });
  const workOrders = await WorkOrder.find({
    $nor: [{ startTime: { $gt: "" } }, { endTime: { $gt: "" } }],
  })
    .select("_id number legacyId customerName descPerform")
    .lean();
  const notes = await latestNotes();

  const skips = { none: 0, multiple: 0, "outside-work-day": 0 };
  const updates: Array<{
    id: mongoose.Types.ObjectId;
    startTime: string;
    endTime: string;
  }> = [];

  for (const order of workOrders) {
    const text = (notes.get(String(order._id)) || order.descPerform || "").trim();
    const parsed = parseNoteTimeWindow(text);
    if (!parsed.ok) {
      skips[parsed.reason] += 1;
      continue;
    }
    const label =
      order.customerName?.trim() ||
      order.number ||
      (order.legacyId ? String(order.legacyId) : String(order._id));
    console.log(
      `${label} | ${snippet(text)} | ${parsed.startTime}-${parsed.endTime}`,
    );
    updates.push({
      id: order._id,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
    });
  }

  if (APPLY && updates.length > 0) {
    await WorkOrder.bulkWrite(
      updates.map((row) => ({
        updateOne: {
          filter: { _id: row.id },
          update: { $set: { startTime: row.startTime, endTime: row.endTime } },
        },
      })),
    );
  }

  const skipped =
    alreadySet + skips.none + skips.multiple + skips["outside-work-day"];
  console.log(
    `${APPLY ? "" : "[dry-run] "}${APPLY ? "Updated" : "Would update"} ${updates.length} work orders. Skipped ${skipped} (already set ${alreadySet}, no range ${skips.none}, multiple ${skips.multiple}, outside work day ${skips["outside-work-day"]}).`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongoDB();
  process.exit(1);
});
