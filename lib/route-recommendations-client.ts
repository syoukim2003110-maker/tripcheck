import { notHostedResponse, serverRoutesUnavailable } from "./hosting-mode.ts";
import type { DestinationChoice } from "./destinations.ts";
import type { GapSuggestionKind } from "./gap-detection.ts";
import type { RouteRecommendation, RouteRecommendationPoint } from "./route-recommendations.ts";
import { tripRequestHeaders } from "./trip-request-identity.ts";
import { appleRelayClient } from "./apple-relay-client.ts";
import { bundledSightsNearRoute, cafesNearRoute } from "./bundled-route-recommendations.ts";

export class RouteRecommendationsError extends Error {
  code: "not_configured" | "rate_limited" | "unavailable";

  constructor(code: RouteRecommendationsError["code"]) {
    super(code);
    this.code = code;
  }
}

type Request = {
  routePoints: RouteRecommendationPoint[];
  excludedPlaceIds: string[];
  excludedNames: string[];
  destination: DestinationChoice;
  languageCode: "en" | "ja";
  /** The gap band's categories (lib/gap-detection) — they drive the provider search. */
  suggestionKinds?: GapSuggestionKind[];
};

/**
 * Static hosting: well-known sights near the route from the bundled list, and
 * cafés from the Apple relay when one is configured. A failure of either
 * source leaves the other's answer standing.
 */
async function keylessRouteRecommendations(request: Request, signal?: AbortSignal) {
  const relay = appleRelayClient();
  const [sights, cafes] = await Promise.all([
    import("./popular-sights-data.json", { with: { type: "json" } })
      .then((bundled) => bundledSightsNearRoute({
        ...request,
        cities: (bundled.default as { cities: Parameters<typeof bundledSightsNearRoute>[0]["cities"] }).cities,
      }))
      .catch(() => [] as RouteRecommendation[]),
    relay
      ? cafesNearRoute({ ...request, search: relay.search, signal }).catch(() => [] as RouteRecommendation[])
      : Promise.resolve([] as RouteRecommendation[]),
  ]);
  // A short gap asked for a café: cafés lead. Otherwise the sights do.
  const cafeFirst = request.suggestionKinds?.some((kind) => kind === "CAFE" || kind === "BAKERY") ?? false;
  return {
    provider: "open_data" as const,
    fetchedAt: new Date().toISOString(),
    candidates: cafeFirst ? [...cafes, ...sights] : [...sights, ...cafes],
  };
}

export async function requestRouteRecommendations(request: Request, signal?: AbortSignal): Promise<{
  provider: "google_maps" | "open_data";
  fetchedAt: string;
  candidates: RouteRecommendation[];
}> {
  if (serverRoutesUnavailable()) return keylessRouteRecommendations(request, signal);
  let response: Response;
  try {
    response = serverRoutesUnavailable() ? notHostedResponse() : await fetch("/api/route-recommendations", {
      method: "POST",
      headers: tripRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new RouteRecommendationsError("unavailable");
  }
  const payload = await response.json().catch(() => null) as {
    code?: string;
    provider?: unknown;
    fetchedAt?: unknown;
    candidates?: unknown;
  } | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new RouteRecommendationsError("not_configured");
    if (payload?.code === "rate_limited") throw new RouteRecommendationsError("rate_limited");
    throw new RouteRecommendationsError("unavailable");
  }
  if (payload.provider !== "google_maps" || typeof payload.fetchedAt !== "string" || !Array.isArray(payload.candidates)) {
    throw new RouteRecommendationsError("unavailable");
  }
  return {
    provider: "google_maps" as const,
    fetchedAt: payload.fetchedAt,
    candidates: payload.candidates as RouteRecommendation[],
  };
}
