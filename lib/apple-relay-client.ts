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

export type AppleRelayEta = Readonly<{ minutes: number; distanceMeters: number | null }>;

const etaCache = new Map<string, AppleRelayEta | null>();
const transitCoverage = new Map<string, { answered: number; unanswered: number }>();

/**
 * Travel time for one leg and one mode. `null` means Apple has no answer for
 * this pair (it has no transit data for Japan, for instance) — an absence of
 * evidence, never a claim that the journey cannot be made.
 */
export async function appleRelayEta(
  options: Readonly<{
    origin: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    mode: "transit" | "walk" | "drive";
    departureTime?: string | null;
    signal?: AbortSignal;
  }>,
  relayUrl: string | null = appleRelayUrl(),
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<AppleRelayEta | null> {
  if (!relayUrl) throw new AppleRelayError("not_configured");
  const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
  const url = new URL(relayUrl, base);
  const point = (value: { latitude: number; longitude: number }) => `${value.latitude.toFixed(5)},${value.longitude.toFixed(5)}`;
  // The same place twice (a provisional base that is one of the stops) is
  // not a journey and not worth a quota unit.
  if (point(options.origin) === point(options.destination)) return { minutes: 1, distanceMeters: 0 };
  // Feeding measured minutes back into the schedule nudges every later
  // departure, and the planner asks again for the same pair a few minutes
  // on. Within the same hour the first answer stands.
  // Apple has no transit timetable for some countries (Japan). After a few
  // unanswered transit lookups around the same area and not one answer,
  // further ones there are not worth a quota unit each.
  const area = `${relayUrl}|${Math.round(options.origin.latitude)},${Math.round(options.origin.longitude)}`;
  const coverage = options.mode === "transit" ? transitCoverage.get(area) : undefined;
  if (coverage && coverage.answered === 0 && coverage.unanswered >= 3) return null;
  const hour = options.departureTime ? options.departureTime.slice(0, 13) : "now";
  const cacheKey = [relayUrl, point(options.origin), point(options.destination), options.mode, hour].join("|");
  const cached = etaCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const remember = (value: AppleRelayEta | null) => {
    if (options.mode === "transit") {
      const seen = transitCoverage.get(area) ?? { answered: 0, unanswered: 0 };
      if (value) seen.answered += 1;
      else seen.unanswered += 1;
      transitCoverage.set(area, seen);
    }
    etaCache.set(cacheKey, value);
    if (etaCache.size > 600) etaCache.delete(etaCache.keys().next().value as string);
    return value;
  };
  url.searchParams.set("op", "eta");
  url.searchParams.set("from", point(options.origin));
  url.searchParams.set("to", point(options.destination));
  url.searchParams.set("mode", options.mode);
  if (options.departureTime) url.searchParams.set("depart", options.departureTime);
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AppleRelayError("unavailable");
  }
  const payload = await response.json().catch(() => null) as { code?: unknown; minutes?: unknown; distanceMeters?: unknown } | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new AppleRelayError("not_configured");
    if (response.status === 429) throw new AppleRelayError("quota_exhausted");
    throw new AppleRelayError("unavailable");
  }
  const minutes = Number(payload.minutes);
  if (payload.minutes === null || !Number.isFinite(minutes) || minutes <= 0) return remember(null);
  const meters = Number(payload.distanceMeters);
  return remember({ minutes: Math.round(minutes), distanceMeters: Number.isFinite(meters) && meters > 0 ? Math.round(meters) : null });
}

export type AppleRelayRoute = Readonly<{
  minutes: number;
  distanceMeters: number | null;
  path: Array<{ latitude: number; longitude: number }>;
}>;

const routeCache = new Map<string, AppleRelayRoute | null>();

/**
 * The way along the streets between two points, on foot or by car. Null when
 * Apple cannot route the pair. Remembered per pair and mode: the streets do
 * not move between two looks at the same booklet.
 */
export async function appleRelayRoute(
  options: Readonly<{
    origin: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    mode: "walk" | "drive";
    signal?: AbortSignal;
  }>,
  relayUrl: string | null = appleRelayUrl(),
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<AppleRelayRoute | null> {
  if (!relayUrl) throw new AppleRelayError("not_configured");
  const point = (value: { latitude: number; longitude: number }) => `${value.latitude.toFixed(5)},${value.longitude.toFixed(5)}`;
  const cacheKey = [relayUrl, point(options.origin), point(options.destination), options.mode].join("|");
  const cached = routeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
  const url = new URL(relayUrl, base);
  url.searchParams.set("op", "route");
  url.searchParams.set("from", point(options.origin));
  url.searchParams.set("to", point(options.destination));
  url.searchParams.set("mode", options.mode);
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AppleRelayError("unavailable");
  }
  const payload = await response.json().catch(() => null) as { code?: unknown; minutes?: unknown; distanceMeters?: unknown; path?: unknown } | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new AppleRelayError("not_configured");
    if (response.status === 429) throw new AppleRelayError("quota_exhausted");
    throw new AppleRelayError("unavailable");
  }
  const minutes = Number(payload.minutes);
  const path = (Array.isArray(payload.path) ? payload.path : []).flatMap((raw): Array<{ latitude: number; longitude: number }> => {
    if (!Array.isArray(raw)) return [];
    const latitude = Number(raw[0]);
    const longitude = Number(raw[1]);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? [{ latitude, longitude }] : [];
  }).slice(0, 400);
  const meters = Number(payload.distanceMeters);
  const route = payload.minutes === null || !Number.isFinite(minutes) || minutes <= 0 || path.length < 2
    ? null
    : { minutes: Math.round(minutes), distanceMeters: Number.isFinite(meters) && meters > 0 ? Math.round(meters) : null, path };
  routeCache.set(cacheKey, route);
  if (routeCache.size > 400) routeCache.delete(routeCache.keys().next().value as string);
  return route;
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
