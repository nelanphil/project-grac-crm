/**
 * Soft-delete legacy customers whose userId is not Christopher Hatton (1) or
 * Dustin Hatton (2). CRM-created customers (userId 0) are left alone.
 *
 * Idempotent: only active customers matching the non-owner filter are
 * updated. The renewal cascade is run before deletedAt is set, so a failed
 * run can be retried and will not skip customers that still need cleanup.
 *
 * Listed in migrations/manifest.ts so Render `preDeployCommand`
 * (`npm run migrate`) applies it once on production.
 *
 * Run from server/:
 *   npx tsx src/scripts/soft-delete-non-owner-customers.ts
 *   npx tsx src/scripts/soft-delete-non-owner-customers.ts --dry-run
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

import {
  connectMongoDB,
  disconnectMongoDB,
  getMongoStatus,
} from "../config/mongodb";
import {
  activeCustomerFilter,
  Customer,
} from "../models/mongo/Customer";
import { nonOwnerLegacyCustomerFilter } from "../services/legacyLoginOwners";
import { cascadeCustomerSoftDelete } from "../services/customerSoftDelete";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

function log(msg: string): void {
  console.log(`[soft-delete-non-owner-customers] ${msg}`);
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[soft-delete-non-owner-customers] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }

  const selector = {
    ...activeCustomerFilter,
    ...nonOwnerLegacyCustomerFilter,
  };
  const grouped = await Customer.aggregate<{ _id: number | null; n: number }>([
    { $match: selector },
    { $group: { _id: "$userId", n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const total = grouped.reduce((sum, row) => sum + row.n, 0);
  if (grouped.length === 0) {
    log("No active non-owner legacy customers.");
  } else {
    for (const row of grouped) {
      log(`userId ${row._id ?? "null"}: ${row.n.toLocaleString()} customers`);
    }
    log(`${total.toLocaleString()} customers to soft-delete.`);
  }

  if (DRY_RUN) {
    log("dry-run: no changes written.");
    await disconnectMongoDB();
    return;
  }

  if (total === 0) {
    await disconnectMongoDB();
    return;
  }

  const ids = await Customer.find(selector).select("_id").lean();
  const objectIds = ids.map((customer) => customer._id);

  const cascade = await cascadeCustomerSoftDelete(objectIds);
  log(
    `Voided ${cascade.invoicesVoided.toLocaleString()} renewal invoices. Scheduled emails updated ${cascade.scheduledEmailsUpdated.toLocaleString()} (cancelled ${cascade.scheduledEmailsCancelled.toLocaleString()}). Scheduled messages updated ${cascade.scheduledMessagesUpdated.toLocaleString()} (cancelled ${cascade.scheduledMessagesCancelled.toLocaleString()}).`,
  );

  const deletedAt = new Date();
  let modified = 0;
  for (let i = 0; i < objectIds.length; i += BATCH_SIZE) {
    const result = await Customer.updateMany(
      { _id: { $in: objectIds.slice(i, i + BATCH_SIZE) }, ...selector },
      { $set: { deletedAt } },
    );
    modified += result.modifiedCount;
  }
  log(`Soft-deleted ${modified.toLocaleString()} customers.`);
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[soft-delete-non-owner-customers] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
