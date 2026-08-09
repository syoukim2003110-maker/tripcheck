import {
  FreshVoicesProviderError,
  fetchFreshVoices,
  parseFreshVoicesRequest,
  type FreshVoicesDepth,
  type FreshVoicesResult,
} from "../../../../lib/fresh-voices";
import { enabledAnthropicApiKey } from "../../../../lib/anthropic-runtime";
import { paidApiDenialResponse, paidProviderGateway } from "../../../../lib/server/provider-gateway";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const cacheTtlMs = 30 * 60 * 1000;
const quotaWindowMs = 60 * 60 * 1000;
// One plan is capped at 24 units in the client. Allow two substantially
// different plans per hour while keeping the global spend ceiling bounded.
const perClientQuota = 48;
const globalQuota = 192;
const resultCache = new Map<string, { expiresAt: number; result: FreshVoicesResult }>();
const inFlight = new Map<string, Promise<FreshVoicesResult>>();
const clientWindows = new Map<string, { startedAt: number; count: number }>();
let globalWindow = { startedAt: Date.now(), count: 0 };

function cacheKey(name: string, area: string, languageCode: string, intent: string, depth: string, destination: string) {
  return [name, area, languageCode, intent, depth, destination]
    .map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim())
    .join("|");
}

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

function prune(now: number) {
  for (const [key, value] of resultCache) if (value.expiresAt <= now) resultCache.delete(key);
  if (resultCache.size > 64) resultCache.delete(resultCache.keys().next().value as string);
  for (const [key, value] of clientWindows) if (now - value.startedAt >= quotaWindowMs) clientWindows.delete(key);
}

type QuotaReservation = { client: string; reserved: number };

function searchBudget(depth: FreshVoicesDepth) {
  return depth === "quick" ? 1 : 2;
}

function takeQuota(request: Request, now: number, reserved: number): QuotaReservation | null {
  if (now - globalWindow.startedAt >= quotaWindowMs) globalWindow = { startedAt: now, count: 0 };
  const key = clientKey(request);
  const previous = clientWindows.get(key);
  const window = !previous || now - previous.startedAt >= quotaWindowMs
    ? { startedAt: now, count: 0 }
    : previous;
  if (window.count + reserved > perClientQuota || globalWindow.count + reserved > globalQuota) return null;
  window.count += reserved;
  globalWindow.count += reserved;
  clientWindows.set(key, window);
  return { client: key, reserved };
}

function settleQuota(reservation: QuotaReservation, reportedSearchCount: number) {
  const charged = reportedSearchCount > 0
    ? Math.min(reservation.reserved, Math.max(0, Math.round(reportedSearchCount)))
    : reservation.reserved;
  const refund = reservation.reserved - charged;
  if (refund <= 0) return;
  const window = clientWindows.get(reservation.client);
  if (window) window.count = Math.max(0, window.count - refund);
  globalWindow.count = Math.max(0, globalWindow.count - refund);
}

export async function POST(request: Request) {
  const preflight = paidProviderGateway.preflight(request, "anthropic");
  if (!preflight.ok) return paidApiDenialResponse(preflight, noStoreHeaders);
  const anthropicApiKey = enabledAnthropicApiKey();
  if (!anthropicApiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseFreshVoicesRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  const now = Date.now();
  prune(now);
  const key = cacheKey(parsed.name, parsed.area, parsed.languageCode, parsed.intent, parsed.depth, parsed.destination);
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.result, { headers: { ...noStoreHeaders, "X-TripCheck-Cache": "hit" } });
  }
  const existing = inFlight.get(key);
  if (existing) {
    try {
      return Response.json(await existing, { headers: { ...noStoreHeaders, "X-TripCheck-Cache": "shared" } });
    } catch {
      return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
    }
  }
  const providerUnits = searchBudget(parsed.depth);
  const access = paidProviderGateway.reserve(preflight, "fresh_voices", providerUnits);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);
  const reservation = takeQuota(request, now, providerUnits);
  if (!reservation) {
    access.complete();
    return Response.json({ code: "rate_limited" }, {
      status: 429,
      headers: { ...noStoreHeaders, ...access.headers, "Retry-After": "3600" },
    });
  }

  try {
    const pending = fetchFreshVoices(parsed, anthropicApiKey, fetch, request.signal).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    const result = await pending;
    settleQuota(reservation, result.searchCount);
    access.complete();
    resultCache.set(key, { expiresAt: now + cacheTtlMs, result });
    return Response.json(result, { headers: { ...noStoreHeaders, ...access.headers, "X-TripCheck-Cache": "miss" } });
  } catch (error) {
    access.complete({ failedUnits: providerUnits });
    console.warn("fresh_voices_unavailable", {
      reason: error instanceof FreshVoicesProviderError ? error.reason : "unknown",
    });
    return Response.json({ code: "unavailable" }, { status: 502, headers: { ...noStoreHeaders, ...access.headers } });
  }
}
