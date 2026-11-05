/**
 * Repair paid contract invoices that were given a blank work order even
 * though the customer already had an ASC visit for that period.
 *
 * For each paid contract invoice linked to an untouched auto-created work
 * order, look for the customer's covering ASC visit. When there is one, link
 * the invoice and its contract renewal to that visit and delete the blank
 * work order.
 *
 * Also lists, without changing them, contracts whose paid renewal moved the
 * due date forward on top of a completed visit that had already moved it, so
 * staff can check those dates by hand.
 *
 * Idempotent. Pass --dry-run to print the changes without writing.
 *
 *   npx tsx src/scripts/repair-duplicate-renewal-work-orders.ts --dry-run
 *   npx tsx src/scripts/repair-duplicate-renewal-work-orders.ts
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
import { Contract } from "../models/mongo/Contract";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  CONTRACT_SERVICE_SOURCE_TYPES,
  findCoveringAscVisit,
  isBlankRenewalWorkOrder,
  linkRenewalWorkOrder,
} from "../services/renewalWorkOrder.service";

const DRY_RUN = process.argv.includes("--dry-run");
const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;

function log(message: string): void {
  console.log(`[repair-duplicate-renewal-work-orders] ${message}`);
}

function day(value: Date | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "none";
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[repair-duplicate-renewal-work-orders] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }
  log(DRY_RUN ? "dry run" : "writing");

  const invoices = await Invoice.find({
    sourceType: { $in: [...CONTRACT_SERVICE_SOURCE_TYPES] },
    status: "paid",
    serviceWorkOrderRef: { $ne: null },
  }).sort({ paidAt: 1 });
  log(`${invoices.length} paid contract invoice${invoices.length === 1 ? "" : "s"} with a work order`);

  let relinked = 0;
  let noVisit = 0;
  const toCheck: string[] = [];

  for (const invoice of invoices) {
    const linked = await WorkOrder.findById(invoice.serviceWorkOrderRef)
      .select(
        "number renewalInvoiceRef date scheduledStart completed deletedAt parts assignedUserRef assignedUserRefs",
      )
      .lean();
    if (!linked || !isBlankRenewalWorkOrder(linked, invoice._id)) continue;

    const visit = await findCoveringAscVisit(invoice, {
      excludeWorkOrderRef: invoice.serviceWorkOrderRef,
    });
    if (!visit) {
      noVisit += 1;
      log(`keep ${invoice.number} -> ${linked.number} (no earlier ASC visit found)`);
      continue;
    }

    const real = await WorkOrder.findById(visit._id)
      .select("number legacyId date completed")
      .lean();
    const label = real?.number || (real?.legacyId ? `legacy #${real.legacyId}` : String(visit._id));
    log(
      `${DRY_RUN ? "would relink" : "relink"} ${invoice.number}: ${linked.number} -> ${label} (visit ${day(real?.date)}${real?.completed ? ", completed" : ""})${DRY_RUN ? "" : `, delete ${linked.number}`}`,
    );
    if (!DRY_RUN) {
      await linkRenewalWorkOrder({
        invoiceId: String(invoice._id),
        workOrderId: String(visit._id),
        actor: { actorName: "System" },
      });
    }
    relinked += 1;

    if (!real?.completed || !real.date || !invoice.contractRef) continue;
    const contract = await Contract.findById(invoice.contractRef)
      .select("renewals")
      .lean();
    const renewal = contract?.renewals?.find(
      (entry) => entry.invoiceRef && String(entry.invoiceRef) === String(invoice._id),
    );
    if (!renewal?.previousDueDate || !renewal.newDueDate) continue;
    const extended =
      new Date(renewal.newDueDate).getTime() > new Date(renewal.previousDueDate).getTime();
    const alreadyMoved =
      new Date(renewal.previousDueDate).getTime() - new Date(real.date).getTime() > SIX_MONTHS_MS;
    if (extended && alreadyMoved) {
      toCheck.push(
        `${invoice.number}: visit ${day(real.date)}, renewal moved due ${day(renewal.previousDueDate)} -> ${day(renewal.newDueDate)} (contract ${String(invoice.contractRef)})`,
      );
    }
  }

  log(`summary: ${DRY_RUN ? "would relink" : "relinked"} ${relinked}, kept ${noVisit} with no earlier visit`);
  if (toCheck.length > 0) {
    log(`check these contract due dates by hand (${toCheck.length}); they were not changed:`);
    for (const line of toCheck) log(`  ${line}`);
  }
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("[repair-duplicate-renewal-work-orders] failed:", err);
  process.exit(1);
});
