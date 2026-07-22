import type { Locale } from "./i18n.ts";

export type TripIdeasResponse = {
  provider: "anthropic";
  concept: string;
  places: string[];
};

export class TripIdeasError extends Error {
  code: "not_configured" | "rate_limited" | "unavailable";

  constructor(code: TripIdeasError["code"]) {
    super(code);
    this.code = code;
  }
}

export async function requestTripIdeas(concept: string, locale: Locale, signal?: AbortSignal): Promise<TripIdeasResponse> {
  let response: Response;
  try {
    response = await fetch("/api/trip-ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept, languageCode: locale === "ja" ? "ja" : "en" }),
      signal,
    });
  } catch {
    throw new TripIdeasError("unavailable");
  }
  const body = await response.json().catch(() => null) as (TripIdeasResponse & { code?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.places)) {
    if (body?.code === "not_configured") throw new TripIdeasError("not_configured");
    if (body?.code === "rate_limited") throw new TripIdeasError("rate_limited");
    throw new TripIdeasError("unavailable");
  }
  return body;
}
