import type { NextConfig } from "next";
import path from "path";

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
};

export default nextConfig;
