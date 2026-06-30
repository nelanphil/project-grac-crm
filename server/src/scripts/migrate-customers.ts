/**
 * Migrates customers from the MySQL SQL dump into MongoDB.
 * Run: npx tsx src/scripts/migrate-customers.ts
 *
 * Safe to re-run — checks for existing data and skips if already migrated.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import fs from "fs";
import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";

const DUMP_PATH = path.resolve(__dirname, "database_dump/customers.sql");

interface CustomerRow {
  legacyId: number;
  userId: number;
  first: string;
  last: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  atsSerial: string;
  serial: string;
  generatorModel: string;
  lastSvc: Date | null;
  exday: string;
  extime: string;
}

/**
 * Parses a single SQL string value token — handles NULL, quoted strings,
 * and escaped characters.
 */
function parseSqlValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.toUpperCase() === "NULL") return null;
  // Strip surrounding single quotes and unescape \' and \\
  return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

/**
 * Splits a VALUES row like (1, 1, 'Pat', 'Smith', ...) into an array of
 * raw token strings, respecting escaped quotes inside values.
 */
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

function parseDump(sql: string): CustomerRow[] {
  const rows: CustomerRow[] = [];

  // Match each (...) VALUES group — the dump is one big multi-row INSERT
  const valuesBlockMatch = sql.match(/INSERT INTO `customers`[^V]*VALUES\s*([\s\S]+?);[\s\n]*--/);
  if (!valuesBlockMatch) throw new Error("Could not locate VALUES block in dump");

  const valuesBlock = valuesBlockMatch[1];

  // Split on ),\n( boundaries to get individual row strings
  const rowRegex = /\(([^()]*(?:'[^'\\]*(?:\\.[^'\\]*)*'[^()]*)*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(valuesBlock)) !== null) {
    const tokens = splitValuesRow(match[1]);
    if (tokens.length < 16) continue;

    rows.push({
      legacyId: parseInt(tokens[0], 10),
      userId: parseInt(tokens[1], 10),
      first: parseSqlValue(tokens[2]) ?? "",
      last: parseSqlValue(tokens[3]) ?? "",
      address: parseSqlValue(tokens[4]) ?? "",
      city: parseSqlValue(tokens[5]) ?? "",
      state: parseSqlValue(tokens[6]) ?? "",
      zip: parseSqlValue(tokens[7]) ?? "",
      phone: parseSqlValue(tokens[8]) ?? "",
      email: parseSqlValue(tokens[9]) ?? "",
      atsSerial: parseSqlValue(tokens[10]) ?? "",
      serial: parseSqlValue(tokens[11]) ?? "",
      generatorModel: parseSqlValue(tokens[12]) ?? "",
      lastSvc: parseDate(parseSqlValue(tokens[13])),
      exday: parseSqlValue(tokens[14]) ?? "",
      extime: parseSqlValue(tokens[15]) ?? "",
    });
  }

  return rows;
}

const BATCH_SIZE = 500;

async function main() {
  await connectMongoDB();

  const existingCount = await Customer.countDocuments();
  if (existingCount > 0) {
    console.log(`Customers collection already has ${existingCount} documents. Skipping migration.`);
    console.log("To re-run, drop the customers collection first.");
    await disconnectMongoDB();
    return;
  }

  console.log(`Reading dump from ${DUMP_PATH}...`);
  const sql = fs.readFileSync(DUMP_PATH, "utf-8");

  console.log("Parsing SQL dump...");
  const rows = parseDump(sql);
  console.log(`Parsed ${rows.length} customer rows.`);

  console.log(`Inserting in batches of ${BATCH_SIZE}...`);
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Customer.insertMany(batch, { ordered: false });
    inserted += batch.length;
    process.stdout.write(`  ${inserted}/${rows.length}\r`);
  }

  console.log(`\nMigration complete — ${inserted} customers inserted into MongoDB.`);
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
