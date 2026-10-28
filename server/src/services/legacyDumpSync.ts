/**
 * Incremental import of phpMyAdmin customers / work_orders dumps.
 * Uses a dedicated mongoose connection so the API's default connection is never retargeted.
 */
import { randomInt } from "crypto";
import mongoose, { Connection, Model, Types } from "mongoose";
import {
  activeCustomerFilter,
  Customer,
  ensureCustomerOptionalUniqueIndexes,
  ICustomer,
} from "../models/mongo/Customer";
import { CustomerAddress, ICustomerAddress } from "../models/mongo/CustomerAddress";
import { activeContactFilter, CustomerContact, ICustomerContact } from "../models/mongo/CustomerContact";
import { Equipment, IEquipment } from "../models/mongo/Equipment";
import { IContract, Contract } from "../models/mongo/Contract";
import { IContractTemplate, ContractTemplate } from "../models/mongo/ContractTemplate";
import { IInvoice, Invoice } from "../models/mongo/Invoice";
import { TAX_SETTINGS_SLUG, TaxSettings } from "../models/mongo/TaxSettings";
import { IProduct, Product } from "../models/mongo/Product";
import { IWorkOrder, WorkOrder } from "../models/mongo/WorkOrder";
import {
  syncAscContractsFromRecords,
  type AscContractSyncSummary,
} from "./ascContractSync";
import {
  ALLOWED_LEGACY_OWNER_USER_IDS,
  isAllowedLegacyOwner,
  LEGACY_LOGIN_OWNERS,
} from "./legacyLoginOwners";
import { pendingPaymentWorkOrderFilter } from "./completedPaidReport";
import {
  legacyWorkOrderHasBillableMoney,
  ensureLegacyCatalogProducts,
  linkCatalogProductRefs,
  mongooseLegacyProductWriter,
  partsForMongo,
  resolveLegacyWorkOrderMoney,
  workOrderLinesNeedProductLink,
  workOrderLinesNeedRebuild,
  workOrderMoneyFieldsFromMapped,
  type LegacyCatalogProduct,
  type LegacyMappedWorkOrderMoney,
} from "./legacyWorkOrderItems";
import {
  dollarsToCents,
  invoiceNumberPrefixFromDate,
  workOrderInvoiceLineItems,
} from "./invoice.service";
import {
  companyTaxForUnpaidWorkOrder,
  DEFAULT_TAX_RATE_PERCENT,
  normalizeTaxRatePercent,
  taxCentsFromDollars,
} from "./taxSettings";
import { mintCheckoutKey } from "../utils/checkoutKey";
import {
  customerHasEquipmentData,
  customerHasSiteData,
  defaultAddressLabel,
  normalizeAddressKey,
  normalizePhoneDigits,
} from "../utils/customerSites";

const DEFAULT_DB = "grac-crm";

export type LegacyDumpTarget = "production" | "development";
export type IdentityReason = "phone" | "email" | "address";
export type DumpKind = "customers" | "work_orders";

export type CustomerAuditRow = {
  sqlId: number;
  sqlName: string;
  phone: string;
  email: string;
};

export type IdentityLinkedRow = CustomerAuditRow & {
  reason: IdentityReason;
  mongoLegacyId: number;
  mongoName: string;
};

export type CollisionAuditRow = CustomerAuditRow & {
  occupiedBy: string;
  occupiedLegacyId: number;
  assignedId: number;
};

export type MissingWoRow = {
  woId: number;
  customerId: number;
  customerName: string;
  date: string;
};

export type OrphanWoRow = {
  woId: number;
  customerId: number;
};

export type AuditReport = {
  customersPresent: number;
  customersIdentityLinked: IdentityLinkedRow[];
  customersMissing: CustomerAuditRow[];
  customersCollisions: CollisionAuditRow[];
  wosPresent: number;
  wosFuzzy: number;
  wosMissing: MissingWoRow[];
  wosOrphan: OrphanWoRow[];
};

export type ImportSummary = {
  customersParsed: number;
  customersInserted: number;
  contactsCreated: number;
  customersSkippedLegacy: number;
  customersSkippedIdentity: number;
  customersSkippedNonOwner: number;
  customerCollisions: number;
  workOrdersParsed: number;
  workOrdersInserted: number;
  workOrdersSkippedLegacy: number;
  workOrdersSkippedFuzzy: number;
  workOrderOrphans: number;
  workOrdersLineItemsBackfilled: number;
  workOrdersStatusUpdated: number;
  workOrdersSkippedDuplicateLegacy: number;
  workOrdersSkippedUserMismatch: number;
  workOrdersSkippedNonOwner: number;
  ascCustomers: number;
  contractsCreated: number;
  contractsUpdated: number;
};

export type LegacyDumpSyncResult = {
  target: LegacyDumpTarget | "custom";
  targetLabel: string;
  mode: "audit" | "import";
  customersParsed: number;
  workOrdersParsed: number;
  audit: AuditReport;
  summary: ImportSummary;
};

export type LegacyDumpTargetInfo = {
  available: boolean;
  label: string | null;
  reason?: string;
};

type CustomerRow = {
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
};

type WorkOrderRow = {
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
};

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

type IdentityIndex = {
  byLegacyId: Map<number, MappedCustomer[]>;
  byPhone: Map<string, MappedCustomer>;
  byEmail: Map<string, MappedCustomer>;
  byAddress: Map<string, MappedCustomer>;
};

type BoundModels = {
  Customer: Model<ICustomer>;
  CustomerContact: Model<ICustomerContact>;
  CustomerAddress: Model<ICustomerAddress>;
  Equipment: Model<IEquipment>;
  WorkOrder: Model<IWorkOrder>;
  Invoice: Model<IInvoice>;
  Product: Model<IProduct>;
  Contract: Model<IContract>;
  ContractTemplate: Model<IContractTemplate>;
};

const notMergedFilter = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

export function withDbName(raw: string): string {
  if (raw.includes(`/${DEFAULT_DB}`)) return raw;

  const [base, query] = raw.split("?");
  const afterHost = base.replace(/^mongodb(\+srv)?:\/\/[^/]+/, "");
  const needsDb = afterHost === "" || afterHost === "/";
  if (!needsDb) return raw;

  const baseTrimmed = base.replace(/\/$/, "");
  return query ? `${baseTrimmed}/${DEFAULT_DB}?${query}` : `${baseTrimmed}/${DEFAULT_DB}`;
}

export function describeMongoTarget(uri: string): string {
  const normalized = uri
    .replace(/^mongodb\+srv:\/\//i, "https://")
    .replace(/^mongodb:\/\//i, "https://");
  const parsed = new URL(normalized);
  const db =
    decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] || "") ||
    DEFAULT_DB;
  return `${parsed.host}/${db}`;
}

export function resolveLegacyDumpUri(target: LegacyDumpTarget): string | null {
  const raw =
    target === "production"
      ? process.env.MONGODB_URI_PRODUCTION
      : process.env.MONGODB_URI_DEVELOPMENT ?? process.env.MONGODB_URI;
  if (!raw) return null;
  return withDbName(raw);
}

export function describeLegacyDumpTargets(): Record<
  LegacyDumpTarget,
  LegacyDumpTargetInfo
> {
  const productionUri = resolveLegacyDumpUri("production");
  const developmentUri = resolveLegacyDumpUri("development");
  return {
    production: productionUri
      ? { available: true, label: describeMongoTarget(productionUri) }
      : {
          available: false,
          label: null,
          reason: "MONGODB_URI_PRODUCTION is not set",
        },
    development: developmentUri
      ? { available: true, label: describeMongoTarget(developmentUri) }
      : {
          available: false,
          label: null,
          reason: "MONGODB_URI_DEVELOPMENT is not set",
        },
  };
}

const PROGRESS_EVERY = 500;

export async function countLegacyDumpCollections(
  target: LegacyDumpTarget,
  onLog?: (message: string) => void,
): Promise<{
  target: LegacyDumpTarget;
  label: string;
  customers: number;
  workOrders: number;
}> {
  const uri = resolveLegacyDumpUri(target);
  if (!uri) {
    throw new Error(
      target === "production"
        ? "MONGODB_URI_PRODUCTION is not set"
        : "MONGODB_URI_DEVELOPMENT is not set",
    );
  }
  const label = describeMongoTarget(uri);
  onLog?.(`[${target}] Counting documents on ${label}…`);
  const conn = mongoose.createConnection(uri);
  try {
    await conn.asPromise();
    const models = bindModels(conn);
    const [customers, workOrders] = await Promise.all([
      models.Customer.estimatedDocumentCount(),
      models.WorkOrder.estimatedDocumentCount(),
    ]);
    onLog?.(
      `[${target}] customers=${customers.toLocaleString()} work_orders=${workOrders.toLocaleString()}`,
    );
    return { target, label, customers, workOrders };
  } finally {
    await conn.close();
  }
}

