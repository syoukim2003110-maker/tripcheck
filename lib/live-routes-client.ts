import type { Locale } from "./i18n.ts";
import { routeLegKey, type BuiltTripPlan } from "./trip-builder.ts";
import type { LiveRouteResult } from "./google-routes.ts";

export type LiveRoutesResponse = {
  provider: "google_maps";
  fetchedAt: string;
  legs: LiveRouteResult[];
};

export class LiveRoutesError extends Error {
  code: "missing_date" | "not_configured" | "invalid_or_out_of_range" | "unavailable";

  constructor(code: "missing_date" | "not_configured" | "invalid_or_out_of_range" | "unavailable") {
    super(code);
    this.code = code;
  }
}

function languageCode(locale: Locale) {
  return locale === "zh" ? "zh-CN" : locale;
}

export async function requestLiveTransit(plan: BuiltTripPlan, locale: Locale): Promise<LiveRoutesResponse> {
  const legs = plan.days.flatMap((day) => {
    if (!day.date) return [];
    return day.legs.flatMap((leg, index) => leg.isLocalMealPause ? [] : [{
      id: routeLegKey(leg.from.id, leg.to.id),
      origin: { latitude: leg.from.latitude, longitude: leg.from.longitude },
      destination: { latitude: leg.to.latitude, longitude: leg.to.longitude },
      departureTime: `${day.date}T${day.stops[index].departure}:00+09:00`,
    }]);
  });
  if (legs.length === 0) throw new LiveRoutesError("missing_date");

  let response: Response;
  try {
    response = await fetch("/api/live-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legs, languageCode: languageCode(locale) }),
    });
  } catch {
    throw new LiveRoutesError("unavailable");
  }
  const payload = await response.json().catch(() => null) as (LiveRoutesResponse & { code?: string }) | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new LiveRoutesError("not_configured");
    if (payload?.code === "invalid_or_out_of_range") throw new LiveRoutesError("invalid_or_out_of_range");
    throw new LiveRoutesError("unavailable");
  }
  return payload;
}
