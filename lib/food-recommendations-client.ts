import type { Locale } from "./i18n.ts";
import type { FoodRecommendationSlot } from "./trip-builder.ts";
import type { FoodCandidate } from "./google-food.ts";

export type FoodRecommendationsResponse = {
  provider: "google_maps";
  fetchedAt: string;
  candidates: FoodCandidate[];
};

export class FoodRecommendationsError extends Error {
  code: "not_configured" | "invalid_request" | "unavailable";

  constructor(code: FoodRecommendationsError["code"]) {
    super(code);
    this.code = code;
  }
}

export function buildFoodSearchPayload(slot: FoodRecommendationSlot, query: string, locale: Locale) {
  return {
    latitude: slot.latitude,
    longitude: slot.longitude,
    area: slot.area,
    mealKind: slot.kind,
    query,
    languageCode: locale === "ja" ? "ja" as const : "en" as const,
  };
}

export function foodSearchLinks(query: string, area: string, locale: Locale) {
  const search = encodeURIComponent(`${query} ${area}`);
  return {
    googleMaps: `https://www.google.com/maps/search/?api=1&query=${search}`,
    tabelog: `${locale === "ja" ? "https://tabelog.com/rstLst/" : "https://tabelog.com/en/rstLst/"}?sk=${search}`,
    x: `https://x.com/search?q=${search}&src=typed_query`,
  };
}

export async function requestFoodRecommendations(
  slot: FoodRecommendationSlot,
  query: string,
  locale: Locale,
): Promise<FoodRecommendationsResponse> {
  let response: Response;
  try {
    response = await fetch("/api/food-recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildFoodSearchPayload(slot, query, locale)),
    });
  } catch {
    throw new FoodRecommendationsError("unavailable");
  }
  const payload = await response.json().catch(() => null) as (FoodRecommendationsResponse & { code?: string }) | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new FoodRecommendationsError("not_configured");
    if (payload?.code === "invalid_request") throw new FoodRecommendationsError("invalid_request");
    throw new FoodRecommendationsError("unavailable");
  }
  return payload;
}
