/**
 * Ordered list of database migrations applied to production on deploy.
 *
 * The runner (run.ts) executes each entry that is not yet recorded in the
 * `migrations` ledger collection, in the order listed here, then records it.
 *
 * Only prod-safe, idempotent, DB-to-DB migrations belong here. Do NOT add:
 *   - copy-dev-to-prod.ts  (destructive, one-time, manual only)
 *   - migrate-customers.ts / migrate-work-orders.ts (need local SQL dumps)
 *   - migrate-customer-sites.ts (reads legacy database_dump/work_orders.sql,
 *     not present on Render; part of the one-time local import)
 *   - inspect / verify diagnostics
 *   - seed-admin / set-super-admin (sensitive one-time admin setup)
 *
 * `file` is the script name (without extension) under dist/scripts/. The runner
 * spawns `node dist/scripts/<file>.js`, so scripts must be compiled first
 * (they are, via `npm run build`).
 */
export interface MigrationEntry {
  /** Stable, unique id recorded in the ledger. Never change once shipped. */
  id: string;
  /** Script file name (without .js) under dist/scripts/. */
  file: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  // Customers → contacts → users chain.
  { id: "2026-07-19-customer-contacts", file: "migrate-customer-contacts" },
  { id: "2026-07-19-provision-contact-users", file: "provision-contact-users" },

  // Contracts (must stay in this order).
  {
    id: "2026-07-19-contracts-collection",
    file: "migrate-contracts-collection",
  },
  { id: "2026-07-19-contract-dates", file: "migrate-contract-dates" },
];
