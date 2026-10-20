/**
 * Maps stored legacy work-order totals and descriptions onto parts/labor
 * line items, then syncs invoices, on both development and production.
 *
 * Uses each database's own connection. Products and invoices are written to
 * that database, not the API default connection.
 *
 * Dry run both:
 *   npx tsx src/scripts/backfill-work-order-line-items.ts --dry-run
 * Write development, preview production:
 *   npx tsx src/scripts/backfill-work-order-line-items.ts
 * Write both:
 *   npx tsx src/scripts/backfill-work-order-line-items.ts --confirm
 * One target:
 *   npx tsx src/scripts/backfill-work-order-line-items.ts --target production --confirm
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
  backfillStoredWorkOrderLineItems,
  describeMongoTarget,
  resolveLegacyDumpUri,
  type LegacyDumpTarget,
} from "../services/legacyDumpSync";

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIRM = process.argv.includes("--confirm");

function requestedTargets(): LegacyDumpTarget[] {
  const flagIndex = process.argv.indexOf("--target");
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (!value) return ["development", "production"];
  if (value === "development" || value === "production") return [value];
  throw new Error(`Unknown --target ${value}. Use development or production.`);
}

async function main(): Promise<void> {
  const targets = requestedTargets();
  let failed = 0;

  for (const target of targets) {
    const uri = resolveLegacyDumpUri(target);
    if (!uri) {
      failed += 1;
      console.error(
        `[${target}] URI is not set (${target === "production" ? "MONGODB_URI_PRODUCTION" : "MONGODB_URI_DEVELOPMENT / MONGODB_URI"}).`,
      );
      continue;
    }

    const write = !DRY_RUN && (target !== "production" || CONFIRM);
    if (!write && target === "production" && !DRY_RUN) {
      console.log(
        `[production] Skipping write to ${describeMongoTarget(uri)}. Re-run with --confirm to update production.`,
      );
    }

    try {
      await backfillStoredWorkOrderLineItems({
        target,
        mongoUri: uri,
        dryRun: !write,
        onLog: (message) => console.log(message),
      });
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
