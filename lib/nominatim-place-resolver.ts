import {
  destinationById,
  destinationPlaceQuery,
  withinBounds,
  type Destination,
} from "./destinations.ts";
import {
  areaFromAddress,
  selectPlaceResolutionCandidates,
  type PlaceResolutionRequest,
} from "./google-place-resolver.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import { estimateStayMinutes } from "./stay-estimates.ts";

export const NOMINATIM_ATTRIBUTION = Object.freeze({
  label: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
});

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_INTERVAL_MS = 1_100;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_CACHE_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CONTACT_URL = "https://github.com/syoukim2003110-maker/tripcheck";

type NominatimSearchResult = {
  place_id?: number | string;
  osm_type?: string;
  osm_id?: number | string;
  lat?: string;
  lon?: string;
  category?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  name?: string;
  display_name?: string;
  address?: { country_code?: string };
};

type CacheEntry = Readonly<{
  expiresAt: number;
  candidates: ResolvedInputStop[];
}>;

type ResolverOptions = Partial<{
  fetcher: typeof fetch;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
  intervalMs: number;
  cacheTtlMs: number;
  maximumCacheEntries: number;
  timeoutMs: number;
  userAgent: string;
  /** In a web page the browser's own Referer identifies the application. */
  browser: boolean;
}>;

/** The one place this module reaches the network when no fetcher is injected. */
export function defaultNominatimFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, init);
}

function normalizedHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 256);
}

function configuredUserAgent() {
  const environment: Record<string, string | undefined> = typeof process !== "undefined" && process.env ? process.env : {};
  const explicit = normalizedHeaderValue(environment.TRIPCHECK_NOMINATIM_USER_AGENT ?? "");
  if (explicit) return explicit;
  let contact = DEFAULT_CONTACT_URL;
  try {
    const publicOrigin = environment.TRIPCHECK_PUBLIC_ORIGIN?.trim();
    if (publicOrigin) contact = new URL(publicOrigin).origin;
  } catch {
    // A malformed deployment origin must not produce an invalid HTTP header.
  }
  return `TripCheck/0.1 (+${contact})`;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("request_aborted");
}

async function waitUnlessAborted(
  delayMs: number,
  sleep: (delayMs: number) => Promise<void>,
  signal?: AbortSignal,
) {
  if (delayMs <= 0) return;
  if (!signal) {
    await sleep(delayMs);
    return;
  }
  if (signal.aborted) throw abortError(signal);
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      sleep(delayMs),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError(signal));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function osmObjectUrl(result: NominatimSearchResult) {
  const objectType = result.osm_type?.trim().toLocaleLowerCase("en-US");
  const objectId = String(result.osm_id ?? "").trim();
  if (!objectType || !["node", "way", "relation"].includes(objectType) || !/^\d{1,24}$/.test(objectId)) return null;
  return {
    id: `osm-${objectType}-${objectId}`,
    sourceUrl: `https://www.openstreetmap.org/${objectType}/${objectId}`,
  };
}

