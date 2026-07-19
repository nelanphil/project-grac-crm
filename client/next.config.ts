import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
