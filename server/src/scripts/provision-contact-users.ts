/**
 * Provisions User accounts for existing CustomerContact emails.
 *
 * Idempotent. Run from server/:
 *   npx tsx src/scripts/provision-contact-users.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB, getMongoStatus } from "../config/mongodb";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { ensureCustomerUser } from "../utils/ensureCustomerUser";

function log(msg: string): void {
  console.log(`[provision-contact-users] ${msg}`);
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
      "[provision-contact-users] MongoDB is not connected. Check MONGODB_URI_DEVELOPMENT / MONGODB_URI in .env"
    );
    process.exit(1);
  }

  mongoose.set("bufferCommands", false);

  log("Loading contacts with non-empty email…");
  const contacts = await CustomerContact.find({
    email: { $exists: true, $nin: ["", null] },
  })
    .select("_id email first last userRef")
    .lean();
  log(`Found ${contacts.length} contacts with email`);

  let created = 0;
  let linked = 0;
  let restored = 0;
  let skipped = 0;
  let errors = 0;

  await mapPool(contacts, 10, async (contact) => {
    try {
      const result = await ensureCustomerUser({
        _id: contact._id as mongoose.Types.ObjectId,
        email: contact.email,
        first: contact.first,
        last: contact.last,
        userRef: contact.userRef ?? null,
      });
      if (result.status === "created") created++;
      else if (result.status === "linked") linked++;
      else if (result.status === "restored") restored++;
      else skipped++;
    } catch (err) {
      errors++;
      console.error(
        `[provision-contact-users] Error for contact ${contact._id}:`,
        err
      );
    }
  });

  log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s — created=${created} linked=${linked} restored=${restored} skipped=${skipped} errors=${errors}`
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[provision-contact-users] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
