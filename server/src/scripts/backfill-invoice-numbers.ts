/**
 * Renames existing invoices from INV-YYYY-##### to GMOFMMDDYY + 5-digit
 * random suffix, using each invoice's original issuedAt (fallback createdAt).
 * Skips numbers that already match the new format.
 *
 * Run: npx tsx src/scripts/backfill-invoice-numbers.ts
 * Dry run: npx tsx src/scripts/backfill-invoice-numbers.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Invoice } from "../models/mongo/Invoice";
import {
  INVOICE_NUMBER_PATTERN,
  nextInvoiceNumber,
} from "../services/invoice.service";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 100;

type BulkOp = {
  updateOne: {
    filter: { _id: mongoose.Types.ObjectId };
    update: {
      $set: {
        number: string;
        "metadata.previousNumber": string;
      };
    };
  };
};

async function main(): Promise<void> {
  await connectMongoDB();

  const invoices = await Invoice.find(
    {},
    { number: 1, issuedAt: 1, createdAt: 1 },
  ).lean();

  const reserved = new Set<string>();
  let updated = 0;
  let skipped = 0;
  let ops: BulkOp[] = [];

  async function flush(): Promise<void> {
    if (ops.length === 0 || DRY_RUN) {
      ops = [];
      return;
    }
    await Invoice.bulkWrite(ops, { ordered: false });
    ops = [];
  }

  for (const invoice of invoices) {
    if (INVOICE_NUMBER_PATTERN.test(invoice.number)) {
      skipped += 1;
      continue;
    }

    const previousNumber = invoice.number;
    const issuedAt =
      invoice.issuedAt instanceof Date
        ? invoice.issuedAt
        : invoice.createdAt instanceof Date
          ? invoice.createdAt
          : new Date();

    const number = await nextInvoiceNumber(issuedAt, reserved);
    reserved.add(number);
    updated += 1;

    if (DRY_RUN) {
      console.log(`${previousNumber} -> ${number}`);
      continue;
    }

    ops.push({
      updateOne: {
        filter: { _id: invoice._id as mongoose.Types.ObjectId },
        update: {
          $set: {
            number,
            "metadata.previousNumber": previousNumber,
          },
        },
      },
    });

    if (ops.length >= BATCH_SIZE) await flush();
  }

  await flush();

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Scanned ${invoices.length} invoices, ${updated} ${DRY_RUN ? "would be" : ""} updated, ${skipped} already in new format.`,
  );

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("backfill-invoice-numbers failed:", err);
  process.exit(1);
});
