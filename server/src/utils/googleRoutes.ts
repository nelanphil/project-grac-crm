import { getActiveGoogleApiKey } from "../utils/googleAddressValidator";

export type LatLng = { lat: number; lng: number };

const EARTH_MILES = 3958.8;
const FALLBACK_MPH = 30;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haversineDriveMinutes(a: LatLng, b: LatLng): number {
  const miles = haversineMiles(a, b);
  return Math.max(1, Math.round((miles / FALLBACK_MPH) * 60));
}

export type RouteMatrixCell = {
  originIndex: number;
  destinationIndex: number;
  durationMinutes: number;
  distanceMeters: number;
  source: "google" | "haversine";
};

export type RouteLeg = {
  durationMinutes: number;
  distanceMeters: number;
  encodedPolyline?: string;
};

type MatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  status?: string;
};

function parseDurationSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) : 0;
}

export async function computeDriveMinutesMatrix(
  origins: LatLng[],
  destinations: LatLng[],
): Promise<RouteMatrixCell[]> {
  if (origins.length === 0 || destinations.length === 0) return [];

  const apiKey = await getActiveGoogleApiKey();
  if (apiKey) {
    try {
      const res = await fetch(
        "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "originIndex,destinationIndex,duration,distanceMeters,status",
          },
          body: JSON.stringify({
            origins: origins.map((o) => ({
              waypoint: {
                location: {
                  latLng: { latitude: o.lat, longitude: o.lng },
                },
              },
            })),
            destinations: destinations.map((d) => ({
              waypoint: {
                location: {
                  latLng: { latitude: d.lat, longitude: d.lng },
                },
              },
            })),
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_UNAWARE",
          }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as MatrixElement[];
        if (Array.isArray(data) && data.length > 0) {
          return data
            .filter((row) => row.status === "OK" || !row.status)
            .map((row) => ({
              originIndex: row.originIndex ?? 0,
              destinationIndex: row.destinationIndex ?? 0,
              durationMinutes: Math.max(
                1,
                Math.round(parseDurationSeconds(row.duration) / 60),
              ),
              distanceMeters: row.distanceMeters ?? 0,
              source: "google" as const,
            }));
        }
      } else {
        console.error(
          "Google Routes matrix error:",
          res.status,
          await res.text().catch(() => ""),
        );
      }
    } catch (err) {
      console.error("Google Routes matrix failed:", err);
    }
  }

  const cells: RouteMatrixCell[] = [];
  for (let i = 0; i < origins.length; i += 1) {
    for (let j = 0; j < destinations.length; j += 1) {
      cells.push({
        originIndex: i,
        destinationIndex: j,
        durationMinutes: haversineDriveMinutes(origins[i]!, destinations[j]!),
        distanceMeters: Math.round(haversineMiles(origins[i]!, destinations[j]!) * 1609.34),
        source: "haversine",
      });
    }
  }
  return cells;
}

export async function computeDriveMinutes(
  origin: LatLng,
  destination: LatLng,
): Promise<{ minutes: number; source: "google" | "haversine" }> {
  const cells = await computeDriveMinutesMatrix([origin], [destination]);
  const cell = cells[0];
  return {
    minutes: cell?.durationMinutes ?? haversineDriveMinutes(origin, destination),
    source: cell?.source ?? "haversine",
  };
}

type ComputeRoutesResponse = {
  routes?: Array<{
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
    legs?: Array<{
      duration?: string;
      distanceMeters?: number;
      polyline?: { encodedPolyline?: string };
    }>;
  }>;
};

export async function computeDayRoute(
  origin: LatLng,
  destination: LatLng,
  intermediates: LatLng[],
): Promise<{
  durationMinutes: number;
  distanceMeters: number;
  encodedPolyline?: string;
  legs: RouteLeg[];
  source: "google" | "haversine";
} | null> {
  const waypoints = [origin, ...intermediates, destination];
  if (waypoints.length < 2) return null;

  const apiKey = await getActiveGoogleApiKey();
  if (apiKey) {
    try {
      const res = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters",
          },
          body: JSON.stringify({
            origin: {
              location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
            },
            destination: {
              location: {
                latLng: { latitude: destination.lat, longitude: destination.lng },
              },
            },
            intermediates: intermediates.map((p) => ({
              location: { latLng: { latitude: p.lat, longitude: p.lng } },
            })),
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_UNAWARE",
          }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as ComputeRoutesResponse;
        const route = data.routes?.[0];
        if (route) {
          return {
            durationMinutes: Math.max(
              1,
              Math.round(parseDurationSeconds(route.duration) / 60),
            ),
            distanceMeters: route.distanceMeters ?? 0,
            encodedPolyline: route.polyline?.encodedPolyline,
            legs: (route.legs ?? []).map((leg) => ({
              durationMinutes: Math.max(
                1,
                Math.round(parseDurationSeconds(leg.duration) / 60),
              ),
              distanceMeters: leg.distanceMeters ?? 0,
              encodedPolyline: leg.polyline?.encodedPolyline,
            })),
            source: "google",
          };
        }
      } else {
        console.error(
          "Google Routes computeRoutes error:",
          res.status,
          await res.text().catch(() => ""),
        );
      }
    } catch (err) {
      console.error("Google Routes computeRoutes failed:", err);
    }
  }

  const legs: RouteLeg[] = [];
  let totalMinutes = 0;
  let totalMeters = 0;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const minutes = haversineDriveMinutes(waypoints[i]!, waypoints[i + 1]!);
    const meters = Math.round(
      haversineMiles(waypoints[i]!, waypoints[i + 1]!) * 1609.34,
    );
    legs.push({ durationMinutes: minutes, distanceMeters: meters });
    totalMinutes += minutes;
    totalMeters += meters;
  }
  return {
    durationMinutes: totalMinutes,
    distanceMeters: totalMeters,
    legs,
    source: "haversine",
  };
}
