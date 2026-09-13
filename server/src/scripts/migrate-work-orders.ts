/**
 * Migrates work orders from the MySQL SQL dump into MongoDB.
 * Run: npx tsx src/scripts/migrate-work-orders.ts
 *
 * Safe to re-run — checks for existing data and skips if already migrated.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import fs from "fs";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { Customer } from "../models/mongo/Customer";
import { Product } from "../models/mongo/Product";
import { mappedWorkOrderMoneyFields } from "../services/legacyWorkOrderItems";
import { parseWorkOrderDump } from "../services/legacyDumpSync";
import mongoose from "mongoose";

const CURRENT_DUMP = path.resolve(__dirname, "../current/work_orders.sql");
const FALLBACK_DUMP = path.resolve(__dirname, "database_dump/work_orders.sql");
const DUMP_PATH = fs.existsSync(CURRENT_DUMP) ? CURRENT_DUMP : FALLBACK_DUMP;

type CustomerSnap = {
  id: string;
  name: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  email: string;
};

async function buildCustomerMap(): Promise<Map<number, CustomerSnap>> {
  const customers = await Customer.find(
    {},
    { legacyId: 1, accountName: 1, first: 1, last: 1, address: 1, city: 1, zip: 1, phone: 1, email: 1 },
  ).lean();
  const map = new Map<number, CustomerSnap>();
  for (const c of customers) {
    if (c.legacyId == null) continue;
    const name =
      (c.accountName ?? "").trim() ||
      `${c.first ?? ""} ${c.last ?? ""}`.trim();
    map.set(c.legacyId, {
      id: (c._id as object).toString(),
      name,
      address: c.address ?? "",
      city: c.city ?? "",
      zip: c.zip ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
    });
  }
  return map;
}

const BATCH_SIZE = 500;

async function main() {
  await connectMongoDB();

  const existingCount = await WorkOrder.countDocuments();
  if (existingCount > 0) {
    console.log(
      `WorkOrders collection already has ${existingCount} documents. Skipping migration.`,
    );
    console.log("To re-run, drop the workorders collection first.");
    await disconnectMongoDB();
    return;
  }

  console.log(`Reading dump from ${DUMP_PATH}...`);
  const sql = fs.readFileSync(DUMP_PATH, "utf-8");

  console.log("Parsing SQL dump...");
  const rows = parseWorkOrderDump(sql);
  console.log(`Parsed ${rows.length} work order rows.`);

  console.log("Building customer lookup map...");
  const customerMap = await buildCustomerMap();
  console.log(`Found ${customerMap.size} customers for linking.`);

  const catalog = (
    await Product.find({ active: { $ne: false } })
      .select("_id productCode partNumber name kind listPrice unitPrice")
      .lean()
  ).map((product) => ({
    _id: String(product._id),
    productCode: product.productCode,
    partNumber: product.partNumber,
    name: product.name,
    kind: product.kind,
    listPrice: product.listPrice,
    unitPrice: product.unitPrice,
  }));
  console.log(`Loaded ${catalog.length} products for line-item mapping.`);

  const docs = rows.map((row) => {
    const customer = customerMap.get(row.customerId);
    return {
      ...row,
      ...mappedWorkOrderMoneyFields(row, catalog),
      customerRef: customer
        ? new mongoose.Types.ObjectId(customer.id)
        : undefined,
      customerName: customer?.name ?? "",
      customerAddress: customer?.address ?? "",
      customerCity: customer?.city ?? "",
      customerZip: customer?.zip ?? "",
      customerPhone: customer?.phone ?? "",
      customerEmail: customer?.email ?? "",
    };
  });

  console.log(`Inserting in batches of ${BATCH_SIZE}...`);
  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await WorkOrder.insertMany(batch, { ordered: false });
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${docs.length}`);
  }

  console.log(`Migration complete. ${inserted} work orders inserted.`);
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
