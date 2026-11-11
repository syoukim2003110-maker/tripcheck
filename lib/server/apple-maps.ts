/*
 * Apple Maps Server API adapter.
 *
 * Included with an Apple Developer Program membership and metered by a daily
 * service-call quota rather than by money, so it sits between the keyless
 * open-data sources and the paid Google surfaces: it is used whenever its
 * three credentials are configured, and never needs the paid-API opt-in.
 *
 * Contract verified against Apple's documentation (2026-11):
 *   - auth token: ES256 JWT, header {alg, kid, typ}, claims {iss, iat, exp,
 *     scope: "server_api"}, signed with the Maps private key (.p8);
 *   - GET /v1/token exchanges it for {accessToken, expiresInSeconds};
 *   - GET /v1/search   q, lang, searchLocation, searchRegion,
 *                      searchRegionPriority, includePoiCategories,
 *                      resultTypeFilter → {results: Place[]};
 *   - GET /v1/etas     origin, destinations, transportType (Automobile |
 *                      Transit | Walking), departureDate → {etas: [{
 *                      expectedTravelTimeSeconds, distanceMeters}]};
 *   - GET /v1/directions origin, destination, transportType (Automobile |
 *                      Walking) → {routes, steps, stepPaths}.
 * Checked against the live service on 2026-11-11 (token exchange, search).
 *
 * Apple place data is fetched at request time and never written to storage.
 */

const APPLE_MAPS_ORIGIN = "https://maps-api.apple.com";
const AUTH_TOKEN_LIFETIME_SECONDS = 30 * 60;
const REQUEST_TIMEOUT_MS = 6_000;
/** Stay well inside Apple's daily service-call quota from one process. */
const DEFAULT_DAILY_CALL_CEILING = 15_000;

export type AppleMapsCredentials = Readonly<{
  teamId: string;
  keyId: string;
  /** PKCS#8 PEM, exactly as downloaded (.p8). "\n" escapes are accepted. */
  privateKey: string;
}>;

export type AppleMapsPlace = Readonly<{
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

export type AppleMapsSearchOptions = Readonly<{
  query: string;
  /** BCP 47, e.g. "ja-JP". */
  language: string;
  near?: { latitude: number; longitude: number } | null;
  /** When set with `near`, results outside this radius are not wanted. */
  withinMeters?: number | null;
  poiCategories?: readonly string[];
  poiOnly?: boolean;
  signal?: AbortSignal;
}>;

export type AppleMapsEtaOptions = Readonly<{
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  mode: "transit" | "walk" | "drive";
  /** ISO 8601 instant; omitted means "now". */
  departureTime?: string | null;
  signal?: AbortSignal;
}>;

export type AppleMapsEta = Readonly<{ minutes: number; distanceMeters: number | null }>;

export type AppleMapsRoute = Readonly<{
  minutes: number;
  distanceMeters: number | null;
  path: Array<{ latitude: number; longitude: number }>;
}>;

/** Keeps a path's shape with at most `limit` points (first and last always). */
export function thinPath<T>(path: T[], limit: number): T[] {
  if (path.length <= limit) return path;
  const step = (path.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => path[Math.round(index * step)]);
}

export class AppleMapsError extends Error {
  code: "not_configured" | "unauthorized" | "quota_exhausted" | "unavailable";

  constructor(code: AppleMapsError["code"]) {
    super(`apple_maps_${code}`);
    this.code = code;
  }
}

export function appleMapsCredentialsFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): AppleMapsCredentials | null {
  const teamId = environment.APPLE_MAPS_TEAM_ID?.trim() ?? "";
  const keyId = environment.APPLE_MAPS_KEY_ID?.trim() ?? "";
  const privateKey = (environment.APPLE_MAPS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Z0-9]{10}$/.test(keyId)) return null;
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(privateKey)) return null;
  return { teamId, keyId, privateKey };
}

