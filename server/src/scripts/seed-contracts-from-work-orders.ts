/**
 * Seeds service contracts from each customer's most recent ASC/ACS work order.
 * Run: npx tsx src/scripts/seed-contracts-from-work-orders.ts
 *
 * Requires work orders to be migrated first.
 * Safe to re-run — skips if contracts already exist.
 * To re-seed, drop the servicecontracts collection first.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { ServiceContract } from "../models/mongo/ServiceContract";

const ASC_PATTERN = /ASC|ACS/i;

async function main(): Promise<void> {
  await connectMongoDB();

  const existing = await ServiceContract.countDocuments();
  if (existing > 0) {
    console.log(`ServiceContract collection already has ${existing} documents — skipping.`);
    await disconnectMongoDB();
    return;
  }

  const woCount = await WorkOrder.countDocuments();
  if (woCount === 0) {
    console.error("No work orders found. Run migrate-work-orders.ts first.");
    await disconnectMongoDB();
    process.exit(1);
  }

  const grouped = await WorkOrder.aggregate([
    { $match: { descPerform: { $regex: ASC_PATTERN } } },
    { $sort: { date: -1, legacyId: -1 } },
    {
      $group: {
        _id: "$customerId",
        workOrder: { $first: "$$ROOT" },
      },
    },
  ]);

  console.log(`Found ${grouped.length} customers with ASC/ACS work orders.`);

  const customerMap = new Map<number, string>();
  const customers = await Customer.find().select("_id legacyId").lean();
  for (const c of customers) {
    customerMap.set(c.legacyId, c._id.toString());
  }

  const toInsert: Array<{
    customerId: number;
    customerRef?: string;
    contractDate: Date | null;
    description: string;
    sourceWorkOrderRef: string;
    userId?: number;
  }> = [];

  let skipped = 0;

  for (const row of grouped) {
    const wo = row.workOrder;
    const customerRef = customerMap.get(wo.customerId);

    if (!customerRef) {
      console.warn(`Skipping customerId ${wo.customerId}: customer not found.`);
      skipped++;
      continue;
    }

    toInsert.push({
      customerId: wo.customerId,
      customerRef,
      contractDate: wo.date ?? null,
      description: wo.descPerform ?? "",
      sourceWorkOrderRef: wo._id.toString(),
      userId: wo.userId,
    });
  }

  if (toInsert.length > 0) {
    await ServiceContract.insertMany(toInsert);
  }

  console.log(`Inserted ${toInsert.length} service contracts (${skipped} skipped).`);
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
