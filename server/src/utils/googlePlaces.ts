/**
 * Places API (New) city lookup. Address Validation has no typeahead.
 * https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 */
import { US_STATE_BOUNDS, isUsStateCode } from "../constants/usStates";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export type CitySuggestion = {
  placeId: string;
  label: string;
  city: string;
  state: string;
};

export type ResolvedServiceCity = {
  city: string;
  state: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
};

type PlacesFailure = { ok: false; status: number; message: string };

type GoogleErrorBody = {
  error?: { message?: string; status?: string };
};

type AutocompleteResponse = GoogleErrorBody & {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
};

type PlaceDetailsResponse = GoogleErrorBody & {
  id?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
};

function placesErrorMessage(status: number, body: GoogleErrorBody): string {
  const message = body.error?.message?.trim() ?? "";
  const placesDisabled =
    status === 403 ||
    /has not been used|PERMISSION_DENIED|Places API|API key not valid/i.test(
      message,
    );
  if (placesDisabled) {
    return message
      ? `City search is unavailable. ${message}`
      : "City search is unavailable. Enable the Places API for the Google key in Control Panel → API Services.";
  }
  return message || "City search is unavailable. Try again.";
}

function stateCodeInText(text: string): string | null {
  const tokens = text.toUpperCase().match(/\b[A-Z]{2}\b/g) ?? [];
  return tokens.find((token) => isUsStateCode(token)) ?? null;
}

async function postAutocomplete(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: AutocompleteResponse }> {
  const res = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as AutocompleteResponse;
  return { status: res.status, data };
}

function componentText(
  components: PlaceDetailsResponse["addressComponents"],
  type: string,
  field: "longText" | "shortText",
): string {
  const match = components?.find((component) => component.types?.includes(type));
  return (match?.[field] ?? "").trim();
}

export async function suggestUsCities(opts: {
  apiKey: string;
  query: string;
  state: string;
}): Promise<{ ok: true; suggestions: CitySuggestion[] } | PlacesFailure> {
  const state = opts.state.trim().toUpperCase();
  const bounds = US_STATE_BOUNDS[state];
  if (!bounds) {
    return { ok: false, status: 400, message: "state must be a US state code" };
  }

  const query = opts.query.trim();
  const requestBody = {
    input: query,
    includedPrimaryTypes: ["(cities)"],
    includedRegionCodes: ["us"],
    languageCode: "en",
    regionCode: "US",
    locationBias: {
      rectangle: {
        low: { latitude: bounds.south, longitude: bounds.west },
        high: { latitude: bounds.north, longitude: bounds.east },
      },
    },
  };

  let data: AutocompleteResponse;
  let status: number;
  try {
    const first = await postAutocomplete(opts.apiKey, requestBody);
    status = first.status;
    data = first.data;
    if (status === 400) {
      const second = await postAutocomplete(opts.apiKey, {
        ...requestBody,
        locationBias: undefined,
      });
      status = second.status;
      data = second.data;
    }
  } catch {
    return {
      ok: false,
      status: 502,
      message: "City search is unavailable. Try again.",
    };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, status: 502, message: placesErrorMessage(status, data) };
  }

  const suggestions: CitySuggestion[] = [];
  const seen = new Set<string>();
  for (const suggestion of data.suggestions ?? []) {
    const prediction = suggestion.placePrediction;
    const placeId = prediction?.placeId?.trim() ?? "";
    const city = prediction?.structuredFormat?.mainText?.text?.trim() ?? "";
    const label = prediction?.text?.text?.trim() || city;
    const secondary = prediction?.structuredFormat?.secondaryText?.text?.trim() ?? "";
    if (!placeId || !city || seen.has(placeId)) continue;

    const mentioned = stateCodeInText(`${secondary} ${label}`);
    if (mentioned && mentioned !== state) continue;

    seen.add(placeId);
    suggestions.push({ placeId, label, city, state });
    if (suggestions.length >= 8) break;
  }

  return { ok: true, suggestions };
}

