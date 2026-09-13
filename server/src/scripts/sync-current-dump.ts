/**
 * Incremental import of new customers and work orders from SQL dumps.
 *
 * Run from server/:
 *   npx tsx src/scripts/sync-current-dump.ts --dry-run
 *   npx tsx src/scripts/sync-current-dump.ts
 *   npx tsx src/scripts/sync-current-dump.ts --audit --production
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

import fs from "fs";
import {
  type AuditReport,
  describeMongoTarget,
  resolveLegacyDumpUri,
  runLegacyDumpSync,
} from "../services/legacyDumpSync";

const CUSTOMERS_DUMP = path.resolve(__dirname, "../current/customers.sql");
const WORK_ORDERS_DUMP = path.resolve(__dirname, "../current/work_orders.sql");
const USE_PRODUCTION = process.argv.includes("--production");
const AUDIT = process.argv.includes("--audit");
const DRY_RUN = AUDIT || process.argv.includes("--dry-run");
const TEVIS_CUSTOMER_ID = 3019;
const TEVIS_WO_IDS = [5587, 5605] as const;

function log(msg: string): void {
  console.log(`[sync-current-dump] ${msg}`);
}

function printAuditList(title: string, rows: string[]): void {
  log(`${title} (${rows.length})`);
  if (rows.length === 0) {
    log("  (none)");
    return;
  }
  for (const line of rows) {
    log(`  ${line}`);
  }
}

function printSpotlight(report: AuditReport): void {
  const missing = report.customersMissing.find((r) => r.sqlId === TEVIS_CUSTOMER_ID);
  const linked = report.customersIdentityLinked.find((r) => r.sqlId === TEVIS_CUSTOMER_ID);
  const collision = report.customersCollisions.find((r) => r.sqlId === TEVIS_CUSTOMER_ID);
  let tevisStatus = "present (same legacyId)";
  if (missing) tevisStatus = "MISSING from Mongo";
  else if (linked) {
    tevisStatus = `identity-linked to mongo ${linked.mongoLegacyId} "${linked.mongoName}" (${linked.reason})`;
  } else if (collision) {
    tevisStatus = `COLLISION with "${collision.occupiedBy}" (legacyId=${collision.occupiedLegacyId}); would assign ${collision.assignedId}`;
  }
  const tevisName = missing?.sqlName ?? linked?.sqlName ?? collision?.sqlName ?? "Richard Tevis";
  log(`SPOTLIGHT customer ${TEVIS_CUSTOMER_ID} "${tevisName}": ${tevisStatus}`);

  for (const woId of TEVIS_WO_IDS) {
    const orphan = report.wosOrphan.find((r) => r.woId === woId);
    const woMissing = report.wosMissing.find((r) => r.woId === woId);
    if (woMissing) {
      log(
        `SPOTLIGHT WO ${woId}: MISSING customer_id=${woMissing.customerId} "${woMissing.customerName}" date=${woMissing.date || "(none)"}`,
      );
    } else if (orphan) {
      log(`SPOTLIGHT WO ${woId}: ORPHAN customer_id=${orphan.customerId}`);
    } else {
      log(`SPOTLIGHT WO ${woId}: present (legacyId already in Mongo)`);
    }
  }
}

function printAuditReport(report: AuditReport, customersParsed: number, workOrdersParsed: number): void {
  log("");
  log("Audit report");
  log(`  Customers parsed:                         ${customersParsed}`);
  log(`  Customers present (same legacy id):       ${report.customersPresent}`);
  log(`  Customers identity-linked (different id): ${report.customersIdentityLinked.length}`);
  log(`  Customers missing:                        ${report.customersMissing.length}`);
  log(`  Customer legacyId collisions:             ${report.customersCollisions.length}`);
  log(`  Work orders parsed:                       ${workOrdersParsed}`);
  log(`  Work orders present (same legacy id):     ${report.wosPresent}`);
  log(`  Work orders missing:                      ${report.wosMissing.length}`);
  log(`  Work orders skipped (same job):           ${report.wosFuzzy}`);
  log(`  Work order orphans:                       ${report.wosOrphan.length}`);
  log("");
  printSpotlight(report);
  log("");
  printAuditList(
    "Customers missing",
    report.customersMissing.map(
      (r) =>
        `mysql=${r.sqlId} "${r.sqlName}" phone=${r.phone || "(none)"} email=${r.email || "(none)"}`,
    ),
  );
  log("");
  printAuditList(
    "Customers identity-linked",
    report.customersIdentityLinked.map(
      (r) =>
        `mysql=${r.sqlId} "${r.sqlName}" -> mongo ${r.mongoLegacyId} "${r.mongoName}" (${r.reason}) phone=${r.phone || "(none)"} email=${r.email || "(none)"}`,
    ),
  );
  log("");
  printAuditList(
    "Customer collisions",
    report.customersCollisions.map(
      (r) =>
        `mysql=${r.sqlId} "${r.sqlName}" occupied by "${r.occupiedBy}" (legacyId=${r.occupiedLegacyId}); would assign ${r.assignedId}`,
    ),
  );
  log("");
  printAuditList(
    "Work orders missing",
    report.wosMissing.map(
      (r) =>
        `WO ${r.woId} customer_id=${r.customerId} "${r.customerName}" date=${r.date || "(none)"}`,
    ),
  );
  log("");
  printAuditList(
    "Work order orphans",
    report.wosOrphan.map((r) => `WO ${r.woId} customer_id=${r.customerId}`),
  );
}

async function main(): Promise<void> {
  const started = Date.now();
  const target = USE_PRODUCTION ? "production" : "development";
  const mongoUri = resolveLegacyDumpUri(target);
  if (!mongoUri) {
    console.error(
      `[sync-current-dump] ${
        USE_PRODUCTION
          ? "MONGODB_URI_PRODUCTION is not set"
          : "MONGODB_URI_DEVELOPMENT / MONGODB_URI is not set"
      }`,
    );
    process.exit(1);
  }

  const targetLabel = describeMongoTarget(mongoUri);
  const mode = AUDIT || DRY_RUN ? "audit" : "import";
  if (AUDIT) {
    log(`AUDIT — read-only against ${target} (${targetLabel})`);
  } else if (DRY_RUN) {
    log(`DRY RUN — no writes (${target} ${targetLabel})`);
  } else if (USE_PRODUCTION) {
    log(`LIVE PRODUCTION IMPORT — writing to ${targetLabel}`);
  } else {
    log(`Live import — writing to development (${targetLabel})`);
  }

  const customersPath = process.argv.includes("--customers")
    ? path.resolve(process.argv[process.argv.indexOf("--customers") + 1] ?? CUSTOMERS_DUMP)
    : CUSTOMERS_DUMP;
  const workOrdersPath = process.argv.includes("--work-orders")
    ? path.resolve(process.argv[process.argv.indexOf("--work-orders") + 1] ?? WORK_ORDERS_DUMP)
    : WORK_ORDERS_DUMP;

  const customerSql = fs.existsSync(customersPath)
    ? fs.readFileSync(customersPath, "utf-8")
    : undefined;
  const workOrderSql = fs.existsSync(workOrdersPath)
    ? fs.readFileSync(workOrdersPath, "utf-8")
    : undefined;
  if (!customerSql && !workOrderSql) {
    console.error("[sync-current-dump] No dump files found.");
    process.exit(1);
  }
  if (customerSql) log(`Reading ${customersPath}`);
  if (workOrderSql) log(`Reading ${workOrdersPath}`);

  const result = await runLegacyDumpSync({
    customerSql,
    workOrderSql,
    mongoUri,
    mode,
    target,
    verbose: true,
  });

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  if (AUDIT) {
    printAuditReport(result.audit, result.customersParsed, result.workOrdersParsed);
  } else {
    log(DRY_RUN ? "Dry-run summary" : "Import summary");
    log(`  Customers parsed:              ${result.summary.customersParsed}`);
    log(`  Customers inserted:            ${result.summary.customersInserted}`);
    log(`  Primary contacts created:      ${result.summary.contactsCreated}`);
    log(`  Customers skipped (legacy id): ${result.summary.customersSkippedLegacy}`);
    log(`  Customers skipped (identity):  ${result.summary.customersSkippedIdentity}`);
    log(`  Customer legacyId collisions:  ${result.summary.customerCollisions}`);
    log(`  Work orders parsed:            ${result.summary.workOrdersParsed}`);
    log(`  Work orders inserted:          ${result.summary.workOrdersInserted}`);
    log(`  Work orders skipped (legacy):  ${result.summary.workOrdersSkippedLegacy}`);
    log(`  Work orders skipped (same job):${result.summary.workOrdersSkippedFuzzy}`);
    log(`  Work order orphans:            ${result.summary.workOrderOrphans}`);
    log(`  Work order line items mapped:  ${result.summary.workOrdersLineItemsBackfilled}`);
  }
  log(`  Finished in ${elapsedSec}s`);
}

main().catch((err) => {
  console.error("[sync-current-dump] Fatal:", err);
  process.exit(1);
});
