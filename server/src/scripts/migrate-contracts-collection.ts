/**
 * Step 1 of 2 — migrate servicecontracts into contracts.
 *
 * 1. Renames MongoDB collection `servicecontracts` → `contracts` (if needed)
 *    When an empty `contracts` collection already exists, drops it first so
 *    the rename can proceed.
 * 2. Drops a unique index on customerId (multi-contract: many per customer)
 * 3. Ensures compound index { customerId, contractDate }
 * 4. Backfills contractType: "service" where description matches ASC/ACS
 *
 * Run: npx tsx src/scripts/migrate-contracts-collection.ts
 * Then: npx tsx src/scripts/migrate-contract-dates.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Contract } from "../models/mongo/Contract";
import { ASC_PATTERN } from "../utils/contractTypes";

async function main(): Promise<void> {
  await connectMongoDB();

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection not available");
  }

  const names = (await db.listCollections().toArray()).map((c) => c.name);
  let renamed = false;

  const hasService = names.includes("servicecontracts");
  const hasContracts = names.includes("contracts");

  if (hasService && hasContracts) {
    const contractsCount = await db.collection("contracts").countDocuments();
    if (contractsCount === 0) {
      await db.collection("contracts").drop();
      console.log("Dropped empty contracts collection to allow rename");
      await db.collection("servicecontracts").rename("contracts");
      renamed = true;
      console.log("Renamed servicecontracts → contracts");
    } else {
      console.log(
        `contracts already has ${contractsCount} documents — skipping rename (servicecontracts left intact)`,
      );
    }
  } else if (hasService && !hasContracts) {
    await db.collection("servicecontracts").rename("contracts");
    renamed = true;
    console.log("Renamed servicecontracts → contracts");
  } else if (hasContracts) {
    console.log("contracts collection already exists — skipping rename");
  } else {
    console.log("No servicecontracts collection found — skipping rename");
  }

  const collectionNames = (await db.listCollections().toArray()).map((c) => c.name);
  if (!collectionNames.includes("contracts")) {
    console.log("No contracts collection after rename step — nothing to backfill");
    await disconnectMongoDB();
    return;
  }

  const collection = db.collection("contracts");
  const indexes = await collection.indexes();

  for (const idx of indexes) {
    const key = idx.key as Record<string, number>;
    const keys = Object.keys(key);
    if (idx.unique && keys.length === 1 && keys[0] === "customerId") {
      await collection.dropIndex(idx.name as string);
      console.log(`Dropped unique index: ${idx.name}`);
    }
  }

  await collection.createIndex({ customerId: 1, contractDate: -1 });
  console.log("Ensured compound index { customerId: 1, contractDate: -1 }");

  const backfillResult = await Contract.updateMany(
    { description: { $regex: ASC_PATTERN }, contractType: { $ne: "service" } },
    { $set: { contractType: "service" } },
  );

  const total = await Contract.countDocuments();
  console.log(`Backfilled contractType on ${backfillResult.modifiedCount} records`);
  console.log(`Total contracts: ${total}`);
  console.log(`Collection renamed: ${renamed ? "yes" : "no"}`);
  console.log("Next: npx tsx src/scripts/migrate-contract-dates.ts");

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
