/**
 * Clones every collection from the PRODUCTION MongoDB database into the
 * DEVELOPMENT MongoDB database (exact mirror when --drop is passed).
 *
 * Reads MONGODB_URI_PRODUCTION (source) and MONGODB_URI_DEVELOPMENT (target)
 * from server/.env (repo-root .env is a fallback). The `grac-crm` database
 * name is appended using the same logic as src/config/env.ts.
 *
 * Copies every collection, including messaging traffic
 * (`twiliocommunications`, `messagethreads`), and mirrors each
 * collection's indexes onto development.
 *
 * Dry-run by default. Pass --yes to write. Pass --drop to replace each
 * development collection (true clone). The positional argument `p2d`
 * means --yes --drop (prod into dev).
 *
 *   npm run clone p2d
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

import {
  MongoClient,
  Db,
  Collection,
  type CreateIndexesOptions,
  type IndexSpecification,
} from "mongodb";

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

async function copyIndexes(
  name: string,
  sourceDb: Db,
  target: Collection,
): Promise<void> {
  const indexes = await sourceDb.collection(name).indexes();
  for (const index of indexes) {
    if (!index.name || index.name === "_id_") continue;

    const options: CreateIndexesOptions = { name: index.name };
    if (index.unique) options.unique = true;
    if (index.sparse) options.sparse = true;
    if (typeof index.expireAfterSeconds === "number") {
      options.expireAfterSeconds = index.expireAfterSeconds;
    }
    if (index.partialFilterExpression) {
      options.partialFilterExpression = index.partialFilterExpression;
    }

    try {
      await target.createIndex(index.key as IndexSpecification, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `  ${name}: warning, index ${index.name} was not copied (${message})`,
      );
    }
  }
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
  await copyIndexes(name, sourceDb, target);

  return { name, copied, source: sourceCount };
}

const USAGE = "Usage: npm run clone p2d";

function directionArgs(): { execute: boolean; drop: boolean } {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const unknown = positional.filter((arg) => arg !== "p2d");
  if (unknown.length > 0) {
    console.error(USAGE);
    process.exit(1);
  }

  const p2d = positional.includes("p2d");
  if (!p2d && !process.argv.includes("--yes") && !process.argv.includes("--drop")) {
    console.log(USAGE);
  }

  return {
    execute: process.argv.includes("--yes") || p2d,
    drop: process.argv.includes("--drop") || p2d,
  };
}

async function main() {
  const { execute, drop } = directionArgs();

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
