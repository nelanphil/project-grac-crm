/**
 * Creates invoices for existing work orders that have a billable total and no
 * non-void invoice. Unpaid tickets get an open invoice; paid tickets get a
 * paid invoice (metadata.backfilled = true).
 *
 * Run: npx tsx src/scripts/backfill-work-order-invoices.ts
 * Dry run: npx tsx src/scripts/backfill-work-order-invoices.ts --dry-run
 */
import { randomInt } from "crypto";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  dollarsToCents,
  invoiceNumberPrefixFromDate,
  workOrderInvoiceLineItems,
  type WorkOrderInvoiceSource,
} from "../services/invoice.service";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 100;
const NUMBER_ATTEMPTS = 40;

function asDate(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function lineItemsFor(wo: WorkOrderInvoiceSource, amountCents: number) {
  const built = workOrderInvoiceLineItems(wo);
  if (built.length > 0) return built;
  return [
    {
      description: `Work order${wo.descPerform ? `: ${wo.descPerform}` : ""}`,
      amountCents,
    },
  ];
}

function allocateNumber(issuedAt: Date, reserved: Set<string>): string {
  const prefix = invoiceNumberPrefixFromDate(issuedAt);
  for (let i = 0; i < NUMBER_ATTEMPTS; i++) {
    const number = `${prefix}${String(randomInt(0, 100_000)).padStart(5, "0")}`;
    if (reserved.has(number)) continue;
    reserved.add(number);
    return number;
  }
  throw new Error(`Unable to allocate invoice number for ${prefix}`);
}

async function main(): Promise<void> {
  await connectMongoDB();

  console.log("Loading billable work orders…");
  const workOrders = await WorkOrder.find({ total: { $gt: 0 } })
    .select(
      "_id number paid total customerId customerRef parts totalLabor miscExp shipping descPerform date updatedAt",
    )
    .lean();
  console.log(`Loaded ${workOrders.length} billable work orders.`);

  console.log("Loading existing invoice numbers and billed work orders…");
  const [existingNumbers, billedRows] = await Promise.all([
    Invoice.distinct("number"),
    Invoice.find({
      workOrderRef: { $in: workOrders.map((wo) => wo._id) },
      status: { $ne: "void" },
    })
      .select("workOrderRef")
      .lean(),
  ]);
  const reserved = new Set(existingNumbers.map(String));
  const billedIds = new Set(billedRows.map((row) => String(row.workOrderRef)));
  console.log(
    `Reserved ${reserved.size} invoice numbers. ${billedIds.size} work orders already invoiced.`,
  );

  const missingLegacyIds = [
    ...new Set(
      workOrders
        .filter((wo) => !wo.customerRef && typeof wo.customerId === "number")
        .map((wo) => wo.customerId),
    ),
  ];
  const refByLegacy = new Map<number, mongoose.Types.ObjectId>();
  if (missingLegacyIds.length > 0) {
    const customers = await Customer.find({
      legacyId: { $in: missingLegacyIds },
    })
      .select("_id legacyId")
      .lean();
    for (const customer of customers) {
      if (typeof customer.legacyId === "number") {
        refByLegacy.set(
          customer.legacyId,
          customer._id as mongoose.Types.ObjectId,
        );
      }
    }
  }

  let createdOpen = 0;
  let createdPaid = 0;
  let skippedExisting = 0;
  let skippedOrphan = 0;
  let skippedError = 0;
  const customerRefOps: Array<{
    updateOne: {
      filter: { _id: mongoose.Types.ObjectId };
      update: { $set: { customerRef: mongoose.Types.ObjectId } };
    };
  }> = [];
  let pending: Record<string, unknown>[] = [];

  async function flush(): Promise<void> {
    if (pending.length === 0) return;
    if (!DRY_RUN) {
      await Invoice.insertMany(pending, { ordered: false });
    }
    pending = [];
  }

  for (let i = 0; i < workOrders.length; i += 1) {
    const wo = workOrders[i] as WorkOrderInvoiceSource;
    const label = (wo.number ?? "").trim() || String(wo._id);

    if (billedIds.has(String(wo._id))) {
      skippedExisting += 1;
      continue;
    }

    const customerRef =
      wo.customerRef ??
      (typeof wo.customerId === "number"
        ? refByLegacy.get(wo.customerId)
        : undefined);
    if (!customerRef) {
      skippedOrphan += 1;
      if (DRY_RUN) {
        console.log(`orphan  ${label}  customerId=${wo.customerId}`);
      }
      continue;
    }

    if (!wo.customerRef) {
      customerRefOps.push({
        updateOne: {
          filter: { _id: wo._id },
          update: { $set: { customerRef } },
        },
      });
    }

    const amountCents = dollarsToCents(wo.total || 0);
    if (amountCents <= 0) {
      skippedError += 1;
      continue;
    }

    const issuedAt =
      asDate(wo.date) ?? asDate(wo.updatedAt) ?? new Date();

    if (DRY_RUN) {
      console.log(
        `${wo.paid ? "paid" : "open "}  ${label}  $${(wo.total ?? 0).toFixed(2)}`,
      );
      if (wo.paid) createdPaid += 1;
      else createdOpen += 1;
      continue;
    }

    try {
      const number = allocateNumber(issuedAt, reserved);
      pending.push({
        number,
        customerId: wo.customerId,
        customerRef,
        sourceType: "work_order",
        workOrderRef: wo._id,
        lineItems: lineItemsFor(wo, amountCents),
        amountCents,
        currency: "USD",
        status: wo.paid ? "paid" : "open",
        dueDate: null,
        issuedAt,
        paidAt: wo.paid ? issuedAt : null,
        metadata: { backfilled: true },
      });
      if (wo.paid) createdPaid += 1;
      else createdOpen += 1;
    } catch (err) {
      skippedError += 1;
      console.error(`failed  ${label}:`, err);
    }

    if (pending.length >= BATCH_SIZE) {
      await flush();
      console.log(
        `  Progress ${i + 1}/${workOrders.length}  open=${createdOpen} paid=${createdPaid} skipped=${skippedExisting} errors=${skippedError}`,
      );
    }
  }

  await flush();

  if (!DRY_RUN && customerRefOps.length > 0) {
    for (let i = 0; i < customerRefOps.length; i += BATCH_SIZE) {
      await WorkOrder.bulkWrite(customerRefOps.slice(i, i + BATCH_SIZE), {
        ordered: false,
      });
    }
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Scanned ${workOrders.length} billable work orders.`,
  );
  console.log(
    `  ${DRY_RUN ? "Would create" : "Created"} open invoices: ${createdOpen}`,
  );
  console.log(
    `  ${DRY_RUN ? "Would create" : "Created"} paid invoices: ${createdPaid}`,
  );
  console.log(`  Skipped (already invoiced): ${skippedExisting}`);
  console.log(`  Skipped (no customer): ${skippedOrphan}`);
  if (!DRY_RUN) {
    console.log(`  Skipped (error): ${skippedError}`);
  }

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("backfill-work-order-invoices failed:", err);
  process.exit(1);
});
