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
  travelMode: LiveRouteTravelMode;
};

export type LiveRouteTravelMode = "TRANSIT" | "WALK" | "DRIVE";

export type LiveRouteResult = {
  id: string;
  durationMinutes: number | null;
  distanceMeters: number | null;
  encodedPolyline: string | null;
  /** Number of vehicle changes on a transit route; null unless step data is complete. */
  transferCount: number | null;
  status: "ok" | "unavailable";
};

const validLanguages = new Set(["en", "ja", "ko", "zh-CN"]);
const validTravelModes = new Set<LiveRouteTravelMode>(["TRANSIT", "WALK", "DRIVE"]);
const validStepTravelModes = new Set(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]);

export function resolveGoogleRoutesApiKey(environment: {
  GOOGLE_ROUTES_API_KEY?: string;
  GOOGLE_PLACES_API_KEY?: string;
}) {
  return environment.GOOGLE_ROUTES_API_KEY?.trim()
    || environment.GOOGLE_PLACES_API_KEY?.trim()
    || null;
}

function validCoordinate(value: unknown): value is LiveRouteCoordinate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.latitude === "number"
    && typeof candidate.longitude === "number"
    && Number.isFinite(candidate.latitude)
    && Number.isFinite(candidate.longitude)
    && candidate.latitude >= -90
    && candidate.latitude <= 90
    && candidate.longitude >= -180
    && candidate.longitude <= 180;
}

export function parseLiveRoutesRequest(input: unknown, now = new Date()): LiveRoutesRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.legs) || candidate.legs.length < 1 || candidate.legs.length > 20) return null;
  if (typeof candidate.languageCode !== "string" || !validLanguages.has(candidate.languageCode)) return null;
  const travelMode = candidate.travelMode ?? "TRANSIT";
  if (typeof travelMode !== "string" || !validTravelModes.has(travelMode as LiveRouteTravelMode)) return null;

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
    travelMode: travelMode as LiveRouteTravelMode,
  };
}

function durationMinutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.max(1, Math.ceil(Number(match[1]) / 60)) : null;
}

type GoogleRoutePayload = {
  duration?: string;
  distanceMeters?: number;
  polyline?: { encodedPolyline?: string };
  legs?: Array<{ steps?: Array<{ travelMode?: unknown }> }>;
};

/**
 * Google documents one TRANSIT RouteLegStep per transit ride. A transfer is a
 * change between rides, hence max(0, rides - 1). Missing or malformed step
 * fields remain unknown instead of being treated as a zero-transfer route.
 */
function transferCount(route: GoogleRoutePayload | undefined, travelMode: LiveRouteTravelMode) {
  if (travelMode !== "TRANSIT") return null;
  if (!route || !Array.isArray(route.legs) || route.legs.length === 0) return null;
  const steps = route.legs.flatMap((leg) => Array.isArray(leg.steps) ? leg.steps : []);
  if (steps.length === 0 || route.legs.some((leg) => !Array.isArray(leg.steps))) return null;
  if (steps.some((step) => (
    !step
    || typeof step !== "object"
    || typeof step.travelMode !== "string"
    || !validStepTravelModes.has(step.travelMode)
  ))) return null;
  const rideCount = steps.filter((step) => step.travelMode === "TRANSIT").length;
  return Math.max(0, rideCount - 1);
}

function unavailableRoute(id: string): LiveRouteResult {
  return {
    id,
    durationMinutes: null,
    distanceMeters: null,
    encodedPolyline: null,
    transferCount: null,
    status: "unavailable",
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

export async function fetchGoogleRoutes(
  request: LiveRoutesRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  concurrency = 6,
): Promise<LiveRouteResult[]> {
  return mapWithConcurrency(request.legs, Math.min(8, concurrency), async (leg): Promise<LiveRouteResult> => {
    try {
      const response = await fetcher("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": [
            "routes.duration",
            "routes.distanceMeters",
            "routes.polyline.encodedPolyline",
            ...(request.travelMode === "TRANSIT" ? ["routes.legs.steps.travelMode"] : []),
          ].join(","),
        },
        body: JSON.stringify({
          origin: { location: { latLng: leg.origin } },
          destination: { location: { latLng: leg.destination } },
          travelMode: request.travelMode,
          ...(request.travelMode === "TRANSIT" ? { departureTime: leg.departureTime } : {}),
          languageCode: request.languageCode,
          units: "METRIC",
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return unavailableRoute(leg.id);
      const payload = await response.json() as { routes?: GoogleRoutePayload[] };
      const route = payload.routes?.[0];
      const minutes = durationMinutes(route?.duration);
      if (!route || minutes === null) return unavailableRoute(leg.id);
      return {
        id: leg.id,
        durationMinutes: minutes,
        distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : null,
        encodedPolyline: typeof route.polyline?.encodedPolyline === "string" && route.polyline.encodedPolyline.length > 0
          ? route.polyline.encodedPolyline
          : null,
        transferCount: transferCount(route, request.travelMode),
        status: "ok",
      };
    } catch {
      return unavailableRoute(leg.id);
    }
  });
}

/** Backward-compatible adapter for callers that explicitly need transit only. */
export async function fetchGoogleTransitRoutes(
  request: LiveRoutesRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  concurrency = 4,
): Promise<LiveRouteResult[]> {
  return fetchGoogleRoutes({ ...request, travelMode: "TRANSIT" }, apiKey, fetcher, concurrency);
}
