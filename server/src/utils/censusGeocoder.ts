/**
 * US Census Bureau single-address geocoder (no API key).
 * https://geocoding.geo.census.gov/geocoder/
 */

const CENSUS_ADDRESS_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/address";
const BENCHMARK = "Public_AR_Current";

export type AddressInput = {
  street: string;
  city?: string;
  state?: string;
  zip?: string;
};

export type NormalizedAddress = {
  address: string;
  city: string;
  state: string;
  zip: string;
};

export type GeocodeMatch = {
  matchedAddress: string;
  normalized: NormalizedAddress;
  coordinates: { lng: number; lat: number } | null;
};

export type GeocodeResult =
  | { ok: true; match: GeocodeMatch }
  | { ok: false; reason: "incomplete" | "no_match" | "upstream_error"; message: string };

type CensusAddressComponents = {
  zip?: string;
  city?: string;
  state?: string;
  streetName?: string;
  preType?: string;
  preDirection?: string;
  suffixDirection?: string;
  suffixType?: string;
  fromAddress?: string;
};

type CensusMatch = {
  matchedAddress?: string;
  coordinates?: { x?: number; y?: number };
  addressComponents?: CensusAddressComponents;
};

type CensusResponse = {
  result?: {
    addressMatches?: CensusMatch[];
  };
};

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** "410 MICHIGAN AVE W, LAKE HELEN, FL, 32744" → parts */
function parseMatchedAddress(matched: string): NormalizedAddress | null {
  const parts = matched
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;

  const zipPart = parts[parts.length - 1] ?? "";
  const statePart = parts[parts.length - 2] ?? "";
  const cityPart = parts[parts.length - 3] ?? "";
  const streetPart = parts.slice(0, parts.length - 3).join(", ");

  const zipMatch = zipPart.match(/\b(\d{5})(?:-\d{4})?\b/);
  const state = statePart.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  if (!streetPart || !cityPart || !state || !zipMatch) return null;

  return {
    address: toTitleCase(streetPart),
    city: toTitleCase(cityPart),
    state,
    zip: zipMatch[1],
  };
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d/.test(word)) return word.toUpperCase();
      // Keep common short tokens uppercase (N, S, E, W, NE, NW, SE, SW)
      if (/^(n|s|e|w|ne|nw|se|sw)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function buildStreetFromComponents(
  matchedAddress: string,
  components?: CensusAddressComponents,
): string {
  const parsed = parseMatchedAddress(matchedAddress);
  if (parsed?.address) return parsed.address;

  if (!components) return "";
  const number = (components.fromAddress ?? "").trim();
  const bits = [
    components.preDirection,
    components.preType,
    components.streetName,
    components.suffixType,
    components.suffixDirection,
  ]
    .map((b) => (b ?? "").trim())
    .filter(Boolean);
  const street = [number, ...bits].join(" ").trim();
  return street ? toTitleCase(street) : "";
}

export async function geocodeAddress(
  input: AddressInput,
): Promise<GeocodeResult> {
  const street = trim(input.street);
  const city = trim(input.city);
  const state = trim(input.state);
  const zip = trim(input.zip);

  if (!street) {
    return {
      ok: false,
      reason: "incomplete",
      message: "Street address is required to validate.",
    };
  }

  const hasCityState = Boolean(city && state);
  const hasZip = Boolean(zip);
  if (!hasCityState && !hasZip) {
    return {
      ok: false,
      reason: "incomplete",
      message: "Provide city and state, or a ZIP code, with the street.",
    };
  }

  const params = new URLSearchParams({
    street,
    benchmark: BENCHMARK,
    format: "json",
  });
  if (city) params.set("city", city);
  if (state) params.set("state", state);
  if (zip) params.set("zip", zip);

  let data: CensusResponse;
  try {
    const res = await fetch(`${CENSUS_ADDRESS_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "upstream_error",
        message: "Address validation service is unavailable. Try again.",
      };
    }
    data = (await res.json()) as CensusResponse;
  } catch {
    return {
      ok: false,
      reason: "upstream_error",
      message: "Address validation service is unavailable. Try again.",
    };
  }

  const match = data.result?.addressMatches?.[0];
  if (!match?.matchedAddress) {
    return {
      ok: false,
      reason: "no_match",
      message:
        "No matching US address found. Check the street, city, state, and ZIP.",
    };
  }

  const parsed = parseMatchedAddress(match.matchedAddress);
  const normalized: NormalizedAddress = parsed ?? {
    address: buildStreetFromComponents(match.matchedAddress, match.addressComponents),
    city: toTitleCase(match.addressComponents?.city ?? city),
    state: (match.addressComponents?.state ?? state).toUpperCase().slice(0, 2),
    zip: match.addressComponents?.zip ?? zip.replace(/\D/g, "").slice(0, 5),
  };

  if (!normalized.address || !normalized.city || !normalized.state) {
    return {
      ok: false,
      reason: "no_match",
      message:
        "No matching US address found. Check the street, city, state, and ZIP.",
    };
  }

  const lng = match.coordinates?.x;
  const lat = match.coordinates?.y;

  return {
    ok: true,
    match: {
      matchedAddress: match.matchedAddress,
      normalized,
      coordinates:
        typeof lng === "number" && typeof lat === "number"
          ? { lng, lat }
          : null,
    },
  };
}
