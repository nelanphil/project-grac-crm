/**
 * Read-only diagnostic — prints document counts for the key CRM collections and
 * the applied-migrations ledger for the CURRENT environment.
 *
 *   Development:  npx tsx src/scripts/db-counts.ts
 *   Production:   NODE_ENV=production npx tsx src/scripts/db-counts.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { User } from "../models/mongo/User";
import { Contract } from "../models/mongo/Contract";
import { Migration } from "../models/mongo/Migration";

async function main(): Promise<void> {
  const env =
    process.env.NODE_ENV === "production" ? "PRODUCTION" : "development";
  console.log(`[db-counts] Environment: ${env}`);
  await connectMongoDB();

  const [customers, contacts, contactsWithEmail, users, contracts] =
    await Promise.all([
      Customer.countDocuments({}),
      CustomerContact.countDocuments({}),
      CustomerContact.countDocuments({
        email: { $exists: true, $nin: ["", null] },
      }),
      User.countDocuments({}),
      Contract.countDocuments({}),
    ]);

  console.table({
    Customer: customers,
    CustomerContact: contacts,
    "CustomerContact(with email)": contactsWithEmail,
    User: users,
    Contract: contracts,
  });

  const applied = await Migration.find()
    .select("migrationId appliedAt")
    .sort({ appliedAt: 1 })
    .lean();
  console.log(`[db-counts] Applied migrations (${applied.length}):`);
  for (const m of applied) {
    console.log(
      `  - ${m.migrationId} @ ${new Date(m.appliedAt).toISOString()}`,
    );
  }

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[db-counts] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
