/**
 * ONE-TIME data copy: clones every collection from the DEVELOPMENT MongoDB
 * database into the PRODUCTION MongoDB database.
 *
 * Reads MONGODB_URI_DEVELOPMENT (source) and MONGODB_URI_PRODUCTION (target)
 * from the repo-root .env. The `grac-crm` database name is appended to each
 * URI using the same logic as src/config/env.ts.
 *
 * Because this writes to production, it runs in DRY-RUN mode by default and
 * only reports what it would do. Pass --yes to perform the copy.
 *
 *   Dry run (safe, shows plan):
 *     npx tsx src/scripts/copy-dev-to-prod.ts
 *
 *   Execute the copy (append missing docs, keep existing prod data):
 *     npx tsx src/scripts/copy-dev-to-prod.ts --yes
 *
 *   Execute and DROP each prod collection first (exact mirror of dev):
 *     npx tsx src/scripts/copy-dev-to-prod.ts --yes --drop
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { MongoClient, Db } from "mongodb";

const DEFAULT_DB = "grac-crm";
const BATCH_SIZE = 500;

/** Mirrors resolveMongoUri() in src/config/env.ts so the db name matches. */
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

/** Copies all documents of one collection from source db to target db. */
async function copyCollection(
  name: string,
  sourceDb: Db,
  targetDb: Db,
  { execute, drop }: { execute: boolean; drop: boolean }
): Promise<{ name: string; copied: number; source: number }> {
  const sourceCount = await sourceDb.collection(name).countDocuments();

  if (!execute) {
    return { name, copied: 0, source: sourceCount };
  }

  if (drop) {
    const exists = await targetDb
      .listCollections({ name })
      .hasNext();
    if (exists) {
      await targetDb.collection(name).drop();
    }
  }

  const target = targetDb.collection(name);
  const cursor = sourceDb.collection(name).find({});
  let batch: unknown[] = [];
  let copied = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await target.insertMany(batch as never[], { ordered: false });
    copied += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  return { name, copied, source: sourceCount };
}

async function main() {
  const execute = process.argv.includes("--yes");
  const drop = process.argv.includes("--drop");

  const devRaw = process.env.MONGODB_URI_DEVELOPMENT;
  const prodRaw = process.env.MONGODB_URI_PRODUCTION;

  if (!devRaw) throw new Error("MONGODB_URI_DEVELOPMENT is not set in .env");
  if (!prodRaw) throw new Error("MONGODB_URI_PRODUCTION is not set in .env");

  const devUri = withDbName(devRaw);
  const prodUri = withDbName(prodRaw);

  if (devUri === prodUri) {
    throw new Error("Source and target URIs are identical — aborting.");
  }

  const sourceClient = new MongoClient(devUri, {
    serverSelectionTimeoutMS: 15000,
  });
  const targetClient = new MongoClient(prodUri, {
    serverSelectionTimeoutMS: 15000,
  });

  await sourceClient.connect();
  await targetClient.connect();

  const sourceDb = sourceClient.db(DEFAULT_DB);
  const targetDb = targetClient.db(DEFAULT_DB);

  console.log(`Source (dev):  ${sourceDb.databaseName} @ ${new URL(devUri.replace("mongodb+srv", "https")).host}`);
  console.log(`Target (prod): ${targetDb.databaseName} @ ${new URL(prodUri.replace("mongodb+srv", "https")).host}`);
  console.log(
    execute
      ? drop
        ? "\nMODE: EXECUTE + DROP (prod collections will be dropped then refilled)\n"
        : "\nMODE: EXECUTE (append; existing prod docs are kept)\n"
      : "\nMODE: DRY RUN (no writes). Re-run with --yes to copy.\n"
  );

  const collections = await sourceDb
    .listCollections({}, { nameOnly: true })
    .toArray();
  const names = collections
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .sort();

  const results: { name: string; copied: number; source: number }[] = [];
  for (const name of names) {
    const res = await copyCollection(name, sourceDb, targetDb, {
      execute,
      drop,
    });
    results.push(res);
    console.log(
      execute
        ? `  ${name}: copied ${res.copied}/${res.source}`
        : `  ${name}: ${res.source} docs in dev`
    );
  }

  const totalSource = results.reduce((s, r) => s + r.source, 0);
  const totalCopied = results.reduce((s, r) => s + r.copied, 0);
  console.log(
    execute
      ? `\nDone. Copied ${totalCopied} documents across ${results.length} collections.`
      : `\nDry run complete. ${totalSource} documents across ${results.length} collections would be copied. Re-run with --yes to execute.`
  );

  await sourceClient.close();
  await targetClient.close();
}

main().catch((err) => {
  console.error("Copy failed:", err);
  process.exit(1);
});
