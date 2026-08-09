import type { DestinationChoice } from "./destinations.ts";
import type { FreshVoicesDepth, FreshVoicesIntent, FreshVoicesResult } from "./fresh-voices.ts";
import type { Locale } from "./i18n.ts";
import type { RouteStop } from "./route-optimizer.ts";
import type { PlaceIntelligenceResult } from "./place-intelligence.ts";
import { tripRequestHeaders } from "./trip-request-identity.ts";

export class PlaceIntelligenceError extends Error {
  code: "not_configured" | "invalid_request" | "rate_limited" | "unavailable";

  constructor(code: PlaceIntelligenceError["code"]) {
    super(code);
    this.code = code;
  }
}

export async function requestPlaceIntelligence(
  stop: RouteStop,
  locale: Locale,
  destination: DestinationChoice = "auto",
  signal?: AbortSignal,
): Promise<PlaceIntelligenceResult> {
  const providerRef = stop.providerRef ?? (stop.id.startsWith("google-") ? stop.id.slice("google-".length) : undefined);
  const response = await fetch("/api/place-intelligence", {
    method: "POST",
    headers: tripRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      scope: "planning",
      name: stop.name,
      area: stop.area,
      latitude: stop.latitude,
      longitude: stop.longitude,
      ...(providerRef ? { providerRef } : {}),
      languageCode: locale === "ja" ? "ja" : "en",
      destination,
    }),
    signal,
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

export async function requestFreshVoices(
  stop: Pick<RouteStop, "name" | "area">,
  locale: Locale,
  options: {
    intent?: FreshVoicesIntent;
    depth?: FreshVoicesDepth;
    destination?: DestinationChoice;
    signal?: AbortSignal;
  } = {},
): Promise<FreshVoicesResult> {
  const response = await fetch("/api/place-intelligence/fresh", {
    method: "POST",
    headers: tripRequestHeaders({ "Content-Type": "application/json" }),
    cache: "no-store",
    body: JSON.stringify({
      name: stop.name,
      area: stop.area,
      languageCode: locale === "ja" ? "ja" : "en",
      destination: options.destination ?? "auto",
      intent: options.intent ?? "place",
      depth: options.depth ?? "deep",
    }),
    signal: options.signal,
  }).catch(() => null);
  if (!response) throw new PlaceIntelligenceError("unavailable");
  const payload = await response.json().catch(() => null) as (FreshVoicesResult & { code?: string }) | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new PlaceIntelligenceError("not_configured");
    if (payload?.code === "invalid_request") throw new PlaceIntelligenceError("invalid_request");
    if (payload?.code === "rate_limited") throw new PlaceIntelligenceError("rate_limited");
    throw new PlaceIntelligenceError("unavailable");
  }
  return payload;
}
