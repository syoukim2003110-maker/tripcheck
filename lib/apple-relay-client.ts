import type { MapsPlaceSearch } from "./open-place-resolver.ts";

/*
 * Browser side of the Apple Maps relay.
 *
 * The Apple private key can never ship to a browser, so a statically hosted
 * app reaches Apple through a small relay on its own host (a PHP file on
 * shared hosting; a Node script in local development). The relay accepts only
 * a search — words, language, an optional point or bounded area, optional
 * categories — and returns place names and coordinates. No itinerary text.
 *
 * With no relay URL configured every function here answers "not available"
 * and the app runs on open data alone.
 */

export type AppleRelayPlace = Readonly<{
  id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  locality: string | null;
  subLocality: string | null;
  countryCode: string | null;
  poiCategory: string | null;
}>;

export type AppleRelaySearchOptions = Readonly<{
  query: string;
  language: string;
  near?: { latitude: number; longitude: number } | null;
  withinMeters?: number | null;
  poiCategories?: readonly string[];
  poiOnly?: boolean;
  signal?: AbortSignal;
}>;

export class AppleRelayError extends Error {
  code: "not_configured" | "quota_exhausted" | "unavailable";

  constructor(code: AppleRelayError["code"]) {
    super(`apple_relay_${code}`);
    this.code = code;
  }
}

/** The relay endpoint, or null when this build has none. */
export function appleRelayUrl() {
  const configured = process.env.NEXT_PUBLIC_APPLE_RELAY_URL?.trim();
  return configured ? configured : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function appleRelaySearch(
  options: AppleRelaySearchOptions,
  relayUrl: string | null = appleRelayUrl(),
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<AppleRelayPlace[]> {
  if (!relayUrl) throw new AppleRelayError("not_configured");
  const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
  const url = new URL(relayUrl, base);
  url.searchParams.set("q", options.query);
  url.searchParams.set("lang", options.language);
  if (options.near) {
    url.searchParams.set("near", `${options.near.latitude.toFixed(5)},${options.near.longitude.toFixed(5)}`);
    if (options.withinMeters) url.searchParams.set("within", String(Math.round(options.withinMeters)));
  }
  if (options.poiCategories?.length) url.searchParams.set("categories", options.poiCategories.join(","));
  if (options.poiOnly) url.searchParams.set("poi", "1");

  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AppleRelayError("unavailable");
  }
  const payload = await response.json().catch(() => null) as { code?: unknown; results?: unknown } | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new AppleRelayError("not_configured");
    if (response.status === 429) throw new AppleRelayError("quota_exhausted");
    throw new AppleRelayError("unavailable");
  }
  if (!Array.isArray(payload.results)) return [];
  return payload.results.flatMap((raw): AppleRelayPlace[] => {
    if (!raw || typeof raw !== "object") return [];
    const place = raw as Record<string, unknown>;
    const name = text(place.name);
    const latitude = Number(place.latitude);
    const longitude = Number(place.longitude);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
    const countryCode = text(place.countryCode)?.toUpperCase() ?? null;
    return [{
      id: text(place.id),
      name,
      latitude,
      longitude,
      formattedAddress: text(place.formattedAddress) ?? "",
      locality: text(place.locality),
      subLocality: text(place.subLocality),
      countryCode: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
      poiCategory: text(place.poiCategory),
    }];
  });
}

/** The relay as a search client, shaped like the server-side Apple client. */
export function appleRelayClient(relayUrl: string | null = appleRelayUrl()) {
  if (!relayUrl) return null;
  return { search: (options: AppleRelaySearchOptions) => appleRelaySearch(options, relayUrl) };
}

/** The relay as the open resolver's optional maps search. */
export function appleRelayPlaceSearch(relayUrl: string | null = appleRelayUrl()): MapsPlaceSearch | null {
  const client = appleRelayClient(relayUrl);
  if (!client) return null;
  return async (input, languageCode, near, signal) => {
    const places = await client.search({
      query: input,
      language: languageCode === "ja" ? "ja-JP" : "en-US",
      near,
      signal,
    });
    return places.map((place) => ({
      id: place.id,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.formattedAddress,
      area: place.subLocality ?? place.locality,
      countryCode: place.countryCode,
      category: place.poiCategory,
    }));
  };
}
