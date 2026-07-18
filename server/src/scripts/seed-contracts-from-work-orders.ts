/**
 * Seeds contracts from each customer's most recent ASC/ACS work order.
 * Run: npx tsx src/scripts/seed-contracts-from-work-orders.ts
 *
 * Prefer migrate-contracts-collection.ts when a servicecontracts collection exists.
 * This seed is a fallback only when contracts is empty.
 *
 * Requires work orders to be migrated first.
 * Safe to re-run — skips if contracts already exist.
 * To re-seed, drop the contracts collection first.
 *
 * Note: seeds at most one contract per customer (latest ASC WO). Customers may
 * later hold multiple contracts via the API.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { Contract } from "../models/mongo/Contract";
import {
  DEFAULT_DURATION_MONTHS,
  computeInitialRenewalDueDate,
  parseDateOnly,
} from "../utils/contractDates";
import { ASC_PATTERN } from "../utils/contractTypes";

async function main(): Promise<void> {
  await connectMongoDB();

  const existing = await Contract.countDocuments();
  if (existing > 0) {
    console.log(`contracts collection already has ${existing} documents — skipping.`);
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
    originalContractDate: Date | null;
    contractDate: Date | null;
    durationMonths: number;
    renewalDueDate: Date | null;
    lastRenewalDate: null;
    renewals: [];
    description: string;
    contractType: "service";
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

    const contractDate = parseDateOnly(wo.date);
    const durationMonths = DEFAULT_DURATION_MONTHS;

    toInsert.push({
      customerId: wo.customerId,
      customerRef,
      originalContractDate: contractDate,
      contractDate,
      durationMonths,
      renewalDueDate: computeInitialRenewalDueDate(contractDate, durationMonths),
      lastRenewalDate: null,
      renewals: [],
      description: wo.descPerform ?? "",
      contractType: "service",
      sourceWorkOrderRef: wo._id.toString(),
      userId: wo.userId,
    });
  }

  if (toInsert.length > 0) {
    await Contract.insertMany(toInsert);
  }

  console.log(`Inserted ${toInsert.length} contracts (${skipped} skipped).`);
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
