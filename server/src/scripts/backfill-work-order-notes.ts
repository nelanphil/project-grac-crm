/**
 * Copies WorkOrder.descPerformed into a WorkOrderNote when the ticket has
 * legacy text and no notes yet.
 *
 * Run: npx tsx src/scripts/backfill-work-order-notes.ts
 * Dry run: npx tsx src/scripts/backfill-work-order-notes.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { User } from "../models/mongo/User";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderNote } from "../models/mongo/WorkOrderNote";

const DRY_RUN = process.argv.includes("--dry-run");
const ADMIN_ROLES = ["admin", "super-admin", "owner"];

async function main() {
  await connectMongoDB();

  const fallbackAuthor = await User.findOne({
    role: { $in: ADMIN_ROLES },
  })
    .select("_id")
    .lean();

  const workOrders = await WorkOrder.find({
    descPerformed: { $exists: true, $nin: [null, ""] },
  })
    .select("_id descPerformed assignedUserRef")
    .lean();

  let created = 0;
  let skipped = 0;

  for (const wo of workOrders) {
    const content = String(wo.descPerformed ?? "").trim();
    if (!content) {
      skipped += 1;
      continue;
    }
    const exists = await WorkOrderNote.exists({ workOrderRef: wo._id });
    if (exists) {
      skipped += 1;
      continue;
    }
    const authorId = wo.assignedUserRef ?? fallbackAuthor?._id;
    if (!authorId) {
      skipped += 1;
      continue;
    }
    if (!DRY_RUN) {
      await WorkOrderNote.create({
        workOrderRef: wo._id,
        authorId,
        content,
        visibleToCustomer: true,
      });
    }
    created += 1;
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Created ${created} notes, skipped ${skipped}.`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongoDB();
  process.exit(1);
});
