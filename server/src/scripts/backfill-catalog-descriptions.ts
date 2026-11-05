/**
 * Writes each product's catalog Description onto existing work-order,
 * estimate, and invoice lines. Amounts, names, and updatedAt stay as stored.
 *
 * Dry run both:
 *   npx tsx src/scripts/backfill-catalog-descriptions.ts --dry-run
 * Write development, preview production:
 *   npx tsx src/scripts/backfill-catalog-descriptions.ts
 * Write both:
 *   npx tsx src/scripts/backfill-catalog-descriptions.ts --confirm
 * One target:
 *   npx tsx src/scripts/backfill-catalog-descriptions.ts --target development
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

import { Estimate } from "../models/mongo/Estimate";
import { Invoice } from "../models/mongo/Invoice";
import {
  includingDeletedWorkOrders,
  WorkOrder,
} from "../models/mongo/WorkOrder";
import {
  catalogDescriptionText,
  hydrateRecordParts,
  type CatalogDescriptionPart,
} from "../services/catalogDescription";
import {
  describeMongoTarget,
  resolveLegacyDumpUri,
  type LegacyDumpTarget,
} from "../services/legacyDumpSync";
import { invoiceLinesWithCatalogDetail } from "../services/invoice.service";

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIRM = process.argv.includes("--confirm");
const BATCH = 200;

const blankDescription = {
  $or: [
    { catalogDescription: { $exists: false } },
    { catalogDescription: null },
    { catalogDescription: "" },
  ],
};

const linkedPart = {
  parts: {
    $elemMatch: {
      lineType: { $ne: "note" },
      $and: [
        blankDescription,
        {
          $or: [
            { productRef: { $type: "objectId" } },
            { contractTemplateRef: { $type: "objectId" } },
          ],
        },
      ],
    },
  },
};

type PartRecord = {
  _id: mongoose.Types.ObjectId;
  parts?: CatalogDescriptionPart[] | null;
};

function requestedTargets(): LegacyDumpTarget[] {
  const flagIndex = process.argv.indexOf("--target");
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (!value) return ["development", "production"];
  if (value === "development" || value === "production") return [value];
  throw new Error(`Unknown --target ${value}. Use development or production.`);
}

function descriptionKey(parts: CatalogDescriptionPart[] | null | undefined): string {
  return (parts ?? [])
    .map((part) => catalogDescriptionText(part.catalogDescription))
    .join("\n");
}

async function backfillParts(
  label: string,
  updateParts: (
    id: mongoose.Types.ObjectId,
    parts: CatalogDescriptionPart[],
  ) => Promise<unknown>,
  query: { select(fields: string): { lean(): { cursor(): AsyncIterable<PartRecord> } } },
  dryRun: boolean,
  log: (message: string) => void,
): Promise<{ scanned: number; updated: number }> {
  const cursor = query.select("_id parts").lean().cursor();
  let scanned = 0;
  let updated = 0;
  let batch: PartRecord[] = [];

  async function flush(records: PartRecord[]): Promise<void> {
    if (records.length === 0) return;
    const hydrated = await hydrateRecordParts(records);
    for (let index = 0; index < records.length; index += 1) {
      const nextParts = (hydrated[index] as PartRecord).parts ?? [];
      if (descriptionKey(records[index]?.parts) === descriptionKey(nextParts)) continue;
      updated += 1;
      if (!dryRun) {
        const id = records[index]?._id;
        if (id) await updateParts(id, nextParts);
      }
    }
  }

  for await (const record of cursor) {
    scanned += 1;
    batch.push(record as PartRecord);
    if (batch.length >= BATCH) {
      await flush(batch);
      batch = [];
      log(`${label}: scanned ${scanned.toLocaleString()}, updates ${updated.toLocaleString()}`);
    }
  }
  await flush(batch);
  return { scanned, updated };
}

async function backfillInvoices(
  dryRun: boolean,
  log: (message: string) => void,
): Promise<{ scanned: number; updated: number }> {
  const cursor = Invoice.find({
    status: { $ne: "void" },
    workOrderRef: { $type: "objectId" },
    lineItems: {
      $elemMatch: {
        $or: [{ detail: { $exists: false } }, { detail: null }, { detail: "" }],
      },
    },
  })
    .select("_id workOrderRef lineItems")
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  for await (const invoice of cursor) {
    scanned += 1;
    const next = await invoiceLinesWithCatalogDetail(invoice);
    const changed = next.some(
      (item, index) =>
        catalogDescriptionText(item.detail) !==
        catalogDescriptionText(invoice.lineItems?.[index]?.detail),
    );
    if (!changed) continue;
    updated += 1;
    if (!dryRun) {
      await Invoice.updateOne(
        { _id: invoice._id },
        { $set: { lineItems: next } },
        { timestamps: false },
      );
    }
    if (scanned % BATCH === 0) {
      log(
        `invoices: scanned ${scanned.toLocaleString()}, updates ${updated.toLocaleString()}`,
      );
    }
  }
  return { scanned, updated };
}

async function backfillTarget(target: LegacyDumpTarget, dryRun: boolean): Promise<void> {
  const uri = resolveLegacyDumpUri(target);
  if (!uri) {
    throw new Error(
      `${target} URI is not set (${target === "production" ? "MONGODB_URI_PRODUCTION" : "MONGODB_URI_DEVELOPMENT / MONGODB_URI"}).`,
    );
  }
  const prefix = dryRun ? "[dry-run] " : "";
  const log = (message: string) => console.log(`${prefix}[${target}] ${message}`);
  log(`Connecting to ${describeMongoTarget(uri)}…`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20_000 });
  try {
    const workOrders = await backfillParts(
      "work orders",
      (id, parts) =>
        WorkOrder.updateOne({ _id: id }, { $set: { parts } }, { timestamps: false }),
      includingDeletedWorkOrders(WorkOrder.find(linkedPart)),
      dryRun,
      log,
    );
    const estimates = await backfillParts(
      "estimates",
      (id, parts) =>
        Estimate.updateOne({ _id: id }, { $set: { parts } }, { timestamps: false }),
      Estimate.find(linkedPart),
      dryRun,
      log,
    );
    const invoices = await backfillInvoices(dryRun, log);
    log(
      `Done. Work orders ${workOrders.updated.toLocaleString()}/${workOrders.scanned.toLocaleString()}, estimates ${estimates.updated.toLocaleString()}/${estimates.scanned.toLocaleString()}, invoices ${invoices.updated.toLocaleString()}/${invoices.scanned.toLocaleString()}.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

async function main(): Promise<void> {
  const targets = requestedTargets();
  let failed = 0;
  for (const target of targets) {
    const write = !DRY_RUN && (target !== "production" || CONFIRM);
    if (!write && target === "production" && !DRY_RUN) {
      const uri = resolveLegacyDumpUri(target);
      console.log(
        `[production] Skipping write to ${uri ? describeMongoTarget(uri) : "production"}. Re-run with --confirm to update production.`,
      );
    }
    try {
      await backfillTarget(target, !write);
    } catch (err) {
      failed += 1;
      console.error(`[${target}] Backfill failed:`, err);
    }
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
