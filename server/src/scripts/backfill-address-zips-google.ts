/**
 * Backfill empty CustomerAddress ZIP (and county) via Google Address Validation
 * with Census fallback. Requires street + state.
 *
 * Run: npx tsx src/scripts/backfill-address-zips-google.ts
 * Dry run: npx tsx src/scripts/backfill-address-zips-google.ts --dry-run
 * Limit: npx tsx src/scripts/backfill-address-zips-google.ts --limit=50
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { normalizeCountyName } from "../constants/floridaCounties";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { syncCustomerPrimaryFields } from "../utils/customerSites";
import { assignCustomerOwner } from "../utils/ownerTerritory";
import { resolveGeocodedAddress } from "../utils/resolveGeocodedAddress";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0;
const DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function main() {
  await connectMongoDB();

  let query = CustomerAddress.find({
    address: { $nin: [null, ""] },
    state: { $nin: [null, ""] },
    $or: [{ zip: "" }, { zip: null }, { zip: { $exists: false } }],
  }).sort({ createdAt: 1 });

  if (LIMIT > 0) query = query.limit(LIMIT);

  const addresses = await query.lean();
  console.log(
    `Found ${addresses.length} address(es) missing zip with street+state${DRY_RUN ? " (dry run)" : ""}.`,
  );

  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  const touchedCustomers = new Set<string>();

  for (let i = 0; i < addresses.length; i += 1) {
    const addr = addresses[i]!;
    const street = trim(addr.address);
    const city = trim(addr.city);
    const state = trim(addr.state);
    if (!street || !state) {
      unmatched += 1;
      continue;
    }

    const result = await resolveGeocodedAddress({
      street,
      city,
      state,
      zip: "",
    });

    if (!result.ok) {
      unmatched += 1;
      console.log(
        `  no match: ${addr._id} — ${street}, ${city || "—"}, ${state}`,
      );
    } else {
      const zip = trim(result.match.normalized.zip);
      const county = normalizeCountyName(result.match.normalized.county);
      if (!zip) {
        unmatched += 1;
        console.log(
          `  no zip: ${addr._id} — ${result.match.matchedAddress}`,
        );
      } else {
        matched += 1;
        const existingCounty = normalizeCountyName(addr.county);
        const fillCounty =
          Boolean(county) && !existingCounty && addr.countyManual !== true;
        console.log(
          `  ${addr._id}: zip=${zip}${fillCounty ? ` county=${county}` : ""}`,
        );

        if (!DRY_RUN) {
          const $set: { zip: string; county?: string } = { zip };
          if (fillCounty) $set.county = county;
          await CustomerAddress.updateOne(
            {
              _id: addr._id,
              $or: [{ zip: "" }, { zip: null }, { zip: { $exists: false } }],
            },
            { $set },
          );
          updated += 1;
          touchedCustomers.add(String(addr.customerRef));
        }
      }
    }

    if (i + 1 < addresses.length) await sleep(DELAY_MS);

    if ((i + 1) % 50 === 0) {
      console.log(`Progress ${i + 1}/${addresses.length}…`);
    }
  }

  if (!DRY_RUN) {
    let synced = 0;
    for (const customerId of touchedCustomers) {
      await syncCustomerPrimaryFields(customerId);
      await assignCustomerOwner(customerId, {
        fillMissingCounty: true,
        allowCensus: false,
      });
      synced += 1;
    }
    console.log(`Synced owner/primary for ${synced} customer(s).`);
  }

  console.log(`Matched: ${matched}`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`Updated: ${updated}${DRY_RUN ? " (dry-run)" : ""}`);

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
