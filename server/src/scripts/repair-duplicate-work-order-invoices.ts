/**
 * Voids extra work-order invoices so each work order keeps one.
 *
 * A work order keeps its paid invoice over an open one. When the statuses
 * match, it keeps the invoice created first. The others are voided with
 * metadata.voidReason = "duplicate_work_order_invoice". A duplicate that was
 * actually paid by card, check, cash, or Tap to Pay is left alone and listed
 * for review.
 *
 * When the kept invoice is paid and the work order total no longer matches
 * it, the work order tax and total are restored from that invoice.
 *
 * Idempotent. Pass --dry-run to print the changes without writing.
 *
 *   npx tsx src/scripts/repair-duplicate-work-order-invoices.ts --dry-run
 *   npx tsx src/scripts/repair-duplicate-work-order-invoices.ts
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
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { recordCustomerActivity } from "../services/customerActivity.service";
import { dollarsToCents } from "../services/invoice.service";

const DRY_RUN = process.argv.includes("--dry-run");
const VOID_REASON = "duplicate_work_order_invoice";

function log(message: string): void {
  console.log(`[repair-duplicate-work-order-invoices] ${message}`);
}

function statusRank(status: string): number {
  if (status === "paid") return 0;
  return 1;
}

/** Paid invoices win. Otherwise the earliest invoice of that status wins. */
export function chooseKeptWorkOrderInvoice<T extends { status: string; createdAt?: Date }>(
  invoices: T[],
): T {
  return [...invoices].sort((a, b) => {
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    return aTime - bTime;
  })[0]!;
}

function collectedPayment(invoice: IInvoice): string | null {
  if (invoice.providerPaymentId) return `card ${invoice.providerPaymentId}`;
  if (invoice.offlinePayment?.method) {
    return `offline ${invoice.offlinePayment.method}`;
  }
  if (invoice.posCharge) return `tap to pay (${invoice.posCharge.status})`;
  return null;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[repair-duplicate-work-order-invoices] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }
  log(DRY_RUN ? "dry run" : "writing");

  const groups = await Invoice.aggregate<{ _id: Types.ObjectId; n: number }>([
    {
      $match: {
        sourceType: "work_order",
        workOrderRef: { $ne: null },
        status: { $ne: "void" },
      },
    },
    { $group: { _id: "$workOrderRef", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  log(`${groups.length} work order${groups.length === 1 ? "" : "s"} with more than one invoice`);

  let voided = 0;
  let restored = 0;
  let skipped = 0;

  for (const group of groups) {
    const invoices = await Invoice.find({
      workOrderRef: group._id,
      sourceType: "work_order",
      status: { $ne: "void" },
    });
    if (invoices.length < 2) continue;

    const keeper = chooseKeptWorkOrderInvoice(invoices);
    const extras = invoices.filter((invoice) => invoice._id !== keeper._id);
    const paidExtra = extras
      .map((invoice) => {
        const payment = collectedPayment(invoice);
        return payment ? `${invoice.number} (${payment})` : null;
      })
      .filter((line): line is string => Boolean(line));
    const workOrder = await WorkOrder.findById(group._id).select(
      "number legacyId customerName total tax taxRate taxOverridden customerRef",
    );
    const label =
      workOrder?.customerName ||
      workOrder?.number ||
      (workOrder?.legacyId ? `legacy #${workOrder.legacyId}` : String(group._id));

    if (paidExtra.length > 0) {
      skipped += 1;
      log(
        `review ${label}: kept ${keeper.number}, but ${paidExtra.join(", ")} ${paidExtra.length === 1 ? "has" : "have"} a real payment`,
      );
      continue;
    }

    for (const extra of extras) {
      log(
        `${DRY_RUN ? "would void" : "void"} ${extra.number} (${extra.status} ${money(extra.amountCents)}) on ${label}; keep ${keeper.number} (${keeper.status} ${money(keeper.amountCents)})`,
      );
      if (!DRY_RUN) {
        extra.status = "void";
        extra.metadata = {
          ...(extra.metadata && typeof extra.metadata === "object"
            ? extra.metadata
            : {}),
          voidReason: VOID_REASON,
        };
        extra.markModified("metadata");
        await extra.save();
        const customerRef = extra.customerRef ?? workOrder?.customerRef;
        if (customerRef) {
          await recordCustomerActivity({
            customerRef,
            category: "invoice",
            action: "updated",
            actorKind: "system",
            actorName: "System",
            entityType: "invoice",
            entityId: String(extra._id),
            summary: `Invoice ${extra.number} voided as a duplicate of ${keeper.number}`,
            metadata: { voidReason: VOID_REASON, keptInvoice: keeper.number },
            source: "job",
            publish: false,
          });
        }
      }
      voided += 1;
    }

    if (!workOrder || keeper.status !== "paid") continue;
    const totalCents = dollarsToCents(workOrder.total || 0);
    const taxCents = dollarsToCents(workOrder.tax || 0);
    const rate = workOrder.taxRate ?? 0;
    const nextRate = keeper.taxRatePercent ?? 0;
    const nextTaxCents = keeper.taxCents ?? 0;
    if (
      totalCents === keeper.amountCents &&
      taxCents === nextTaxCents &&
      rate === nextRate
    ) {
      continue;
    }
    log(
      `${DRY_RUN ? "would restore" : "restore"} ${label} total ${money(totalCents)} -> ${money(keeper.amountCents)} from ${keeper.number}`,
    );
    if (!DRY_RUN) {
      await WorkOrder.updateOne(
        { _id: workOrder._id },
        {
          $set: {
            taxRate: nextRate,
            tax: nextTaxCents / 100,
            total: keeper.amountCents / 100,
            taxOverridden: Boolean(keeper.taxOverridden),
          },
        },
      );
    }
    restored += 1;
  }

  log(
    `${DRY_RUN ? "Would void" : "Voided"} ${voided} duplicate invoice${voided === 1 ? "" : "s"}.`,
  );
  log(
    `${DRY_RUN ? "Would restore" : "Restored"} ${restored} work order total${restored === 1 ? "" : "s"}.`,
  );
  log(`Left ${skipped} work order${skipped === 1 ? "" : "s"} for review.`);

  await disconnectMongoDB();
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry.endsWith(`${path.sep}repair-duplicate-work-order-invoices.ts`)) {
  main().catch((err) => {
    console.error("repair-duplicate-work-order-invoices failed:", err);
    process.exit(1);
  });
}
