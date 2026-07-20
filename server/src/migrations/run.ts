/**
 * Database migration runner.
 *
 * Applies every migration in manifest.ts that is not yet recorded in the
 * `migrations` ledger collection, in order, then records each one. Already
 * applied migrations are skipped, so this is safe to run on every deploy.
 *
 * Runs compiled JavaScript (no tsx needed in production). Build first:
 *   npm run build && npm run migrate
 *
 * The target database is chosen by NODE_ENV via src/config/env.ts:
 *   NODE_ENV=production -> MONGODB_URI_PRODUCTION
 *   otherwise           -> MONGODB_URI_DEVELOPMENT
 *
 * Exit code is non-zero if any migration fails, which aborts a Render deploy.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { spawn } from "child_process";
import {
  connectMongoDB,
  disconnectMongoDB,
  getMongoStatus,
} from "../config/mongodb";
import { Migration } from "../models/mongo/Migration";
import { MIGRATIONS, MigrationEntry } from "./manifest";

function log(msg: string): void {
  console.log(`[migrate] ${msg}`);
}

/** Runs a compiled migration script as a child process, inheriting stdio/env. */
function runScript(file: string): Promise<void> {
  const scriptPath = path.resolve(__dirname, "../scripts", `${file}.js`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const env =
    process.env.NODE_ENV === "production" ? "PRODUCTION" : "development";
  log(`Target environment: ${env}`);
  log("Connecting to MongoDB…");
  await connectMongoDB();

  if (getMongoStatus() !== "connected") {
    console.error(
      "[migrate] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }

  const appliedDocs = await Migration.find().select("migrationId").lean();
  const applied = new Set(appliedDocs.map((d) => d.migrationId));

  const pending: MigrationEntry[] = MIGRATIONS.filter(
    (m) => !applied.has(m.id),
  );

  if (pending.length === 0) {
    log(`All ${MIGRATIONS.length} migrations already applied. Nothing to do.`);
    await disconnectMongoDB();
    return;
  }

  log(`${applied.size} applied, ${pending.length} pending.`);

  for (const migration of pending) {
    log(`Running: ${migration.id} (${migration.file})…`);
    const started = Date.now();
    try {
      await runScript(migration.file);
    } catch (err) {
      console.error(`[migrate] FAILED: ${migration.id}`, err);
      await disconnectMongoDB();
      process.exit(1);
    }
    const durationMs = Date.now() - started;
    await Migration.create({
      migrationId: migration.id,
      appliedAt: new Date(),
      durationMs,
    });
    log(`Applied: ${migration.id} in ${(durationMs / 1000).toFixed(1)}s`);
  }

  log(`Done. Applied ${pending.length} migration(s).`);
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error("[migrate] Fatal:", err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
