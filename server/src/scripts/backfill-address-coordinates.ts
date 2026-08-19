/**
 * Backfill lat/lng on CustomerAddress via Google Address Validation
 * with Census fallback.
 *
 * Run: npx tsx src/scripts/backfill-address-coordinates.ts
 * Dry run: npx tsx src/scripts/backfill-address-coordinates.ts --dry-run
 * Limit: npx tsx src/scripts/backfill-address-coordinates.ts --limit=50
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
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
    $or: [
      { lat: null },
      { lng: null },
      { lat: { $exists: false } },
      { lng: { $exists: false } },
    ],
  }).sort({ createdAt: 1 });

  if (LIMIT > 0) query = query.limit(LIMIT);

  const addresses = await query.lean();
  console.log(
    `Found ${addresses.length} address(es) missing coordinates${DRY_RUN ? " (dry run)" : ""}.`,
  );

  let matched = 0;
  let unmatched = 0;
  let updated = 0;

  for (let i = 0; i < addresses.length; i += 1) {
    const addr = addresses[i]!;
    const street = trim(addr.address);
    if (!street) {
      unmatched += 1;
      continue;
    }

    const result = await resolveGeocodedAddress({
      street,
      city: trim(addr.city),
      state: trim(addr.state),
      zip: trim(addr.zip),
    });

    if (!result.ok || !result.match.coordinates) {
      unmatched += 1;
      console.log(
        `  no coords: ${addr._id} — ${street}, ${trim(addr.city) || "—"}, ${trim(addr.state)}`,
      );
    } else {
      matched += 1;
      const { lat, lng } = result.match.coordinates;
      if (!DRY_RUN) {
        await CustomerAddress.updateOne({ _id: addr._id }, { $set: { lat, lng } });
        updated += 1;
      }
      console.log(
        `  ${DRY_RUN ? "would update" : "updated"} ${addr._id} → ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      );
    }

    if (i < addresses.length - 1 && DELAY_MS > 0) {
      await sleep(DELAY_MS);
    }
  }

  console.log(
    `Done. matched=${matched} unmatched=${unmatched} updated=${updated}`,
  );
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