export async function resolveUsCity(opts: {
  apiKey: string;
  placeId: string;
  state: string;
}): Promise<{ ok: true; city: ResolvedServiceCity } | PlacesFailure> {
  const state = opts.state.trim().toUpperCase();
  const bounds = US_STATE_BOUNDS[state];
  if (!bounds) {
    return { ok: false, status: 400, message: "state must be a US state code" };
  }

  const placeId = opts.placeId.trim();
  if (!/^[A-Za-z0-9_-]{8,300}$/.test(placeId)) {
    return { ok: false, status: 400, message: "placeId is invalid" };
  }

  let data: PlaceDetailsResponse;
  let status: number;
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": opts.apiKey,
          "X-Goog-FieldMask": "id,location,addressComponents",
        },
      },
    );
    status = res.status;
    data = (await res.json()) as PlaceDetailsResponse;
  } catch {
    return {
      ok: false,
      status: 502,
      message: "City search is unavailable. Try again.",
    };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, status: 502, message: placesErrorMessage(status, data) };
  }

  const components = data.addressComponents;
  const resolvedState = componentText(
    components,
    "administrative_area_level_1",
    "shortText",
  ).toUpperCase();
  const city =
    componentText(components, "locality", "longText") ||
    componentText(components, "postal_town", "longText") ||
    componentText(components, "administrative_area_level_3", "longText") ||
    componentText(components, "sublocality_level_1", "longText");

  if (!city || resolvedState !== state) {
    return {
      ok: false,
      status: 422,
      message: `That place is not a city in ${bounds.name}.`,
    };
  }

  const lat = data.location?.latitude;
  const lng = data.location?.longitude;

  return {
    ok: true,
    city: {
      city,
      state,
      placeId: data.id?.trim() || placeId,
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
    },
  };
}

type GeocodeAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    place_id?: string;
    address_components?: GeocodeAddressComponent[];
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
};

function geocodeComponent(
  components: GeocodeAddressComponent[] | undefined,
  type: string,
  field: "long_name" | "short_name",
): string {
  const match = components?.find((component) => component.types?.includes(type));
  return (match?.[field] ?? "").trim();
}

function geocodeErrorMessage(data: GeocodeResponse): string {
  const message = data.error_message?.trim() ?? "";
  const disabled =
    data.status === "REQUEST_DENIED" ||
    /has not been used|not authorized|Geocoding API|API key not valid|REQUEST_DENIED/i.test(
      message,
    );
  if (disabled) {
    return message
      ? `City lookup is unavailable. ${message}`
      : "City lookup is unavailable. Enable the Geocoding API for the Google key in Control Panel → API Services.";
  }
  return message || "City lookup is unavailable. Try again.";
}

/** Reverse-geocode a map click to the city whose boundary contains that point. */
export async function resolveUsCityAt(opts: {
  apiKey: string;
  lat: number;
  lng: number;
  state: string;
}): Promise<{ ok: true; city: ResolvedServiceCity } | PlacesFailure> {
  const state = opts.state.trim().toUpperCase();
  const bounds = US_STATE_BOUNDS[state];
  if (!bounds) {
    return { ok: false, status: 400, message: "state must be a US state code" };
  }
  if (
    !Number.isFinite(opts.lat) ||
    !Number.isFinite(opts.lng) ||
    opts.lat < -90 ||
    opts.lat > 90 ||
    opts.lng < -180 ||
    opts.lng > 180
  ) {
    return {
      ok: false,
      status: 400,
      message: "lat and lng must be valid coordinates",
    };
  }

  const params = new URLSearchParams({
    latlng: `${opts.lat},${opts.lng}`,
    result_type: "locality",
    key: opts.apiKey,
  });

  let data: GeocodeResponse;
  try {
    const res = await fetch(`${GEOCODE_URL}?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    data = (await res.json()) as GeocodeResponse;
    if (!res.ok) {
      return { ok: false, status: 502, message: geocodeErrorMessage(data) };
    }
  } catch {
    return {
      ok: false,
      status: 502,
      message: "City lookup is unavailable. Try again.",
    };
  }

  if (data.status !== "OK") {
    if (data.status === "ZERO_RESULTS") {
      return {
        ok: false,
        status: 422,
        message: `That spot is not a city in ${bounds.name}.`,
      };
    }
    return { ok: false, status: 502, message: geocodeErrorMessage(data) };
  }

  const result = data.results?.[0];
  const components = result?.address_components;
  const resolvedState = geocodeComponent(
    components,
    "administrative_area_level_1",
    "short_name",
  ).toUpperCase();
  const city =
    geocodeComponent(components, "locality", "long_name") ||
    geocodeComponent(components, "postal_town", "long_name");
  const placeId = result?.place_id?.trim() ?? "";

  if (!city || !placeId || resolvedState !== state) {
    return {
      ok: false,
      status: 422,
      message: `That spot is not a city in ${bounds.name}.`,
    };
  }

  const lat = result?.geometry?.location?.lat;
  const lng = result?.geometry?.location?.lng;

  return {
    ok: true,
    city: {
      city,
      state,
      placeId,
      lat: typeof lat === "number" ? lat : opts.lat,
      lng: typeof lng === "number" ? lng : opts.lng,
    },
  };
}
