/**
 * Backfills MessageThread.customerRef from CustomerContact for grouping.
 * Does not merge threads, does not drop the contact-level unique index,
 * and does not add a unique index on (customerRef, ourNumber).
 *
 * Run: npx tsx src/scripts/merge-customer-message-threads.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";

mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { MessageThread } from "../models/mongo/MessageThread";

function log(msg: string): void {
  console.log(`[merge-customer-message-threads] ${msg}`);
}

async function backfillCustomerRef(): Promise<{ scanned: number; updated: number }> {
  const threads = await MessageThread.find({
    $or: [{ customerRef: null }, { customerRef: { $exists: false } }],
    contactRef: { $ne: null },
  })
    .select("_id contactRef")
    .lean();

  log(`Threads missing customerRef with a contact: ${threads.length}`);
  if (threads.length === 0) return { scanned: 0, updated: 0 };

  const contactIds = [
    ...new Set(
      threads
        .map((t) => (t.contactRef ? String(t.contactRef) : ""))
        .filter(Boolean),
    ),
  ];

  const contacts = await CustomerContact.find({ _id: { $in: contactIds } })
    .select("_id customerRef")
    .lean();
  const customerByContact = new Map(
    contacts
      .filter((c) => c.customerRef)
      .map((c) => [String(c._id), c.customerRef]),
  );

  const ops: Array<{
    updateOne: {
      filter: { _id: (typeof threads)[number]["_id"] };
      update: { $set: { customerRef: mongoose.Types.ObjectId } };
    };
  }> = [];

  for (const thread of threads) {
    if (!thread.contactRef) continue;
    const customerRef = customerByContact.get(String(thread.contactRef));
    if (!customerRef) continue;
    ops.push({
      updateOne: {
        filter: { _id: thread._id },
        update: { $set: { customerRef } },
      },
    });
  }

  let updated = 0;
  const chunkSize = 500;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    const result = await MessageThread.bulkWrite(chunk, { ordered: false });
    updated += result.modifiedCount + result.upsertedCount;
  }

  return { scanned: threads.length, updated };
}

/**
 * Keep the contact-level unique open-thread index. Tighten the partial filter
 * so documents with contactRef null (unknown callers) are not covered — that
 * is still {contactRef, ourNumber} uniqueness, not a customer unique index.
 */
async function ensureContactOpenUniqueIndex(): Promise<void> {
  const col = MessageThread.collection;
  const indexes = await col.indexes();
  const desiredPartial = {
    status: "open",
    contactRef: { $type: "objectId" as const },
  };

  const contactUniques = indexes.filter(
    (idx) =>
      Boolean(idx.unique) &&
      idx.key?.contactRef === 1 &&
      idx.key?.ourNumber === 1 &&
      Object.keys(idx.key).length === 2,
  );

  const alreadyCorrect = contactUniques.some((idx) => {
    const partial = idx.partialFilterExpression as
      | { status?: string; contactRef?: { $type?: string | number } }
      | undefined;
    const type = partial?.contactRef?.$type;
    return (
      partial?.status === "open" && (type === "objectId" || type === 7)
    );
  });

  if (alreadyCorrect) {
    log("Contact unique open-thread index already present.");
    return;
  }

  for (const idx of contactUniques) {
    if (!idx.name) continue;
    log(`Dropping outdated contact unique index ${idx.name} to restore ObjectId partial filter.`);
    await col.dropIndex(idx.name);
  }

  await col.createIndex(
    { contactRef: 1, ourNumber: 1 },
    {
      unique: true,
      name: "contactRef_1_ourNumber_1",
      partialFilterExpression: desiredPartial,
    },
  );
  log("Restored unique open-thread index on {contactRef, ourNumber}.");
}

async function main(): Promise<void> {
  await connectMongoDB();

  const { scanned, updated } = await backfillCustomerRef();
  log(`Backfilled customerRef on ${updated} of ${scanned} thread(s).`);
  log("Skipping merge: contact-level threads are unchanged.");

  await ensureContactOpenUniqueIndex();

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
