/**
 * Prefer Google Address Validation when configured; fall back to Census.
 * Always try FL ZIP→county when a match has ZIP but no county.
 */
import { normalizeCountyName } from "../constants/floridaCounties";
import { countyForFloridaZip } from "../constants/floridaZipCounties";
import {
  geocodeAddress,
  type AddressInput,
  type GeocodeResult,
} from "./censusGeocoder";
import {
  geocodeAddressGoogle,
  getActiveGoogleApiKey,
} from "./googleAddressValidator";

function fillCountyFromZip(result: GeocodeResult): GeocodeResult {
  if (!result.ok) return result;
  if (result.match.normalized.county) return result;
  const zip = result.match.normalized.zip;
  const county = normalizeCountyName(countyForFloridaZip(zip));
  if (!county) return result;
  return {
    ...result,
    match: {
      ...result.match,
      normalized: { ...result.match.normalized, county },
    },
  };
}

export async function resolveGeocodedAddress(
  input: AddressInput,
): Promise<GeocodeResult> {
  let result: GeocodeResult | null = null;

  const googleApiKey = await getActiveGoogleApiKey();
  if (googleApiKey) {
    try {
      result = await geocodeAddressGoogle(input, googleApiKey);
    } catch (err) {
      console.error("Google address validation error:", err);
      result = null;
    }
  }

  if (!result || !result.ok) {
    const censusResult = await geocodeAddress(input);
    // Prefer a successful Census match; otherwise keep whichever failure
    // message is more informative (Google's, if it was actually attempted).
    if (censusResult.ok || !result) {
      result = censusResult;
    }
  }

  return fillCountyFromZip(result);
}
