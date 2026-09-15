import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { publicAssetSlugFromPath } from "./publicImagePath.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(rootDir, "out");
const apiBase = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009"
).replace(/\/$/, "");
const port = Number(process.env.PORT || 3009);

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const resolved = path.resolve(outDir, `.${decoded}`);
  if (resolved !== outDir && !resolved.startsWith(`${outDir}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function sendFile(res, filePath, status = 200) {
  res.writeHead(status, { "Content-Type": contentTypeFor(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

function sendNotFound(res) {
  const notFound = path.join(outDir, "404.html");
  if (fs.existsSync(notFound)) {
    sendFile(res, notFound, 404);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

function serveStatic(urlPath, res) {
  const target = safeFile(urlPath);
  if (!target) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  let filePath = target;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    sendNotFound(res);
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }
  sendNotFound(res);
}

async function proxyPublicImage(slug, req, res) {
  try {
    const upstream = await fetch(`${apiBase}/public-assets/${slug}`, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: { Accept: req.headers.accept || "*/*" },
    });
    const headers = {
      "Content-Type":
        upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control":
        upstream.headers.get("cache-control") ||
        "public, max-age=300, must-revalidate",
      "Cross-Origin-Resource-Policy": "cross-origin",
    };
    const length = upstream.headers.get("content-length");
    if (length) headers["Content-Length"] = length;

    res.writeHead(upstream.status, headers);
    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ message: "Unable to retrieve the image." }));
  }
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const slug = publicAssetSlugFromPath(pathname);
  if (slug) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    void proxyPublicImage(slug, req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  serveStatic(pathname, res);
});

server.listen(port, () => {
  console.log(
    `Serving ${outDir} on ${port}; /images/<slug> -> ${apiBase}/public-assets/<slug>`,
  );
});
