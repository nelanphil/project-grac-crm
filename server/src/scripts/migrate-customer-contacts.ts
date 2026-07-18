/**
 * Migrates flat customer first/last/phone/email into CustomerContact
 * collection (one primary contact per customer).
 *
 * Idempotent. Run from server/:
 *   npx tsx src/scripts/migrate-customer-contacts.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB, getMongoStatus } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { ensureCustomerContactFromFlat } from "../utils/customerContacts";

function log(msg: string): void {
  console.log(`[migrate-customer-contacts] ${msg}`);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    () => worker()
  );
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const started = Date.now();
  log("Connecting to MongoDB…");
  await connectMongoDB();

  if (getMongoStatus() !== "connected") {
    console.error(
      "[migrate-customer-contacts] MongoDB is not connected. Check MONGODB_URI_DEVELOPMENT / MONGODB_URI in .env"
    );
    process.exit(1);
  }

  mongoose.set("bufferCommands", false);

  log("Loading customers…");
  const customers = await Customer.find({
    $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
  })
    .select("_id legacyId first last phone email")
    .lean();
  log(`Found ${customers.length} customers`);

  log("Loading existing contacts…");
  const existingContacts = await CustomerContact.find()
    .select("_id customerRef")
    .lean();
  const customersWithContacts = new Set(
    existingContacts.map((c) => c.customerRef.toString())
  );
  log(`${customersWithContacts.size} customers already have contacts`);

  const toCreate = customers.filter(
    (c) => !customersWithContacts.has(c._id.toString())
  );
  log(`Creating contacts for ${toCreate.length} customers…`);

  let created = 0;
  let errors = 0;

  await mapPool(toCreate, 20, async (customer, index) => {
    try {
      const result = await ensureCustomerContactFromFlat(customer);
      if (result.created) created += 1;
      if ((index + 1) % 200 === 0 || index + 1 === toCreate.length) {
        log(`Progress ${index + 1}/${toCreate.length} (created ${created})`);
      }
    } catch (err) {
      errors += 1;
      console.error(
        `[migrate-customer-contacts] Failed for ${customer._id}:`,
        err
      );
    }
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log(
    `Done in ${elapsed}s — created ${created}, skipped ${customers.length - toCreate.length}, errors ${errors}`
  );

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[migrate-customer-contacts] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    // ignore
  }
  process.exit(1);
});
