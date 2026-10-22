/**
 * Title-case Customer and CustomerContact first/last names.
 *
 * Idempotent: a row is updated only when a stored first or last name differs
 * from toProperCase. accountName is never changed, and a contact is never
 * copied onto its customer. Listed in migrations/manifest.ts so Render
 * `preDeployCommand` (`npm run migrate`) applies it once on production.
 *
 * Run from server/:
 *   npx tsx src/scripts/backfill-person-names.ts
 *   npx tsx src/scripts/backfill-person-names.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

const envCandidates = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../../.env"),
];
for (const envPath of envCandidates) {
  dotenv.config({ path: envPath });
}

import mongoose from "mongoose";
mongoose.set("autoIndex", false);

import type { AnyBulkWriteOperation, Types } from "mongoose";
import {
  connectMongoDB,
  disconnectMongoDB,
  getMongoStatus,
} from "../config/mongodb";
import { Customer, ICustomer } from "../models/mongo/Customer";
import { CustomerContact, ICustomerContact } from "../models/mongo/CustomerContact";
import { toProperCase } from "../utils/formatName";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 500;

function log(msg: string): void {
  console.log(`[backfill-person-names] ${msg}`);
}

function personNameSet(
  first: string | null | undefined,
  last: string | null | undefined,
): { first?: string; last?: string } | null {
  const nextFirst = toProperCase(first);
  const nextLast = toProperCase(last);
  const set: { first?: string; last?: string } = {};
  if ((first ?? "") !== nextFirst) set.first = nextFirst;
  if ((last ?? "") !== nextLast) set.last = nextLast;
  return Object.keys(set).length > 0 ? set : null;
}

function describeChange(
  kind: string,
  id: Types.ObjectId,
  beforeFirst: string,
  beforeLast: string,
  set: { first?: string; last?: string },
): string {
  const parts: string[] = [];
  if (set.first !== undefined) {
    parts.push(`first ${JSON.stringify(beforeFirst)} -> ${JSON.stringify(set.first)}`);
  }
  if (set.last !== undefined) {
    parts.push(`last ${JSON.stringify(beforeLast)} -> ${JSON.stringify(set.last)}`);
  }
  return `${kind} ${id.toString()}: ${parts.join("; ")}`;
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[backfill-person-names] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }

  const customers = await Customer.find({})
    .select("_id first last")
    .lean();
  const contacts = await CustomerContact.find({})
    .select("_id first last")
    .lean();

  const customerOps: AnyBulkWriteOperation<ICustomer>[] = [];
  const contactOps: AnyBulkWriteOperation<ICustomerContact>[] = [];
  const examples: string[] = [];

  for (const customer of customers) {
    const set = personNameSet(customer.first, customer.last);
    if (!set) continue;
    customerOps.push({
      updateOne: {
        filter: { _id: customer._id },
        update: { $set: set },
      },
    });
    if (examples.length < 20) {
      examples.push(
        describeChange(
          "customer",
          customer._id as Types.ObjectId,
          customer.first ?? "",
          customer.last ?? "",
          set,
        ),
      );
    }
  }

  for (const contact of contacts) {
    const set = personNameSet(contact.first, contact.last);
    if (!set) continue;
    contactOps.push({
      updateOne: {
        filter: { _id: contact._id },
        update: { $set: set },
      },
    });
    if (examples.length < 20) {
      examples.push(
        describeChange(
          "contact",
          contact._id as Types.ObjectId,
          contact.first ?? "",
          contact.last ?? "",
          set,
        ),
      );
    }
  }

  log(
    `${customerOps.length} customers and ${contactOps.length} contacts have a first or last name to title-case.`,
  );
  for (const example of examples) log(example);

  if (DRY_RUN) {
    log("dry-run: no changes written.");
    await disconnectMongoDB();
    return;
  }

  let customersModified = 0;
  for (let i = 0; i < customerOps.length; i += BATCH_SIZE) {
    const result = await Customer.bulkWrite(customerOps.slice(i, i + BATCH_SIZE), {
      ordered: false,
    });
    customersModified += result.modifiedCount;
  }
  let contactsModified = 0;
  for (let i = 0; i < contactOps.length; i += BATCH_SIZE) {
    const result = await CustomerContact.bulkWrite(
      contactOps.slice(i, i + BATCH_SIZE),
      { ordered: false },
    );
    contactsModified += result.modifiedCount;
  }
  log(
    `Updated ${customersModified} customers and ${contactsModified} contacts.`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[backfill-person-names] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
