/**
 * Repair paid contract invoices that never became a service visit.
 *
 * Pass 1: a paid new-contract offer for a customer who already had that plan
 * is folded into the older contract. The older contract is extended, the
 * duplicate open renewal is voided, and the extra contract is removed.
 * Pass 2: every paid contract invoice that still has no work order gets one.
 *
 * Idempotent. Pass --dry-run to print the changes without writing.
 *
 *   npx tsx src/scripts/repair-paid-contract-work-orders.ts
 *   npx tsx src/scripts/repair-paid-contract-work-orders.ts --dry-run
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

import mongoose, { Types } from "mongoose";
mongoose.set("autoIndex", false);

import {
  connectMongoDB,
  disconnectMongoDB,
  getMongoStatus,
} from "../config/mongodb";
import { Contract } from "../models/mongo/Contract";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { foldOfferIntoExistingContract } from "../services/offerRenewalFold";
import {
  ensureRenewalWorkOrder,
  findPaidRenewalsWithoutWorkOrder,
} from "../services/renewalWorkOrder.service";

const DRY_RUN = process.argv.includes("--dry-run");

function log(message: string): void {
  console.log(`[repair-paid-contract-work-orders] ${message}`);
}

async function foldPaidOffers(): Promise<void> {
  const offers = await Invoice.find({
    status: "paid",
    sourceType: "contract_initial",
    "metadata.temporaryContract": true,
  });
  log(`pass 1: ${offers.length} paid offer invoice${offers.length === 1 ? "" : "s"}`);
  let folded = 0;
  let promoted = 0;
  let skipped = 0;
  for (const invoice of offers) {
    const result = await foldOfferIntoExistingContract(invoice, { dryRun: DRY_RUN });
    if (result.folded) {
      folded += 1;
      const voided = result.voidedInvoiceNumbers.length
        ? `, void ${result.voidedInvoiceNumbers.join(", ")}`
        : "";
      const removed = result.deletedOfferContractId
        ? `, remove contract ${result.deletedOfferContractId}`
        : "";
      const due = result.renewalDueDate?.slice(0, 10) ?? "";
      const renewal = due
        ? result.extendedRenewal
          ? `, renewal due ${due}`
          : `, renewal date stays ${due}`
        : "";
      log(
        `${DRY_RUN ? "would fold" : "folded"} ${invoice.number} into contract ${result.contractId}${renewal}${voided}${removed}`,
      );
    } else if (result.promoted) {
      promoted += 1;
      log(
        `${DRY_RUN ? "would promote" : "promoted"} ${invoice.number} to a new contract ${result.contractId}`,
      );
    } else {
      skipped += 1;
      log(`skip ${invoice.number} (no earlier contract to renew)`);
    }
  }
  log(`pass 1 summary: folded ${folded}, promoted ${promoted}, skipped ${skipped}`);
}

async function deleteAbandonedOfferContracts(): Promise<void> {
  const invoices = await Invoice.find({
    "metadata.foldedFromContractRef": { $type: "string" },
  }).select("metadata contractRef");
  const seen = new Set<string>();
  for (const invoice of invoices) {
    const raw = invoice.metadata?.foldedFromContractRef;
    if (typeof raw !== "string" || !Types.ObjectId.isValid(raw) || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    const offerId = new Types.ObjectId(raw);
    const stillThere = await Contract.exists({ _id: offerId });
    if (!stillThere) continue;
    const [otherInvoices, jobs] = await Promise.all([
      Invoice.countDocuments({ contractRef: offerId }),
      WorkOrder.countDocuments({ contractRef: offerId, deletedAt: null }),
    ]);
    if (otherInvoices > 0 || jobs > 0) {
      log(`leave offer contract ${raw} (still referenced)`);
      continue;
    }
    log(`${DRY_RUN ? "would delete" : "deleting"} abandoned offer contract ${raw}`);
    if (!DRY_RUN) await Contract.deleteOne({ _id: offerId });
  }
}

async function createMissingWorkOrders(): Promise<void> {
  const { invoices, total } = await findPaidRenewalsWithoutWorkOrder();
  log(`pass 2: ${total} paid contract invoice${total === 1 ? "" : "s"} without a work order`);
  let created = 0;
  let skipped = 0;
  for (const row of invoices) {
    const number = typeof row.number === "string" ? row.number : String(row._id ?? "");
    if (!row._id) {
      skipped += 1;
      log(`skip ${number} (missing id)`);
      continue;
    }
    if (DRY_RUN) {
      created += 1;
      log(`would create work order for ${number}`);
      continue;
    }
    const workOrder = await ensureRenewalWorkOrder(
      { _id: row._id as Types.ObjectId },
      { actorName: "System" },
    );
    if (!workOrder) {
      skipped += 1;
      log(`skip ${number} (work order was not created)`);
      continue;
    }
    created += 1;
    log(
      `${number} -> ${workOrder.number || workOrder.workOrderId} created=${workOrder.created}`,
    );
  }
  log(`pass 2 summary: ${DRY_RUN ? "would create" : "created"} ${created}, skipped ${skipped}`);
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[repair-paid-contract-work-orders] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }
  log(DRY_RUN ? "dry run" : "writing");
  await foldPaidOffers();
  await deleteAbandonedOfferContracts();
  await createMissingWorkOrders();
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("[repair-paid-contract-work-orders] failed:", err);
  process.exit(1);
});
