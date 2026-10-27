import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(rootDir, "out");

/**
 * Content-hashed Next chunks only. The random `out/_next/static/<buildId>/`
 * directory is excluded so a rebuild with identical source does not look like
 * a new frontend deploy.
 */
const HASHED_DIRS = ["chunks", "media"].map((name) =>
  path.join(outDir, "_next", "static", name),
);

function listFiles(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, acc);
    else if (entry.isFile()) acc.push(path.relative(outDir, full));
  }
}

if (!fs.existsSync(outDir)) {
  console.log("write-version: out/ is missing, skipping");
  process.exit(0);
}

const files = [];
for (const dir of HASHED_DIRS) listFiles(dir, files);
files.sort();

const version = createHash("sha256")
  .update(files.join("\n"))
  .digest("hex")
  .slice(0, 16);

const payload = {
  version,
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(outDir, "version.json"),
  `${JSON.stringify(payload, null, 2)}\n`,
);

console.log(`write-version: ${version} (${files.length} files)`);
