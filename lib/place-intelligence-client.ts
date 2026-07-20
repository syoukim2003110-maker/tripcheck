import type { Locale } from "./i18n.ts";
import type { RouteStop } from "./route-optimizer.ts";
import type { PlaceIntelligenceResult } from "./place-intelligence.ts";

export class PlaceIntelligenceError extends Error {
  code: "not_configured" | "invalid_request" | "unavailable";

  constructor(code: PlaceIntelligenceError["code"]) {
    super(code);
    this.code = code;
  }
}

export async function requestPlaceIntelligence(stop: RouteStop, locale: Locale): Promise<PlaceIntelligenceResult> {
  const response = await fetch("/api/place-intelligence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: stop.name,
      area: stop.area,
      languageCode: locale === "ja" ? "ja" : "en",
    }),
  }).catch(() => null);
  if (!response) throw new PlaceIntelligenceError("unavailable");
  const payload = await response.json().catch(() => null) as (PlaceIntelligenceResult & { code?: string }) | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new PlaceIntelligenceError("not_configured");
    if (payload?.code === "invalid_request") throw new PlaceIntelligenceError("invalid_request");
    throw new PlaceIntelligenceError("unavailable");
  }
  return payload;
}
