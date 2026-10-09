/**
 * Set a blank customer accountName to "First Last" so full-name searches and
 * list sorting see the same name the UI displays.
 *
 * Idempotent: only customers with a blank accountName and a first or last
 * name are touched. Listed in migrations/manifest.ts so Render
 * `preDeployCommand` (`npm run migrate`) applies it once on production.
 *
 * Run from server/:
 *   npx tsx src/scripts/backfill-customer-account-names.ts
 *   npx tsx src/scripts/backfill-customer-account-names.ts --dry-run
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

import type { AnyBulkWriteOperation } from "mongoose";
import {
  connectMongoDB,
  disconnectMongoDB,
  getMongoStatus,
} from "../config/mongodb";
import { Customer, ICustomer } from "../models/mongo/Customer";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

function log(msg: string): void {
  console.log(`[backfill-customer-account-names] ${msg}`);
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[backfill-customer-account-names] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }

  const candidates = await Customer.find({
    $or: [
      { accountName: "" },
      { accountName: null },
      { accountName: { $exists: false } },
      { accountName: /^\s+$/ },
    ],
  })
    .select("_id first last")
    .lean();

  const ops: AnyBulkWriteOperation<ICustomer>[] = [];
  for (const customer of candidates) {
    const name = [customer.first, customer.last]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    if (!name) continue;
    ops.push({
      updateOne: {
        filter: { _id: customer._id },
        update: { $set: { accountName: name } },
      },
    });
  }

  log(
    `${candidates.length} customers with a blank accountName; ${ops.length} have a first/last name to copy.`,
  );

  if (DRY_RUN) {
    log("dry-run: no changes written.");
    await disconnectMongoDB();
    return;
  }

  let modified = 0;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const result = await Customer.bulkWrite(ops.slice(i, i + BATCH_SIZE), {
      ordered: false,
    });
    modified += result.modifiedCount;
  }
  log(`Updated ${modified} customers.`);
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[backfill-customer-account-names] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
