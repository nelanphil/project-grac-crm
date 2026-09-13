/**
 * Recompute each customer's ASC / renewal dates from the latest work order
 * or invoice that includes the ASC product.
 *
 * Idempotent: existing service contracts are updated only when dates change.
 * Listed in migrations/manifest.ts so Render `preDeployCommand` (`npm run migrate`)
 * applies it once on the next production deploy.
 *
 * Run from server/:
 *   npx tsx src/scripts/sync-asc-contracts.ts
 *   npx tsx src/scripts/sync-asc-contracts.ts --dry-run
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
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { Customer } from "../models/mongo/Customer";
import { Invoice } from "../models/mongo/Invoice";
import { Product } from "../models/mongo/Product";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { syncAscContractsFromRecords } from "../services/ascContractSync";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  await connectMongoDB();
  const summary = await syncAscContractsFromRecords(
    {
      Customer,
      WorkOrder,
      Invoice,
      Product,
      Contract,
      ContractTemplate,
    },
    {
      dryRun: DRY_RUN,
      onLog: (message) => console.log(`[sync-asc-contracts] ${message}`),
    },
  );
  console.log(
    `[sync-asc-contracts] ${DRY_RUN ? "dry-run " : ""}customers=${summary.customersWithAsc} created=${summary.contractsCreated} updated=${summary.contractsUpdated} skippedNoCustomer=${summary.skippedNoCustomer} skippedNoDate=${summary.skippedNoDate}`,
  );
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("[sync-asc-contracts] Fatal:", err);
  process.exit(1);
});
