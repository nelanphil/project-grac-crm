/**
 * Cleans customer street/city fields and re-geocodes missing zips.
 *
 * - Strips duplicated city from street ("3 Holly Circle, Indian Atlantic")
 * - Normalizes common FL city aliases/misspellings ("Indian Atlantic" → Indialantic)
 * - Backfills empty zips via US Census geocoder using cleaned values
 *
 * Run: npx tsx src/scripts/normalize-and-backfill-zips.ts
 * Dry run: npx tsx src/scripts/normalize-and-backfill-zips.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BATCH_SIZE = 400;
const DRY_RUN = process.argv.includes("--dry-run");

/** Lowercase alias → canonical city name */
const CITY_ALIASES: Record<string, string> = {
  "indian atlantic": "Indialantic",
  indianatlantic: "Indialantic",
  "india lantic": "Indialantic",
  "fla beach": "Flagler Beach",
  "flagler bch": "Flagler Beach",
  "flagler beach": "Flagler Beach",
  "st.aug": "St. Augustine",
  "st aug": "St. Augustine",
  "st. aug": "St. Augustine",
  "st.augustine": "St. Augustine",
  "st augustine": "St. Augustine",
  "st. augustine": "St. Augustine",
  pc: "Palm Coast",
  "palm cst": "Palm Coast",
  "palmcoast": "Palm Coast",
  nsb: "New Smyrna Beach",
  "new smyrna": "New Smyrna Beach",
  "new smyrna bch": "New Smyrna Beach",
  ob: "Ormond Beach",
  ormond: "Ormond Beach",
  dealnd: "DeLand",
  deland: "DeLand",
  debary: "DeBary",
  "melbourne beach": "Melbourne Beach",
  "cocoa beach": "Cocoa Beach",
  "winter park": "Winter Park",
  "winter springs": "Winter Springs",
  "palm coast": "Palm Coast",
  "ormond beach": "Ormond Beach",
  "new smyrna beach": "New Smyrna Beach",
  "flagler beach": "Flagler Beach",
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCity(city: string): string {
  const key = normalizeKey(city);
  if (!key) return "";
  return CITY_ALIASES[key] ?? city.trim();
}

function stripCityFromStreet(address: string, city: string): string {
  let street = address.trim();
  if (!street.includes(",")) return street;

  const parts = street.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return street;

  const cityKey = normalizeKey(city);
  const last = parts[parts.length - 1];
  const lastKey = normalizeKey(last);

  // Trailing segment is the city (exact or alias-equivalent)
  const lastAsCity = normalizeCity(last);
  if (
    (cityKey && (lastKey === cityKey || normalizeKey(lastAsCity) === normalizeKey(normalizeCity(city)))) ||
    (CITY_ALIASES[lastKey] && !cityKey) ||
    (cityKey && lastKey.startsWith(cityKey)) ||
    (cityKey && cityKey.startsWith(lastKey) && lastKey.length >= 3)
  ) {
    return parts.slice(0, -1).join(", ").trim();
  }

  // Trailing segment looks like "City ST" or "City FL 32903"
  const withoutStateZip = last
    .replace(/\b[A-Z]{2}\b/gi, "")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "")
    .trim();
  if (cityKey && normalizeKey(withoutStateZip) === cityKey) {
    return parts.slice(0, -1).join(", ").trim();
  }

  return street;
}

type CustomerRow = {
  _id: { toString(): string };
  address: string;
  city: string;
  state: string;
  zip: string;
};

