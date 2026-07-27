/**
 * Backfills the denormalized `phoneDigits` field on every customer from their
 * existing `phone` value. Required for indexed duplicate detection used by the
 * paginated customer list.
 *
 * Run: npx tsx src/scripts/backfill-customer-phone-digits.ts
 * Dry run: npx tsx src/scripts/backfill-customer-phone-digits.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
// Avoid triggering index builds while backfilling.
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { normalizePhoneDigits } from "../utils/customerSites";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

type BulkOp = {
  updateOne: {
    filter: { _id: mongoose.Types.ObjectId };
    update: { $set: { phoneDigits: string } };
  };
};

async function main(): Promise<void> {
  await connectMongoDB();

  const customers = await Customer.find(
    {},
    { phone: 1, phoneDigits: 1 },
  ).lean();

  let updated = 0;
  let ops: BulkOp[] = [];

  async function flush(): Promise<void> {
    if (ops.length === 0 || DRY_RUN) {
      ops = [];
      return;
    }
    await Customer.bulkWrite(ops, { ordered: false });
    ops = [];
  }

  for (const customer of customers) {
    const digits = normalizePhoneDigits(customer.phone);
    if (digits === (customer.phoneDigits ?? "")) continue;

    updated += 1;
    ops.push({
      updateOne: {
        filter: { _id: customer._id as mongoose.Types.ObjectId },
        update: { $set: { phoneDigits: digits } },
      },
    });

    if (ops.length >= BATCH_SIZE) await flush();
  }

  await flush();

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Scanned ${customers.length} customers, ${updated} phoneDigits ${DRY_RUN ? "would be" : ""} updated.`,
  );

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("backfill-customer-phone-digits failed:", err);
  process.exit(1);
});
