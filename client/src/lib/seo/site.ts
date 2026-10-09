import type { Metadata } from "next";
import { COMPANY } from "@/lib/constants";

/** Public canonical origin. Crawl files and metadata always use this host. */
export const PUBLIC_SITE_URL = "https://www.genmaintoffl.com";

export const ROOT_TITLE = "Generator Service in Central & South Florida";

export const TITLE_TEMPLATE = "%s | Generator Maintenance of Florida";

export const ROOT_DESCRIPTION =
  "Generac installation, maintenance, and 24/7 repair across Central and South Florida. Call (386) 631-8982.";

export const OG_IMAGE = {
  url: "/images/generac-product-lineup.jpg",
  width: 1024,
  height: 340,
  type: "image/jpeg",
  alt: "Generac home standby and portable generators",
} as const;

export function absoluteUrl(path: string): string {
  if (path === "/" || path === "") return `${PUBLIC_SITE_URL}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const isFile = /\.[a-z0-9]+$/i.test(normalized);
  if (isFile) return `${PUBLIC_SITE_URL}${normalized}`;
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return `${PUBLIC_SITE_URL}${withSlash}`;
}

export function brandedTitle(segment: string): string {
  return TITLE_TEMPLATE.replace("%s", segment);
}

export function pageMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const socialTitle = brandedTitle(input.title);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      type: "website",
      title: socialTitle,
      description: input.description,
      url: input.path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: input.description,
      images: [OG_IMAGE],
    },
  };
}

export function citySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cityPath(slug: string): string {
  return `/service-areas/${slug}`;
}

export const BUSINESS_ID = `${PUBLIC_SITE_URL}/#business`;

/**
 * HomeAndConstructionBusiness is the closer public type. HVACBusiness is for
 * heating and air conditioning shops. This company installs and services
 * standby generators (electrical, fuel, and pad work), and no street address
 * is published, so the postal address is region and country only.
 */
export function localBusinessJsonLd(areaServed: {
  name: string;
  type: "State" | "City";
}) {
  return {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    "@id": BUSINESS_ID,
    name: COMPANY.name,
    url: `${PUBLIC_SITE_URL}/`,
    telephone: "+13866318982",
    email: COMPANY.email,
    image: absoluteUrl(OG_IMAGE.url),
    description: ROOT_DESCRIPTION,
    address: {
      "@type": "PostalAddress",
      addressRegion: "FL",
      addressCountry: "US",
    },
    areaServed: {
      "@type": areaServed.type,
      name: areaServed.name,
      ...(areaServed.type === "City"
        ? {
            containedInPlace: {
              "@type": "State",
              name: "Florida",
            },
          }
        : { addressCountry: "US" }),
    },
  };
}

export function faqPageJsonLd(
  faqs: readonly { question: string; answer: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}
