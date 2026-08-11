import type { DestinationChoice } from "./destinations.ts";
import type { GapSuggestionKind } from "./gap-detection.ts";
import type { RouteRecommendation, RouteRecommendationPoint } from "./route-recommendations.ts";
import { tripRequestHeaders } from "./trip-request-identity.ts";

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

export async function requestRouteRecommendations(request: Request, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch("/api/route-recommendations", {
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
