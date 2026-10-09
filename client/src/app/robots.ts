import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL } from "@/lib/seo/site";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/admin/", "/dashboard/"],
    },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