function countryCodeFromNominatim(result: NominatimSearchResult) {
  const code = result.address?.country_code?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function resolvedPlaceFromNominatim(
  input: string,
  result: NominatimSearchResult,
  destination: Destination,
  verifiedAt: string,
): ResolvedInputStop | null {
  const object = osmObjectUrl(result);
  const displayName = result.display_name?.trim() ?? "";
  const name = result.name?.trim() || displayName.split(",")[0]?.trim();
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  if (!object || !name || !displayName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (!withinBounds(destination.bounds, latitude, longitude)) return null;
  const placeTypes = [...new Set([
    result.category,
    result.class,
    result.type,
    result.addresstype,
  ].flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []))];
  const countryCode = countryCodeFromNominatim(result);
  return {
    id: object.id,
    input,
    name,
    area: areaFromAddress(displayName, name, destination),
    address: displayName,
    ...(countryCode ? { countryCode } : {}),
    latitude,
    longitude,
    sourceUrl: object.sourceUrl,
    verifiedAt,
    confidence: "medium",
    planningDurationMinutes: estimateStayMinutes(`${input} ${name}`, placeTypes, 90),
    isAnchor: false,
    placeTypes,
  };
}

function cacheKey(input: string, languageCode: "en" | "ja", destination: Destination) {
  return JSON.stringify([
    input.normalize("NFKC").trim().toLocaleLowerCase(),
    languageCode,
    destination.id,
  ]);
}

/**
 * Small-deployment adapter for the public Nominatim service.
 *
 * The public policy forbids autocomplete and caps the whole application at
 * one request per second. This adapter is called only by the explicit trip
 * build endpoint, serializes network starts inside one isolate, and caches
 * both hits and misses. Multi-isolate production traffic still needs a
 * globally coordinated proxy or a hosted Nominatim instance before scaling.
 */
export class NominatimPlaceResolver {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly intervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly maximumCacheEntries: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly browser: boolean;
  private readonly cache = new Map<string, CacheEntry>();
  private queue: Promise<void> = Promise.resolve();
  private nextNetworkStartAt = 0;

  constructor(options: ResolverOptions = {}) {
    this.fetcher = options.fetcher ?? defaultNominatimFetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.intervalMs = Math.max(1_000, Math.floor(options.intervalMs ?? DEFAULT_INTERVAL_MS));
    this.cacheTtlMs = Math.max(1, Math.floor(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
    this.maximumCacheEntries = Math.max(1, Math.floor(options.maximumCacheEntries ?? DEFAULT_CACHE_ENTRIES));
    this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    this.userAgent = normalizedHeaderValue(options.userAgent ?? configuredUserAgent()) || configuredUserAgent();
    this.browser = options.browser ?? false;
  }

  private cachedCandidates(key: string, input: string) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= this.now()) {
      this.cache.delete(key);
      return null;
    }
    // Refresh insertion order for the bounded least-recently-used eviction.
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached.candidates.map((candidate) => ({ ...candidate, input }));
  }

  private remember(key: string, candidates: ResolvedInputStop[]) {
    this.cache.set(key, {
      expiresAt: this.now() + this.cacheTtlMs,
      candidates: candidates.map((candidate) => ({ ...candidate })),
    });
    while (this.cache.size > this.maximumCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (typeof oldest !== "string") break;
      this.cache.delete(oldest);
    }
  }

  private async networkTurn<T>(signal: AbortSignal | undefined, operation: () => Promise<T>) {
    let release = () => {};
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (signal?.aborted) throw abortError(signal);
      await waitUnlessAborted(this.nextNetworkStartAt - this.now(), this.sleep, signal);
      if (signal?.aborted) throw abortError(signal);
      this.nextNetworkStartAt = this.now() + this.intervalMs;
      return await operation();
    } finally {
      release();
    }
  }

  async search(
    input: string,
    languageCode: "en" | "ja",
    destination: Destination,
    signal?: AbortSignal,
  ): Promise<ResolvedInputStop[]> {
    const key = cacheKey(input, languageCode, destination);
    const cached = this.cachedCandidates(key, input);
    if (cached) return cached;

    return this.networkTurn(signal, async () => {
      // A concurrent request may have populated the same key while this one
      // was waiting for its one-per-second turn.
      const afterWait = this.cachedCandidates(key, input);
      if (afterWait) return afterWait;

      const url = new URL(NOMINATIM_SEARCH_URL);
      url.searchParams.set("q", destinationPlaceQuery(input, destination, languageCode));
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "3");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("namedetails", "1");
      url.searchParams.set("accept-language", languageCode);
      if (destination.countryCodes.length > 0) {
        // OpenStreetMap files Hong Kong and Macau under country code "cn";
        // asking for "hk" alone returns nothing at all. The bounded viewbox
        // below still keeps the answer inside the territory.
        const codes = new Set(destination.countryCodes.map((code) => code.toLocaleLowerCase("en-US")));
        if (codes.has("hk") || codes.has("mo")) codes.add("cn");
        url.searchParams.set("countrycodes", [...codes].join(","));
      }
      if (destination.bounds) {
        url.searchParams.set("viewbox", [
          destination.bounds.west,
          destination.bounds.north,
          destination.bounds.east,
          destination.bounds.south,
        ].join(","));
        url.searchParams.set("bounded", "1");
      }

      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const providerSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await this.fetcher(url, {
        method: "GET",
        headers: this.browser
          ? { Accept: "application/json", "Accept-Language": languageCode }
          : { Accept: "application/json", "Accept-Language": languageCode, "User-Agent": this.userAgent },
        signal: providerSignal,
      });
      if (!response.ok) throw new Error("nominatim_unavailable");
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) throw new Error("nominatim_invalid_response");
      const verifiedAt = new Date(this.now()).toISOString();
      const seen = new Set<string>();
      const candidates = payload.slice(0, 3).flatMap((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const resolved = resolvedPlaceFromNominatim(input, raw as NominatimSearchResult, destination, verifiedAt);
        if (!resolved || seen.has(resolved.id)) return [];
        seen.add(resolved.id);
        return [resolved];
      });
      this.remember(key, candidates);
      return candidates;
    });
  }
}

const publicNominatimResolver = new NominatimPlaceResolver();

export async function fetchNominatimPlaceResolutions(
  request: PlaceResolutionRequest,
  signal?: AbortSignal,
  resolver: NominatimPlaceResolver = publicNominatimResolver,
) {
  const destination = destinationById(request.destination === "auto" ? "worldwide" : request.destination);
  const inputs = [...request.queries, ...(request.hotelQuery ? [request.hotelQuery] : [])];
  const results: ResolvedInputStop[][] = [];
  // Deliberately serial: Promise.all would violate the public-service policy.
  for (const input of inputs) results.push(await resolver.search(input, request.languageCode, destination, signal));
  // providerOverrides are Google Place IDs. An exact choice that cannot be
  // rehydrated must stay unresolved; it must never degrade to fuzzy OSM text.
  return selectPlaceResolutionCandidates(request, results);
}
