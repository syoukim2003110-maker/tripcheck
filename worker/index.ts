/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { secureResponse } from "../lib/security-headers";
import {
  enforceDurableProviderQuota,
  type D1DatabaseLike,
  type DurableProviderQuotaRequest,
  type DurableQuotaEnvironment,
  type DurableQuotaOperation,
  type DurableQuotaProvider,
} from "../lib/server/durable-provider-quota.ts";
import {
  googleProviderCircuit,
  ProviderAttemptNotAuthorizedError,
  ProviderCallCancelledError,
  ProviderCircuitOpenError,
  runResilientProviderCall,
} from "../lib/server/provider-resilience.ts";
import { apiRoutePolicy, type ApiRoutePolicy } from "../lib/server/api-route-policy.ts";
import { placePhotoTokenSecret, verifyPlacePhotoToken } from "../lib/server/place-photo-token.ts";
import { handleAppGateway, isAppGatewayPath } from "../lib/server/app-attest/gateway.ts";

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env extends DurableQuotaEnvironment {
  ASSETS: Fetcher;
  DB?: D1DatabaseLike;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  TRIPCHECK_PUBLIC_ORIGIN?: string;
  HOTEL_RECOMMENDATIONS_ENABLED?: string;
  FOOD_RECOMMENDATIONS_ENABLED?: string;
  ROUTE_RECOMMENDATIONS_ENABLED?: string;
  ANTHROPIC_REQUESTS_ENABLED?: string;
  TRIPCHECK_APP_IDS?: string;
  TRIPCHECK_APP_ATTEST_ENVIRONMENTS?: string;
  TRIPCHECK_APP_ATTEST_BYPASS_TOKEN?: string;
  TRIPCHECK_APP_API_DISABLED?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type PaidApiRoute = ApiRoutePolicy & Readonly<{
  provider: DurableQuotaProvider;
  operation: DurableQuotaOperation;
}>;

function paidRoutePolicy(request: Request, url: URL): PaidApiRoute | undefined {
  const policy = apiRoutePolicy(request.method, url.pathname);
  if (!policy || policy.class !== "paid" || !policy.provider || !policy.operation) return undefined;
  return policy as PaidApiRoute;
}

const SESSION_COOKIE = "tc_paid_session";
const MAX_QUOTA_BODY_BYTES = 256 * 1024;
const MAX_PLACE_INPUT_INDEX = 3_999;
const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function validPlaceResolutionText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maximum;
}

/**
 * Validates the durable, provider-owned choices before they influence quota.
 * Only the count leaves this boundary; input text and Place IDs are never
 * copied into D1 quota records.
 */
function placeResolutionOverrideUnits(value: unknown) {
  if (value === undefined) return 0;
  if (!Array.isArray(value)) return null;
  const inputIndexes = new Set<number>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const override = raw as Record<string, unknown>;
    if (
      typeof override.inputIndex !== "number"
      || !Number.isSafeInteger(override.inputIndex)
      || override.inputIndex < 0
      || override.inputIndex > MAX_PLACE_INPUT_INDEX
      || inputIndexes.has(override.inputIndex)
      || !validPlaceResolutionText(override.input, 120)
      || typeof override.providerRef !== "string"
      || !GOOGLE_PLACE_ID_PATTERN.test(override.providerRef)
    ) return null;
    inputIndexes.add(override.inputIndex);
  }
  return value.length;
}

function paidRequestIsSameOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLocaleLowerCase("en-US");
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(env.TRIPCHECK_PUBLIC_ORIGIN?.trim() || request.url).origin;
  } catch {
    return false;
  }
  if (!origin || fetchSite !== "same-origin") return false;
  try {
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

/**
 * An `<img>` sends no Origin and no custom header, so `signed_resource` routes
 * prove themselves with the signature the server minted for that exact photo
 * name. `Sec-Fetch-Site` is still required to be same-origin — it is trivially
 * forged by a non-browser client, which is precisely why it is not the gate.
 */
async function signedResourceIsAuthorized(request: Request, url: URL, env: Env) {
  if (request.headers.get("Sec-Fetch-Site")?.toLocaleLowerCase("en-US") !== "same-origin") return false;
  const secret = placePhotoTokenSecret(env as unknown as Record<string, string | undefined>);
  if (!secret) return false;
  return verifyPlacePhotoToken({
    photoName: url.searchParams.get("name")?.trim() ?? "",
    token: url.searchParams.get("sig")?.trim() ?? "",
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
}

function paidFeatureEnabled(route: PaidApiRoute, env: Env) {
  return (route.featureFlags ?? []).every((flag) => (
    flag.mode === "explicit-on"
      ? env[flag.name] === "true"
      : env[flag.name] !== "false"
  ));
}

function boundedOpaqueId(value: string | null) {
  return value && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
}

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

/**
 * Who this paid request is charged to.
 *
 * The session used to be read from `X-TripCheck-Session` first, falling back
 * to the HttpOnly cookie. A header is entirely under the caller's control, so
 * a non-browser client could send a fresh one on every request and walk past
 * every per-session and per-trip ceiling, leaving only the deployment-wide day
 * and month rows in its way. Only the cookie this edge issued counts now; the
 * public header is ignored at ingress and overwritten before the request
 * reaches the origin.
 *
 * The trip token stays client-supplied on purpose — one person really does
 * plan several trips in a session, and the token is what keeps their budgets
 * apart. It is namespaced under the session so it cannot be aimed at anyone
 * else's counter, and rotating it can only escape the per-trip row: the
 * session-day ceiling above it is the real per-actor bound.
 */
function quotaIdentity(request: Request) {
  const existingSession = boundedOpaqueId(cookieValue(request, SESSION_COOKIE));
  const sessionId = existingSession ?? globalThis.crypto.randomUUID().replaceAll("-", "");
  const suppliedTrip = boundedOpaqueId(request.headers.get("X-TripCheck-Trip"));
  const tripScope = suppliedTrip ?? `time_bucket_${Math.floor(Date.now() / (4 * 60 * 60 * 1000))}`;
  const tripId = `${sessionId.slice(0, 16)}_${tripScope}`.slice(0, 128);
  if (existingSession) return { sessionId, tripId, setCookie: null };
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    sessionId,
    tripId,
    setCookie: `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}`,
  };
}

function paidRequestUnits(operation: DurableQuotaOperation, input: Record<string, unknown> | null) {
  if (operation === "place_intelligence") return 1;
  // One signed photo name, one Places Photo media event. The signature and the
  // name itself were already validated before this point.
  if (operation === "place_photo") return 1;
  if (!input) return null;
  if (operation === "live_routes") {
    return Array.isArray(input.legs) ? input.legs.length : null;
  }
  if (operation === "place_suggestions") {
    return validPlaceResolutionText(input.query, 120)
      && (input.languageCode === "en" || input.languageCode === "ja")
      && typeof input.destination === "string"
      && input.destination.length <= 32
      ? 1
      : null;
  }
  if (operation === "place_resolution") {
    if (!Array.isArray(input.queries)) return null;
    if (!input.queries.every((query) => validPlaceResolutionText(query, 120))) return null;
    const exact = placeResolutionOverrideUnits(input.providerOverrides);
    if (exact === null) return null;
    if (
      input.hotelQuery !== undefined
      && input.hotelQuery !== null
      && input.hotelQuery !== ""
      && !validPlaceResolutionText(input.hotelQuery, 120)
    ) return null;
    const hotel = typeof input.hotelQuery === "string" && input.hotelQuery.trim().length > 0 ? 1 : 0;
    return input.queries.length + exact + hotel;
  }
  if (operation === "hotel_recommendations") {
    if (
      input.query !== undefined
      && input.query !== null
      && input.query !== ""
      && !validPlaceResolutionText(input.query, 160)
    ) return null;
    // A named property is one focused search. Automatic hotel discovery uses
    // three searches and may make one bounded fallback.
    return typeof input.query === "string" && input.query.trim().length > 0 ? 1 : 4;
  }
  if (operation === "food_recommendations") {
    // Nearby food discovery may make one bounded radius expansion.
    return 2;
  }
  if (operation === "food_ranking") return 1;
  if (operation === "hotel_ranking") return 1;
  if (operation === "route_recommendations") {
    // Search Along Route may fall back to both route endpoints.
    return 3;
  }
  if (input.depth === undefined || input.depth === "deep") return 2;
  return input.depth === "quick" ? 1 : null;
}

type PaidRequestEnvelope = Readonly<{
  rawBody: Uint8Array | null;
  units: number;
}>;

/**
 * Reads the paid request body exactly once, into bytes this Worker owns.
 *
 * A retry has to deliver byte-identical content, and a streaming Request
 * cannot be replayed: keeping one as a retry template made each attempt tee
 * the same stream, which races the previous attempt's reader and intermittently
 * throws `TypeError: unusable`. When that happened the retry never reached the
 * origin at all and a recoverable provider blip was returned to the traveller
 * as a 502. Materialising the body removes the race and lets the unit count and
 * every attempt read from the same immutable source.
 */
async function readPaidRequestEnvelope(request: Request, operation: DurableQuotaOperation): Promise<PaidRequestEnvelope | null> {
  if (request.method !== "POST") {
    const units = paidRequestUnits(operation, {});
    return units === null ? null : { rawBody: null, units };
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_QUOTA_BODY_BYTES) return null;
  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return null;
  }
  // Chunked uploads carry no Content-Length, so the real byte count is the
  // only limit that holds. Oversized bodies stop here — before D1 is touched.
  if (rawBody.byteLength > MAX_QUOTA_BODY_BYTES) return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) parsed = decoded as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const units = paidRequestUnits(operation, parsed);
  return units === null ? null : { rawBody, units };
}

function withHeaders(response: Response, extra: Record<string, string>, setCookie: string | null = null) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  headers.set("X-TripCheck-Quota-Scope", "durable-d1");
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The quota layer marks every paid response `no-store`, which is right for a
 * JSON answer and wrong for a photo: an image that scrolls out of view and
 * back used to buy itself again. A signed photo redirect may be reused inside
 * the browser that asked for it, and by nobody else.
 */
