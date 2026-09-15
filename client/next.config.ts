import type { NextConfig } from "next";
import path from "path";

const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4009"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Pin the workspace root to this `client` directory so Turbopack doesn't
  // infer the monorepo parent (multiple lockfiles) as the root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Produce a fully static export (`out/`) so the app can be hosted on a
  // static site service (e.g. Render Static Site).
  output: "export",
  // Emit `route/index.html` files so static hosts resolve nested paths on refresh.
  trailingSlash: true,
  images: {
    // The static export target has no Next.js image optimization server.
    unoptimized: true,
  },
  // Local `next dev` only — static export cannot apply these at serve time.
  // Production uses `/images/:slug` rewrites in render.yaml to the API proxy.
  // Slug pattern excludes dots so static files like *.jpg are not proxied.
  async rewrites() {
    return [
      {
        source: "/images/:slug([a-zA-Z0-9-]+)",
        destination: `${apiUrl}/public-assets/:slug`,
      },
      {
        source: "/images/:slug([a-zA-Z0-9-]+)/",
        destination: `${apiUrl}/public-assets/:slug`,
      },
    ];
  },
};

export default nextConfig;
