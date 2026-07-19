export type LiveRouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type LiveRouteLegRequest = {
  id: string;
  origin: LiveRouteCoordinate;
  destination: LiveRouteCoordinate;
  departureTime: string;
};

export type LiveRoutesRequest = {
  legs: LiveRouteLegRequest[];
  languageCode: "en" | "ja" | "ko" | "zh-CN";
};

export type LiveRouteResult = {
  id: string;
  durationMinutes: number | null;
  distanceMeters: number | null;
  status: "ok" | "unavailable";
};

const validLanguages = new Set(["en", "ja", "ko", "zh-CN"]);

function validCoordinate(value: unknown): value is LiveRouteCoordinate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.latitude === "number"
    && typeof candidate.longitude === "number"
    && Number.isFinite(candidate.latitude)
    && Number.isFinite(candidate.longitude)
    && candidate.latitude >= 20
    && candidate.latitude <= 46
    && candidate.longitude >= 122
    && candidate.longitude <= 154;
}

export function parseLiveRoutesRequest(input: unknown, now = new Date()): LiveRoutesRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.legs) || candidate.legs.length < 1 || candidate.legs.length > 24) return null;
  if (typeof candidate.languageCode !== "string" || !validLanguages.has(candidate.languageCode)) return null;

  const earliest = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const latest = new Date(now.getTime() + 100 * 24 * 60 * 60 * 1000);
  const legs: LiveRouteLegRequest[] = [];
  for (const value of candidate.legs) {
    if (!value || typeof value !== "object") return null;
    const leg = value as Record<string, unknown>;
    if (typeof leg.id !== "string" || leg.id.length < 1 || leg.id.length > 160) return null;
    if (!validCoordinate(leg.origin) || !validCoordinate(leg.destination)) return null;
    if (typeof leg.departureTime !== "string") return null;
    const departure = new Date(leg.departureTime);
    if (Number.isNaN(departure.getTime()) || departure < earliest || departure > latest) return null;
    legs.push({
      id: leg.id,
      origin: leg.origin,
      destination: leg.destination,
      departureTime: departure.toISOString(),
    });
  }

  return {
    legs,
    languageCode: candidate.languageCode as LiveRoutesRequest["languageCode"],
  };
}

function durationMinutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.max(1, Math.ceil(Number(match[1]) / 60)) : null;
}

export async function fetchGoogleTransitRoutes(
  request: LiveRoutesRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<LiveRouteResult[]> {
  return Promise.all(request.legs.map(async (leg): Promise<LiveRouteResult> => {
    try {
      const response = await fetcher("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { location: { latLng: leg.origin } },
          destination: { location: { latLng: leg.destination } },
          travelMode: "TRANSIT",
          departureTime: leg.departureTime,
          languageCode: request.languageCode,
          units: "METRIC",
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return { id: leg.id, durationMinutes: null, distanceMeters: null, status: "unavailable" };
      const payload = await response.json() as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
      const route = payload.routes?.[0];
      const minutes = durationMinutes(route?.duration);
      if (!route || minutes === null) return { id: leg.id, durationMinutes: null, distanceMeters: null, status: "unavailable" };
      return {
        id: leg.id,
        durationMinutes: minutes,
        distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : null,
        status: "ok",
      };
    } catch {
      return { id: leg.id, durationMinutes: null, distanceMeters: null, status: "unavailable" };
    }
  }));
}