function base64Url(bytes: Uint8Array | string) {
  const binary = typeof bytes === "string"
    ? unescape(encodeURIComponent(bytes))
    : Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string) {
  const body = pem.replace(/-----(?:BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Signs the short-lived Maps auth token. Exported for the signature test. */
export async function signAppleMapsAuthToken(credentials: AppleMapsCredentials, nowMs: number) {
  const issuedAt = Math.floor(nowMs / 1_000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.teamId,
    iat: issuedAt,
    exp: issuedAt + AUTH_TOKEN_LIFETIME_SECONDS,
    scope: "server_api",
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(credentials.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto returns the raw r‖s form that JWS ES256 requires.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

type ClientOptions = Partial<{
  fetcher: typeof fetch;
  now: () => number;
  dailyCallCeiling: number;
}>;

export class AppleMapsClient {
  private readonly credentials: AppleMapsCredentials;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly dailyCallCeiling: number;
  private accessToken: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;
  private callDay = "";
  private callsToday = 0;

  constructor(credentials: AppleMapsCredentials, options: ClientOptions = {}) {
    this.credentials = credentials;
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
    this.dailyCallCeiling = Math.max(1, Math.floor(options.dailyCallCeiling ?? DEFAULT_DAILY_CALL_CEILING));
  }

  private countCall() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.callDay) {
      this.callDay = day;
      this.callsToday = 0;
    }
    if (this.callsToday >= this.dailyCallCeiling) throw new AppleMapsError("quota_exhausted");
    this.callsToday += 1;
  }

  private async request(url: URL, bearer: string, signal?: AbortSignal) {
    this.countCall();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${bearer}`,
          // The Workers runtime sends no User-Agent of its own; identify the
          // client. (Known issue, 2026-11-11: from the local workerd runtime
          // Apple's edge answers every request "403 Forbidden" before the API
          // sees it, with or without this header, while the identical request
          // from Node or curl succeeds. Not yet tested from a deployed host.)
          "User-Agent": "TripCheck/0.1",
        },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AppleMapsError("unavailable");
    }
    if (response.status === 401) throw new AppleMapsError("unauthorized");
    if (response.status === 429) throw new AppleMapsError("quota_exhausted");
    if (!response.ok) throw new AppleMapsError("unavailable");
    try {
      return await response.json() as unknown;
    } catch {
      throw new AppleMapsError("unavailable");
    }
  }

  private async token(signal?: AbortSignal) {
    if (this.accessToken && this.accessToken.expiresAt > this.now() + 60_000) return this.accessToken.value;
    // Concurrent lookups share one exchange instead of minting a token each.
    this.pendingToken ??= (async () => {
      try {
        const authToken = await signAppleMapsAuthToken(this.credentials, this.now());
        const payload = await this.request(new URL("/v1/token", APPLE_MAPS_ORIGIN), authToken, signal) as {
          accessToken?: unknown;
          expiresInSeconds?: unknown;
        };
        if (typeof payload.accessToken !== "string" || !payload.accessToken) throw new AppleMapsError("unavailable");
        const lifetime = typeof payload.expiresInSeconds === "number" && payload.expiresInSeconds > 0
          ? payload.expiresInSeconds
          : 60;
        this.accessToken = { value: payload.accessToken, expiresAt: this.now() + lifetime * 1_000 };
        return payload.accessToken;
      } finally {
        this.pendingToken = null;
      }
    })();
    return this.pendingToken;
  }

  private async authorized(url: URL, signal?: AbortSignal) {
    try {
      return await this.request(url, await this.token(signal), signal);
    } catch (error) {
      // An access token can be revoked before its stated expiry. One fresh
      // exchange, then the failure is real.
      if (!(error instanceof AppleMapsError) || error.code !== "unauthorized" || !this.accessToken) throw error;
      this.accessToken = null;
      return this.request(url, await this.token(signal), signal);
    }
  }

  /**
   * Travel time between two points for one mode. `null` means Apple has no
   * answer for this pair and mode (no transit coverage, no walkable path) —
   * an absence of evidence, not a claim that the journey is impossible.
   */
  async eta(options: AppleMapsEtaOptions): Promise<AppleMapsEta | null> {
    const url = new URL("/v1/etas", APPLE_MAPS_ORIGIN);
    const point = (value: { latitude: number; longitude: number }) => `${value.latitude.toFixed(6)},${value.longitude.toFixed(6)}`;
    url.searchParams.set("origin", point(options.origin));
    url.searchParams.set("destinations", point(options.destination));
    url.searchParams.set("transportType", options.mode === "walk" ? "Walking" : options.mode === "drive" ? "Automobile" : "Transit");
    if (options.departureTime) {
      const departure = new Date(options.departureTime);
      if (Number.isFinite(departure.getTime())) url.searchParams.set("departureDate", departure.toISOString().replace(/\.\d{3}Z$/, "Z"));
    }
    let payload: { etas?: unknown };
    try {
      payload = await this.authorized(url, options.signal) as { etas?: unknown };
    } catch (error) {
      // Apple answers 4xx/5xx for a pair it cannot route; quota and auth
      // failures are still real failures.
      if (error instanceof AppleMapsError && error.code === "unavailable") return null;
      throw error;
    }
    const first = Array.isArray(payload.etas) ? payload.etas[0] as {
      expectedTravelTimeSeconds?: unknown;
      distanceMeters?: unknown;
    } | undefined : undefined;
    const seconds = Number(first?.expectedTravelTimeSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const meters = Number(first?.distanceMeters);
    return {
      minutes: Math.max(1, Math.round(seconds / 60)),
      distanceMeters: Number.isFinite(meters) && meters > 0 ? Math.round(meters) : null,
    };
  }

  /**
   * The way from one point to another on foot or by car: duration, distance
   * and the path along the streets. Null when Apple cannot route the pair.
   * There is no transit mode in this API.
   */
  async route(options: Omit<AppleMapsEtaOptions, "mode" | "departureTime"> & { mode: "walk" | "drive" }): Promise<AppleMapsRoute | null> {
    const url = new URL("/v1/directions", APPLE_MAPS_ORIGIN);
    const point = (value: { latitude: number; longitude: number }) => `${value.latitude.toFixed(6)},${value.longitude.toFixed(6)}`;
    url.searchParams.set("origin", point(options.origin));
    url.searchParams.set("destination", point(options.destination));
    url.searchParams.set("transportType", options.mode === "walk" ? "Walking" : "Automobile");
    let payload: { routes?: unknown; steps?: unknown; stepPaths?: unknown };
    try {
      payload = await this.authorized(url, options.signal) as typeof payload;
    } catch (error) {
      if (error instanceof AppleMapsError && error.code === "unavailable") return null;
      throw error;
    }
    const route = Array.isArray(payload.routes) ? payload.routes[0] as { durationSeconds?: unknown; distanceMeters?: unknown; stepIndexes?: unknown } | undefined : undefined;
    const seconds = Number(route?.durationSeconds);
    if (!route || !Number.isFinite(seconds) || seconds <= 0) return null;
    const steps = Array.isArray(payload.steps) ? payload.steps as Array<{ stepPathIndex?: unknown }> : [];
    const stepPaths = Array.isArray(payload.stepPaths) ? payload.stepPaths as unknown[] : [];
    const path: Array<{ latitude: number; longitude: number }> = [];
    for (const stepIndex of Array.isArray(route.stepIndexes) ? route.stepIndexes as unknown[] : []) {
      const step = steps[Number(stepIndex)];
      const points = stepPaths[Number(step?.stepPathIndex)];
      if (!Array.isArray(points)) continue;
      for (const raw of points as Array<{ latitude?: unknown; longitude?: unknown }>) {
        const latitude = Number(raw?.latitude);
        const longitude = Number(raw?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
        const last = path.at(-1);
        // Consecutive step paths repeat their shared point.
        if (last && last.latitude === latitude && last.longitude === longitude) continue;
        path.push({ latitude, longitude });
      }
    }
    const meters = Number(route.distanceMeters);
    return {
      minutes: Math.max(1, Math.round(seconds / 60)),
      distanceMeters: Number.isFinite(meters) && meters > 0 ? Math.round(meters) : null,
      path: thinPath(path, 160),
    };
  }

  async search(options: AppleMapsSearchOptions): Promise<AppleMapsPlace[]> {
    const url = new URL("/v1/search", APPLE_MAPS_ORIGIN);
    url.searchParams.set("q", options.query);
    url.searchParams.set("lang", options.language);
    if (options.poiOnly) url.searchParams.set("resultTypeFilter", "Poi");
    if (options.poiCategories?.length) url.searchParams.set("includePoiCategories", options.poiCategories.join(","));
    if (options.near) {
      const { latitude, longitude } = options.near;
      // The live service rejects a request carrying both hints ("Cannot
      // specify both searchRegion and searchLocation"), so a bounded search
      // sends the region alone and an unbounded one the point alone.
      if (!options.withinMeters) {
        url.searchParams.set("searchLocation", `${latitude.toFixed(5)},${longitude.toFixed(5)}`);
      } else {
        const latitudeSpan = options.withinMeters / 111_320;
        const longitudeSpan = options.withinMeters / (111_320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
        // north-latitude, east-longitude, south-latitude, west-longitude.
        url.searchParams.set("searchRegion", [
          latitude + latitudeSpan,
          longitude + longitudeSpan,
          latitude - latitudeSpan,
          longitude - longitudeSpan,
        ].map((value) => value.toFixed(5)).join(","));
        url.searchParams.set("searchRegionPriority", "required");
      }
    }
    const payload = await this.authorized(url, options.signal) as { results?: unknown };
    if (!Array.isArray(payload.results)) return [];
    return payload.results.flatMap((raw): AppleMapsPlace[] => {
      if (!raw || typeof raw !== "object") return [];
      const place = raw as {
        id?: unknown;
        name?: unknown;
        coordinate?: { latitude?: unknown; longitude?: unknown };
        formattedAddressLines?: unknown;
        structuredAddress?: { locality?: unknown; subLocality?: unknown };
        countryCode?: unknown;
        poiCategory?: unknown;
      };
      const latitude = Number(place.coordinate?.latitude);
      const longitude = Number(place.coordinate?.longitude);
      const name = typeof place.name === "string" ? place.name.trim() : "";
      if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
      const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
      const lines = Array.isArray(place.formattedAddressLines)
        ? place.formattedAddressLines.flatMap((line) => text(line) ?? [])
        : [];
      const countryCode = text(place.countryCode)?.toUpperCase() ?? null;
      return [{
        id: text(place.id),
        name,
        latitude,
        longitude,
        formattedAddress: lines.join(", "),
        locality: text(place.structuredAddress?.locality),
        subLocality: text(place.structuredAddress?.subLocality),
        countryCode: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
        poiCategory: text(place.poiCategory),
      }];
    });
  }
}

let sharedClient: { key: string; client: AppleMapsClient } | null = null;

/** The process-wide client, or null when the three credentials are not set. */
export function appleMapsClient(): AppleMapsClient | null {
  const credentials = appleMapsCredentialsFromEnvironment();
  if (!credentials) return null;
  const key = `${credentials.teamId}:${credentials.keyId}:${credentials.privateKey.length}`;
  if (sharedClient?.key !== key) sharedClient = { key, client: new AppleMapsClient(credentials) };
  return sharedClient.client;
}
