/**
 * Backfills `phoneDigits` on every customer contact from the stored phone.
 *
 * Run: npx tsx src/scripts/backfill-contact-phone-digits.ts
 * Dry run: npx tsx src/scripts/backfill-contact-phone-digits.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";

mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import {
  contactPhoneDigits,
  CustomerContact,
} from "../models/mongo/CustomerContact";

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

  const contacts = await CustomerContact.find({}, { phone: 1, phoneDigits: 1 }).lean();

  let updated = 0;
  let ops: BulkOp[] = [];

  async function flush(): Promise<void> {
    if (ops.length === 0 || DRY_RUN) {
      ops = [];
      return;
    }
    await CustomerContact.bulkWrite(ops, { ordered: false });
    ops = [];
  }

  for (const contact of contacts) {
    const digits = contactPhoneDigits(contact.phone);
    if (digits === (contact.phoneDigits ?? "")) continue;

    updated += 1;
    ops.push({
      updateOne: {
        filter: { _id: contact._id as mongoose.Types.ObjectId },
        update: { $set: { phoneDigits: digits } },
      },
    });

    if (ops.length >= BATCH_SIZE) await flush();
  }

  await flush();

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Scanned ${contacts.length} contacts, ${updated} phoneDigits ${DRY_RUN ? "would be" : ""} updated.`,
  );

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("backfill-contact-phone-digits failed:", err);
  process.exit(1);
});
