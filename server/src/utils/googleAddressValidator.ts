/**
 * Google Address Validation API.
 * https://developers.google.com/maps/documentation/address-validation
 */
import { normalizeCountyName } from "../constants/floridaCounties";
import { GoogleCredentials } from "../models/mongo/GoogleCredentials";
import { decryptCredential } from "./credentialsCrypto";
import {
  lookupCountyFromCensus,
  type AddressInput,
  type GeocodeResult,
  type NormalizedAddress,
} from "./censusGeocoder";

const VALIDATE_URL =
  "https://addressvalidation.googleapis.com/v1:validateAddress";

type GoogleAddressComponent = {
  componentType?: string;
  componentName?: { text?: string };
};

type GooglePostalAddress = {
  regionCode?: string;
  postalCode?: string;
  administrativeArea?: string;
  locality?: string;
  addressLines?: string[];
};

type GoogleValidateResponse = {
  result?: {
    verdict?: {
      addressComplete?: boolean;
    };
    address?: {
      formattedAddress?: string;
      postalAddress?: GooglePostalAddress;
      addressComponents?: GoogleAddressComponent[];
    };
    geocode?: {
      location?: { latitude?: number; longitude?: number };
    };
  };
  error?: { message?: string };
};

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d/.test(word)) return word.toUpperCase();
      if (/^(n|s|e|w|ne|nw|se|sw)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Loads the active Google API key, if any credentials are configured. */
export async function getActiveGoogleApiKey(): Promise<string | null> {
  const creds = await GoogleCredentials.findOne({
    slug: "google",
    isActive: true,
  }).lean();
  if (!creds?.apiKeyEncrypted) return null;

  try {
    return decryptCredential(creds.apiKeyEncrypted);
  } catch {
    return null;
  }
}

export async function geocodeAddressGoogle(
  input: AddressInput,
  apiKey: string,
): Promise<GeocodeResult> {
  const street = trim(input.street);
  const city = trim(input.city);
  const state = trim(input.state);
  const zip = trim(input.zip);

  const addressLines = [street];
  const secondLineParts = [city, state, zip].filter(Boolean);
  if (secondLineParts.length) addressLines.push(secondLineParts.join(" "));

  let data: GoogleValidateResponse;
  try {
    const res = await fetch(`${VALIDATE_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: {
          regionCode: "US",
          addressLines,
        },
      }),
    });

    data = (await res.json()) as GoogleValidateResponse;

    if (!res.ok) {
      return {
        ok: false,
        reason: "upstream_error",
        message: data?.error?.message || "Google address validation is unavailable.",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "upstream_error",
      message: "Google address validation is unavailable. Try again.",
    };
  }

  const result = data.result;
  const postal = result?.address?.postalAddress;
  const streetLine = postal?.addressLines?.[0] ?? "";
  const cityVal = postal?.locality ?? "";
  const stateVal = postal?.administrativeArea ?? "";
  const zipVal = (postal?.postalCode ?? "").match(/\d{5}/)?.[0] ?? "";

  if (!streetLine || !cityVal || !stateVal || !zipVal) {
    return {
      ok: false,
      reason: "no_match",
      message:
        "No matching US address found. Check the street, city, state, and ZIP.",
    };
  }

  const countyComponent = result?.address?.addressComponents?.find(
    (c) => c.componentType === "administrative_area_level_2",
  );
  let county = normalizeCountyName(countyComponent?.componentName?.text ?? "");

  const normalized: NormalizedAddress = {
    address: toTitleCase(streetLine),
    city: toTitleCase(cityVal),
    state: stateVal.toUpperCase().slice(0, 2),
    zip: zipVal,
    county,
  };

  if (!normalized.county) {
    normalized.county = await lookupCountyFromCensus({
      street: normalized.address,
      city: normalized.city,
      state: normalized.state,
      zip: normalized.zip,
    });
  }

  const location = result?.geocode?.location;
  const lat = location?.latitude;
  const lng = location?.longitude;

  return {
    ok: true,
    match: {
      matchedAddress:
        result?.address?.formattedAddress ||
        `${normalized.address}, ${normalized.city}, ${normalized.state}, ${normalized.zip}`,
      normalized,
      coordinates:
        typeof lat === "number" && typeof lng === "number" ? { lng, lat } : null,
    },
  };
}
