/**
 * One login per customer, matched by primary email.
 *
 * 1. Ensure a role=customer User exists for each active customer's primary email
 * 2. Soft-delete leftover customer Users whose email is not a primary email
 * 3. Clear CustomerContact.userRef (auth no longer uses it)
 *
 * Idempotent. Run from server/:
 *   npx tsx src/scripts/tighten-customer-logins.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import {
  connectMongoDB,
  disconnectMongoDB,
  getMongoStatus,
} from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { User, activeUserFilter } from "../models/mongo/User";
import { ensureCustomerLoginForPrimaryEmail } from "../utils/ensureCustomerLogin";
import {
  accountEmailRegex,
  normalizeAccountEmail,
} from "../utils/provisionCustomerAccount";

function log(msg: string): void {
  console.log(`[tighten-customer-logins] ${msg}`);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
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
    () => worker(),
  );
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const started = Date.now();
  log("Connecting to MongoDB…");
  await connectMongoDB();

  if (getMongoStatus() !== "connected") {
    console.error(
      "[tighten-customer-logins] MongoDB is not connected. Check MONGODB_URI_DEVELOPMENT / MONGODB_URI in .env",
    );
    process.exit(1);
  }

  mongoose.set("bufferCommands", false);

  const customers = await Customer.find({
    deletedAt: null,
    mergedIntoRef: null,
    email: { $exists: true, $nin: ["", null] },
  })
    .select("_id email")
    .lean();
  log(`Ensuring logins for ${customers.length} customers with a primary email`);

  let created = 0;
  let linked = 0;
  let restored = 0;
  let renamed = 0;
  let skipped = 0;
  let errors = 0;

  await mapPool(customers, 10, async (customer) => {
    try {
      const result = await ensureCustomerLoginForPrimaryEmail(customer._id);
      if (result.status === "created") created++;
      else if (result.status === "linked") linked++;
      else if (result.status === "restored") restored++;
      else if (result.status === "renamed") renamed++;
      else skipped++;
    } catch (err) {
      errors++;
      console.error(
        `[tighten-customer-logins] Error for customer ${customer._id}:`,
        err,
      );
    }
  });

  const primaryEmails = new Set(
    customers
      .map((c) => normalizeAccountEmail(c.email ?? ""))
      .filter(Boolean),
  );

  const customerUsers = await User.find({
    role: "customer",
    ...activeUserFilter,
  })
    .select("_id email")
    .lean();

  let revoked = 0;
  for (const user of customerUsers) {
    const email = normalizeAccountEmail(user.email ?? "");
    if (email && primaryEmails.has(email)) continue;
    const emailRx = accountEmailRegex(email);
    const stillPrimary = emailRx
      ? await Customer.exists({
          email: emailRx,
          deletedAt: null,
          mergedIntoRef: null,
        })
      : null;
    if (stillPrimary) continue;
    await User.updateOne({ _id: user._id }, { $set: { deletedAt: new Date() } });
    revoked++;
  }

  const unset = await CustomerContact.updateMany(
    { userRef: { $ne: null } },
    { $unset: { userRef: "" } },
  );

  log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s — created=${created} linked=${linked} restored=${restored} renamed=${renamed} skipped=${skipped} revoked=${revoked} clearedUserRef=${unset.modifiedCount} errors=${errors}`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[tighten-customer-logins] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
