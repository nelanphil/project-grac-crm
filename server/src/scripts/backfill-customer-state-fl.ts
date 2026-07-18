/**
 * Backfills empty customer.state to FL and normalizes FL casing variants to FL.
 * Does not overwrite other states (GA, NY, etc.).
 * Run: npx tsx src/scripts/backfill-customer-state-fl.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";

async function main(): Promise<void> {
  await connectMongoDB();

  const emptyResult = await Customer.updateMany(
    { $or: [{ state: null }, { state: "" }, { state: { $exists: false } }] },
    { $set: { state: "FL" } },
  );

  const caseResult = await Customer.updateMany(
    { state: { $regex: /^fl$/i } },
    { $set: { state: "FL" } },
  );

  console.log(`Filled empty state with FL: ${emptyResult.modifiedCount}`);
  console.log(`Normalized FL casing: ${caseResult.modifiedCount}`);

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