function applyRouteCachePolicy(response: Response, route: PaidApiRoute) {
  if (route.cache !== "private_short" || response.status >= 400) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, max-age=900");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function edgeJson(code: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ code }, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", ...headers },
  });
}

async function handlePaidApi(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
  route: PaidApiRoute,
) {
  const authorized = route.origin === "signed_resource"
    ? await signedResourceIsAuthorized(request, url, env)
    : paidRequestIsSameOrigin(request, env);
  if (!authorized) {
    return secureResponse(edgeJson("forbidden", 403), url);
  }
  if (!paidFeatureEnabled(route, env)) {
    return secureResponse(edgeJson("feature_disabled", 503, {
      "X-TripCheck-Feature-Scope": "core-recommendation",
    }), url);
  }
  const envelope = await readPaidRequestEnvelope(request, route.operation);
  if (envelope === null) return secureResponse(edgeJson("invalid_request", 400), url);
  const units = envelope.units;

  let identity: ReturnType<typeof quotaIdentity>;
  try {
    identity = quotaIdentity(request);
  } catch {
    return secureResponse(edgeJson("quota_store_unavailable", 503), url);
  }
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("X-TripCheck-Session", identity.sessionId);
  forwardedHeaders.set("X-TripCheck-Trip", identity.tripId);
  // Each attempt gets its own Request built from the same bytes, so a retry
  // never depends on a stream the previous attempt may still be draining.
  const attemptRequest = (signal: AbortSignal) => new Request(request.url, {
    method: request.method,
    headers: forwardedHeaders,
    ...(envelope.rawBody === null ? {} : { body: envelope.rawBody.slice() }),
    signal,
  });
  let lastQuotaHeaders: Record<string, string> = {};

  const attempt = async (_attemptIndex: number, deadlineSignal: AbortSignal) => {
    if (request.signal.aborted) throw new ProviderCallCancelledError();
    // A retry is a new provider event and must win a second atomic D1
    // reservation. If it cannot, the resilience runner returns the first
    // failure without crossing any trip/session/day/month ceiling.
    const quotaRequest: DurableProviderQuotaRequest = {
      provider: route.provider,
      operation: route.operation,
      units,
      anonymousSessionId: identity.sessionId,
      tripId: identity.tripId,
    };
    const quota = await enforceDurableProviderQuota(quotaRequest, env.DB, env);
    if (!quota.ok) {
      const denied = withHeaders(edgeJson(quota.code, quota.status, quota.headers), quota.headers, identity.setCookie);
      throw new ProviderAttemptNotAuthorizedError(denied);
    }
    lastQuotaHeaders = quota.headers;

    const combinedSignal = AbortSignal.any([request.signal, deadlineSignal]);
    const forwardedRequest = attemptRequest(combinedSignal);
    let response: Response;
    try {
      response = await handler.fetch(forwardedRequest, env, ctx);
    } catch {
      if (request.signal.aborted) {
        await quota.complete({ failedUnits: units });
        throw new ProviderCallCancelledError();
      }
      response = edgeJson("unavailable", 502);
    }
    const reportedFailureHeader = response.headers.get("X-TripCheck-Provider-Failed-Units");
    const reportedFailures = reportedFailureHeader === null ? Number.NaN : Number(reportedFailureHeader);
    const failedUnits = Number.isInteger(reportedFailures) && reportedFailures >= 0 && reportedFailures <= units
      ? reportedFailures
      : response.status >= 500 ? units : 0;
    await quota.complete({ failedUnits });
    return withHeaders(response, quota.headers, identity.setCookie);
  };

  try {
    const response = route.provider === "google"
      ? await runResilientProviderCall({
        circuit: googleProviderCircuit,
        attempt,
        isFailure: (candidate) => candidate.status >= 500,
        // Configuration and kill-switch 503s are not transient provider
        // responses. Origin routes use 502 for a retryable Google failure.
        isRetryable: (candidate) => candidate.status === 502 || candidate.status === 504,
      })
      : await attempt(0, request.signal);
    return secureResponse(applyRouteCachePolicy(response, route), url);
  } catch (error) {
    if (error instanceof ProviderAttemptNotAuthorizedError && error.response instanceof Response) {
      return secureResponse(error.response, url);
    }
    if (error instanceof ProviderCircuitOpenError) {
      return secureResponse(edgeJson("provider_circuit_open", 503, {
        "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
      }), url);
    }
    return secureResponse(withHeaders(
      edgeJson("unavailable", 502),
      lastQuotaHeaders,
      identity.setCookie,
    ), url);
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (isAppGatewayPath(url.pathname)) {
      const response = await handleAppGateway(request, env as unknown as import("../lib/server/app-attest/gateway.ts").AppGatewayEnvironment);
      return secureResponse(response, url);
    }

    const paidApiRoute = paidRoutePolicy(request, url);
    if (paidApiRoute) return handlePaidApi(request, url, env, ctx, paidApiRoute);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return secureResponse(response, url);
    }

    return secureResponse(await handler.fetch(request, env, ctx), url);
  },
};

export default worker;
