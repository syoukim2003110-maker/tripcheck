import type { Locale } from "./i18n.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import { resolveKnownStops } from "./route-optimizer.ts";

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

const dayHeadingPattern = /^(?:day\s*\d+|\d+\s*日目|\d+\s*일차|第?\s*\d+\s*天)(?:\s*[-–—:].*)?$/i;

export function cleanPlaceQuery(line: string) {
  return line
    .replace(/^[-•*]\s*/, "")
    .replace(/^\d{1,2}(?::|\.)\d{2}\s*(?:[-–—:]\s*)?/, "")
    .replace(/\s+[—–-]\s+(?:day\s*\d+|\d+\s*日目|予約|確定|必須|絶対|時間があれば|滞在|booked|reserved|must(?:-do)?|optional|stay\s*\d+|(?:[01]?\d|2[0-3]):[0-5]\d).*$/i, "")
    .replace(/\s+@\s*(?:[01]?\d|2[0-3]):[0-5]\d.*$/, "")
    .replace(/\s*(?:滞在\s*\d{1,3}\s*分|\d{1,3}\s*分\s*滞在|\bstay\s*\d{1,3}\s*min(?:ute)?s?)\s*$/i, "")
    .trim();
}

export function buildPlaceResolutionPayload(raw: string, hotelQuery: string, locale: Locale) {
  const queries = raw.split("\n").flatMap((rawLine) => {
    const line = rawLine.trim();
    if (!line || dayHeadingPattern.test(line)) return [];
    const query = cleanPlaceQuery(line);
    if (!query || resolveKnownStops(query, locale).length > 0) return [];
    return [query];
  });
  return {
    queries: [...new Set(queries)].slice(0, 12),
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
