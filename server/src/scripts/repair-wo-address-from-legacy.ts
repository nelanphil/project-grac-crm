/**
 * Remap work order (and eligible contract) addressRef/equipmentRef using
 * CustomerAddress.legacyCustomerId + the legacy work_orders.sql dump.
 *
 * Fixes post-merge cases like Aaron Becker where Ormond Beach WOs were stamped
 * onto Port Orange or left untagged.
 *
 * Run from server/:
 *   DRY_RUN=1 npx tsx src/scripts/repair-wo-address-from-legacy.ts
 *   npx tsx src/scripts/repair-wo-address-from-legacy.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB, getMongoStatus } from "../config/mongodb";
import { remapAddressRefsFromLegacyDump } from "../utils/legacyAddressRemap";

function log(msg: string): void {
  console.log(`[repair-wo-address-from-legacy] ${msg}`);
}

async function main(): Promise<void> {
  const dryRun =
    process.env.DRY_RUN === "1" ||
    process.env.DRY_RUN === "true" ||
    process.argv.includes("--dry-run");

  log(dryRun ? "Starting DRY RUN…" : "Starting repair…");
  await connectMongoDB();

  if (getMongoStatus() !== "connected") {
    console.error(
      "[repair-wo-address-from-legacy] MongoDB is not connected. Check MONGODB_URI_DEVELOPMENT / MONGODB_URI in .env"
    );
    process.exit(1);
  }

  mongoose.set("bufferCommands", false);

  const result = await remapAddressRefsFromLegacyDump({ dryRun, log });

  log(`Addresses processed: ${result.addressesProcessed}`);
  log(`Work orders updated: ${result.workOrdersUpdated}`);
  log(`Contracts updated: ${result.contractsUpdated}`);

  // Highlight Becker if present
  for (const row of result.perLegacyCustomer) {
    if (row.legacyCustomerId === 1655 || row.legacyCustomerId === 1663) {
      log(
        `  Becker legacyCustomerId=${row.legacyCustomerId}: ${row.woIds.length} dump WOs, modified=${row.woModified}`
      );
    }
  }

  await disconnectMongoDB();
  log(dryRun ? "Dry run complete." : "Done.");
}

main().catch((err) => {
  console.error("[repair-wo-address-from-legacy] Fatal:", err);
  process.exit(1);
});
