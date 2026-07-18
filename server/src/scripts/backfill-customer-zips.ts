/**
 * Backfills missing customer zip codes via the US Census Bureau geocoder
 * using street + city + state. Only updates empty zip fields.
 *
 * Run: npx tsx src/scripts/backfill-customer-zips.ts
 * Dry run: npx tsx src/scripts/backfill-customer-zips.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BATCH_SIZE = 500;
const DRY_RUN = process.argv.includes("--dry-run");

type MissingZipCustomer = {
  _id: { toString(): string };
  address: string;
  city: string;
  state: string;
  zip: string;
};

function buildCsv(rows: MissingZipCustomer[]): string {
  return rows
    .map((c, i) => {
      const id = String(i);
      const street = (c.address ?? "").replace(/"/g, "").trim();
      const city = (c.city ?? "").replace(/"/g, "").trim();
      const state = (c.state ?? "FL").replace(/"/g, "").trim() || "FL";
      return `${id},"${street}","${city}","${state}",`;
    })
    .join("\n");
}

/** Parse Census batch CSV; returns map of row index → zip. */
function parseBatchResponse(text: string): Map<number, string> {
  const zips = new Map<number, string>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());

  for (const line of lines) {
    // Columns are typically quoted CSV:
    // id, input, Match|No_Match|Tie, matchType, matchedAddress, coords, tigerId, side
    const cols = parseCsvLine(line).map((c) => c.replace(/^"|"$/g, ""));
    if (cols.length < 5) continue;

    const id = Number(cols[0]);
    const status = cols[2] ?? "";
    if (status !== "Match" || !Number.isFinite(id)) continue;

    const zip = extractZip(cols[4] ?? "");
    if (zip) zips.set(id, zip);
  }

  return zips;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function extractZip(matchedAddress: string): string | null {
  // "410 MICHIGAN AVE W, LAKE HELEN, FL, 32744" or "... FL 32744-1234"
  const match = matchedAddress.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  return match?.[1] ?? null;
}

async function geocodeBatch(rows: MissingZipCustomer[]): Promise<Map<number, string>> {
  const csv = buildCsv(rows);
  const form = new FormData();
  form.append(
    "addressFile",
    new Blob([csv], { type: "text/csv" }),
    "addresses.csv",
  );
  form.append("benchmark", "Public_AR_Current");

  const res = await fetch(CENSUS_BATCH_URL, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Census batch failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const text = await res.text();
  return parseBatchResponse(text);
}

async function main(): Promise<void> {
  await connectMongoDB();

  const customers = (await Customer.find({
    $and: [
      { address: { $nin: [null, ""] } },
      { city: { $nin: [null, ""] } },
      { $or: [{ zip: null }, { zip: "" }, { zip: { $exists: false } }] },
    ],
  })
    .select("_id address city state zip")
    .lean()) as MissingZipCustomer[];

  console.log(`Customers missing zip with street+city: ${customers.length}`);
  if (DRY_RUN) console.log("DRY RUN — no writes");

  let updated = 0;
  let matched = 0;
  let unmatched = 0;

  for (let offset = 0; offset < customers.length; offset += BATCH_SIZE) {
    const batch = customers.slice(offset, offset + BATCH_SIZE);
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(customers.length / BATCH_SIZE);
    console.log(`Geocoding batch ${batchNum}/${totalBatches} (${batch.length} addresses)…`);

    const zipByIndex = await geocodeBatch(batch);

    for (let i = 0; i < batch.length; i++) {
      const zip = zipByIndex.get(i);
      if (!zip) {
        unmatched++;
        continue;
      }
      matched++;
      if (DRY_RUN) continue;

      await Customer.updateOne(
        { _id: batch[i]._id, $or: [{ zip: null }, { zip: "" }, { zip: { $exists: false } }] },
        { $set: { zip } },
      );
      updated++;
    }

    // Be polite to the public Census endpoint between batches
    if (offset + BATCH_SIZE < customers.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(`Matched: ${matched}`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`Updated: ${updated}${DRY_RUN ? " (dry-run)" : ""}`);

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
