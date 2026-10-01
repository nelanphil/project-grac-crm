import type { IUserLoginLocation } from "../models/mongo/User";

const LOOKUP_TIMEOUT_MS = 1500;

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

/** Loopback, link-local, and RFC1918 addresses have no public place. */
export function isNonPublicIp(raw: string): boolean {
  const ip = normalizeClientIp(raw).toLowerCase();
  if (!ip || ip === "unknown") return true;
  if (ip === "::1" || ip === "::" || ip === "0.0.0.0") return true;
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) {
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
  return { city, region, country };
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
