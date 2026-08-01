/** All 67 Florida county names (no "County" suffix). */
export const FLORIDA_COUNTIES = [
  "Alachua",
  "Baker",
  "Bay",
  "Bradford",
  "Brevard",
  "Broward",
  "Calhoun",
  "Charlotte",
  "Citrus",
  "Clay",
  "Collier",
  "Columbia",
  "DeSoto",
  "Dixie",
  "Duval",
  "Escambia",
  "Flagler",
  "Franklin",
  "Gadsden",
  "Gilchrist",
  "Glades",
  "Gulf",
  "Hamilton",
  "Hardee",
  "Hendry",
  "Hernando",
  "Highlands",
  "Hillsborough",
  "Holmes",
  "Indian River",
  "Jackson",
  "Jefferson",
  "Lafayette",
  "Lake",
  "Lee",
  "Leon",
  "Levy",
  "Liberty",
  "Madison",
  "Manatee",
  "Marion",
  "Martin",
  "Miami-Dade",
  "Monroe",
  "Nassau",
  "Okaloosa",
  "Okeechobee",
  "Orange",
  "Osceola",
  "Palm Beach",
  "Pasco",
  "Pinellas",
  "Polk",
  "Putnam",
  "Santa Rosa",
  "Sarasota",
  "Seminole",
  "St. Johns",
  "St. Lucie",
  "Sumter",
  "Suwannee",
  "Taylor",
  "Union",
  "Volusia",
  "Wakulla",
  "Walton",
  "Washington",
] as const;

export type FloridaCounty = (typeof FLORIDA_COUNTIES)[number];

const FLORIDA_COUNTY_SET = new Set<string>(
  FLORIDA_COUNTIES.map((c) => c.toLowerCase())
);

/** Map lowercase / common variants → canonical FL county name. */
const COUNTY_ALIASES: Record<string, FloridaCounty> = {
  desoto: "DeSoto",
  "de soto": "DeSoto",
  "miami dade": "Miami-Dade",
  "miami-dade": "Miami-Dade",
  dade: "Miami-Dade",
  "st johns": "St. Johns",
  "st. johns": "St. Johns",
  "saint johns": "St. Johns",
  "st lucie": "St. Lucie",
  "st. lucie": "St. Lucie",
  "saint lucie": "St. Lucie",
  "indian river": "Indian River",
  "palm beach": "Palm Beach",
  "santa rosa": "Santa Rosa",
};

export function isFloridaCounty(name: string): boolean {
  const normalized = normalizeCountyName(name);
  return normalized != null && FLORIDA_COUNTY_SET.has(normalized.toLowerCase());
}

/**
 * Strip "County" suffix and normalize to a canonical FL name when possible.
 * Returns the cleaned display name even for non-FL counties.
 */
export function normalizeCountyName(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/\s+County$/i, "").trim();
  const key = s.toLowerCase().replace(/\s+/g, " ");
  if (COUNTY_ALIASES[key]) return COUNTY_ALIASES[key];
  const match = FLORIDA_COUNTIES.find((c) => c.toLowerCase() === key);
  if (match) return match;
  // Title-case fallback for unknown counties
  return s
    .split(/\s+/)
    .map((w) =>
      w.includes("-")
        ? w
            .split("-")
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
            .join("-")
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(" ");
}
