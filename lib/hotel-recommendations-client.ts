import type { DestinationChoice } from "./destinations.ts";
import type { Locale } from "./i18n.ts";
import type { HotelCandidate } from "./google-hotels.ts";
import { tripRequestHeaders } from "./trip-request-identity.ts";

export type HotelSearchInput = {
  latitude: number;
  longitude: number;
  area: string;
  query?: string;
  routePoints?: Array<{ latitude: number; longitude: number }>;
};

export type HotelRecommendationsResponse = {
  provider: "google_maps";
  evidenceProviders: { rakuten: boolean };
  fetchedAt: string;
  candidates: HotelCandidate[];
};

export class HotelRecommendationsError extends Error {
  code: "not_configured" | "invalid_request" | "quota_exhausted" | "unavailable";

  constructor(code: HotelRecommendationsError["code"]) {
    super(code);
    this.code = code;
  }
}

export function buildHotelSearchPayload(
  input: HotelSearchInput,
  locale: Locale,
  destination: DestinationChoice = "auto",
) {
  const query = input.query?.trim();
  const routePoints = input.routePoints?.slice(0, 10).map(({ latitude, longitude }) => ({ latitude, longitude }));
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    area: input.area,
    ...(query ? { query } : {}),
    ...(routePoints?.length ? { routePoints } : {}),
    languageCode: locale === "ja" ? "ja" as const : "en" as const,
    destination,
  };
}

export async function requestHotelRecommendations(
  input: HotelSearchInput,
  locale: Locale,
  destination: DestinationChoice = "auto",
  signal?: AbortSignal,
): Promise<HotelRecommendationsResponse> {
  let response: Response;
  try {
    response = await fetch("/api/hotel-recommendations", {
      method: "POST",
      headers: tripRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(buildHotelSearchPayload(input, locale, destination)),
      signal,
    });
  } catch {
    throw new HotelRecommendationsError("unavailable");
  }
  const payload = await response.json().catch(() => null) as (HotelRecommendationsResponse & { code?: string }) | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new HotelRecommendationsError("not_configured");
    if (payload?.code === "invalid_request") throw new HotelRecommendationsError("invalid_request");
    if (response.status === 429 || payload?.code === "budget_exhausted") throw new HotelRecommendationsError("quota_exhausted");
    throw new HotelRecommendationsError("unavailable");
  }
  return payload;
}
