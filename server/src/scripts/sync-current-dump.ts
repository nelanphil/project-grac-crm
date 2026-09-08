/**
 * Incremental import of new customers and work orders from server/src/current/.
 *
 * Inserts only records that are not already in Mongo (by legacy id or identity).
 * Every newly inserted customer gets a primary contact from the SQL first/last/
 * phone/email fields.
 *
 * Run from server/:
 *   npx tsx src/scripts/sync-current-dump.ts --dry-run
 *   npx tsx src/scripts/sync-current-dump.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import fs from "fs";
import mongoose, { Types } from "mongoose";
import { connectMongoDB, disconnectMongoDB, getMongoStatus } from "../config/mongodb";
import { activeCustomerFilter, Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Equipment } from "../models/mongo/Equipment";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { mintCheckoutKey } from "../utils/checkoutKey";
import { ensureCustomerContactFromFlat } from "../utils/customerContacts";
import {
  customerHasSiteData,
  ensureCustomerSiteFromFlat,
  normalizeAddressKey,
  normalizePhoneDigits,
} from "../utils/customerSites";

const CUSTOMERS_DUMP = path.resolve(__dirname, "../current/customers.sql");
const WORK_ORDERS_DUMP = path.resolve(__dirname, "../current/work_orders.sql");
const DRY_RUN = process.argv.includes("--dry-run");

const notMergedFilter = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

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

type MappedCustomer = {
  _id: Types.ObjectId;
  legacyId: number;
  first: string;
  last: string;
  accountName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  phoneDigits: string;
  email: string;
  generatorModel: string;
  serial: string;
  exday: string;
  extime: string;
};

function log(msg: string): void {
  console.log(`[sync-current-dump] ${msg}`);
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

function parseValuesBlocks(sql: string, table: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(
    `INSERT INTO \`${table}\`[^V]*VALUES\\s*([\\s\\S]+?);\\s*(?=INSERT INTO|--|$)`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    blocks.push(match[1]);
  }
  if (blocks.length === 0) {
    throw new Error(`Could not locate VALUES block in ${table} dump`);
  }
  return blocks;
}

/** Extract top-level (...) value rows, ignoring parentheses inside quoted strings. */
function extractValueRows(valuesBlock: string): string[] {
  const rows: string[] = [];
  let i = 0;
  while (i < valuesBlock.length) {
    if (valuesBlock[i] !== "(") {
      i += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let j = i;
    while (j < valuesBlock.length) {
      const ch = valuesBlock[j];
      if (inString) {
        if (ch === "\\" && j + 1 < valuesBlock.length) {
          j += 2;
          continue;
        }
        if (ch === "'") inString = false;
        j += 1;
        continue;
      }
      if (ch === "'") {
        inString = true;
        j += 1;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          rows.push(valuesBlock.slice(i + 1, j));
          i = j + 1;
          break;
        }
      }
      j += 1;
    }
    if (j >= valuesBlock.length) break;
  }
  return rows;
}

function eachValuesRow(sql: string, table: string, fn: (tokens: string[]) => void): void {
  for (const block of parseValuesBlocks(sql, table)) {
    for (const inner of extractValueRows(block)) {
      fn(splitValuesRow(inner));
    }
  }
}

