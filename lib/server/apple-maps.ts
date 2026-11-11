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
 *                      resultTypeFilter → {results: Place[]}.
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
        headers: { Accept: "application/json", Authorization: `Bearer ${bearer}` },
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

  async search(options: AppleMapsSearchOptions): Promise<AppleMapsPlace[]> {
    const url = new URL("/v1/search", APPLE_MAPS_ORIGIN);
    url.searchParams.set("q", options.query);
    url.searchParams.set("lang", options.language);
    if (options.poiOnly) url.searchParams.set("resultTypeFilter", "Poi");
    if (options.poiCategories?.length) url.searchParams.set("includePoiCategories", options.poiCategories.join(","));
    if (options.near) {
      const { latitude, longitude } = options.near;
      url.searchParams.set("searchLocation", `${latitude.toFixed(5)},${longitude.toFixed(5)}`);
      if (options.withinMeters) {
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
