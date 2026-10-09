/**
 * Set work orders that have no type and no equipment lines to the Service
 * work order type. Equipment tickets are left unset so someone can choose
 * New Install or Swap.
 *
 * Idempotent: only null/missing workOrderTypeRef values are updated.
 *
 * Run from server/:
 *   npx tsx src/scripts/backfill-work-order-service-type.ts
 *   npx tsx src/scripts/backfill-work-order-service-type.ts --dry-run
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
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderType } from "../models/mongo/WorkOrderType";
import { SERVICE_TYPE_SLUG } from "../services/ticketWorkOrderType";

const DRY_RUN = process.argv.includes("--dry-run");

function log(msg: string): void {
  console.log(`[backfill-work-order-service-type] ${msg}`);
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[backfill-work-order-service-type] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }

  const service = await WorkOrderType.findOne({
    slug: SERVICE_TYPE_SLUG,
    deletedAt: null,
  }).select("_id");
  if (!service) {
    log(
      "No Service work order type found. Add it in Control Panel, then run this again.",
    );
    await disconnectMongoDB();
    process.exit(1);
  }

  const filter = {
    $and: [
      {
        $or: [{ workOrderTypeRef: null }, { workOrderTypeRef: { $exists: false } }],
      },
      { parts: { $not: { $elemMatch: { kind: "equipment" } } } },
    ],
  };

  const count = await WorkOrder.countDocuments(filter);
  log(`${count} work orders with no type and no equipment lines.`);
  if (DRY_RUN) {
    log("dry-run: no changes written.");
    await disconnectMongoDB();
    return;
  }

  const result = await WorkOrder.updateMany(filter, {
    $set: { workOrderTypeRef: service._id },
  });
  log(`Updated ${result.modifiedCount} work orders.`);
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[backfill-work-order-service-type] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
