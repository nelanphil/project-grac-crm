/**
 * Reassign invoices and other customer-owned records that were left on
 * merged-away customers.
 *
 * Run: npx tsx src/scripts/repair-merged-customer-records.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { Invoice } from "../models/mongo/Invoice";
import { reassignCustomerOwnedRecords } from "../utils/reassignCustomerRecords";

async function main() {
  const env =
    process.env.NODE_ENV === "production" ? "PRODUCTION" : "development";
  console.log(`[repair-merged] Environment: ${env}`);
  await connectMongoDB();

  const sources = await Customer.find({
    mergedIntoRef: { $ne: null },
  })
    .select("_id legacyId first last accountName mergedIntoRef")
    .lean();

  console.log(`Merged-away customers: ${sources.length}`);

  for (const source of sources) {
    const survivor = await Customer.findById(source.mergedIntoRef)
      .select("_id legacyId first last accountName mergedIntoRef")
      .lean();
    if (!survivor) {
      console.log(
        `SKIP ${source._id}: survivor ${source.mergedIntoRef} not found`,
      );
      continue;
    }
    if (survivor.mergedIntoRef) {
      console.log(
        `SKIP ${source._id}: survivor ${survivor._id} was also merged`,
      );
      continue;
    }

    const leftoverOpen = await Invoice.find({
      $or: [
        { customerRef: source._id },
        ...(typeof source.legacyId === "number"
          ? [{ customerId: source.legacyId }]
          : []),
      ],
      status: { $in: ["open", "draft", "failed"] },
    })
      .select("number status amountCents workOrderRef")
      .lean();

    const counts = await reassignCustomerOwnedRecords({
      sourceId: source._id as mongoose.Types.ObjectId,
      sourceLegacyId: source.legacyId,
      survivorId: survivor._id as mongoose.Types.ObjectId,
      survivorLegacyId: survivor.legacyId,
    });

    console.log({
      source: `${source.first} ${source.last}`.trim() || source.accountName,
      sourceId: String(source._id),
      survivor:
        `${survivor.first} ${survivor.last}`.trim() || survivor.accountName,
      survivorId: String(survivor._id),
      leftoverOpenInvoices: leftoverOpen.map((i) => ({
        number: i.number,
        amountCents: i.amountCents,
        workOrderRef: i.workOrderRef ? String(i.workOrderRef) : null,
      })),
      remapped: counts,
    });
  }

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[repair-merged] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