function parseCustomerDump(sql: string): CustomerRow[] {
  const rows: CustomerRow[] = [];
  eachValuesRow(sql, "customers", (tokens) => {
    if (tokens.length < 16) return;
    const legacyId = parseInt(tokens[0], 10);
    const userId = parseInt(tokens[1], 10);
    if (!Number.isFinite(legacyId) || !Number.isFinite(userId)) return;
    rows.push({
      legacyId,
      userId,
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
  });
  return rows;
}

function parseWorkOrderDump(sql: string): WorkOrderRow[] {
  const rows: WorkOrderRow[] = [];
  eachValuesRow(sql, "work_orders", (tokens) => {
    if (tokens.length < 18) return;
    const legacyId = parseInt(tokens[0], 10);
    const userId = parseInt(tokens[1], 10);
    const customerId = parseInt(tokens[2], 10);
    if (
      !Number.isFinite(legacyId) ||
      !Number.isFinite(userId) ||
      !Number.isFinite(customerId)
    ) {
      return;
    }
    rows.push({
      legacyId,
      userId,
      customerId,
      descPerform: parseSqlValue(tokens[3]) ?? "",
      paid: tokens[4].trim() === "1",
      runHours: parseInt(tokens[5], 10) || 0,
      laborHours: parseInt(tokens[6], 10) || 0,
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
  });
  return rows;
}

function sqlPhone(row: CustomerRow): string {
  return normalizePhoneDigits(row.phone);
}

function sqlEmail(row: CustomerRow): string {
  return row.email.trim().toLowerCase();
}

function sqlAddressKey(row: CustomerRow): string {
  return normalizeAddressKey(row.address, row.zip);
}

function hasSqlIdentity(row: CustomerRow): boolean {
  return sqlPhone(row).length >= 7 || Boolean(sqlEmail(row)) || Boolean(sqlAddressKey(row));
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(row: CustomerRow, existing: MappedCustomer): boolean {
  const sqlName = `${normalizeName(row.first)} ${normalizeName(row.last)}`.trim();
  if (!sqlName) return false;
  const existingName = `${normalizeName(existing.first)} ${normalizeName(existing.last)}`.trim();
  if (existingName && sqlName === existingName) return true;
  const account = normalizeName(existing.accountName);
  return Boolean(account) && sqlName === account;
}

function dateKey(d: Date | null | undefined): string {
  if (!d) return "";
  const parsed = d instanceof Date ? d : new Date(d);
  if (isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizeDesc(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function woFuzzyKey(
  customerLegacyId: number,
  date: Date | null | undefined,
  descPerform: string,
): string {
  return `${customerLegacyId}|${dateKey(date)}|${normalizeDesc(descPerform)}`;
}

function displayName(c: { first?: string; last?: string; accountName?: string }): string {
  const account = (c.accountName ?? "").trim();
  if (account) return account;
  return `${c.first ?? ""} ${c.last ?? ""}`.trim() || "(unnamed)";
}

type IdentityIndex = {
  byLegacyId: Map<number, MappedCustomer[]>;
  byPhone: Map<string, MappedCustomer>;
  byEmail: Map<string, MappedCustomer>;
  byAddress: Map<string, MappedCustomer>;
};

function indexCustomer(index: IdentityIndex, customer: MappedCustomer): void {
  if (customer.legacyId != null) {
    const list = index.byLegacyId.get(customer.legacyId) ?? [];
    list.push(customer);
    index.byLegacyId.set(customer.legacyId, list);
  }
}

function indexIdentity(
  index: IdentityIndex,
  customer: MappedCustomer,
  extras?: { phones?: string[]; emails?: string[]; addressKeys?: string[] },
): void {
  const phones = new Set<string>();
  const digits = customer.phoneDigits || normalizePhoneDigits(customer.phone);
  if (digits.length >= 7) phones.add(digits);
  for (const p of extras?.phones ?? []) {
    if (p.length >= 7) phones.add(p);
  }
  for (const p of phones) {
    if (!index.byPhone.has(p)) index.byPhone.set(p, customer);
  }

  const emails = new Set<string>();
  const email = (customer.email ?? "").trim().toLowerCase();
  if (email) emails.add(email);
  for (const e of extras?.emails ?? []) {
    if (e) emails.add(e);
  }
  for (const e of emails) {
    if (!index.byEmail.has(e)) index.byEmail.set(e, customer);
  }

  const keys = new Set<string>();
  const ownKey = normalizeAddressKey(customer.address, customer.zip);
  if (ownKey) keys.add(ownKey);
  for (const k of extras?.addressKeys ?? []) {
    if (k) keys.add(k);
  }
  for (const k of keys) {
    if (!index.byAddress.has(k)) index.byAddress.set(k, customer);
  }
}

function identitiesMatch(
  row: CustomerRow,
  existing: MappedCustomer,
  extras?: { phones?: string[]; emails?: string[]; addressKeys?: string[] },
): boolean {
  if (namesMatch(row, existing)) return true;
  if (!hasSqlIdentity(row)) return true;

  const phone = sqlPhone(row);
  if (phone.length >= 7) {
    const existingPhone = existing.phoneDigits || normalizePhoneDigits(existing.phone);
    if (existingPhone === phone) return true;
    if ((extras?.phones ?? []).includes(phone)) return true;
  }

  const email = sqlEmail(row);
  if (email) {
    if ((existing.email ?? "").trim().toLowerCase() === email) return true;
    if ((extras?.emails ?? []).includes(email)) return true;
  }

  const addr = sqlAddressKey(row);
  if (addr) {
    if (normalizeAddressKey(existing.address, existing.zip) === addr) return true;
    if ((extras?.addressKeys ?? []).includes(addr)) return true;
  }

  return false;
}

function findIdentityMatch(row: CustomerRow, index: IdentityIndex): MappedCustomer | null {
  const phone = sqlPhone(row);
  if (phone.length >= 7) {
    const match = index.byPhone.get(phone);
    if (match) return match;
  }
  const email = sqlEmail(row);
  if (email) {
    const match = index.byEmail.get(email);
    if (match) return match;
  }
  const addr = sqlAddressKey(row);
  if (addr) {
    const match = index.byAddress.get(addr);
    if (match) return match;
  }
  return null;
}

function toMapped(doc: {
  _id: Types.ObjectId;
  legacyId?: number | null;
  first?: string;
  last?: string;
  accountName?: string;
  address?: string;
  city?: string;
  zip?: string;
  phone?: string;
  phoneDigits?: string;
  email?: string;
  generatorModel?: string;
  serial?: string;
  exday?: string;
  extime?: string;
}): MappedCustomer {
  return {
    _id: doc._id,
    legacyId: doc.legacyId ?? 0,
    first: doc.first ?? "",
    last: doc.last ?? "",
    accountName: doc.accountName ?? "",
    address: doc.address ?? "",
    city: doc.city ?? "",
    zip: doc.zip ?? "",
    phone: doc.phone ?? "",
    phoneDigits: doc.phoneDigits ?? normalizePhoneDigits(doc.phone),
    email: doc.email ?? "",
    generatorModel: doc.generatorModel ?? "",
    serial: doc.serial ?? "",
    exday: doc.exday ?? "",
    extime: doc.extime ?? "",
  };
}

async function createCustomerFromRow(
  row: CustomerRow,
  legacyId: number,
): Promise<MappedCustomer> {
  const accountName = `${row.first} ${row.last}`.trim();
  const customer = await Customer.create({
    legacyId,
    userId: row.userId,
    accountName,
    first: row.first,
    last: row.last,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county: "",
    ownerUserRef: null,
    phone: row.phone,
    phoneDigits: normalizePhoneDigits(row.phone),
    email: row.email,
    atsSerial: row.atsSerial,
    serial: row.serial,
    generatorModel: row.generatorModel,
    lastSvc: row.lastSvc,
    exday: row.exday,
    extime: row.extime,
    isTemporary: false,
    deletedAt: null,
    checkoutKey: mintCheckoutKey(),
  });

  const contact = await ensureCustomerContactFromFlat(customer);
  const site = customerHasSiteData(row)
    ? await ensureCustomerSiteFromFlat(customer)
    : null;

  log(
    `  created customer ${legacyId} "${accountName || "(unnamed)"}" contact=${contact.created ? "new" : "existing"} site=${site?.created ? "new" : site ? "existing" : "skipped"}`,
  );

  return toMapped(customer);
}

type SiteRefs = {
  addressRef?: Types.ObjectId;
  equipmentRef?: Types.ObjectId;
};

async function loadSiteRefs(
  customerId: Types.ObjectId,
  cache: Map<string, SiteRefs>,
): Promise<SiteRefs> {
  const key = customerId.toString();
  const cached = cache.get(key);
  if (cached) return cached;

  const addresses = await CustomerAddress.find({ customerRef: customerId })
    .select("_id")
    .lean();
  const refs: SiteRefs = {};
  if (addresses.length === 1) {
    refs.addressRef = addresses[0]._id as Types.ObjectId;
    const equipment = await Equipment.find({ addressRef: refs.addressRef })
      .select("_id")
      .lean();
    if (equipment.length === 1) {
      refs.equipmentRef = equipment[0]._id as Types.ObjectId;
    }
  }
  cache.set(key, refs);
  return refs;
}

async function main(): Promise<void> {
  const started = Date.now();
  log(DRY_RUN ? "DRY RUN — no writes" : "Live import");

  log("Connecting to MongoDB…");
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error("[sync-current-dump] MongoDB is not connected.");
    process.exit(1);
  }

  log(`Reading ${CUSTOMERS_DUMP}`);
  const customerRows = parseCustomerDump(fs.readFileSync(CUSTOMERS_DUMP, "utf-8"));
  log(`Parsed ${customerRows.length} customer rows.`);

  log(`Reading ${WORK_ORDERS_DUMP}`);
  const workOrderRows = parseWorkOrderDump(fs.readFileSync(WORK_ORDERS_DUMP, "utf-8"));
  log(`Parsed ${workOrderRows.length} work order rows.`);

  const existingCustomers = await Customer.find({
    ...activeCustomerFilter,
    ...notMergedFilter,
  })
    .select(
      "_id legacyId first last accountName address city zip phone phoneDigits email generatorModel serial exday extime",
    )
    .lean();
  log(`Loaded ${existingCustomers.length} active customers.`);

  const existingIds = existingCustomers.map((c) => c._id);
  const contacts = await CustomerContact.find({
    customerRef: { $in: existingIds },
  })
    .select("customerRef phone email")
    .lean();
  const addresses = await CustomerAddress.find({
    customerRef: { $in: existingIds },
  })
    .select("customerRef address zip")
    .lean();

  const extrasByCustomer = new Map<
    string,
    { phones: string[]; emails: string[]; addressKeys: string[] }
  >();
  function extrasFor(id: Types.ObjectId) {
    const key = id.toString();
    let extras = extrasByCustomer.get(key);
    if (!extras) {
      extras = { phones: [], emails: [], addressKeys: [] };
      extrasByCustomer.set(key, extras);
    }
    return extras;
  }
  for (const contact of contacts) {
    const extras = extrasFor(contact.customerRef);
    const phone = normalizePhoneDigits(contact.phone);
    if (phone.length >= 7) extras.phones.push(phone);
    const email = (contact.email ?? "").trim().toLowerCase();
    if (email) extras.emails.push(email);
  }
  for (const address of addresses) {
    const extras = extrasFor(address.customerRef);
    const key = normalizeAddressKey(address.address, address.zip);
    if (key) extras.addressKeys.push(key);
  }

  const index: IdentityIndex = {
    byLegacyId: new Map(),
    byPhone: new Map(),
    byEmail: new Map(),
    byAddress: new Map(),
  };
  const mappedByMongoId = new Map<string, MappedCustomer>();
  for (const doc of existingCustomers) {
    const mapped = toMapped(doc);
    mappedByMongoId.set(mapped._id.toString(), mapped);
    indexCustomer(index, mapped);
    indexIdentity(index, mapped, extrasByCustomer.get(mapped._id.toString()));
  }

  let nextLegacyId =
    existingCustomers.reduce((max, c) => Math.max(max, c.legacyId ?? 0), 0) + 1;

  const mysqlToCustomer = new Map<number, MappedCustomer>();

  let skippedLegacy = 0;
  let skippedIdentity = 0;
  let collisions = 0;
  let insertedCustomers = 0;
  let contactsCreated = 0;

  log("Syncing customers…");
  for (const row of customerRows) {
    const existingSameId = index.byLegacyId.get(row.legacyId) ?? [];
    const sameIdMatch = existingSameId.find((c) =>
      identitiesMatch(row, c, extrasByCustomer.get(c._id.toString())),
    );
    if (sameIdMatch) {
      mysqlToCustomer.set(row.legacyId, sameIdMatch);
      skippedLegacy += 1;
      continue;
    }

    const identityMatch = findIdentityMatch(row, index);
    if (identityMatch) {
      mysqlToCustomer.set(row.legacyId, identityMatch);
      skippedIdentity += 1;
      continue;
    }

    if (existingSameId.length > 0) {
      collisions += 1;
      const assignedId = nextLegacyId;
      nextLegacyId += 1;
      log(
        `  COLLISION mysql=${row.legacyId} "${`${row.first} ${row.last}`.trim()}" occupied by "${displayName(existingSameId[0])}" (legacyId=${existingSameId[0].legacyId}). Assigning ${assignedId}.`,
      );

      if (DRY_RUN) {
        const fake = toMapped({
          _id: new Types.ObjectId(),
          legacyId: assignedId,
          first: row.first,
          last: row.last,
          accountName: `${row.first} ${row.last}`.trim(),
          address: row.address,
          zip: row.zip,
          phone: row.phone,
          phoneDigits: normalizePhoneDigits(row.phone),
          email: row.email,
        });
        mysqlToCustomer.set(row.legacyId, fake);
        indexCustomer(index, fake);
        indexIdentity(index, fake);
        insertedCustomers += 1;
        contactsCreated += 1;
        continue;
      }

      const created = await createCustomerFromRow(row, assignedId);
      mysqlToCustomer.set(row.legacyId, created);
      indexCustomer(index, created);
      indexIdentity(index, created, {
        phones: [normalizePhoneDigits(row.phone)].filter((p) => p.length >= 7),
        emails: [sqlEmail(row)].filter(Boolean),
        addressKeys: [sqlAddressKey(row)].filter(Boolean),
      });
      insertedCustomers += 1;
      contactsCreated += 1;
      continue;
    }

    if (row.legacyId >= nextLegacyId) nextLegacyId = row.legacyId + 1;

    if (DRY_RUN) {
      const fake = toMapped({
        _id: new Types.ObjectId(),
        legacyId: row.legacyId,
        first: row.first,
        last: row.last,
        accountName: `${row.first} ${row.last}`.trim(),
        address: row.address,
        zip: row.zip,
        phone: row.phone,
        phoneDigits: normalizePhoneDigits(row.phone),
        email: row.email,
      });
      mysqlToCustomer.set(row.legacyId, fake);
      indexCustomer(index, fake);
      indexIdentity(index, fake);
      insertedCustomers += 1;
      contactsCreated += 1;
      continue;
    }

    const created = await createCustomerFromRow(row, row.legacyId);
    mysqlToCustomer.set(row.legacyId, created);
    indexCustomer(index, created);
    indexIdentity(index, created, {
      phones: [normalizePhoneDigits(row.phone)].filter((p) => p.length >= 7),
      emails: [sqlEmail(row)].filter(Boolean),
      addressKeys: [sqlAddressKey(row)].filter(Boolean),
    });
    insertedCustomers += 1;
    contactsCreated += 1;
  }

  const existingWos = await WorkOrder.find()
    .select("legacyId customerId date descPerform")
    .lean();
  const existingWoLegacyIds = new Set<number>();
  const fuzzyWoKeys = new Set<string>();
  for (const wo of existingWos) {
    if (wo.legacyId != null) existingWoLegacyIds.add(wo.legacyId);
    fuzzyWoKeys.add(woFuzzyKey(wo.customerId, wo.date, wo.descPerform ?? ""));
  }
  log(`Loaded ${existingWos.length} existing work orders.`);

  const siteCache = new Map<string, SiteRefs>();
  let skippedWoLegacy = 0;
  let skippedWoFuzzy = 0;
  let orphanWos = 0;
  let insertedWos = 0;

  log("Syncing work orders…");
  for (const row of workOrderRows) {
    if (existingWoLegacyIds.has(row.legacyId)) {
      skippedWoLegacy += 1;
      continue;
    }

    const customer =
      mysqlToCustomer.get(row.customerId) ??
      index.byLegacyId.get(row.customerId)?.[0];
    if (!customer) {
      orphanWos += 1;
      log(`  ORPHAN WO ${row.legacyId} customer_id=${row.customerId} (no customer)`);
      continue;
    }

    const fuzzy = woFuzzyKey(customer.legacyId, row.date, row.descPerform);
    if (fuzzyWoKeys.has(fuzzy)) {
      skippedWoFuzzy += 1;
      continue;
    }

    if (DRY_RUN) {
      existingWoLegacyIds.add(row.legacyId);
      fuzzyWoKeys.add(fuzzy);
      insertedWos += 1;
      continue;
    }

    const site = await loadSiteRefs(customer._id, siteCache);
    await WorkOrder.create({
      legacyId: row.legacyId,
      userId: row.userId,
      customerId: customer.legacyId,
      customerRef: customer._id,
      addressRef: site.addressRef ?? null,
      equipmentRef: site.equipmentRef ?? null,
      descPerform: row.descPerform,
      paid: row.paid,
      runHours: row.runHours,
      laborHours: row.laborHours,
      date: row.date,
      tech: row.tech,
      descPerformed: row.descPerformed,
      totalParts: row.totalParts,
      totalLabor: row.totalLabor,
      miscExp: row.miscExp,
      subtotal: row.subtotal,
      shipping: row.shipping,
      total: row.total,
      certify: row.certify,
      completed: row.completed,
      customerName: displayName(customer),
      customerAddress: customer.address,
      customerCity: customer.city,
      customerZip: customer.zip,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      serialNumber: customer.serial,
      generatorModel: customer.generatorModel,
      exerciseDay: customer.exday,
      exerciseTime: customer.extime,
    });

    existingWoLegacyIds.add(row.legacyId);
    fuzzyWoKeys.add(fuzzy);
    insertedWos += 1;
    if (insertedWos % 100 === 0) {
      log(`  inserted ${insertedWos} work orders…`);
    }
  }

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  log("");
  log(DRY_RUN ? "Dry-run summary" : "Import summary");
  log(`  Customers parsed:              ${customerRows.length}`);
  log(`  Customers inserted:            ${insertedCustomers}`);
  log(`  Primary contacts created:      ${contactsCreated}`);
  log(`  Customers skipped (legacy id): ${skippedLegacy}`);
  log(`  Customers skipped (identity):  ${skippedIdentity}`);
  log(`  Customer legacyId collisions:  ${collisions}`);
  log(`  Work orders parsed:            ${workOrderRows.length}`);
  log(`  Work orders inserted:          ${insertedWos}`);
  log(`  Work orders skipped (legacy):  ${skippedWoLegacy}`);
  log(`  Work orders skipped (same job):${skippedWoFuzzy}`);
  log(`  Work order orphans:            ${orphanWos}`);
  log(`  Finished in ${elapsedSec}s`);

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("[sync-current-dump] Fatal:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
