import type { Locale } from "./i18n.ts";
import type { HotelCandidate } from "./google-hotels.ts";

export type HotelSearchInput = {
  latitude: number;
  longitude: number;
  area: string;
  query?: string;
};

export type HotelRecommendationsResponse = {
  provider: "google_maps";
  fetchedAt: string;
  candidates: HotelCandidate[];
};

export class HotelRecommendationsError extends Error {
  code: "not_configured" | "invalid_request" | "unavailable";

  constructor(code: HotelRecommendationsError["code"]) {
    super(code);
    this.code = code;
  }
}

export function buildHotelSearchPayload(input: HotelSearchInput, locale: Locale) {
  const query = input.query?.trim();
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    area: input.area,
    ...(query ? { query } : {}),
    languageCode: locale === "ja" ? "ja" as const : "en" as const,
  };
}

export async function requestHotelRecommendations(
  input: HotelSearchInput,
  locale: Locale,
  signal?: AbortSignal,
): Promise<HotelRecommendationsResponse> {
  let response: Response;
  try {
    response = await fetch("/api/hotel-recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildHotelSearchPayload(input, locale)),
      signal,
    });
  } catch {
    throw new HotelRecommendationsError("unavailable");
  }
  const payload = await response.json().catch(() => null) as (HotelRecommendationsResponse & { code?: string }) | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new HotelRecommendationsError("not_configured");
    if (payload?.code === "invalid_request") throw new HotelRecommendationsError("invalid_request");
    throw new HotelRecommendationsError("unavailable");
  }
  return payload;
}
