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

const DUMP_PATH = path.resolve(__dirname, "database_dump/work_orders.sql");

interface WorkOrderRow {
  legacyId: number;
  userId: number;
  customerId: number;
  descPerform: string;
  paid: boolean;
  runHours: number;
  laborHours: number;
  date: Date | null;
  tech: string;
  descPerformed: string;
  totalParts: number;
  totalLabor: number;
  miscExp: number;
  subtotal: number;
  shipping: number;
  total: number;
  certify: boolean;
  completed: boolean;
}

function parseSqlValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.toUpperCase() === "NULL") return null;
  return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function splitValuesRow(inner: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  let current = "";
  let inString = false;

  while (i < inner.length) {
    const ch = inner[i];

    if (inString) {
      if (ch === "\\" && i + 1 < inner.length) {
        current += ch + inner[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") {
        current += ch;
        inString = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === "'") {
        inString = true;
        current += ch;
      } else if (ch === ",") {
        tokens.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    i++;
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function parseDate(raw: string | null): Date | null {
  if (!raw || raw === "") return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseDecimal(raw: string): number {
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

function parseDump(sql: string): WorkOrderRow[] {
  const rows: WorkOrderRow[] = [];

  const valuesBlockMatch = sql.match(
    /INSERT INTO `work_orders`[^V]*VALUES\s*([\s\S]+?);\s*(?:--|$)/,
  );
  if (!valuesBlockMatch)
    throw new Error("Could not locate VALUES block in dump");

  const valuesBlock = valuesBlockMatch[1];

  const rowRegex = /\(([^()]*(?:'[^'\\]*(?:\\.[^'\\]*)*'[^()]*)*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(valuesBlock)) !== null) {
    const tokens = splitValuesRow(match[1]);
    if (tokens.length < 18) continue;

    rows.push({
      legacyId: parseInt(tokens[0], 10),
      userId: parseInt(tokens[1], 10),
      customerId: parseInt(tokens[2], 10),
      descPerform: parseSqlValue(tokens[3]) ?? "",
      paid: tokens[4].trim() === "1",
      runHours: parseInt(tokens[5], 10),
      laborHours: parseInt(tokens[6], 10),
      date: parseDate(parseSqlValue(tokens[7])),
      tech: parseSqlValue(tokens[8]) ?? "",
      descPerformed: parseSqlValue(tokens[9]) ?? "",
      totalParts: parseDecimal(tokens[10]),
      totalLabor: parseDecimal(tokens[11]),
      miscExp: parseDecimal(tokens[12]),
      subtotal: parseDecimal(tokens[13]),
      shipping: parseDecimal(tokens[14]),
      total: parseDecimal(tokens[15]),
      certify: tokens[16].trim() === "1",
      completed: tokens[17].trim() === "1",
    });
  }

  return rows;
}

// Build a legacyId -> ObjectId map for all customers
async function buildCustomerMap(): Promise<Map<number, string>> {
  const customers = await Customer.find({}, { legacyId: 1 }).lean();
  const map = new Map<number, string>();
  for (const c of customers) {
    if (c.legacyId != null) map.set(c.legacyId, (c._id as object).toString());
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
  const rows = parseDump(sql);
  console.log(`Parsed ${rows.length} work order rows.`);

  console.log("Building customer lookup map...");
  const customerMap = await buildCustomerMap();
  console.log(`Found ${customerMap.size} customers for linking.`);

  const docs = rows.map((row) => ({
    ...row,
    customerRef: customerMap.get(row.customerId)
      ? new (require("mongoose").Types.ObjectId)(
          customerMap.get(row.customerId),
        )
      : undefined,
  }));

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
