/**
 * Merges a CRM-created work order with the site-dump copy for the same
 * customer on the same calendar day.
 *
 * Dry run (default):
 *   npx tsx src/scripts/merge-legacy-crm-duplicates.ts
 * Apply:
 *   npx tsx src/scripts/merge-legacy-crm-duplicates.ts --apply
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
import { Contract } from "../models/mongo/Contract";
import { Estimate } from "../models/mongo/Estimate";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { WorkOrderNote } from "../models/mongo/WorkOrderNote";
import {
  chooseKeptDuplicate,
  duplicateWorkOrderScore,
  mergeLegacyDescPerform,
  storedWorkOrderCalendarDay,
  type DuplicateScoreInput,
} from "../services/legacyDumpSync";

const APPLY = process.argv.includes("--apply");

type Part = {
  lineType?: string | null;
  amount?: number | null;
  unitPrice?: number | null;
};

type Row = DuplicateScoreInput & {
  _id: mongoose.Types.ObjectId;
  number?: string;
  customerRef?: mongoose.Types.ObjectId | null;
  customerName?: string;
  date?: Date | null;
  descPerform?: string;
  paid?: boolean;
  completed?: boolean;
  parts?: Part[] | null;
};

function workOrderLabel(workOrder: Row): string {
  if (workOrder.number) return workOrder.number;
  if (workOrder.legacyId != null) return `legacy ${workOrder.legacyId}`;
  return String(workOrder._id);
}

async function main(): Promise<void> {
  const env =
    process.env.NODE_ENV === "production" ? "PRODUCTION" : "development";
  console.log(`[merge-legacy-crm-duplicates] Environment: ${env}`);
  console.log(
    APPLY
      ? "[merge-legacy-crm-duplicates] APPLY — writing."
      : "[merge-legacy-crm-duplicates] Dry run — no writes. Pass --apply to merge.",
  );

  await connectMongoDB();

  const workOrders = (await WorkOrder.find({})
    .select(
      "_id legacyId number customerRef customerName date scheduledStart descPerform parts total paid completed",
    )
    .lean()) as Row[];

  const groups = new Map<string, Row[]>();
  let skippedNoKey = 0;
  for (const workOrder of workOrders) {
    if (!workOrder.customerRef) {
      skippedNoKey += 1;
      continue;
    }
    const day = storedWorkOrderCalendarDay(workOrder);
    if (!day) {
      skippedNoKey += 1;
      continue;
    }
    const key = `${String(workOrder.customerRef)}|${day}`;
    const list = groups.get(key) ?? [];
    list.push(workOrder);
    groups.set(key, list);
  }

  const pairs: Array<{ day: string; crm: Row; site: Row }> = [];
  const larger: string[] = [];
  for (const [key, group] of groups) {
    const day = key.split("|")[1] ?? "";
    const crm = group.filter((workOrder) => workOrder.legacyId == null);
    const site = group.filter((workOrder) => workOrder.legacyId != null);
    if (crm.length === 0 || site.length === 0) continue;
    const name = group.find((workOrder) => workOrder.customerName)?.customerName || "(no name)";
    if (crm.length !== 1 || site.length !== 1) {
      larger.push(
        `${day} ${name}: ${crm.length} CRM, ${site.length} site — skipped`,
      );
      continue;
    }
    pairs.push({ day, crm: crm[0]!, site: site[0]! });
  }

  const pairIds = pairs.flatMap((pair) => [pair.crm._id, pair.site._id]);
  const blockingInvoices = pairIds.length
    ? await Invoice.find({
        workOrderRef: { $in: pairIds },
        $or: [
          { status: { $ne: "void" } },
          { providerPaymentId: { $nin: [null, ""] } },
          { offlinePayment: { $ne: null } },
        ],
      })
        .select("_id workOrderRef status")
        .lean()
    : [];
  const blockingIds = new Set(
    blockingInvoices.map((invoice) => String(invoice.workOrderRef)),
  );

  const legacyCounts = new Map<number, number>();
  for (const workOrder of workOrders) {
    if (workOrder.legacyId == null) continue;
    legacyCounts.set(
      workOrder.legacyId,
      (legacyCounts.get(workOrder.legacyId) ?? 0) + 1,
    );
  }

  let merged = 0;
  let skipped = 0;
  for (const pair of pairs.sort((a, b) => a.day.localeCompare(b.day))) {
    const scoreOf = (workOrder: Row) =>
      duplicateWorkOrderScore({
        ...workOrder,
        hasInvoice: blockingIds.has(String(workOrder._id)),
      });
    const choice = chooseKeptDuplicate(pair.crm, pair.site, scoreOf);
    const { kept, dropped } = choice;
    const name = kept.customerName || dropped.customerName || "(no name)";
    const head = `${pair.day} ${name}: keep ${workOrderLabel(kept)}, drop ${workOrderLabel(dropped)} (${choice.reason})`;

    const unsafe: string[] = [];
    if (dropped.completed) unsafe.push("completed");
    if (dropped.paid) unsafe.push("paid");
    if (blockingIds.has(String(dropped._id))) unsafe.push("invoice or payment");
    if (dropped.legacyId != null && (legacyCounts.get(dropped.legacyId) ?? 0) > 1) {
      unsafe.push(`legacy ${dropped.legacyId} is also on another work order`);
    }
    if (unsafe.length > 0) {
      skipped += 1;
      console.log(`SKIP  ${head} — ${unsafe.join(", ")}`);
      continue;
    }

    const mergedDesc = mergeLegacyDescPerform(kept.descPerform, dropped.descPerform);
    const noteCount = await WorkOrderNote.countDocuments({
      workOrderRef: dropped._id,
    });
    const estimateCount = await Estimate.countDocuments({
      workOrderRef: dropped._id,
    });
    const contractCount = await Contract.countDocuments({
      $or: [
        { sourceWorkOrderRef: dropped._id },
        { "renewals.workOrderRef": dropped._id },
      ],
    });
    const moved = [
      noteCount ? `${noteCount} notes` : "",
      estimateCount ? `${estimateCount} estimates` : "",
      contractCount ? `${contractCount} contracts` : "",
      mergedDesc != null ? "description merged" : "",
      kept.legacyId == null && dropped.legacyId != null
        ? `legacy ${dropped.legacyId} linked`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`${APPLY ? "MERGE" : "WOULD"} ${head}${moved ? ` — ${moved}` : ""}`);

    if (!APPLY) {
      merged += 1;
      continue;
    }

    const $set: Record<string, unknown> = {};
    if (kept.legacyId == null && dropped.legacyId != null) {
      $set.legacyId = dropped.legacyId;
      $set.legacyLinkedAt = new Date();
    }
    if (mergedDesc != null) $set.descPerform = mergedDesc;
    if (Object.keys($set).length > 0) {
      await WorkOrder.updateOne({ _id: kept._id }, { $set });
    }
    await WorkOrderNote.updateMany(
      { workOrderRef: dropped._id },
      { $set: { workOrderRef: kept._id } },
    );
    await Estimate.updateMany(
      { workOrderRef: dropped._id },
      { $set: { workOrderRef: kept._id } },
    );
    await Contract.updateMany(
      { sourceWorkOrderRef: dropped._id },
      { $set: { sourceWorkOrderRef: kept._id } },
    );
    await Contract.updateMany(
      { "renewals.workOrderRef": dropped._id },
      { $set: { "renewals.$[renewal].workOrderRef": kept._id } },
      { arrayFilters: [{ "renewal.workOrderRef": dropped._id }] },
    );
    await Invoice.updateMany(
      { workOrderRef: dropped._id },
      { $set: { workOrderRef: kept._id } },
    );
    await WorkOrder.updateOne(
      { _id: dropped._id },
      {
        $set: { deletedAt: new Date(), deletedBy: null },
        $unset: { legacyId: "" },
      },
    );
    if (dropped.legacyId != null) {
      legacyCounts.set(dropped.legacyId, 1);
    }
    merged += 1;
  }

  console.log("");
  console.log(
    `[merge-legacy-crm-duplicates] ${APPLY ? "Merged" : "Would merge"} ${merged}. Skipped ${skipped}. Larger groups ${larger.length}. Missing customer or day ${skippedNoKey}.`,
  );
  for (const line of larger) {
    console.log(`LARGER ${line}`);
  }

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[merge-legacy-crm-duplicates] Failed:", err);
  await disconnectMongoDB().catch(() => undefined);
  process.exit(1);
});
