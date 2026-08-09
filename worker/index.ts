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
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type PaidApiRoute = Readonly<{
  provider: DurableQuotaProvider;
  operation: DurableQuotaOperation;
}>;

const PAID_API_ROUTES: Readonly<Record<string, PaidApiRoute>> = Object.freeze({
  "/api/live-routes": Object.freeze({ provider: "google", operation: "live_routes" }),
  "/api/place-resolution": Object.freeze({ provider: "google", operation: "place_resolution" }),
  "/api/place-intelligence": Object.freeze({ provider: "google", operation: "place_intelligence" }),
  "/api/place-intelligence/fresh": Object.freeze({ provider: "anthropic", operation: "fresh_voices" }),
});

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

function quotaIdentity(request: Request) {
  const existingSession = boundedOpaqueId(request.headers.get("X-TripCheck-Session"))
    ?? boundedOpaqueId(cookieValue(request, SESSION_COOKIE));
  const sessionId = existingSession ?? globalThis.crypto.randomUUID().replaceAll("-", "");
  const tripId = boundedOpaqueId(request.headers.get("X-TripCheck-Trip"))
    ?? `time_bucket_${Math.floor(Date.now() / (4 * 60 * 60 * 1000))}`;
  if (existingSession) return { sessionId, tripId, setCookie: null };
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    sessionId,
    tripId,
    setCookie: `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}`,
  };
}

async function paidRequestUnits(request: Request, operation: DurableQuotaOperation) {
  if (operation === "place_intelligence") return 1;
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_QUOTA_BODY_BYTES) return null;
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  if (operation === "live_routes") {
    return Array.isArray(input.legs) ? input.legs.length : null;
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
  if (input.depth === undefined || input.depth === "deep") return 2;
  return input.depth === "quick" ? 1 : null;
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
  if (!paidRequestIsSameOrigin(request, env)) {
    return secureResponse(edgeJson("forbidden", 403), url);
  }
  const units = await paidRequestUnits(request, route.operation);
  if (units === null) return secureResponse(edgeJson("invalid_request", 400), url);

  let identity: ReturnType<typeof quotaIdentity>;
  try {
    identity = quotaIdentity(request);
  } catch {
    return secureResponse(edgeJson("quota_store_unavailable", 503), url);
  }
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("X-TripCheck-Session", identity.sessionId);
  forwardedHeaders.set("X-TripCheck-Trip", identity.tripId);
  const forwardedTemplate = new Request(request, { headers: forwardedHeaders });
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
    const forwardedRequest = new Request(forwardedTemplate.clone(), { signal: combinedSignal });
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
    return secureResponse(response, url);
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

    const paidApiRoute = request.method === "POST" ? PAID_API_ROUTES[url.pathname] : undefined;
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
