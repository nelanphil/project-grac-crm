/**
 * Removes all MessageThread / TwilioCommunication documents from the
 * DEVELOPMENT database, plus the Owner Household test customer and its
 * Blair Owner / Alex Owner contacts. Does not touch production Mongo or
 * real customers (Hatton, Nelan Residence, etc.).
 *
 * Dry-run by default. Pass --yes to write.
 *
 *   npx tsx src/scripts/purge-dev-messaging.ts
 *   npx tsx src/scripts/purge-dev-messaging.ts --yes
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
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { CustomerNote } from "../models/mongo/CustomerNote";
import { MessageThread } from "../models/mongo/MessageThread";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { normalizePhoneDigits } from "../utils/customerSites";

const DEFAULT_DB = "grac-crm";
const TEST_PHONES = new Set(["5551110001", "5551110002"]);

function withDbName(raw: string): string {
  if (raw.includes(`/${DEFAULT_DB}`)) return raw;

  const [base, query] = raw.split("?");
  const afterHost = base.replace(/^mongodb(\+srv)?:\/\/[^/]+/, "");
  const needsDb = afterHost === "" || afterHost === "/";

  if (!needsDb) return raw;

  const baseTrimmed = base.replace(/\/$/, "");
  return query
    ? `${baseTrimmed}/${DEFAULT_DB}?${query}`
    : `${baseTrimmed}/${DEFAULT_DB}`;
}

function hostOf(uri: string): string {
  return new URL(uri.replace("mongodb+srv", "https")).host;
}

function isTestContact(contact: {
  first?: string | null;
  last?: string | null;
  phone?: string | null;
}): boolean {
  const first = (contact.first ?? "").trim().toLowerCase();
  const last = (contact.last ?? "").trim().toLowerCase();
  if (last === "owner" && (first === "blair" || first === "alex")) return true;
  const digits = normalizePhoneDigits(contact.phone ?? "");
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
  return TEST_PHONES.has(last10);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run purge-dev-messaging with NODE_ENV=production.");
  }

  const execute = process.argv.includes("--yes");
  const devRaw =
    process.env.MONGODB_URI_DEVELOPMENT ??
    process.env.MONGODB_URI ??
    `mongodb://localhost:27017/${DEFAULT_DB}`;
  const prodRaw = process.env.MONGODB_URI_PRODUCTION;

  const devUri = withDbName(devRaw);
  const prodUri = prodRaw ? withDbName(prodRaw) : null;

  if (prodUri && devUri === prodUri) {
    throw new Error("Development URI equals production URI — aborting.");
  }

  console.log(`Target (dev): ${DEFAULT_DB} @ ${hostOf(devUri)}`);
  console.log(
    execute
      ? "\nMODE: EXECUTE (documents will be deleted)\n"
      : "\nMODE: DRY RUN (no writes). Re-run with --yes to execute.\n",
  );

  await mongoose.connect(devUri, { serverSelectionTimeoutMS: 15000 });

  const commCount = await TwilioCommunication.countDocuments();
  const threadCount = await MessageThread.countDocuments();

  const namedCustomers = await Customer.find({
    accountName: /^Owner Household$/i,
  })
    .select("_id accountName first last")
    .lean();

  const allContacts = await CustomerContact.find()
    .select("_id customerRef first last phone")
    .lean();
  const testContacts = allContacts.filter(isTestContact);

  const customerIds = [
    ...new Set([
      ...namedCustomers.map((c) => String(c._id)),
      ...testContacts.map((c) => String(c.customerRef)),
    ]),
  ];

  const extraCustomers =
    customerIds.length > namedCustomers.length
      ? await Customer.find({
          _id: {
            $in: customerIds.filter(
              (id) => !namedCustomers.some((c) => String(c._id) === id),
            ),
          },
        })
          .select("_id accountName first last")
          .lean()
      : [];

  const customersToDelete = [...namedCustomers, ...extraCustomers];
  const contactsOnThoseCustomers = allContacts.filter((c) =>
    customerIds.includes(String(c.customerRef)),
  );
  const contactIdsToDelete = [
    ...new Set([
      ...testContacts.map((c) => String(c._id)),
      ...contactsOnThoseCustomers.map((c) => String(c._id)),
    ]),
  ];

  console.log(`TwilioCommunication: ${commCount}`);
  console.log(`MessageThread: ${threadCount}`);
  console.log(`Test customers: ${customersToDelete.length}`);
  for (const c of customersToDelete) {
    console.log(
      `  - ${c.accountName || `${c.first} ${c.last}`.trim()} (${c._id})`,
    );
  }
  console.log(`Test contacts: ${contactIdsToDelete.length}`);
  for (const c of [...testContacts, ...contactsOnThoseCustomers].filter(
    (c, i, arr) => arr.findIndex((x) => String(x._id) === String(c._id)) === i,
  )) {
    console.log(
      `  - ${c.first} ${c.last} ${c.phone || ""} (${c._id})`.trim(),
    );
  }

  if (!execute) {
    console.log(
      "\nDry run complete. Re-run with --yes to delete these documents.",
    );
    await mongoose.disconnect();
    return;
  }

  const commResult = await TwilioCommunication.deleteMany({});
  const threadResult = await MessageThread.deleteMany({});
  const contactResult =
    contactIdsToDelete.length > 0
      ? await CustomerContact.deleteMany({ _id: { $in: contactIdsToDelete } })
      : { deletedCount: 0 };
  const addressResult =
    customerIds.length > 0
      ? await CustomerAddress.deleteMany({ customerRef: { $in: customerIds } })
      : { deletedCount: 0 };
  const noteResult =
    customerIds.length > 0
      ? await CustomerNote.deleteMany({ customerRef: { $in: customerIds } })
      : { deletedCount: 0 };
  const customerResult =
    customerIds.length > 0
      ? await Customer.deleteMany({ _id: { $in: customerIds } })
      : { deletedCount: 0 };

  console.log(
    `\nDeleted: communications=${commResult.deletedCount}, threads=${threadResult.deletedCount}, contacts=${contactResult.deletedCount}, addresses=${addressResult.deletedCount}, notes=${noteResult.deletedCount}, customers=${customerResult.deletedCount}`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
