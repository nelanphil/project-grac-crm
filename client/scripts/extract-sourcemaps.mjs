import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(rootDir, "out");
const mapsDir = path.resolve(rootDir, ".sourcemaps");

/** Max JSON bytes per upload request; the API accepts up to 60MB. */
const BATCH_BYTES = 20 * 1024 * 1024;
const MAPPING_COMMENT = /\n?\/\/[#@] sourceMappingURL=[^\n]*\s*$/;

function listMaps(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMaps(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".map")) acc.push(full);
  }
}

function stripMappingComment(file) {
  if (!fs.existsSync(file)) return;
  const source = fs.readFileSync(file, "utf8");
  const stripped = source.replace(MAPPING_COMMENT, "\n");
  if (stripped !== source) fs.writeFileSync(file, stripped);
}

async function upload(maps) {
  const url = process.env.SOURCEMAP_UPLOAD_URL;
  const token = process.env.SOURCEMAP_UPLOAD_TOKEN;
  if (!url || !token) {
    console.log(
      "extract-sourcemaps: SOURCEMAP_UPLOAD_URL/SOURCEMAP_UPLOAD_TOKEN not set, skipping upload",
    );
    return;
  }

  const batches = [];
  let batch = [];
  let size = 0;
  for (const item of maps) {
    const itemSize = item.content.length + item.file.length + 32;
    if (batch.length > 0 && (size + itemSize > BATCH_BYTES || batch.length >= 50)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(item);
    size += itemSize;
  }
  if (batch.length > 0) batches.push(batch);

  let stored = 0;
  for (const [index, items] of batches.entries()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ maps: items }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(
          `extract-sourcemaps: batch ${index + 1}/${batches.length} failed (${res.status}) ${text.slice(0, 200)}`,
        );
        continue;
      }
      stored += items.length;
    } catch (error) {
      console.warn(
        `extract-sourcemaps: batch ${index + 1}/${batches.length} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  console.log(`extract-sourcemaps: uploaded ${stored}/${maps.length} maps`);
}

if (!fs.existsSync(outDir)) {
  console.log("extract-sourcemaps: out/ is missing, skipping");
  process.exit(0);
}

const found = [];
listMaps(outDir, found);
fs.rmSync(mapsDir, { recursive: true, force: true });

const maps = [];
for (const mapPath of found) {
  const relative = path.relative(outDir, mapPath).split(path.sep).join("/");
  const target = path.join(mapsDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(mapPath, target);
  stripMappingComment(mapPath.slice(0, -".map".length));
  maps.push({
    file: relative.slice(0, -".map".length),
    content: fs.readFileSync(target, "utf8"),
  });
}

console.log(`extract-sourcemaps: moved ${maps.length} maps to .sourcemaps/`);

// A failed upload must never fail the deploy; stacks just stay minified.
await upload(maps).catch((error) => {
  console.warn(`extract-sourcemaps: upload failed: ${error}`);
});
