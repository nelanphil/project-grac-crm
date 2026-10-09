import { SERVICE_AREAS } from "@/lib/constants";
import { CITY_COPY, type CityCopy } from "@/lib/seo/cities";
import { SERVICE_PAGES, type ServicePage } from "@/lib/seo/services";
import { brandedTitle, cityPath, citySlug } from "@/lib/seo/site";

export type RegionName = "Central Florida" | "South Florida";

export type CityPage = CityCopy & {
  slug: string;
  name: string;
  region: RegionName;
  path: string;
  title: string;
  h1: string;
};

const REQUIRED_SLUGS = [
  "daytona-beach",
  "orlando",
  "tampa",
  "deltona",
  "new-smyrna-beach",
] as const;

function regionFor(group: "central" | "south"): RegionName {
  return group === "central" ? "Central Florida" : "South Florida";
}

export const CITY_PAGES: readonly CityPage[] = (
  Object.entries(SERVICE_AREAS) as ["central" | "south", readonly string[]][]
).flatMap(([group, names]) =>
  names.map((name) => {
    const slug = citySlug(name);
    const copy = CITY_COPY[slug];
    if (!copy) {
      throw new Error(`Missing local SEO copy for ${name} (${slug})`);
    }
    return {
      ...copy,
      slug,
      name,
      region: regionFor(group),
      path: cityPath(slug),
      title: `${name} Generator Service`,
      h1: `Generac Generator Service in ${name}`,
    };
  }),
);

export function getCity(slug: string): CityPage | undefined {
  return CITY_PAGES.find((city) => city.slug === slug);
}

function fingerprint(text: string, name: string): string {
  return text
    .toLowerCase()
    .replaceAll(name.toLowerCase(), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fail the build if crawl copy drifts into duplicates or over-long snippets. */
export function assertLocalSeo(): void {
  const descriptions = [
    ...SERVICE_PAGES.map((service) => service.description),
    ...CITY_PAGES.map((city) => city.description),
  ];
  for (const description of descriptions) {
    if (description.length > 160) {
      throw new Error(
        `Description is ${description.length} characters: ${description}`,
      );
    }
  }

  const servicePrints = SERVICE_PAGES.map((service) =>
    fingerprint(service.paragraphs.join(" "), service.h1),
  );
  if (new Set(servicePrints).size !== servicePrints.length) {
    throw new Error("Service page copy is duplicated");
  }

  const cityPrints = CITY_PAGES.map((city) =>
    fingerprint(
      [city.lede, ...city.paragraphs, ...city.notes].join(" "),
      city.name,
    ),
  );
  if (new Set(cityPrints).size !== cityPrints.length) {
    throw new Error("City page copy collapses to a duplicate after removing the city name");
  }

  const slugs = new Set(CITY_PAGES.map((city) => city.slug));
  for (const required of REQUIRED_SLUGS) {
    if (!slugs.has(required)) {
      throw new Error(`Missing required city page ${required}`);
    }
  }
  for (const city of CITY_PAGES) {
    for (const nearby of city.nearby) {
      if (!slugs.has(nearby)) {
        throw new Error(`${city.slug} links to unknown city ${nearby}`);
      }
    }
  }

  for (const city of CITY_PAGES) {
    if (brandedTitle(city.title).length > 70) {
      throw new Error(
        `Title is long (${brandedTitle(city.title).length}): ${brandedTitle(city.title)}`,
      );
    }
  }
  for (const service of SERVICE_PAGES) {
    if (brandedTitle(service.title).length > 70) {
      throw new Error(
        `Title is long (${brandedTitle(service.title).length}): ${brandedTitle(service.title)}`,
      );
    }
  }
}

assertLocalSeo();

export function serviceByPath(path: string): ServicePage | undefined {
  return SERVICE_PAGES.find((service) => service.path === path);
}
