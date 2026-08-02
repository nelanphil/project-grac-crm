/**
 * Backfill county from FL ZIP→county map (primary) + Census street geocode
 * (fallback), then assign ownerUserRef from owner territories.
 *
 * Run: npx tsx src/scripts/backfill-owner-territories.ts
 * Dry run: npx tsx src/scripts/backfill-owner-territories.ts --dry-run
 * Limit: npx tsx src/scripts/backfill-owner-territories.ts --limit=100
 * Skip Census: npx tsx src/scripts/backfill-owner-territories.ts --zip-only
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { normalizeCountyName } from "../constants/floridaCounties";
import { countyForFloridaZip } from "../constants/floridaZipCounties";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { lookupCountyFromCensus } from "../utils/censusGeocoder";
import { syncCustomerPrimaryFields } from "../utils/customerSites";
import {
  assignCustomerOwner,
  normalizeZip5,
} from "../utils/ownerTerritory";

const DRY_RUN = process.argv.includes("--dry-run");
const ZIP_ONLY = process.argv.includes("--zip-only");
const SKIP_ASSIGN = process.argv.includes("--skip-assign");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0;
const DELAY_MS = ZIP_ONLY ? 0 : 80;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await connectMongoDB();

  const filter = {
    $or: [{ county: "" }, { county: { $exists: false } }, { county: null }],
  };

  let query = CustomerAddress.find(filter).sort({ createdAt: 1 });
  if (LIMIT > 0) query = query.limit(LIMIT);

  const addresses = await query.lean();
  console.log(
    `Found ${addresses.length} address(es) missing county${DRY_RUN ? " (dry run)" : ""}${ZIP_ONLY ? " [zip-only]" : ""}.`,
  );

  let countyUpdated = 0;
  let countyFailed = 0;
  const touchedCustomers = new Set<string>();

  for (const addr of addresses) {
    const zip = normalizeZip5(addr.zip);
    const state = (addr.state || "FL").trim().toUpperCase().slice(0, 2);
    const street = (addr.address ?? "").trim();

    let county = "";
    // Known FL ZIPs win even when imported state is wrong (e.g. "DL").
    if (zip) {
      county = normalizeCountyName(countyForFloridaZip(zip));
    }

    if (!county && !ZIP_ONLY && street) {
      county = await lookupCountyFromCensus({
        street,
        city: addr.city,
        state: state || "FL",
        zip,
      });
      if (DELAY_MS) await sleep(DELAY_MS);
    }

    if (!county) {
      countyFailed += 1;
      console.log(
        `  no county: ${addr._id} — zip=${zip || "—"} street=${street || "—"}`,
      );
      continue;
    }

    console.log(`  ${addr._id}: ${county} (zip ${zip || "—"})`);

    if (!DRY_RUN) {
      await CustomerAddress.updateOne(
        { _id: addr._id, countyManual: { $ne: true } },
        { $set: { county } },
      );
    }

    countyUpdated += 1;
    touchedCustomers.add(String(addr.customerRef));
  }

  // Also backfill denormalized Customer.county when address is missing but zip exists.
  const flatCustomers = await Customer.find({
    deletedAt: null,
    $or: [{ county: "" }, { county: { $exists: false } }, { county: null }],
    zip: { $nin: ["", null] },
  })
    .select("_id zip state")
    .lean();

  let flatUpdated = 0;
  for (const c of flatCustomers) {
    const zip = normalizeZip5(c.zip);
    if (!zip) continue;
    const county = normalizeCountyName(countyForFloridaZip(zip));
    if (!county) continue;
    if (!DRY_RUN) {
      await Customer.findByIdAndUpdate(c._id, { $set: { county } });
    }
    flatUpdated += 1;
    touchedCustomers.add(String(c._id));
  }

  console.log(
    `County backfill: addresses=${countyUpdated}, flat=${flatUpdated}, failed=${countyFailed}`,
  );

  // Sync denormalized Customer.county for touched primaries only.
  if (!DRY_RUN) {
    let synced = 0;
    for (const id of touchedCustomers) {
      await syncCustomerPrimaryFields(id);
      synced += 1;
    }
    console.log(`Synced primary fields for ${synced} customer(s).`);
  }

  if (SKIP_ASSIGN) {
    console.log("Skipping owner assignment (--skip-assign).");
    await disconnectMongoDB();
    return;
  }

  const customerIds = DRY_RUN
    ? [...touchedCustomers]
    : (
        await Customer.find({ deletedAt: null })
          .select("_id")
          .lean()
      ).map((c) => String(c._id));

  let assigned = 0;
  let cleared = 0;

  for (const id of customerIds) {
    if (!DRY_RUN) {
      const ownerId = await assignCustomerOwner(id, {
        fillMissingCounty: true,
        allowCensus: !ZIP_ONLY,
      });
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
