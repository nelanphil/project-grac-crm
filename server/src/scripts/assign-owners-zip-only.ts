/**
 * Fast owner reassignment using FL ZIP→county only (no Census).
 * Run: npx tsx src/scripts/assign-owners-zip-only.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { reassignOwnersForTerritoryChange } from "../utils/ownerTerritory";

async function main() {
  await connectMongoDB();
  const result = await reassignOwnersForTerritoryChange({
    allCustomers: true,
    fillMissingCounty: true,
    allowCensus: false,
  });
  console.log(
    `Done: processed=${result.processed} assigned=${result.assigned}`,
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