function buildCsv(rows: Array<{ street: string; city: string; state: string }>): string {
  return rows
    .map((c, i) => {
      const street = c.street.replace(/"/g, "").trim();
      const city = c.city.replace(/"/g, "").trim();
      const state = (c.state.replace(/"/g, "").trim() || "FL").toUpperCase();
      return `${i},"${street}","${city}","${state}",`;
    })
    .join("\n");
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
  const match = matchedAddress.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  return match?.[1] ?? null;
}

function extractCityFromMatched(matchedAddress: string): string | null {
  // "3 HOLLY CIR, INDIALANTIC, FL, 32903"
  const parts = matchedAddress.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  return parts[parts.length - 3] ?? null;
}

function extractStreetFromMatched(matchedAddress: string): string | null {
  const parts = matchedAddress.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  return parts.slice(0, -3).join(", ") || null;
}

type GeoMatch = { zip: string; city: string | null; street: string | null };

function parseBatchResponse(text: string): Map<number, GeoMatch> {
  const matches = new Map<number, GeoMatch>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());

  for (const line of lines) {
    const cols = parseCsvLine(line).map((c) => c.replace(/^"|"$/g, ""));
    if (cols.length < 5) continue;

    const id = Number(cols[0]);
    if (cols[2] !== "Match" || !Number.isFinite(id)) continue;

    const matchedAddress = cols[4] ?? "";
    const zip = extractZip(matchedAddress);
    if (!zip) continue;

    matches.set(id, {
      zip,
      city: extractCityFromMatched(matchedAddress),
      street: extractStreetFromMatched(matchedAddress),
    });
  }

  return matches;
}

async function geocodeBatch(
  rows: Array<{ street: string; city: string; state: string }>,
): Promise<Map<number, GeoMatch>> {
  const form = new FormData();
  form.append(
    "addressFile",
    new Blob([buildCsv(rows)], { type: "text/csv" }),
    "addresses.csv",
  );
  form.append("benchmark", "Public_AR_Current");

  const res = await fetch(CENSUS_BATCH_URL, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Census batch failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return parseBatchResponse(await res.text());
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (DRY_RUN) console.log("DRY RUN — no writes");

  // 1) Clean street/city for customers with commas in address or alias cities
  const aliasPattern = new RegExp(
    `^(${Object.keys(CITY_ALIASES)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})$`,
    "i",
  );

  const toClean = await Customer.find({
    $or: [{ address: { $regex: /,/ } }, { city: { $regex: aliasPattern } }],
  })
    .select("_id address city state zip")
    .lean();

  let cleaned = 0;
  for (const c of toClean) {
    const originalAddress = c.address ?? "";
    const originalCity = c.city ?? "";
    const nextCity = normalizeCity(originalCity) || normalizeCity(
      originalAddress.includes(",")
        ? originalAddress.split(",").map((p: string) => p.trim()).at(-1) ?? ""
        : "",
    );
    const nextAddress = stripCityFromStreet(originalAddress, nextCity || originalCity);

    if (nextAddress === originalAddress.trim() && nextCity === originalCity.trim()) {
      continue;
    }

    cleaned++;
    if (DRY_RUN) {
      console.log(
        `CLEAN ${c._id}: "${originalAddress}" / "${originalCity}" → "${nextAddress}" / "${nextCity}"`,
      );
      continue;
    }

    await Customer.updateOne(
      { _id: c._id },
      {
        $set: {
          address: nextAddress,
          city: nextCity || originalCity.trim(),
        },
      },
    );
  }
  console.log(`Address/city cleanups: ${cleaned}`);

  // 2) Re-geocode remaining missing zips with cleaned + aliased values
  const missing = (await Customer.find({
    $and: [
      { address: { $nin: [null, ""] } },
      { city: { $nin: [null, ""] } },
      { $or: [{ zip: null }, { zip: "" }, { zip: { $exists: false } }] },
    ],
  })
    .select("_id address city state zip")
    .lean()) as CustomerRow[];

  console.log(`Customers still missing zip: ${missing.length}`);

  let matched = 0;
  let unmatched = 0;
  let updated = 0;

  for (let offset = 0; offset < missing.length; offset += BATCH_SIZE) {
    const batch = missing.slice(offset, offset + BATCH_SIZE);
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(missing.length / BATCH_SIZE);
    console.log(`Geocoding batch ${batchNum}/${totalBatches} (${batch.length})…`);

    const prepared = batch.map((c) => {
      const city = normalizeCity(c.city);
      const street = stripCityFromStreet(c.address, city || c.city);
      const state = (c.state?.trim().toUpperCase() === "F" ? "FL" : c.state?.trim()) || "FL";
      return { street, city: city || c.city.trim(), state: state.toUpperCase() };
    });

    const geo = await geocodeBatch(prepared);

    for (let i = 0; i < batch.length; i++) {
      const hit = geo.get(i);
      if (!hit) {
        unmatched++;
        continue;
      }
      matched++;

      const set: Record<string, string> = { zip: hit.zip };
      // Prefer Census-normalized city/street when we can parse them
      if (hit.city) set.city = toTitleCase(hit.city);
      if (hit.street) set.address = toTitleCase(hit.street);
      // Fix bad state "F" → FL when we matched
      if ((batch[i].state ?? "").trim().toUpperCase() === "F") set.state = "FL";

      if (DRY_RUN) {
        console.log(
          `ZIP ${batch[i]._id}: ${prepared[i].street}, ${prepared[i].city} → ${hit.zip}`,
        );
        continue;
      }

      await Customer.updateOne(
        { _id: batch[i]._id, $or: [{ zip: null }, { zip: "" }, { zip: { $exists: false } }] },
        { $set: set },
      );
      updated++;
    }

    if (offset + BATCH_SIZE < missing.length) {
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
