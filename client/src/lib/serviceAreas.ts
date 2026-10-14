import { API_URL } from "@/lib/api";
import { FAQS, SERVICE_AREAS } from "@/lib/constants";

export type PublicServiceArea = {
  id: string;
  name: string;
  cities: { name: string }[];
};

export const FALLBACK_REGION_PHRASE = "Central Florida";

export const FALLBACK_SERVICE_AREAS: PublicServiceArea[] = [
  {
    id: "central-florida",
    name: FALLBACK_REGION_PHRASE,
    cities: SERVICE_AREAS.central.map((name) => ({ name })),
  },
];

export function formatRegionPhrase(names: readonly string[]): string {
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (cleaned.length === 0) return FALLBACK_REGION_PHRASE;
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

export function landingFaqs(phrase: string) {
  return FAQS.map((faq) => {
    if (faq.question.startsWith("What areas")) {
      return {
        ...faq,
        answer: `We provide home and commercial standby generator installation, maintenance, and repair throughout ${phrase} — from Orlando and Tampa to Daytona Beach and Ocala.`,
      };
    }
    if (faq.question.startsWith("Why should I choose")) {
      return {
        ...faq,
        answer: `We are a licensed and insured, Generac authorized dealer with experienced technicians who handle the full process — permits, electrical work, plumbing, installation, and final startup — plus preventative maintenance and wireless monitoring across ${phrase}.`,
      };
    }
    return faq;
  });
}

/** Public list for the marketing site. Falls back to Central Florida if the API is down. */
export async function getPublicServiceAreas(): Promise<PublicServiceArea[]> {
  try {
    const res = await fetch(`${API_URL}/service-areas`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return FALLBACK_SERVICE_AREAS;
    const body = (await res.json()) as { areas?: PublicServiceArea[] };
    if (!Array.isArray(body.areas)) return FALLBACK_SERVICE_AREAS;
    return body.areas.filter(
      (area) => area && typeof area.name === "string" && Array.isArray(area.cities),
    );
  } catch {
    return FALLBACK_SERVICE_AREAS;
  }
}
