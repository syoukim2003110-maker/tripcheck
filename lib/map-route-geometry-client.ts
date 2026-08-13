import { tripRequestHeaders } from "./trip-request-identity.ts";

/**
 * The map's live-route transport.
 *
 * `PlannerGoogleMap` used to call `/api/live-routes` with a bare `fetch` of its
 * own — the only paid call in the app made from a component rather than a hook
 * or a client module, and therefore the only one outside the privacy scan. It
 * also had no cancellation, so switching days quickly left older requests
 * running and still billable.
 *
 * The request lives here now, behind an abort signal. What crosses the network
 * is unchanged: coordinates, a departure timestamp and a travel mode. No place
 * name, itinerary line or traveller-entered text is included.
 */

export type MapRouteLegRequest = Readonly<{
  id: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  departureTime: string;
}>;

export type MapRouteLegResult = Readonly<{
  durationMinutes: number | null;
  encodedPolyline: string | null;
  status: string;
  fetchedAt: string | null;
}>;

export type MapRouteGeometryMode = "walk" | "taxi" | "transit";

const TRAVEL_MODE: Record<MapRouteGeometryMode, string> = {
  walk: "WALK",
  taxi: "DRIVE",
  transit: "TRANSIT",
};

export function buildMapRouteGeometryPayload(input: Readonly<{
  legs: readonly MapRouteLegRequest[];
  languageCode: string;
  mode: MapRouteGeometryMode;
}>) {
  return {
    legs: input.legs.map((leg) => ({
      id: leg.id,
      origin: { latitude: leg.origin.latitude, longitude: leg.origin.longitude },
      destination: { latitude: leg.destination.latitude, longitude: leg.destination.longitude },
      departureTime: leg.departureTime,
    })),
    languageCode: input.languageCode,
    travelMode: TRAVEL_MODE[input.mode],
  };
}

/**
 * Returns geometry per leg id. A failure resolves to an empty map rather than
 * throwing: the pins and the map stay usable, and no invented line is drawn.
 */
export async function requestMapRouteGeometry(input: Readonly<{
  legs: readonly MapRouteLegRequest[];
  languageCode: string;
  mode: MapRouteGeometryMode;
  signal?: AbortSignal;
}>): Promise<Map<string, MapRouteLegResult>> {
  const results = new Map<string, MapRouteLegResult>();
  if (input.legs.length === 0) return results;
  try {
    const response = await fetch("/api/live-routes", {
      method: "POST",
      headers: tripRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(buildMapRouteGeometryPayload(input)),
      signal: input.signal,
    });
    const payload = await response.json().catch(() => null) as {
      fetchedAt?: unknown;
      legs?: Array<{ id?: unknown; durationMinutes?: unknown; encodedPolyline?: unknown; status?: unknown }>;
    } | null;
    if (!response.ok || !Array.isArray(payload?.legs)) return results;
    for (const leg of payload.legs) {
      if (typeof leg.id !== "string") continue;
      results.set(leg.id, {
        durationMinutes: typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes) ? leg.durationMinutes : null,
        encodedPolyline: typeof leg.encodedPolyline === "string" ? leg.encodedPolyline : null,
        status: typeof leg.status === "string" ? leg.status : "unavailable",
        fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : null,
      });
    }
  } catch {
    // Aborted or unreachable. The caller keeps whatever it already had.
  }
  return results;
}
