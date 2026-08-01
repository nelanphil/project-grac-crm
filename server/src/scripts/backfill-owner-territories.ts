/**
 * Backfill county on customer addresses (via Census geographies) and assign
 * ownerUserRef from owner territories.
 *
 * Run: npx tsx src/scripts/backfill-owner-territories.ts
 * Dry run: npx tsx src/scripts/backfill-owner-territories.ts --dry-run
 * Limit: npx tsx src/scripts/backfill-owner-territories.ts --limit=100
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { normalizeCountyName } from "../constants/floridaCounties";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { lookupCountyFromCensus } from "../utils/censusGeocoder";
import { syncCustomerPrimaryFields } from "../utils/customerSites";
import { assignCustomerOwner } from "../utils/ownerTerritory";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0;
const DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await connectMongoDB();

  const filter = {
    $or: [{ county: "" }, { county: { $exists: false } }, { county: null }],
    address: { $nin: ["", null] },
  };

  let query = CustomerAddress.find(filter).sort({ createdAt: 1 });
  if (LIMIT > 0) query = query.limit(LIMIT);

  const addresses = await query.lean();
  console.log(
    `Found ${addresses.length} address(es) missing county${DRY_RUN ? " (dry run)" : ""}.`,
  );

  let countyUpdated = 0;
  let countyFailed = 0;
  const touchedCustomers = new Set<string>();

  for (const addr of addresses) {
    const street = (addr.address ?? "").trim();
    if (!street) continue;

    const county = await lookupCountyFromCensus({
      street,
      city: addr.city,
      state: addr.state || "FL",
      zip: addr.zip,
    });

    if (!county) {
      countyFailed += 1;
      console.log(`  no county: ${addr._id} — ${street}`);
      await sleep(DELAY_MS);
      continue;
    }

    const normalized = normalizeCountyName(county);
    console.log(`  ${addr._id}: ${normalized}`);

    if (!DRY_RUN) {
      await CustomerAddress.updateOne(
        { _id: addr._id, countyManual: { $ne: true } },
        { $set: { county: normalized } },
      );
    }

    countyUpdated += 1;
    touchedCustomers.add(String(addr.customerRef));
    await sleep(DELAY_MS);
  }

  console.log(
    `County backfill: updated=${countyUpdated}, failed=${countyFailed}`,
  );

  // Sync denormalized county + assign owners for touched customers,
  // then assign for all customers (covers county-already-present cases).
  const customerIds = DRY_RUN
    ? [...touchedCustomers]
    : (
        await Customer.find({})
          .select("_id")
          .lean()
      ).map((c) => String(c._id));

  let assigned = 0;
  let cleared = 0;

  for (const id of customerIds) {
    if (!DRY_RUN) {
      await syncCustomerPrimaryFields(id);
      const ownerId = await assignCustomerOwner(id);
      if (ownerId) assigned += 1;
      else cleared += 1;
    } else {
      assigned += 1;
    }
  }

  console.log(
    `Owner assignment: processed=${customerIds.length}, withOwner≈${assigned}, withoutOwner≈${cleared}${DRY_RUN ? " (dry-run counts approximate)" : ""}`,
  );

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