export function detectDumpKind(sql: string, filename = ""): DumpKind | null {
  const lower = filename.toLowerCase();
  if (/INSERT INTO\s+`customers`/i.test(sql)) return "customers";
  if (/INSERT INTO\s+`work_orders`/i.test(sql)) return "work_orders";
  if (lower.includes("customer")) return "customers";
  if (lower.includes("work_order") || lower.includes("work-order")) {
    return "work_orders";
  }
  return null;
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
    } else if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === ",") {
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
    i += 1;
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

export function parseCustomerDump(sql: string): CustomerRow[] {
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

export function parseWorkOrderDump(sql: string): WorkOrderRow[] {
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

export type LegacyWoMatchCandidate = {
  userId?: number | null;
};

export type LegacyWoMatch =
  | { action: "update" }
  | { action: "skip"; reason: "none" | "duplicate" | "user_mismatch" };

/** One stored ticket with this legacy id and the same login may be updated. */
export function matchLegacyWorkOrder(
  row: { userId: number },
  candidates: LegacyWoMatchCandidate[],
): LegacyWoMatch {
  if (candidates.length === 0) return { action: "skip", reason: "none" };
  if (candidates.length !== 1) return { action: "skip", reason: "duplicate" };
  if (candidates[0]?.userId !== row.userId) {
    return { action: "skip", reason: "user_mismatch" };
  }
  return { action: "update" };
}

export type LegacyStatusSnapshot = {
  paid?: boolean;
  completed?: boolean;
  date?: Date | string | null;
  total?: number;
};

export type LegacyStatusDump = {
  paid: boolean;
  completed: boolean;
  date: Date | null;
  totalParts: number;
  totalLabor: number;
  miscExp: number;
  subtotal: number;
  shipping: number;
  total: number;
};

function sameDumpTotal(existing: number | undefined, dump: number): boolean {
  return Math.abs((existing ?? 0) - dump) < 0.001;
}

/**
 * Fields to write when a uniquely matched legacy ticket differs from the dump.
 * Returns null when paid, completed, date, and total already match.
 */
export function legacyWorkOrderStatusPatch(
  existing: LegacyStatusSnapshot,
  row: LegacyStatusDump,
): Record<string, unknown> | null {
  const paidChanged = Boolean(existing.paid) !== row.paid;
  const completedChanged = Boolean(existing.completed) !== row.completed;
  const existingDate =
    existing.date instanceof Date
      ? existing.date
      : existing.date
        ? new Date(existing.date)
        : null;
  const dateChanged = dateKey(existingDate) !== dateKey(row.date);
  const totalChanged = !sameDumpTotal(existing.total, row.total);
  if (!paidChanged && !completedChanged && !dateChanged && !totalChanged) {
    return null;
  }

  const $set: Record<string, unknown> = {};
  if (paidChanged || completedChanged || dateChanged) {
    $set.paid = row.paid;
    $set.completed = row.completed;
    $set.date = row.date;
  }
  if (paidChanged || totalChanged) {
    $set.totalParts = row.totalParts;
    $set.totalLabor = row.totalLabor;
    $set.miscExp = row.miscExp;
    $set.subtotal = row.subtotal;
    $set.shipping = row.shipping;
    $set.total = row.total;
    $set.taxRate = 0;
    $set.tax = 0;
    $set.taxOverridden = false;
  }
  return $set;
}

function displayName(c: { first?: string; last?: string; accountName?: string }): string {
  const account = (c.accountName ?? "").trim();
  if (account) return account;
  return `${c.first ?? ""} ${c.last ?? ""}`.trim() || "(unnamed)";
}

function sqlCustomerName(row: CustomerRow): string {
  return `${row.first} ${row.last}`.trim() || "(unnamed)";
}

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

function findIdentityMatch(
  row: CustomerRow,
  index: IdentityIndex,
): { customer: MappedCustomer; reason: IdentityReason } | null {
  const phone = sqlPhone(row);
  if (phone.length >= 7) {
    const match = index.byPhone.get(phone);
    if (match) return { customer: match, reason: "phone" };
  }
  const email = sqlEmail(row);
  if (email) {
    const match = index.byEmail.get(email);
    if (match) return { customer: match, reason: "email" };
  }
  const addr = sqlAddressKey(row);
  if (addr) {
    const match = index.byAddress.get(addr);
    if (match) return { customer: match, reason: "address" };
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

function bindModels(conn: Connection): BoundModels {
  return {
    Customer: conn.model<ICustomer>("Customer", Customer.schema),
    CustomerContact: conn.model<ICustomerContact>(
      "CustomerContact",
      CustomerContact.schema,
    ),
    CustomerAddress: conn.model<ICustomerAddress>(
      "CustomerAddress",
      CustomerAddress.schema,
    ),
    Equipment: conn.model<IEquipment>("Equipment", Equipment.schema),
    WorkOrder: conn.model<IWorkOrder>("WorkOrder", WorkOrder.schema),
    Invoice: conn.model<IInvoice>("Invoice", Invoice.schema),
    Product: conn.model<IProduct>("Product", Product.schema),
    Contract: conn.model<IContract>("Contract", Contract.schema),
    ContractTemplate: conn.model<IContractTemplate>(
      "ContractTemplate",
      ContractTemplate.schema,
    ),
  };
}

async function loadProductCatalog(
  models: BoundModels,
): Promise<LegacyCatalogProduct[]> {
  const products = await models.Product.find({ active: { $ne: false } })
    .select("_id productCode partNumber name kind listPrice unitPrice")
    .lean();
  return products.map((product) => ({
    _id: String(product._id),
    productCode: product.productCode,
    partNumber: product.partNumber,
    name: product.name,
    kind: product.kind,
    listPrice: product.listPrice,
    unitPrice: product.unitPrice,
  }));
}

async function createCustomerFromRow(
  models: BoundModels,
  row: CustomerRow,
  legacyId: number,
): Promise<MappedCustomer> {
  const accountName = `${row.first} ${row.last}`.trim();
  const customer = await models.Customer.create({
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

  const existingContact = await models.CustomerContact.findOne({
    customerRef: customer._id,
    ...activeContactFilter,
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();
  if (!existingContact) {
    await models.CustomerContact.create({
      customerRef: customer._id,
      first: row.first,
      last: row.last,
      phone: row.phone,
      email: row.email,
      label: "",
      isPrimary: true,
      legacyCustomerId: legacyId,
      deletedAt: null,
    });
  }

  if (customerHasSiteData(row)) {
    const existingAddress = await models.CustomerAddress.findOne({
      customerRef: customer._id,
    })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean();
    if (!existingAddress) {
      const addressDoc = await models.CustomerAddress.create({
        customerRef: customer._id,
        label: defaultAddressLabel(row.city, row.address),
        address: row.address,
        city: row.city,
        state: row.state,
        zip: row.zip,
        isPrimary: true,
        propertyType: "residential",
        legacyCustomerId: legacyId,
      });
      if (customerHasEquipmentData(row)) {
        await models.Equipment.create({
          customerRef: customer._id,
          addressRef: addressDoc._id,
          generatorModel: row.generatorModel,
          serial: row.serial,
          atsSerial: row.atsSerial,
          lastSvc: row.lastSvc,
          exday: row.exday,
          extime: row.extime,
        });
      }
    }
  }

  return toMapped(customer);
}

async function loadSiteRefs(
  models: BoundModels,
  customerId: Types.ObjectId,
  cache: Map<string, { addressRef?: Types.ObjectId; equipmentRef?: Types.ObjectId }>,
): Promise<{ addressRef?: Types.ObjectId; equipmentRef?: Types.ObjectId }> {
  const key = customerId.toString();
  const cached = cache.get(key);
  if (cached) return cached;

  const addresses = await models.CustomerAddress.find({ customerRef: customerId })
    .select("_id")
    .lean();
  const refs: { addressRef?: Types.ObjectId; equipmentRef?: Types.ObjectId } = {};
  if (addresses.length === 1) {
    refs.addressRef = addresses[0]._id as Types.ObjectId;
    const equipment = await models.Equipment.find({ addressRef: refs.addressRef })
      .select("_id")
      .lean();
    if (equipment.length === 1) {
      refs.equipmentRef = equipment[0]._id as Types.ObjectId;
    }
  }
  cache.set(key, refs);
  return refs;
}

type ExistingWorkOrder = {
  _id: Types.ObjectId;
  legacyId?: number;
  customerId: number;
  customerRef?: Types.ObjectId | null;
  customerName?: string;
  customerAddress?: string;
  customerCity?: string;
  customerZip?: string;
  customerPhone?: string;
  customerEmail?: string;
  number?: string;
  userId?: number | null;
  date?: Date | null;
  descPerform?: string;
  paid?: boolean;
  completed?: boolean;
  parts?: Array<{
    lineType?: string;
    partNumber?: string;
    productRef?: Types.ObjectId | string | null;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    amount?: number;
    kind?: string;
  }>;
  subtotal?: number;
  shipping?: number;
  total?: number;
};

function emptySnapshot(value: string | undefined): boolean {
  return !value || !value.trim();
}

async function backfillExistingWorkOrderCustomer(
  models: BoundModels,
  existing: ExistingWorkOrder,
  row: WorkOrderRow,
  mysqlToCustomer: Map<number, MappedCustomer>,
  index: IdentityIndex,
  dryRun: boolean,
  log: (msg: string) => void,
): Promise<boolean> {
  if (existing.customerRef) return false;
  const customer =
    mysqlToCustomer.get(row.customerId) ??
    index.byLegacyId.get(row.customerId)?.[0];
  if (!customer) return false;

  const $set: Record<string, unknown> = {
    customerRef: customer._id,
    customerId: customer.legacyId,
  };
  if (emptySnapshot(existing.customerName)) $set.customerName = displayName(customer);
  if (emptySnapshot(existing.customerAddress)) $set.customerAddress = customer.address;
  if (emptySnapshot(existing.customerCity)) $set.customerCity = customer.city;
  if (emptySnapshot(existing.customerZip)) $set.customerZip = customer.zip;
  if (emptySnapshot(existing.customerPhone)) $set.customerPhone = customer.phone;
  if (emptySnapshot(existing.customerEmail)) $set.customerEmail = customer.email;

  log(
    `${dryRun ? "Would backfill" : "Backfilling"} customerRef on existing WO ${row.legacyId} → ${displayName(customer)} (${customer.legacyId}).`,
  );
  if (dryRun) return true;

  await models.WorkOrder.updateOne({ _id: existing._id }, { $set });
  await models.Invoice.updateMany(
    {
      workOrderRef: existing._id,
      $or: [{ customerRef: { $exists: false } }, { customerRef: null }],
    },
    { $set: { customerRef: customer._id, customerId: customer.legacyId } },
  );
  existing.customerRef = customer._id;
  return true;
}

async function boundTaxRate(models: BoundModels): Promise<number> {
  const conn = models.Product.db;
  const TaxModel =
    conn.models.TaxSettings ?? conn.model("TaxSettings", TaxSettings.schema);
  const doc = await TaxModel.findOne({ slug: TAX_SETTINGS_SLUG })
    .select("ratePercent")
    .lean();
  return normalizeTaxRatePercent(
    (doc as { ratePercent?: number } | null)?.ratePercent ?? DEFAULT_TAX_RATE_PERCENT,
  );
}

function unpaidTaxFields(
  mapped: LegacyMappedWorkOrderMoney,
  paid: boolean,
  rate: number,
): { taxRate: number; tax: number; total: number; taxOverridden: boolean } {
  if (paid) {
    return { taxRate: 0, tax: 0, total: mapped.total, taxOverridden: false };
  }
  const next = companyTaxForUnpaidWorkOrder(
    {
      paid: false,
      taxOverridden: false,
      subtotal: mapped.subtotal,
      shipping: mapped.shipping,
      taxRate: 0,
      tax: 0,
      total: mapped.total,
    },
    rate,
  );
  if (!next) {
    return { taxRate: rate, tax: 0, total: mapped.total, taxOverridden: false };
  }
  return { ...next, taxOverridden: false };
}

async function nextBoundInvoiceNumber(
  models: BoundModels,
  issuedAt: Date,
): Promise<string> {
  const prefix = invoiceNumberPrefixFromDate(issuedAt);
  for (let i = 0; i < 20; i += 1) {
    const number = `${prefix}${String(randomInt(0, 100_000)).padStart(5, "0")}`;
    const exists = await models.Invoice.exists({ number });
    if (!exists) return number;
  }
  throw new Error("Unable to allocate a unique invoice number");
}

async function upsertBoundWorkOrderInvoice(
  models: BoundModels,
  wo: {
    _id: Types.ObjectId;
    customerId: number;
    customerRef?: Types.ObjectId | null;
    number?: string;
    date?: Date | null;
    descPerform?: string;
    paid?: boolean;
    parts?: LegacyMappedWorkOrderMoney["parts"];
    totalLabor?: number;
    miscExp?: number;
    shipping?: number;
    total: number;
    taxRate: number;
    tax: number;
  },
): Promise<void> {
  if (wo.total <= 0 || !wo.customerRef) return;
  const amountCents = dollarsToCents(wo.total);
  if (amountCents <= 0) return;
  const existing = await models.Invoice.findOne({
    workOrderRef: wo._id,
    status: { $ne: "void" },
  });
  const lineItems = workOrderInvoiceLineItems(wo);
  const taxCents = wo.paid ? 0 : taxCentsFromDollars(wo.tax);
  const taxRatePercent = wo.paid ? 0 : wo.taxRate;
  if (existing) {
    if (wo.paid || existing.status === "paid") return;
    if (!["open", "draft", "failed"].includes(existing.status)) return;
    existing.amountCents = amountCents;
    existing.lineItems = lineItems;
    existing.taxRatePercent = taxRatePercent;
    existing.taxCents = taxCents;
    existing.taxOverridden = false;
    if (!existing.customerRef) existing.customerRef = wo.customerRef;
    await existing.save();
    return;
  }

  const issuedAt = wo.date instanceof Date ? wo.date : new Date();
  const payload = {
    customerId: wo.customerId,
    customerRef: wo.customerRef,
    sourceType: "work_order" as const,
    workOrderRef: wo._id,
    lineItems,
    amountCents,
    currency: "USD",
    status: wo.paid ? ("paid" as const) : ("open" as const),
    dueDate: null,
    issuedAt,
    paidAt: wo.paid ? issuedAt : null,
    metadata: { backfilled: true },
    taxRatePercent,
    taxCents,
    taxOverridden: false,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await models.Invoice.create({
        ...payload,
        number: await nextBoundInvoiceNumber(models, issuedAt),
      });
      return;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 11000 || attempt === 2) throw err;
    }
  }
}

async function backfillExistingWorkOrderLineItems(
  models: BoundModels,
  existing: ExistingWorkOrder,
  row: WorkOrderRow,
  catalog: LegacyCatalogProduct[],
  dryRun: boolean,
  taxRate: number,
): Promise<boolean> {
  const needsRebuild = workOrderLinesNeedRebuild(existing.parts);
  const needsLink = !needsRebuild && workOrderLinesNeedProductLink(existing.parts);
  if (!needsRebuild && !needsLink) return false;
  if (needsRebuild && !legacyWorkOrderHasBillableMoney(row)) return false;
  if (dryRun) return true;

  const paid = existing.paid ?? row.paid;
  if (needsRebuild) {
    const mapped = await resolveLegacyWorkOrderMoney(
      row,
      catalog,
      mongooseLegacyProductWriter(models.Product),
    );
    if (mapped.total <= 0) return false;
    const tax = unpaidTaxFields(mapped, paid, taxRate);
    const money = {
      ...workOrderMoneyFieldsFromMapped(mapped),
      taxRate: tax.taxRate,
      tax: tax.tax,
      taxOverridden: tax.taxOverridden,
      total: tax.total,
    };
    await models.WorkOrder.updateOne({ _id: existing._id }, { $set: money });
    existing.parts = mapped.parts;
    existing.total = tax.total;
    await upsertBoundWorkOrderInvoice(models, {
      _id: existing._id,
      customerId: existing.customerId,
      customerRef: existing.customerRef,
      number: existing.number,
      date: existing.date ?? row.date,
      descPerform: row.descPerform,
      paid,
      parts: mapped.parts,
      totalLabor: mapped.totalLabor,
      miscExp: mapped.miscExp,
      shipping: mapped.shipping,
      total: tax.total,
      taxRate: tax.taxRate,
      tax: tax.tax,
    });
    return true;
  }

  await ensureLegacyCatalogProducts(
    mongooseLegacyProductWriter(models.Product),
    (existing.parts ?? []).map((part) => ({
      lineType: part.lineType === "note" ? "note" as const : "product" as const,
      partNumber: part.partNumber ?? "",
      description: part.description ?? part.partNumber ?? "",
      kind: part.kind === "labor" ? "labor" as const : "part" as const,
      listPrice: part.unitPrice ?? 0,
      unitPrice: part.unitPrice ?? 0,
      amount: part.amount ?? 0,
    })),
    catalog,
  );
  const linked = (existing.parts ?? []).map((part) => ({
    productRef: part.productRef ? String(part.productRef) : null,
    contractTemplateRef: null,
    enrolledContractRef: null,
    lineType: part.lineType === "note" ? "note" as const : "product" as const,
    kind: part.kind === "labor" ? "labor" as const : "part" as const,
    partNumber: part.partNumber ?? "",
    description: part.description ?? "",
    quantity: part.quantity ?? 0,
    unitPrice: part.unitPrice ?? 0,
    listPrice: part.unitPrice ?? 0,
    priceOverridden: false,
    amount: part.amount ?? 0,
  }));
  if (!linkCatalogProductRefs(linked, catalog)) return false;
  await models.WorkOrder.updateOne(
    { _id: existing._id },
    { $set: { parts: partsForMongo(linked) } },
  );
  existing.parts = linked;
  if ((existing.total ?? 0) > 0) {
    await upsertBoundWorkOrderInvoice(models, {
      _id: existing._id,
      customerId: existing.customerId,
      customerRef: existing.customerRef,
      number: existing.number,
      date: existing.date ?? row.date,
      descPerform: existing.descPerform ?? row.descPerform,
      paid,
      parts: linked,
      shipping: existing.shipping ?? 0,
      total: existing.total ?? 0,
      taxRate: 0,
      tax: 0,
    });
  }
  return true;
}

type BoundInvoiceSnapshot = {
  _id: Types.ObjectId;
  status: string;
  amountCents: number;
  customerRef?: Types.ObjectId | null;
};

async function loadBoundInvoiceSnapshots(
  models: BoundModels,
  workOrderIds: Types.ObjectId[],
): Promise<Map<string, BoundInvoiceSnapshot | null>> {
  const cache = new Map<string, BoundInvoiceSnapshot | null>();
  for (const id of workOrderIds) cache.set(String(id), null);
  if (workOrderIds.length === 0) return cache;

  const docs = await models.Invoice.find({
    workOrderRef: { $in: workOrderIds },
    status: { $ne: "void" },
  })
    .select("_id workOrderRef status amountCents customerRef")
    .lean();
  for (const doc of docs) {
    const key = String(doc.workOrderRef);
    if (cache.get(key)) continue;
    cache.set(key, {
      _id: doc._id as Types.ObjectId,
      status: doc.status,
      amountCents: doc.amountCents ?? 0,
      customerRef: (doc.customerRef as Types.ObjectId | null | undefined) ?? null,
    });
  }
  return cache;
}

async function syncLegacyBoundInvoiceStatus(
  models: BoundModels,
  wo: {
    _id: Types.ObjectId;
    customerId: number;
    customerRef?: Types.ObjectId | null;
    number?: string;
    date?: Date | null;
    descPerform?: string;
    parts?: LegacyMappedWorkOrderMoney["parts"];
    totalLabor?: number;
    miscExp?: number;
    shipping?: number;
  },
  row: WorkOrderRow,
  known: BoundInvoiceSnapshot | null,
): Promise<void> {
  const existing = known;
  const issuedAt = row.date instanceof Date ? row.date : new Date();
  const amountCents = dollarsToCents(row.total);
  const nextStatus = row.paid ? ("paid" as const) : ("open" as const);
  const nextPaidAt = row.paid ? issuedAt : null;

  if (existing) {
    const statusChanged = existing.status !== nextStatus;
    const amountChanged =
      amountCents > 0 && existing.amountCents !== amountCents;
    if (!statusChanged && !amountChanged) return;
    const $set: Record<string, unknown> = {};
    if (statusChanged) {
      $set.status = nextStatus;
      $set.paidAt = nextPaidAt;
    }
    if (amountChanged) {
      $set.amountCents = amountCents;
      $set.taxRatePercent = 0;
      $set.taxCents = 0;
      $set.taxOverridden = false;
    }
    if (!existing.customerRef && wo.customerRef) {
      $set.customerRef = wo.customerRef;
    }
    if (Object.keys($set).length > 0) {
      await models.Invoice.updateOne({ _id: existing._id }, { $set });
    }
    return;
  }

  if (row.total <= 0 || !wo.customerRef || amountCents <= 0) return;
  const payload = {
    customerId: wo.customerId,
    customerRef: wo.customerRef,
    sourceType: "work_order" as const,
    workOrderRef: wo._id,
    lineItems: workOrderInvoiceLineItems({
      number: wo.number,
      descPerform: row.descPerform,
      parts: wo.parts,
      totalLabor: row.totalLabor,
      miscExp: row.miscExp,
      shipping: row.shipping,
      total: row.total,
    }),
    amountCents,
    currency: "USD",
    status: nextStatus,
    dueDate: null,
    issuedAt,
    paidAt: nextPaidAt,
    metadata: { backfilled: true },
    taxRatePercent: 0,
    taxCents: 0,
    taxOverridden: false,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await models.Invoice.create({
        ...payload,
        number: await nextBoundInvoiceNumber(models, issuedAt),
      });
      return;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 11000 || attempt === 2) throw err;
    }
  }
}

function allocateInvoiceNumber(issuedAt: Date, reserved: Set<string>): string {
  const prefix = invoiceNumberPrefixFromDate(issuedAt);
  for (let i = 0; i < 40; i += 1) {
    const number = `${prefix}${String(randomInt(0, 100_000)).padStart(5, "0")}`;
    if (reserved.has(number)) continue;
    reserved.add(number);
    return number;
  }
  throw new Error("Unable to allocate a unique invoice number");
}

type BoundInvoiceInsert = {
  label: string;
  number: string;
  customerId: number;
  customerRef: Types.ObjectId;
  sourceType: "work_order";
  workOrderRef: Types.ObjectId;
  lineItems: { description: string; amountCents: number }[];
  amountCents: number;
  currency: "USD";
  status: "paid" | "open";
  dueDate: null;
  issuedAt: Date;
  paidAt: Date | null;
  metadata: { backfilled: true };
  taxRatePercent: number;
  taxCents: number;
  taxOverridden: false;
};

async function insertInvoiceBatch(
  models: BoundModels,
  docs: BoundInvoiceInsert[],
  reserved: Set<string>,
  onError: (message: string) => void,
): Promise<number> {
  const payload = docs.map(({ label: _label, ...doc }) => doc);
  try {
    const inserted = await models.Invoice.insertMany(payload, { ordered: false });
    return inserted.length;
  } catch (err) {
    const bulk = err as {
      insertedDocs?: unknown[];
      message?: string;
      writeErrors?: Array<{
        index?: number;
        code?: number;
        errmsg?: string;
        err?: { code?: number; errmsg?: string };
      }>;
    };
    let count = bulk.insertedDocs?.length ?? 0;
    const failures = bulk.writeErrors ?? [];
    if (failures.length === 0) {
      onError(`Invoice batch failed: ${err instanceof Error ? err.message : String(err)}`);
      return count;
    }
    for (const failure of failures) {
      const code = failure.code ?? failure.err?.code;
      const doc = docs[failure.index ?? -1];
      if (code === 11000 && doc) {
        try {
          const { label: _label, ...rest } = doc;
          await models.Invoice.create({
            ...rest,
            number: allocateInvoiceNumber(doc.issuedAt, reserved),
          });
          count += 1;
          continue;
        } catch (retryErr) {
          onError(
            `Invoice sync skipped for ${doc.label}: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
          continue;
        }
      }
      onError(
        `Invoice sync skipped for ${doc?.label ?? "unknown"}: ${failure.errmsg ?? failure.err?.errmsg ?? bulk.message ?? "write failed"}`,
      );
    }
    return count;
  }
}

export type WorkOrderLineItemBackfillResult = {
  target: LegacyDumpTarget;
  label: string;
  updated: number;
  skipped: number;
  invoicesSynced: number;
  invoiceErrors: number;
};

/**
 * Rebuild placeholder legacy lines and sync invoices on one dump database.
 * Uses a dedicated connection so products and invoices stay on that database.
 */
export async function backfillStoredWorkOrderLineItems(options: {
  target: LegacyDumpTarget;
  mongoUri: string;
  dryRun?: boolean;
  onLog?: (message: string) => void;
}): Promise<WorkOrderLineItemBackfillResult> {
  const dryRun = options.dryRun ?? false;
  const log = options.onLog ?? ((message: string) => console.log(message));
  const label = describeMongoTarget(options.mongoUri);
  const prefix = dryRun ? "[dry-run] " : "";
  log(`${prefix}Connecting to ${options.target} (${label})…`);

  const conn = mongoose.createConnection(options.mongoUri, {
    serverSelectionTimeoutMS: 20_000,
    socketTimeoutMS: 60_000,
    maxPoolSize: 5,
  });
  await conn.asPromise();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const models = bindModels(conn);
    const catalog = await loadProductCatalog(models);
    const taxRate = dryRun ? 0 : await boundTaxRate(models);
    const writer = mongooseLegacyProductWriter(models.Product);
    log(`${prefix}Loaded ${catalog.length.toLocaleString()} products from ${label}.`);

    const candidates = await models.WorkOrder.find({
      $or: [
        { total: { $gt: 0 } },
        { totalParts: { $gt: 0 } },
        { totalLabor: { $gt: 0 } },
        { miscExp: { $gt: 0 } },
        { shipping: { $gt: 0 } },
        { descPerform: /(?:asc|acs)\s*\$?\s*\d|\$\s*\d+(?:\.\d{1,2})?\s*plus\s+parts/i },
        { descPerformed: /(?:asc|acs)\s*\$?\s*\d|\$\s*\d+(?:\.\d{1,2})?\s*plus\s+parts/i },
        { "parts.partNumber": /^IMPORTED/i },
      ],
    })
      .select(
        "legacyId number descPerform descPerformed parts totalParts totalLabor miscExp subtotal shipping total laborHours paid customerId customerRef date taxRate tax taxOverridden",
      )
      .lean();

    let updated = 0;
    let skipped = 0;
    let invoicesSynced = 0;
    let invoiceErrors = 0;
    let lastNote = `loading ${candidates.length.toLocaleString()} candidate work orders`;
    heartbeat = setInterval(() => {
      log(`${prefix}${options.target}: still working — ${lastNote}`);
    }, 15_000);
    log(`${prefix}${options.target}: found ${candidates.length.toLocaleString()} candidates. Loading existing invoices…`);
    lastNote = "loading existing invoices";

    const billed = new Set<string>();
    const openInvoices = new Map<string, Types.ObjectId>();
    const reserved = new Set<string>();
    const existingInvoices = await models.Invoice.find({
      workOrderRef: { $in: candidates.map((wo) => wo._id) },
      status: { $ne: "void" },
    })
      .select("_id workOrderRef status")
      .lean();
    for (const invoice of existingInvoices) {
      if (!invoice.workOrderRef) continue;
      const id = String(invoice.workOrderRef);
      billed.add(id);
      if (invoice.status === "open" || invoice.status === "draft" || invoice.status === "failed") {
        openInvoices.set(id, invoice._id);
      }
    }
    if (!dryRun) {
      lastNote = "loading invoice numbers";
      const numbers = await models.Invoice.distinct("number");
      for (const number of numbers) {
        if (typeof number === "string" && number) reserved.add(number);
      }
    }
    log(
      `${prefix}${options.target}: ${billed.size.toLocaleString()} already billed. Mapping lines…`,
    );

    const woOps: mongoose.AnyBulkWriteOperation[] = [];
    const invoiceUpdates: mongoose.AnyBulkWriteOperation[] = [];
    const invoiceInserts: BoundInvoiceInsert[] = [];

    const flush = async (force = false) => {
      const pending = woOps.length + invoiceUpdates.length + invoiceInserts.length;
      if (!force && pending < 100) return;
      if (pending === 0) return;
      lastNote = `writing ${woOps.length.toLocaleString()} work orders and ${(invoiceInserts.length + invoiceUpdates.length).toLocaleString()} invoices`;
      log(`${prefix}${options.target}: ${lastNote}…`);
      if (woOps.length > 0) {
        await models.WorkOrder.bulkWrite(woOps.splice(0, woOps.length), { ordered: false });
      }
      if (invoiceUpdates.length > 0) {
        const updates = invoiceUpdates.splice(0, invoiceUpdates.length);
        await models.Invoice.bulkWrite(updates, { ordered: false });
        invoicesSynced += updates.length;
      }
      if (invoiceInserts.length > 0) {
        const batch = invoiceInserts.splice(0, invoiceInserts.length);
        invoicesSynced += await insertInvoiceBatch(models, batch, reserved, (message) => {
          invoiceErrors += 1;
          log(message);
        });
      }
    };

    const queueInvoice = (
      wo: (typeof candidates)[number],
      money: {
        paid: boolean;
        total: number;
        taxRate: number;
        tax: number;
        parts?: Parameters<typeof workOrderInvoiceLineItems>[0]["parts"];
        totalLabor?: number;
        miscExp?: number;
        shipping?: number;
      },
    ) => {
      if (money.total <= 0 || !wo.customerRef || typeof wo.customerId !== "number") return;
      const id = String(wo._id);
      const issuedAt = wo.date instanceof Date ? wo.date : new Date();
      const amountCents = dollarsToCents(money.total);
      if (amountCents <= 0) return;
      const lineItems = workOrderInvoiceLineItems({
        parts: money.parts,
        totalLabor: money.totalLabor,
        miscExp: money.miscExp,
        shipping: money.shipping,
        total: money.total,
        descPerform: wo.descPerform,
        number: wo.number,
      });
      const taxCents = money.paid ? 0 : taxCentsFromDollars(money.tax);
      const taxRatePercent = money.paid ? 0 : money.taxRate;
      const openId = openInvoices.get(id);
      if (dryRun) {
        if (openId || !billed.has(id)) invoicesSynced += 1;
        return;
      }
      if (openId) {
        invoiceUpdates.push({
          updateOne: {
            filter: { _id: openId, status: { $in: ["open", "draft", "failed"] } },
            update: {
              $set: {
                amountCents,
                lineItems,
                taxRatePercent,
                taxCents,
                taxOverridden: false,
                customerRef: wo.customerRef,
              },
            },
          },
        });
        return;
      }
      if (billed.has(id)) return;
      const number = allocateInvoiceNumber(issuedAt, reserved);
      invoiceInserts.push({
        label: wo.number || String(wo.legacyId || wo._id),
        number,
        customerId: wo.customerId,
        customerRef: wo.customerRef,
        sourceType: "work_order",
        workOrderRef: wo._id,
        lineItems,
        amountCents,
        currency: "USD",
        status: money.paid ? "paid" : "open",
        dueDate: null,
        issuedAt,
        paidAt: money.paid ? issuedAt : null,
        metadata: { backfilled: true },
        taxRatePercent,
        taxCents,
        taxOverridden: false,
      });
      billed.add(id);
    };

    for (let index = 0; index < candidates.length; index += 1) {
      const wo = candidates[index];
      const labelForWo = wo.number || String(wo.legacyId || wo._id);
      lastNote = `pricing ${index + 1}/${candidates.length} ${labelForWo}`;
      const needsRebuild = workOrderLinesNeedRebuild(wo.parts);
      const needsLink = !needsRebuild && workOrderLinesNeedProductLink(wo.parts);
      if (!needsRebuild && !needsLink) {
        if ((wo.total ?? 0) > 0 && !billed.has(String(wo._id))) {
          queueInvoice(wo, {
            paid: Boolean(wo.paid),
            total: wo.total ?? 0,
            taxRate: wo.taxRate ?? 0,
            tax: wo.tax ?? 0,
            parts: wo.parts,
            shipping: wo.shipping ?? 0,
          });
        }
        skipped += 1;
        if ((index + 1) % 100 === 0) {
          log(
            `${prefix}${options.target}: reviewed ${(index + 1).toLocaleString()}/${candidates.length.toLocaleString()}`,
          );
        }
        await flush();
        continue;
      }
      if (needsRebuild && !legacyWorkOrderHasBillableMoney(wo)) {
        skipped += 1;
        continue;
      }

      const paid = Boolean(wo.paid);
      if (needsRebuild) {
        const mapped = await resolveLegacyWorkOrderMoney(
          wo,
          catalog,
          dryRun ? null : writer,
        );
        if (mapped.total <= 0) {
          skipped += 1;
          continue;
        }
        const tax = unpaidTaxFields(mapped, paid, taxRate);
        updated += 1;
        if (!dryRun) {
          woOps.push({
            updateOne: {
              filter: { _id: wo._id },
              update: {
                $set: {
                  ...workOrderMoneyFieldsFromMapped(mapped),
                  taxRate: tax.taxRate,
                  tax: tax.tax,
                  taxOverridden: tax.taxOverridden,
                  total: tax.total,
                },
              },
            },
          });
        }
        queueInvoice(wo, {
          paid,
          total: tax.total,
          taxRate: tax.taxRate,
          tax: tax.tax,
          parts: mapped.parts,
          totalLabor: mapped.totalLabor,
          miscExp: mapped.miscExp,
          shipping: mapped.shipping,
        });
      } else {
        if (!dryRun) {
          await ensureLegacyCatalogProducts(
            writer,
            (wo.parts ?? []).map((part) => ({
              lineType: part.lineType === "note" ? "note" as const : "product" as const,
              partNumber: part.partNumber ?? "",
              description: part.description ?? part.partNumber ?? "",
              kind: part.kind === "labor" ? "labor" as const : "part" as const,
              listPrice: part.unitPrice ?? part.listPrice ?? 0,
              unitPrice: part.unitPrice ?? 0,
              amount: part.amount ?? 0,
            })),
            catalog,
          );
        }
        const linked = (wo.parts ?? []).map((part) => ({
          productRef: part.productRef ? String(part.productRef) : null,
          contractTemplateRef: part.contractTemplateRef ? String(part.contractTemplateRef) : null,
          enrolledContractRef: part.enrolledContractRef ? String(part.enrolledContractRef) : null,
          lineType: part.lineType === "note" ? "note" as const : part.lineType === "agreement" ? "agreement" as const : "product" as const,
          kind: part.kind === "labor" ? "labor" as const : part.kind === "equipment" ? "equipment" as const : "part" as const,
          partNumber: part.partNumber ?? "",
          description: part.description ?? "",
          quantity: part.quantity ?? 0,
          unitPrice: part.unitPrice ?? 0,
          listPrice: part.listPrice ?? part.unitPrice ?? 0,
          priceOverridden: Boolean(part.priceOverridden),
          amount: part.amount ?? 0,
        }));
        if (!linkCatalogProductRefs(linked, catalog)) {
          skipped += 1;
          continue;
        }
        updated += 1;
        if (!dryRun) {
          woOps.push({
            updateOne: {
              filter: { _id: wo._id },
              update: { $set: { parts: partsForMongo(linked) } },
            },
          });
        }
        if ((wo.total ?? 0) > 0) {
          queueInvoice(wo, {
            paid,
            total: wo.total ?? 0,
            taxRate: wo.taxRate ?? 0,
            tax: wo.tax ?? 0,
            parts: linked,
            shipping: wo.shipping ?? 0,
          });
        }
      }

      if ((index + 1) % 100 === 0 || index + 1 === candidates.length) {
        log(
          `${prefix}${options.target}: reviewed ${(index + 1).toLocaleString()}/${candidates.length.toLocaleString()} (${updated.toLocaleString()} to update)`,
        );
      }
      await flush();
    }
    lastNote = "writing the final batch";
    await flush(true);

    log(
      `${prefix}${options.target}: mapped ${updated.toLocaleString()} work orders, skipped ${skipped.toLocaleString()}, invoices ${invoicesSynced.toLocaleString()}, invoice errors ${invoiceErrors.toLocaleString()}.`,
    );
    return {
      target: options.target,
      label,
      updated,
      skipped,
      invoicesSynced,
      invoiceErrors,
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await conn.close();
  }
}

/**
 * Keep dump rows that belong to the allowed legacy owners (Christopher and
 * Dustin). When a customer dump was parsed, work orders are dropped by the
 * excluded customer ids. When only a work-order dump was uploaded, they are
 * dropped by the work order's own user id.
 */
export function selectOwnerLegacyDumpRows<
  C extends { legacyId: number; userId: number },
  W extends { userId: number; customerId: number },
>(
  customerRows: readonly C[],
  workOrderRows: readonly W[],
  customerDumpProvided: boolean,
): {
  customers: C[];
  workOrders: W[];
  customersSkippedNonOwner: number;
  workOrdersSkippedNonOwner: number;
} {
  const customers = customerRows.filter((row) => isAllowedLegacyOwner(row.userId));
  const excludedCustomerIds = new Set(
    customerRows
      .filter((row) => !isAllowedLegacyOwner(row.userId))
      .map((row) => row.legacyId),
  );
  const workOrders = workOrderRows.filter((row) =>
    customerDumpProvided
      ? !excludedCustomerIds.has(row.customerId)
      : isAllowedLegacyOwner(row.userId),
  );
  return {
    customers,
    workOrders,
    customersSkippedNonOwner: customerRows.length - customers.length,
    workOrdersSkippedNonOwner: workOrderRows.length - workOrders.length,
  };
}

export async function runLegacyDumpSync(options: {
  customerSql?: string;
  workOrderSql?: string;
  mongoUri: string;
  mode: "audit" | "import";
  target?: LegacyDumpTarget | "custom";
  verbose?: boolean;
  onLog?: (message: string) => void;
}): Promise<LegacyDumpSyncResult> {
  const {
    customerSql,
    workOrderSql,
    mongoUri,
    mode,
    target = "custom",
    verbose = false,
    onLog,
  } = options;
  const dryRun = mode === "audit";
  const log = (msg: string) => {
    const line = `[${target}] ${msg}`;
    if (verbose || onLog) {
      console.log(`[legacy-dump-sync] ${line}`);
    }
    onLog?.(line);
  };
  const heartbeat = (done: number, total: number, noun: string) => {
    if (total === 0) return;
    if (done === total || done % PROGRESS_EVERY === 0) {
      const verb = dryRun ? "matched" : "processed";
      log(`${verb} ${done.toLocaleString()}/${total.toLocaleString()} ${noun}…`);
    }
  };

  log(
    customerSql || workOrderSql
      ? "Parsing SQL dumps…"
      : "No dump SQL provided.",
  );
  const parsedCustomers = customerSql ? parseCustomerDump(customerSql) : [];
  const parsedWorkOrders = workOrderSql ? parseWorkOrderDump(workOrderSql) : [];
  if (parsedCustomers.length === 0 && parsedWorkOrders.length === 0) {
    throw new Error("No customer or work order rows could be parsed from the upload.");
  }
  const ownerRows = selectOwnerLegacyDumpRows(
    parsedCustomers,
    parsedWorkOrders,
    parsedCustomers.length > 0,
  );
  const customerRows = ownerRows.customers;
  const workOrderRows = ownerRows.workOrders;
  const customersSkippedNonOwner = ownerRows.customersSkippedNonOwner;
  const workOrdersSkippedNonOwner = ownerRows.workOrdersSkippedNonOwner;
  log(
    `Parsed ${parsedCustomers.length.toLocaleString()} customers and ${parsedWorkOrders.length.toLocaleString()} work orders.`,
  );
  if (customersSkippedNonOwner > 0 || workOrdersSkippedNonOwner > 0) {
    log(
      `Skipping ${customersSkippedNonOwner.toLocaleString()} customers and ${workOrdersSkippedNonOwner.toLocaleString()} work orders outside legacy owners ${ALLOWED_LEGACY_OWNER_USER_IDS.join(" and ")}.`,
    );
  }

  const targetLabel = describeMongoTarget(mongoUri);
  let conn: Connection | null = null;

  try {
    log(`Connecting to ${targetLabel}…`);
    conn = mongoose.createConnection(mongoUri);
    await conn.asPromise();
    log("Connected.");
    await ensureCustomerOptionalUniqueIndexes(conn);
    const models = bindModels(conn);

    log("Loading existing customers…");
    const existingCustomers = await models.Customer.find({
      ...activeCustomerFilter,
      ...notMergedFilter,
    })
      .select(
        "_id legacyId first last accountName address city zip phone phoneDigits email generatorModel serial exday extime",
      )
      .lean();

    const existingIds = existingCustomers.map((c) => c._id);
    const contacts = await models.CustomerContact.find({
      customerRef: { $in: existingIds },
    })
      .select("customerRef phone email")
      .lean();
    const addresses = await models.CustomerAddress.find({
      customerRef: { $in: existingIds },
    })
      .select("customerRef address zip")
      .lean();
    log(
      `Loaded ${existingCustomers.length.toLocaleString()} customers, ${contacts.length.toLocaleString()} contacts, ${addresses.length.toLocaleString()} addresses.`,
    );

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
      if (!contact.customerRef) continue;
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
    for (const doc of existingCustomers) {
      const mapped = toMapped(doc);
      indexCustomer(index, mapped);
      indexIdentity(index, mapped, extrasByCustomer.get(mapped._id.toString()));
    }

    const maxMongoLegacy = existingCustomers.reduce(
      (max, c) => Math.max(max, c.legacyId ?? 0),
      0,
    );
    const maxSqlLegacy = customerRows.reduce((max, row) => Math.max(max, row.legacyId), 0);
    let nextLegacyId = Math.max(maxMongoLegacy, maxSqlLegacy) + 1;
    log(
      `Collision remaps start at ${nextLegacyId} (mongo max ${maxMongoLegacy}, dump max ${maxSqlLegacy}).`,
    );

    if (customerRows.length > 0) {
      log("Matching dump customers…");
    }

    const loginOwners = new Map<number, Types.ObjectId>();
    if (customerRows.length > 0) {
      for (const owner of LEGACY_LOGIN_OWNERS) {
        const matches = await conn
          .collection("users")
          .find({
            first_name: new RegExp(`^${owner.firstName}$`, "i"),
            last_name: new RegExp(`^${owner.lastName}$`, "i"),
            deletedAt: null,
          })
          .project({ _id: 1 })
          .toArray();
        if (matches.length !== 1) {
          log(
            `Legacy user ${owner.legacyUserId} owner ${owner.firstName} ${owner.lastName} matched ${matches.length} users; leaving those customers unchanged.`,
          );
          continue;
        }
        loginOwners.set(owner.legacyUserId, matches[0]!._id as Types.ObjectId);
        log(
          `Legacy user ${owner.legacyUserId} customers will be owned by ${owner.firstName} ${owner.lastName}.`,
        );
      }
    }

    const mysqlToCustomer = new Map<number, MappedCustomer>();
    let skippedLegacy = 0;
    let skippedIdentity = 0;
    let collisions = 0;
    let insertedCustomers = 0;
    let contactsCreated = 0;
    let ownersAssigned = 0;

    const ownerWrites: Array<{
      updateOne: {
        filter: { _id: Types.ObjectId };
        update: { $set: { ownerUserRef: Types.ObjectId; ownerManual: true } };
      };
    }> = [];
    const assignLegacyOwner = (
      customerId: Types.ObjectId | null,
      userId: number,
    ) => {
      const ownerId = loginOwners.get(userId);
      if (!ownerId) return;
      ownersAssigned += 1;
      if (dryRun || !customerId) return;
      ownerWrites.push({
        updateOne: {
          filter: { _id: customerId },
          update: { $set: { ownerUserRef: ownerId, ownerManual: true } },
        },
      });
    };

    const audit: AuditReport = {
      customersPresent: 0,
      customersIdentityLinked: [],
      customersMissing: [],
      customersCollisions: [],
      wosPresent: 0,
      wosFuzzy: 0,
      wosMissing: [],
      wosOrphan: [],
    };

    for (let i = 0; i < customerRows.length; i += 1) {
      const row = customerRows[i]!;
      try {
      const existingSameId = index.byLegacyId.get(row.legacyId) ?? [];
      const sameIdMatch = existingSameId.find((c) =>
        identitiesMatch(row, c, extrasByCustomer.get(c._id.toString())),
      );
      if (sameIdMatch) {
        mysqlToCustomer.set(row.legacyId, sameIdMatch);
        skippedLegacy += 1;
        audit.customersPresent += 1;
        assignLegacyOwner(sameIdMatch._id, row.userId);
        continue;
      }

      const identityMatch = findIdentityMatch(row, index);
      if (identityMatch) {
        mysqlToCustomer.set(row.legacyId, identityMatch.customer);
        skippedIdentity += 1;
        audit.customersIdentityLinked.push({
          sqlId: row.legacyId,
          sqlName: sqlCustomerName(row),
          phone: row.phone,
          email: sqlEmail(row),
          reason: identityMatch.reason,
          mongoLegacyId: identityMatch.customer.legacyId,
          mongoName: displayName(identityMatch.customer),
        });
        assignLegacyOwner(identityMatch.customer._id, row.userId);
        continue;
      }

      if (existingSameId.length > 0) {
        collisions += 1;
        const assignedId = nextLegacyId;
        nextLegacyId += 1;
        audit.customersCollisions.push({
          sqlId: row.legacyId,
          sqlName: sqlCustomerName(row),
          phone: row.phone,
          email: sqlEmail(row),
          occupiedBy: displayName(existingSameId[0]),
          occupiedLegacyId: existingSameId[0].legacyId,
          assignedId,
        });

        if (dryRun) {
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
          assignLegacyOwner(null, row.userId);
          continue;
        }

        const created = await createCustomerFromRow(models, row, assignedId);
        mysqlToCustomer.set(row.legacyId, created);
        indexCustomer(index, created);
        indexIdentity(index, created, {
          phones: [normalizePhoneDigits(row.phone)].filter((p) => p.length >= 7),
          emails: [sqlEmail(row)].filter(Boolean),
          addressKeys: [sqlAddressKey(row)].filter(Boolean),
        });
        insertedCustomers += 1;
        contactsCreated += 1;
        assignLegacyOwner(created._id, row.userId);
        continue;
      }

      if (row.legacyId >= nextLegacyId) nextLegacyId = row.legacyId + 1;

      audit.customersMissing.push({
        sqlId: row.legacyId,
        sqlName: sqlCustomerName(row),
        phone: row.phone,
        email: sqlEmail(row),
      });

      if (dryRun) {
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
        assignLegacyOwner(null, row.userId);
        continue;
      }

      const created = await createCustomerFromRow(models, row, row.legacyId);
      mysqlToCustomer.set(row.legacyId, created);
      indexCustomer(index, created);
      indexIdentity(index, created, {
        phones: [normalizePhoneDigits(row.phone)].filter((p) => p.length >= 7),
        emails: [sqlEmail(row)].filter(Boolean),
        addressKeys: [sqlAddressKey(row)].filter(Boolean),
      });
      insertedCustomers += 1;
      contactsCreated += 1;
      assignLegacyOwner(created._id, row.userId);
      } finally {
        heartbeat(i + 1, customerRows.length, "customers");
      }
    }

    if (!dryRun && ownerWrites.length > 0) {
      await models.Customer.bulkWrite(ownerWrites, { ordered: true });
    }

    log(
      `Customers: present=${audit.customersPresent.toLocaleString()} identity-linked=${audit.customersIdentityLinked.length.toLocaleString()} missing=${audit.customersMissing.length.toLocaleString()} collisions=${audit.customersCollisions.length.toLocaleString()} owners-assigned=${ownersAssigned.toLocaleString()} skipped-non-owner=${customersSkippedNonOwner.toLocaleString()}.`,
    );

    log("Loading existing work orders…");
    const existingWos = await models.WorkOrder.find()
      .select(
        "_id legacyId userId number customerId customerRef customerName customerAddress customerCity customerZip customerPhone customerEmail date descPerform paid completed parts subtotal shipping total",
      )
      .lean();
    const existingWoLegacyIds = new Set<number>();
    const wosByLegacyId = new Map<number, ExistingWorkOrder[]>();
    const fuzzyWoKeys = new Set<string>();
    for (const wo of existingWos) {
      if (wo.legacyId != null) {
        existingWoLegacyIds.add(wo.legacyId);
        const list = wosByLegacyId.get(wo.legacyId) ?? [];
        list.push(wo);
        wosByLegacyId.set(wo.legacyId, list);
      }
      fuzzyWoKeys.add(woFuzzyKey(wo.customerId, wo.date, wo.descPerform ?? ""));
    }

    const invoiceByWorkOrder = dryRun
      ? new Map<string, BoundInvoiceSnapshot | null>()
      : await loadBoundInvoiceSnapshots(
          models,
          existingWos.map((wo) => wo._id as Types.ObjectId),
        );
    if (!dryRun) {
      log(
        `Loaded ${existingWos.length.toLocaleString()} work orders and ${[...invoiceByWorkOrder.values()].filter(Boolean).length.toLocaleString()} invoices.`,
      );
    } else {
      log(`Loaded ${existingWos.length.toLocaleString()} work orders.`);
    }
    if (workOrderRows.length > 0) {
      log(dryRun ? "Matching dump work orders…" : "Importing dump work orders…");
    }

    const siteCache = new Map<
      string,
      { addressRef?: Types.ObjectId; equipmentRef?: Types.ObjectId }
    >();
    let skippedWoLegacy = 0;
    let skippedWoFuzzy = 0;
    let orphanWos = 0;
    let insertedWos = 0;
    let backfilledWoRefs = 0;
    let backfilledWoLineItems = 0;
    let statusUpdated = 0;
    let skippedDuplicateLegacy = 0;
    let skippedUserMismatch = 0;
    const duplicateLegacyIds: number[] = [];
    const userMismatchIds: number[] = [];
    const productCatalog = await loadProductCatalog(models);
    const taxRate = dryRun ? 0 : await boundTaxRate(models);
    if (workOrderRows.length > 0) {
      log(
        `Loaded ${productCatalog.length.toLocaleString()} active products for work-order line mapping.`,
      );
    }

    for (let i = 0; i < workOrderRows.length; i += 1) {
      const row = workOrderRows[i]!;
      try {
      const legacyMatches = wosByLegacyId.get(row.legacyId) ?? [];
      if (legacyMatches.length > 0 || existingWoLegacyIds.has(row.legacyId)) {
        skippedWoLegacy += 1;
        audit.wosPresent += 1;
        const decision = matchLegacyWorkOrder(row, legacyMatches);
        if (decision.action === "skip") {
          if (decision.reason === "duplicate") {
            skippedDuplicateLegacy += 1;
            duplicateLegacyIds.push(row.legacyId);
          } else if (decision.reason === "user_mismatch") {
            skippedUserMismatch += 1;
            userMismatchIds.push(row.legacyId);
          }
          continue;
        }

        const existing = legacyMatches[0]!;
        const backfilled = await backfillExistingWorkOrderCustomer(
          models,
          existing,
          row,
          mysqlToCustomer,
          index,
          dryRun,
          log,
        );
        if (backfilled) backfilledWoRefs += 1;
        const mappedItems = await backfillExistingWorkOrderLineItems(
          models,
          existing,
          row,
          productCatalog,
          dryRun,
          taxRate,
        );
        if (mappedItems) backfilledWoLineItems += 1;

        const statusPatch = legacyWorkOrderStatusPatch(existing, row);
        if (statusPatch) {
          statusUpdated += 1;
          if (!dryRun) {
            await models.WorkOrder.updateOne(
              { _id: existing._id },
              { $set: statusPatch },
            );
          }
          if ("paid" in statusPatch) existing.paid = row.paid;
          if ("completed" in statusPatch) existing.completed = row.completed;
          if ("date" in statusPatch) existing.date = row.date;
          if ("total" in statusPatch) existing.total = row.total;
        }
        if (!dryRun) {
          await syncLegacyBoundInvoiceStatus(
            models,
            {
              _id: existing._id,
              customerId: existing.customerId,
              customerRef: existing.customerRef,
              number: existing.number,
              date: existing.date ?? row.date,
              descPerform: row.descPerform,
              parts: existing.parts as LegacyMappedWorkOrderMoney["parts"],
              totalLabor: row.totalLabor,
              miscExp: row.miscExp,
              shipping: row.shipping,
            },
            row,
            invoiceByWorkOrder.get(String(existing._id)) ?? null,
          );
        }
        continue;
      }

      const customer =
        mysqlToCustomer.get(row.customerId) ??
        index.byLegacyId.get(row.customerId)?.[0];
      if (!customer) {
        orphanWos += 1;
        audit.wosOrphan.push({ woId: row.legacyId, customerId: row.customerId });
        continue;
      }

      const fuzzy = woFuzzyKey(customer.legacyId, row.date, row.descPerform);
      if (fuzzyWoKeys.has(fuzzy)) {
        skippedWoFuzzy += 1;
        audit.wosFuzzy += 1;
        continue;
      }

      audit.wosMissing.push({
        woId: row.legacyId,
        customerId: row.customerId,
        customerName: displayName(customer),
        date: dateKey(row.date),
      });

      if (dryRun) {
        existingWoLegacyIds.add(row.legacyId);
        fuzzyWoKeys.add(fuzzy);
        insertedWos += 1;
        continue;
      }

      const site = await loadSiteRefs(models, customer._id, siteCache);
      const mapped = await resolveLegacyWorkOrderMoney(
        row,
        productCatalog,
        mongooseLegacyProductWriter(models.Product),
      );
      const tax = unpaidTaxFields(mapped, row.paid, taxRate);
      const createdWo = await models.WorkOrder.create({
        legacyId: row.legacyId,
        userId: row.userId,
        customerId: customer.legacyId,
        customerRef: customer._id,
        addressRef: site.addressRef ?? null,
        equipmentRef: site.equipmentRef ?? null,
        descPerform: row.descPerform,
        paid: row.paid,
        runHours: row.runHours,
        date: row.date,
        tech: row.tech,
        descPerformed: row.descPerformed,
        ...workOrderMoneyFieldsFromMapped(mapped),
        taxRate: tax.taxRate,
        tax: tax.tax,
        taxOverridden: tax.taxOverridden,
        total: tax.total,
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
      await upsertBoundWorkOrderInvoice(models, {
        _id: createdWo._id,
        customerId: customer.legacyId,
        customerRef: customer._id,
        number: createdWo.number,
        date: row.date,
        descPerform: row.descPerform,
        paid: row.paid,
        parts: mapped.parts,
        totalLabor: mapped.totalLabor,
        miscExp: mapped.miscExp,
        shipping: mapped.shipping,
        total: tax.total,
        taxRate: tax.taxRate,
        tax: tax.tax,
      });

      existingWoLegacyIds.add(row.legacyId);
      fuzzyWoKeys.add(fuzzy);
      insertedWos += 1;
      } finally {
        heartbeat(i + 1, workOrderRows.length, "work orders");
      }
    }

    log(
      `Work orders: present=${audit.wosPresent.toLocaleString()} missing=${audit.wosMissing.length.toLocaleString()} fuzzy=${audit.wosFuzzy.toLocaleString()} orphans=${audit.wosOrphan.length.toLocaleString()} ref-backfills=${backfilledWoRefs.toLocaleString()} line-item-backfills=${backfilledWoLineItems.toLocaleString()} status-updates=${statusUpdated.toLocaleString()} duplicate-legacy=${skippedDuplicateLegacy.toLocaleString()} user-mismatch=${skippedUserMismatch.toLocaleString()} skipped-non-owner=${workOrdersSkippedNonOwner.toLocaleString()}.`,
    );
    if (duplicateLegacyIds.length > 0) {
      log(
        `Skipped duplicate legacy work order ids: ${duplicateLegacyIds.join(", ")}`,
      );
    }
    if (userMismatchIds.length > 0) {
      log(
        `Skipped legacy work order ids with a different user: ${userMismatchIds.join(", ")}`,
      );
    }

    if (!dryRun && workOrderRows.length > 0) {
      const dumpCustomerIds = new Set(customerRows.map((row) => row.legacyId));
      const dumpPending = new Map<number, number>();
      for (const row of workOrderRows) {
        if (!row.completed || row.paid) continue;
        if (customerRows.length > 0 && !dumpCustomerIds.has(row.customerId)) continue;
        dumpPending.set(row.userId, (dumpPending.get(row.userId) ?? 0) + 1);
      }
      const crmPending = await models.WorkOrder.aggregate<{ _id: number; n: number }>([
        {
          $match: {
            ...pendingPaymentWorkOrderFilter(),
            deletedAt: null,
            userId: { $in: [...dumpPending.keys()] },
          },
        },
        { $group: { _id: "$userId", n: { $sum: 1 } } },
      ]);
      const crmByUser = new Map(crmPending.map((row) => [row._id, row.n]));
      for (const userId of [...dumpPending.keys()].sort((a, b) => a - b)) {
        const dumpCount = dumpPending.get(userId) ?? 0;
        const crmCount = crmByUser.get(userId) ?? 0;
        log(
          `pending-payment user ${userId}: dump ${dumpCount.toLocaleString()}, CRM ${crmCount.toLocaleString()}${dumpCount === crmCount ? "" : " (MISMATCH)"}.`,
        );
      }
    }

    log(
      dryRun
        ? "Auditing ASC contract dates from latest ASC work orders and invoices…"
        : "Updating ASC contract dates from latest ASC work orders and invoices…",
    );
    let ascSync: AscContractSyncSummary = {
      customersWithAsc: 0,
      contractsCreated: 0,
      contractsUpdated: 0,
      skippedNoCustomer: 0,
      skippedNoDate: 0,
    };
    try {
      ascSync = await syncAscContractsFromRecords(models, {
        dryRun,
        onLog: log,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "ASC contract sync failed.";
      log(`ASC contract sync failed: ${message}`);
      throw err;
    }

    const summary: ImportSummary = {
      customersParsed: parsedCustomers.length,
      customersInserted: dryRun ? 0 : insertedCustomers,
      contactsCreated: dryRun ? 0 : contactsCreated,
      customersSkippedLegacy: skippedLegacy,
      customersSkippedIdentity: skippedIdentity,
      customersSkippedNonOwner,
      customerCollisions: collisions,
      workOrdersParsed: parsedWorkOrders.length,
      workOrdersInserted: dryRun ? 0 : insertedWos,
      workOrdersSkippedLegacy: skippedWoLegacy,
      workOrdersSkippedFuzzy: skippedWoFuzzy,
      workOrderOrphans: orphanWos,
      workOrdersLineItemsBackfilled: backfilledWoLineItems,
      workOrdersStatusUpdated: statusUpdated,
      workOrdersSkippedDuplicateLegacy: skippedDuplicateLegacy,
      workOrdersSkippedUserMismatch: skippedUserMismatch,
      workOrdersSkippedNonOwner,
      ascCustomers: ascSync.customersWithAsc,
      contractsCreated: dryRun ? 0 : ascSync.contractsCreated,
      contractsUpdated: dryRun ? 0 : ascSync.contractsUpdated,
    };

    log(
      dryRun
        ? `Audit complete for ${targetLabel}.`
        : `Import complete for ${targetLabel}: inserted ${summary.customersInserted.toLocaleString()} customers and ${summary.workOrdersInserted.toLocaleString()} work orders.`,
    );

    return {
      target,
      targetLabel,
      mode,
      customersParsed: parsedCustomers.length,
      workOrdersParsed: parsedWorkOrders.length,
      audit,
      summary,
    };
  } finally {
    if (conn) {
      log("Closing connection.");
      await conn.close();
    }
  }
}
