import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import path from "path";

const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009"
).replace(/\/$/, "");

/**
 * Local `next dev` only. Static export cannot apply rewrites, and defining
 * them beside `output: "export"` makes `next build` warn and then ignore them.
 * Production serves `out/` with scripts/serve-static.mjs, which proxies
 * `/p/:code` and `/images/<slug>`. The slug pattern excludes dots so static
 * files like `*.jpg` are not proxied.
 */
const devRewrites: NextConfig["rewrites"] = async () => ({
  beforeFiles: [
    {
      source: "/p/:code",
      destination: `${apiUrl}/checkout/code/:code/redirect`,
    },
    {
      source: "/p/:code/",
      destination: `${apiUrl}/checkout/code/:code/redirect`,
    },
  ],
  afterFiles: [
    {
      source: "/images/:slug([a-zA-Z0-9-]+)",
      destination: `${apiUrl}/public-assets/:slug`,
    },
    {
      source: "/images/:slug([a-zA-Z0-9-]+)/",
      destination: `${apiUrl}/public-assets/:slug`,
    },
  ],
});

export default function nextConfig(phase: string): NextConfig {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    // Pin the workspace root to this `client` directory so Turbopack doesn't
    // infer the monorepo parent (multiple lockfiles) as the root.
    turbopack: {
      root: path.resolve(__dirname),
    },
    // Produce a fully static export (`out/`) so the app can be hosted on a
    // static site service (e.g. Render Static Site). Omit this in dev so the
    // rewrites below actually run.
    ...(isDev ? { rewrites: devRewrites } : { output: "export" as const }),
    // Emit `route/index.html` files so static hosts resolve nested paths on refresh.
    trailingSlash: true,
    images: {
      // The static export target has no Next.js image optimization server.
      unoptimized: true,
    },
  };
}
