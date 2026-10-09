import { stateCodeOrFlorida } from "../constants/usStates";
import { getActiveGoogleApiKey } from "./googleAddressValidator";
import { geocodeUsCityCenter } from "./googlePlaces";
import { resolveGeocodedAddress } from "./resolveGeocodedAddress";

export type SiteCoordSource = "street" | "city";

export type SitePoint = {
  lat: number;
  lng: number;
  source: SiteCoordSource;
};

export type SiteGeocodeInput = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: unknown;
  lng?: unknown;
  coordSource?: string | null;
  geocodedStreet?: string | null;
};

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteCoord(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Keep a stored pin when it came from a street match, or when a city pin was
 * already computed for the current street text. A changed street is geocoded again
 * so a real address can replace the city center.
 */
export function shouldKeepStoredSitePoint(site: SiteGeocodeInput): boolean {
  if (finiteCoord(site.lat) == null || finiteCoord(site.lng) == null) return false;
  if (site.coordSource !== "city") return true;
  return trim(site.address) === trim(site.geocodedStreet);
}

/**
 * Street match first. When the street is blank or does not match, geocode
 * "City, ST" (blank state is FL) to the city center.
 */
export async function geocodeSitePoint(
  input: SiteGeocodeInput,
): Promise<SitePoint | null> {
  const street = trim(input.address);
  const city = trim(input.city);
  const state = stateCodeOrFlorida(input.state);
  const zip = trim(input.zip);

  if (street) {
    const result = await resolveGeocodedAddress({ street, city, state, zip });
    const coords = result.ok ? result.match.coordinates : null;
    if (
      coords &&
      typeof coords.lat === "number" &&
      typeof coords.lng === "number"
    ) {
      return { lat: coords.lat, lng: coords.lng, source: "street" };
    }
  }

  if (!city) return null;
  const apiKey = await getActiveGoogleApiKey();
  if (!apiKey) return null;
  const center = await geocodeUsCityCenter({ apiKey, city, state });
  if (!center) return null;
  return { lat: center.lat, lng: center.lng, source: "city" };
}
