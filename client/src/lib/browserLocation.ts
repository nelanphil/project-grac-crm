import { authUpdateLoginLocation, type LoginCoordinates } from "@/lib/api";

export class LocationError extends Error {}

const LOCATION_DENIED_MESSAGE =
  "Staff sign-in requires location access. Allow location for this site in your browser's address bar settings, then sign in again.";
const LOCATION_UNAVAILABLE_MESSAGE =
  "We couldn't get your location. Staff sign-in requires it. Check that location services are on for this device and browser, then sign in again.";
const LOCATION_UNSUPPORTED_MESSAGE =
  "Staff sign-in requires location, and this browser does not support it. Use a current version of Chrome, Safari, Edge, or Firefox.";

const COOLDOWN_MS = 4 * 60 * 60 * 1000;
const STORAGE_PREFIX = "login-location-refresh:";

const inFlight = new Set<string>();

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function locationRefreshOnCooldown(userId: string): boolean {
  if (!userId) return true;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function markLocationRefreshed(userId: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), String(Date.now()));
  } catch {
    // Private browsing can block storage. The next visit may refresh again.
  }
}

export function getBrowserLocation(
  options: PositionOptions,
): Promise<LoginCoordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new LocationError(LOCATION_UNSUPPORTED_MESSAGE));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (err) =>
        reject(
          new LocationError(
            err.code === err.PERMISSION_DENIED
              ? LOCATION_DENIED_MESSAGE
              : LOCATION_UNAVAILABLE_MESSAGE,
          ),
        ),
      options,
    );
  });
}

/** Ask the browser for a city and save it. Skips when a refresh succeeded recently. */
export function refreshVisitLocation(token: string, userId: string): void {
  if (!token || !userId) return;
  if (locationRefreshOnCooldown(userId) || inFlight.has(userId)) return;
  inFlight.add(userId);
  getBrowserLocation({
    enableHighAccuracy: false,
    timeout: 8000,
    maximumAge: 600000,
  })
    .then((coords) => authUpdateLoginLocation(token, coords))
    .then((saved) => {
      if (saved) markLocationRefreshed(userId);
    })
    .catch(() => {})
    .finally(() => {
      inFlight.delete(userId);
    });
}
