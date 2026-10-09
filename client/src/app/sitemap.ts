import type { MetadataRoute } from "next";
import { CITY_PAGES } from "@/lib/seo/catalog";
import { SERVICE_PAGES } from "@/lib/seo/services";
import { absoluteUrl } from "@/lib/seo/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    ...SERVICE_PAGES.map((service) => service.path),
    "/estimate",
    ...CITY_PAGES.map((city) => city.path),
    "/contact",
  ];

  return paths.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path.startsWith("/service-areas/") ? 0.8 : 0.7,
  }));
}
