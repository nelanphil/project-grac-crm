import type { IUserLoginLocation } from "../models/mongo/User";
import { getActiveGoogleApiKey } from "./googleAddressValidator";

const LOOKUP_TIMEOUT_MS = 1500;
const REVERSE_GEOCODE_TIMEOUT_MS = 3000;
const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

type GoogleGeocodeComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{ address_components?: GoogleGeocodeComponent[] }>;
};

type IpWhoResponse = {
  success?: boolean;
  city?: string;
  region?: string;
  region_code?: string;
  country?: string;
  country_code?: string;
};

/** Strip the IPv4-mapped prefix Express sometimes leaves on req.ip. */
export function normalizeClientIp(raw: string | undefined | null): string {
  const ip = (raw ?? "").trim();
  const mapped = ip.toLowerCase();
  if (mapped.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

/**
 * RFC 4291 link-local is fe80::/10, so the first hextet runs from fe80
 * through febf. A prefix check for "fe80:" misses fea0::, feb0::, and febf::.
 */
function isIpv6LinkLocal(ip: string): boolean {
  const head = ip.split(":")[0] ?? "";
  if (!/^[0-9a-f]{1,4}$/.test(head)) return false;
  const value = Number.parseInt(head, 16);
  return value >= 0xfe80 && value <= 0xfebf;
}

/** Loopback, link-local, and RFC1918 addresses have no public place. */
export function isNonPublicIp(raw: string): boolean {
  const ip = normalizeClientIp(raw).toLowerCase();
  if (!ip || ip === "unknown") return true;
  if (ip === "::1" || ip === "::" || ip === "0.0.0.0") return true;
  if (isIpv6LinkLocal(ip) || ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }

  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = nums;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function locationFromLookup(
  data: IpWhoResponse,
): IUserLoginLocation | null {
  if (data.success === false) return null;
  const city = text(data.city);
  const region = text(data.region_code) || text(data.region);
  const country = text(data.country) || text(data.country_code);
  if (!city && !region && !country) return null;
  return { city, region, country, source: "ip" };
}

export function locationFromGoogleGeocode(
  data: GoogleGeocodeResponse,
): IUserLoginLocation | null {
  if (data.status !== "OK") return null;
  const components = data.results?.[0]?.address_components ?? [];
  const find = (type: string) =>
    components.find((component) => component.types?.includes(type));
  const city =
    text(find("locality")?.long_name) ||
    text(find("postal_town")?.long_name) ||
    text(find("sublocality")?.long_name);
  const region = text(find("administrative_area_level_1")?.short_name);
  const country = text(find("country")?.long_name);
  if (!city && !region) return null;
  return { city, region, country, source: "device" };
}

export function isValidCoordinates(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * City/region for browser coordinates via Google Geocoding. Returns null when
 * no key is configured, the Geocoding API is not enabled, or the call fails.
 */
export async function reverseGeocodeLocation(
  lat: number,
  lng: number,
): Promise<IUserLoginLocation | null> {
  if (!isValidCoordinates(lat, lng)) return null;
  const apiKey = await getActiveGoogleApiKey();
  if (!apiKey) {
    console.warn("[login] reverse geocode skipped: no Google API key configured");
    return null;
  }

  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    result_type: "locality|postal_town|sublocality",
    key: apiKey,
  });
  try {
    const response = await fetch(`${GOOGLE_GEOCODE_URL}?${params}`, {
      signal: AbortSignal.timeout(REVERSE_GEOCODE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as GoogleGeocodeResponse;
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.warn(
        "[login] reverse geocode failed:",
        data.status,
        data.error_message ?? "",
      );
    }
    return locationFromGoogleGeocode(data);
  } catch (err) {
    console.warn(
      "[login] reverse geocode failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return null;
  }
}

/**
 * Approximate city/region for a sign-in. Private addresses and failed
 * lookups return null so login can still record the timestamp.
 */
export async function lookupLoginLocation(
  rawIp: string | undefined | null,
): Promise<IUserLoginLocation | null> {
  const ip = normalizeClientIp(rawIp);
  if (isNonPublicIp(ip)) return null;

  try {
    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as IpWhoResponse;
    return locationFromLookup(data);
  } catch (err) {
    console.warn(
      "[login] location lookup failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return null;
  }
}
