/** Southwest/northeast corners used to bias city search to one state. */
export type StateBounds = {
  name: string;
  south: number;
  west: number;
  north: number;
  east: number;
};

export const US_STATE_BOUNDS: Record<string, StateBounds> = {
  AL: { name: "Alabama", south: 30.14, west: -88.47, north: 35.01, east: -84.89 },
  AK: { name: "Alaska", south: 51.2, west: -168.0, north: 71.5, east: -130.0 },
  AZ: { name: "Arizona", south: 31.33, west: -114.82, north: 37.0, east: -109.04 },
  AR: { name: "Arkansas", south: 33.0, west: -94.62, north: 36.5, east: -89.64 },
  CA: { name: "California", south: 32.53, west: -124.48, north: 42.01, east: -114.13 },
  CO: { name: "Colorado", south: 36.99, west: -109.06, north: 41.0, east: -102.04 },
  CT: { name: "Connecticut", south: 40.95, west: -73.73, north: 42.05, east: -71.79 },
  DE: { name: "Delaware", south: 38.45, west: -75.79, north: 39.84, east: -74.98 },
  FL: { name: "Florida", south: 24.52, west: -87.63, north: 31.0, east: -80.03 },
  GA: { name: "Georgia", south: 30.36, west: -85.61, north: 35.0, east: -80.84 },
  HI: { name: "Hawaii", south: 18.91, west: -160.25, north: 22.24, east: -154.81 },
  ID: { name: "Idaho", south: 41.99, west: -117.24, north: 49.0, east: -111.04 },
  IL: { name: "Illinois", south: 36.97, west: -91.51, north: 42.51, east: -87.02 },
  IN: { name: "Indiana", south: 37.77, west: -88.1, north: 41.76, east: -84.78 },
  IA: { name: "Iowa", south: 40.38, west: -96.64, north: 43.5, east: -90.14 },
  KS: { name: "Kansas", south: 36.99, west: -102.05, north: 40.0, east: -94.59 },
  KY: { name: "Kentucky", south: 36.5, west: -89.57, north: 39.15, east: -81.96 },
  LA: { name: "Louisiana", south: 28.93, west: -94.04, north: 33.02, east: -88.82 },
  ME: { name: "Maine", south: 42.98, west: -71.08, north: 47.46, east: -66.95 },
  MD: { name: "Maryland", south: 37.91, west: -79.49, north: 39.72, east: -75.05 },
  MA: { name: "Massachusetts", south: 41.24, west: -73.51, north: 42.89, east: -69.93 },
  MI: { name: "Michigan", south: 41.7, west: -90.42, north: 48.31, east: -82.41 },
  MN: { name: "Minnesota", south: 43.5, west: -97.24, north: 49.38, east: -89.49 },
  MS: { name: "Mississippi", south: 30.17, west: -91.66, north: 35.0, east: -88.1 },
  MO: { name: "Missouri", south: 35.99, west: -95.77, north: 40.61, east: -89.1 },
  MT: { name: "Montana", south: 44.36, west: -116.05, north: 49.0, east: -104.04 },
  NE: { name: "Nebraska", south: 39.99, west: -104.05, north: 43.0, east: -95.31 },
  NV: { name: "Nevada", south: 35.0, west: -120.01, north: 42.0, east: -114.04 },
  NH: { name: "New Hampshire", south: 42.7, west: -72.56, north: 45.31, east: -70.7 },
  NJ: { name: "New Jersey", south: 38.93, west: -75.56, north: 41.36, east: -73.89 },
  NM: { name: "New Mexico", south: 31.33, west: -109.05, north: 37.0, east: -103.0 },
  NY: { name: "New York", south: 40.5, west: -79.76, north: 45.02, east: -71.86 },
  NC: { name: "North Carolina", south: 33.84, west: -84.32, north: 36.59, east: -75.46 },
  ND: { name: "North Dakota", south: 45.94, west: -104.05, north: 49.0, east: -96.55 },
  OH: { name: "Ohio", south: 38.4, west: -84.82, north: 42.33, east: -80.52 },
  OK: { name: "Oklahoma", south: 33.62, west: -103.0, north: 37.0, east: -94.43 },
  OR: { name: "Oregon", south: 41.99, west: -124.57, north: 46.29, east: -116.46 },
  PA: { name: "Pennsylvania", south: 39.72, west: -80.52, north: 42.27, east: -74.69 },
  RI: { name: "Rhode Island", south: 41.15, west: -71.86, north: 42.02, east: -71.12 },
  SC: { name: "South Carolina", south: 32.05, west: -83.35, north: 35.22, east: -78.54 },
  SD: { name: "South Dakota", south: 42.48, west: -104.06, north: 45.95, east: -96.44 },
  TN: { name: "Tennessee", south: 34.98, west: -90.31, north: 36.68, east: -81.65 },
  TX: { name: "Texas", south: 25.84, west: -106.65, north: 36.5, east: -93.51 },
  UT: { name: "Utah", south: 36.99, west: -114.05, north: 42.0, east: -109.04 },
  VT: { name: "Vermont", south: 42.73, west: -73.44, north: 45.02, east: -71.46 },
  VA: { name: "Virginia", south: 36.54, west: -83.68, north: 39.47, east: -75.24 },
  WA: { name: "Washington", south: 45.54, west: -124.85, north: 49.0, east: -116.92 },
  WV: { name: "West Virginia", south: 37.2, west: -82.64, north: 40.64, east: -77.72 },
  WI: { name: "Wisconsin", south: 42.49, west: -92.89, north: 47.08, east: -86.25 },
  WY: { name: "Wyoming", south: 40.99, west: -111.06, north: 45.01, east: -104.05 },
};

export function isUsStateCode(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(US_STATE_BOUNDS, value);
}

/** Two-letter code, or "" when the value is blank or not a US state. */
export function normalizeUsStateCode(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (isUsStateCode(upper)) return upper;
  const match = Object.entries(US_STATE_BOUNDS).find(
    ([, bounds]) => bounds.name.toLowerCase() === raw.toLowerCase(),
  );
  return match?.[0] ?? "";
}

/** Blank or unrecognized states become FL. */
export function stateCodeOrFlorida(value: string | null | undefined): string {
  return normalizeUsStateCode(value) || "FL";
}
