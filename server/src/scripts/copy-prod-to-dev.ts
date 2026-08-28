/**
 * Clones every collection from the PRODUCTION MongoDB database into the
 * DEVELOPMENT MongoDB database (exact mirror when --drop is passed).
 *
 * Reads MONGODB_URI_PRODUCTION (source) and MONGODB_URI_DEVELOPMENT (target)
 * from server/.env (repo-root .env is a fallback). The `grac-crm` database
 * name is appended using the same logic as src/config/env.ts.
 *
 * Skips `twiliocommunications` and `messagethreads` so live SMS/call
 * traffic is not copied into development.
 *
 * Dry-run by default. Pass --yes to write. Pass --drop to replace each
 * development collection (true clone).
 *
 *   npm run copy-prod-to-dev
 *
 *   Dry run (no writes):
 *     npx tsx src/scripts/copy-prod-to-dev.ts
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

import { MongoClient, Db } from "mongodb";

const DEFAULT_DB = "grac-crm";
const BATCH_SIZE = 500;

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

async function copyCollection(
  name: string,
  sourceDb: Db,
  targetDb: Db,
  { execute, drop }: { execute: boolean; drop: boolean },
): Promise<{ name: string; copied: number; source: number }> {
  const sourceCount = await sourceDb.collection(name).countDocuments();

  if (!execute) {
    return { name, copied: 0, source: sourceCount };
  }

  if (drop) {
    const exists = await targetDb.listCollections({ name }).hasNext();
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

  const sourceClient = new MongoClient(prodUri, {
    serverSelectionTimeoutMS: 15000,
  });
  const targetClient = new MongoClient(devUri, {
    serverSelectionTimeoutMS: 15000,
  });

  await sourceClient.connect();
  await targetClient.connect();

  const sourceDb = sourceClient.db(DEFAULT_DB);
  const targetDb = targetClient.db(DEFAULT_DB);

  console.log(
    `Source (prod): ${sourceDb.databaseName} @ ${hostOf(prodUri)}`,
  );
  console.log(`Target (dev):  ${targetDb.databaseName} @ ${hostOf(devUri)}`);
  console.log(
    execute
      ? drop
        ? "\nMODE: EXECUTE + DROP (dev collections will be dropped then refilled)\n"
        : "\nMODE: EXECUTE (append; existing dev docs are kept)\n"
      : "\nMODE: DRY RUN (no writes). Re-run with --yes --drop to clone.\n",
  );

  const skipCollections = new Set(["twiliocommunications", "messagethreads"]);

  const collections = await sourceDb
    .listCollections({}, { nameOnly: true })
    .toArray();
  const names = collections
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .sort();

  const results: { name: string; copied: number; source: number }[] = [];
  for (const name of names) {
    if (skipCollections.has(name.toLowerCase())) {
      console.log(`  ${name}: skipped (do not copy messaging traffic into dev)`);
      continue;
    }
    const res = await copyCollection(name, sourceDb, targetDb, {
      execute,
      drop,
    });
    results.push(res);
    console.log(
      execute
        ? `  ${name}: copied ${res.copied}/${res.source}`
        : `  ${name}: ${res.source} docs in prod`,
    );
  }

  const totalSource = results.reduce((s, r) => s + r.source, 0);
  const totalCopied = results.reduce((s, r) => s + r.copied, 0);
  console.log(
    execute
      ? `\nDone. Copied ${totalCopied} documents across ${results.length} collections.`
      : `\nDry run complete. ${totalSource} documents across ${results.length} collections would be copied. Re-run with --yes --drop to execute.`,
  );

  await sourceClient.close();
  await targetClient.close();
}

main().catch((err) => {
  console.error("Copy failed:", err);
  process.exit(1);
});
