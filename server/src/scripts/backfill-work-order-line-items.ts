/**
 * Maps stored legacy work-order totals and descriptions onto parts/labor
 * line items using the current product catalog.
 *
 * Safe to re-run: skips tickets that already have priced product lines.
 *
 * Run: npx tsx src/scripts/backfill-work-order-line-items.ts
 * Dry run: npx tsx src/scripts/backfill-work-order-line-items.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Product } from "../models/mongo/Product";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  hasPricedProductLines,
  legacyWorkOrderHasBillableMoney,
  mappedWorkOrderMoneyFields,
} from "../services/legacyWorkOrderItems";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 200;

async function main(): Promise<void> {
  await connectMongoDB();

  const catalog = (
    await Product.find({ active: { $ne: false } })
      .select("_id productCode partNumber name kind listPrice unitPrice")
      .lean()
  ).map((product) => ({
    _id: String(product._id),
    productCode: product.productCode,
    partNumber: product.partNumber,
    name: product.name,
    kind: product.kind,
    listPrice: product.listPrice,
    unitPrice: product.unitPrice,
  }));
  console.log(`Loaded ${catalog.length} products for line-item mapping.`);

  const candidates = await WorkOrder.find({
    $or: [
      { total: { $gt: 0 } },
      { totalParts: { $gt: 0 } },
      { totalLabor: { $gt: 0 } },
      { miscExp: { $gt: 0 } },
      { shipping: { $gt: 0 } },
    ],
  })
    .select(
      "legacyId number descPerform descPerformed parts totalParts totalLabor miscExp subtotal shipping total laborHours",
    )
    .lean();

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const ops: mongoose.AnyBulkWriteOperation[] = [];
    for (const wo of batch) {
      if (hasPricedProductLines(wo.parts)) {
        skipped += 1;
        continue;
      }
      if (!legacyWorkOrderHasBillableMoney(wo)) {
        skipped += 1;
        continue;
      }
      const money = mappedWorkOrderMoneyFields(wo, catalog);
      if (!hasPricedProductLines(money.parts) && money.total <= 0) {
        skipped += 1;
        continue;
      }
      updated += 1;
      if (!DRY_RUN) {
        ops.push({
          updateOne: {
            filter: { _id: wo._id },
            update: { $set: money },
          },
        });
      }
    }
    if (ops.length > 0) {
      await WorkOrder.bulkWrite(ops, { ordered: false });
    }
    console.log(
      `  Processed ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}`,
    );
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Mapped line items on ${updated} work orders, skipped ${skipped}.`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("Backfill failed:", err);
  await disconnectMongoDB();
  process.exit(1);
});
