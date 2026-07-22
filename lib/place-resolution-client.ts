import type { Locale } from "./i18n.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import { resolveKnownStops } from "./route-optimizer.ts";
import { parsedWishlistPlaces } from "./wishlist-parser.ts";

export type PlaceResolutionResponse = {
  provider: "google_maps";
  fetchedAt: string;
  places: ResolvedInputStop[];
  hotel: ResolvedInputStop | null;
};

export class PlaceResolutionError extends Error {
  code: "not_configured" | "invalid_request" | "unavailable";

  constructor(code: PlaceResolutionError["code"]) {
    super(code);
    this.code = code;
  }
}

export function buildPlaceResolutionPayload(raw: string, hotelQuery: string, locale: Locale) {
  // The shared wishlist parser strips day headings, times and marker words, so
  // Google receives clean place names and never any schedule detail.
  const queries = parsedWishlistPlaces(raw).flatMap(({ name }) => (
    resolveKnownStops(name, locale).length > 0 ? [] : [name]
  ));
  return {
    // A pasted three-to-five day trip regularly contains more than twelve
    // places. Keep a firm cost ceiling, but do not silently discard the second
    // half of an ordinary wishlist.
    queries: [...new Set(queries)].slice(0, 24),
    hotelQuery: hotelQuery.trim() || null,
    languageCode: locale === "ja" ? "ja" as const : "en" as const,
  };
}

export async function requestPlaceResolution(raw: string, hotelQuery: string, locale: Locale, signal?: AbortSignal): Promise<PlaceResolutionResponse> {
  const payload = buildPlaceResolutionPayload(raw, hotelQuery, locale);
  if (payload.queries.length === 0 && !payload.hotelQuery) {
    return { provider: "google_maps", fetchedAt: "", places: [], hotel: null };
  }
  let response: Response;
  try {
    response = await fetch("/api/place-resolution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    throw new PlaceResolutionError("unavailable");
  }
  const body = await response.json().catch(() => null) as (PlaceResolutionResponse & { code?: string }) | null;
  if (!response.ok || !body) {
    if (body?.code === "not_configured") throw new PlaceResolutionError("not_configured");
    if (body?.code === "invalid_request") throw new PlaceResolutionError("invalid_request");
    throw new PlaceResolutionError("unavailable");
  }
  return body;
}
