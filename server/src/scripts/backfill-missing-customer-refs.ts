/**
 * Sets customerRef on work orders and invoices that have a numeric customerId
 * but no Mongo customerRef, when an active (not deleted/merged) customer exists
 * with that legacyId.
 *
 * Run: npx tsx src/scripts/backfill-missing-customer-refs.ts
 * Dry run: npx tsx src/scripts/backfill-missing-customer-refs.ts --dry-run
 * Production: NODE_ENV=production npx tsx src/scripts/backfill-missing-customer-refs.ts --dry-run
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
import { Customer } from "../models/mongo/Customer";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";

const DRY_RUN = process.argv.includes("--dry-run");
const missingRefFilter = {
  $or: [{ customerRef: { $exists: false } }, { customerRef: null }],
};

function customerLabel(customer: {
  first?: string;
  last?: string;
  accountName?: string;
  legacyId?: number;
}): string {
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  const name = `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
  return name || `Customer #${customer.legacyId ?? "?"}`;
}

async function main(): Promise<void> {
  const env =
    process.env.NODE_ENV === "production" ? "PRODUCTION" : "development";
  console.log(`[backfill-customer-refs] Environment: ${env}`);
  if (DRY_RUN) console.log("[backfill-customer-refs] Dry run — no writes.");

  await connectMongoDB();

  const [workOrders, invoices] = await Promise.all([
    WorkOrder.find(missingRefFilter)
      .select("_id number legacyId customerId customerName")
      .lean(),
    Invoice.find(missingRefFilter)
      .select("_id number customerId workOrderRef")
      .lean(),
  ]);

  const legacyIds = [
    ...new Set(
      [...workOrders, ...invoices]
        .map((doc) => doc.customerId)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];

  const customers = legacyIds.length
    ? await Customer.find({
        legacyId: { $in: legacyIds },
        deletedAt: null,
        $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
      })
        .select("_id legacyId first last accountName")
        .lean()
    : [];

  const customerByLegacy = new Map<number, (typeof customers)[number]>();
  for (const customer of customers) {
    if (typeof customer.legacyId === "number") {
      customerByLegacy.set(customer.legacyId, customer);
    }
  }

  let woUpdated = 0;
  let invoiceUpdated = 0;
  let skipped = 0;

  for (const wo of workOrders) {
    const customer =
      typeof wo.customerId === "number"
        ? customerByLegacy.get(wo.customerId)
        : undefined;
    const label = (wo.number ?? "").trim() || `legacy ${wo.legacyId ?? wo._id}`;
    if (!customer) {
      skipped += 1;
      console.log(
        `skip  work_order  ${label}  customerId=${wo.customerId}  (no active customer)`,
      );
      continue;
    }
    console.log({
      kind: "work_order",
      id: String(wo._id),
      number: wo.number ?? null,
      legacyId: wo.legacyId ?? null,
      customerId: wo.customerId,
      customerName: customerLabel(customer),
      customerRef: String(customer._id),
    });
    if (!DRY_RUN) {
      await WorkOrder.updateOne(
        { _id: wo._id },
        { $set: { customerRef: customer._id } },
      );
    }
    woUpdated += 1;
  }

  for (const invoice of invoices) {
    const customer =
      typeof invoice.customerId === "number"
        ? customerByLegacy.get(invoice.customerId)
        : undefined;
    if (!customer) {
      skipped += 1;
      console.log(
        `skip  invoice  ${invoice.number}  customerId=${invoice.customerId}  (no active customer)`,
      );
      continue;
    }
    console.log({
      kind: "invoice",
      id: String(invoice._id),
      number: invoice.number,
      customerId: invoice.customerId,
      customerName: customerLabel(customer),
      customerRef: String(customer._id),
    });
    if (!DRY_RUN) {
      await Invoice.updateOne(
        { _id: invoice._id },
        { $set: { customerRef: customer._id } },
      );
    }
    invoiceUpdated += 1;
  }

  console.log(
    `${DRY_RUN ? "[dry-run] Would update" : "Updated"} ${woUpdated} work orders and ${invoiceUpdated} invoices. Skipped ${skipped} with no active customer.`,
  );

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[backfill-customer-refs] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
