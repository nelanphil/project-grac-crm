/**
 * Voids open/draft work-order invoices whose work order is missing, deleted,
 * or not completed. Sets metadata.voidReason = "work_order_reopened" so the
 * same invoice can be reused when the job is completed again.
 *
 * Does not change paid, failed, or contract invoices.
 * Defaults to the development database and does not write unless --apply is passed.
 * Production is refused unless both --target production and --confirm are passed.
 *
 *   npx tsx src/scripts/void-incomplete-work-order-invoices.ts
 *   npx tsx src/scripts/void-incomplete-work-order-invoices.ts --apply
 *   npx tsx src/scripts/void-incomplete-work-order-invoices.ts --target production --confirm
 *   npx tsx src/scripts/void-incomplete-work-order-invoices.ts --target production --confirm --apply
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

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Invoice } from "../models/mongo/Invoice";
import {
  includingDeletedWorkOrders,
  WorkOrder,
} from "../models/mongo/WorkOrder";
import { WORK_ORDER_REOPENED_REASON } from "../services/invoice.service";
import {
  describeMongoTarget,
  resolveLegacyDumpUri,
  type LegacyDumpTarget,
} from "../services/legacyDumpSync";

const APPLY = process.argv.includes("--apply");
const CONFIRM = process.argv.includes("--confirm");

function requestedTarget(): LegacyDumpTarget {
  const flagIndex = process.argv.indexOf("--target");
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : "development";
  if (value === "development" || value === "production") return value;
  throw new Error(`Unknown --target ${value ?? ""}. Use development or production.`);
}

async function main(): Promise<void> {
  const target = requestedTarget();
  if (target === "production" && !CONFIRM) {
    throw new Error(
      "Refusing to connect to production. Re-run with --target production --confirm.",
    );
  }

  const uri = resolveLegacyDumpUri(target);
  if (!uri) {
    throw new Error(
      target === "production"
        ? "MONGODB_URI_PRODUCTION is not set."
        : "MONGODB_URI_DEVELOPMENT is not set.",
    );
  }
  const productionUri = resolveLegacyDumpUri("production");
  if (
    target !== "production" &&
    productionUri &&
    describeMongoTarget(uri) === describeMongoTarget(productionUri)
  ) {
    throw new Error(
      "Refusing to use a development URI that points at the production database. Re-run with --target production --confirm.",
    );
  }

  const label = describeMongoTarget(uri);
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — ${target} (${label})${target === "production" ? " — confirmed" : ""}`,
  );
  await connectMongoDB(uri);
  const invoices = await Invoice.find({
    sourceType: "work_order",
    status: { $in: ["open", "draft"] },
  });
  const workOrderIds = invoices
    .map((invoice) => invoice.workOrderRef)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const workOrders = await includingDeletedWorkOrders(
    WorkOrder.find({ _id: { $in: workOrderIds } }).select("completed deletedAt"),
  ).lean();
  const byId = new Map(workOrders.map((workOrder) => [String(workOrder._id), workOrder]));

  let voided = 0;
  let kept = 0;
  for (const invoice of invoices) {
    const workOrder = invoice.workOrderRef
      ? byId.get(String(invoice.workOrderRef))
      : undefined;
    const ready = Boolean(workOrder?.completed) && !workOrder?.deletedAt;
    if (ready) {
      kept += 1;
      continue;
    }
    const reason = !workOrder
      ? "missing work order"
      : workOrder.deletedAt
        ? "deleted work order"
        : "work order not completed";
    console.log(`${APPLY ? "void" : "would void"} ${invoice.number} (${reason})`);
    if (APPLY) {
      invoice.status = "void";
      invoice.metadata = {
        ...(invoice.metadata ?? {}),
        voidReason: WORK_ORDER_REOPENED_REASON,
      };
      invoice.markModified("metadata");
      await invoice.save();
    }
    voided += 1;
  }

  console.log(
    `${APPLY ? "Voided" : "Would void"} ${voided} invoice(s) on ${target} (${label}). Kept ${kept} for completed work orders.`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongoDB().catch(() => undefined);
  process.exit(1);
});
