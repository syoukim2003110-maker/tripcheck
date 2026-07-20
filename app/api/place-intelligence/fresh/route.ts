import { fetchFreshVoices, type FreshVoicesResult } from "../../../../lib/fresh-voices";
import { parsePlaceIntelligenceRequest } from "../../../../lib/place-intelligence";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const cacheTtlMs = 30 * 60 * 1000;
const quotaWindowMs = 60 * 60 * 1000;
const perClientQuota = 6;
const globalQuota = 48;
const resultCache = new Map<string, { expiresAt: number; result: FreshVoicesResult }>();
const inFlight = new Map<string, Promise<FreshVoicesResult>>();
const clientWindows = new Map<string, { startedAt: number; count: number }>();
let globalWindow = { startedAt: Date.now(), count: 0 };

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function cacheKey(name: string, area: string, languageCode: string) {
  return [name, area, languageCode]
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

function takeQuota(request: Request, now: number) {
  if (now - globalWindow.startedAt >= quotaWindowMs) globalWindow = { startedAt: now, count: 0 };
  const key = clientKey(request);
  const previous = clientWindows.get(key);
  const window = !previous || now - previous.startedAt >= quotaWindowMs
    ? { startedAt: now, count: 0 }
    : previous;
  if (window.count >= perClientQuota || globalWindow.count >= globalQuota) return false;
  window.count += 1;
  globalWindow.count += 1;
  clientWindows.set(key, window);
  return true;
}

export async function POST(request: Request) {
  if (!sameOrigin(request) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parsePlaceIntelligenceRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  const now = Date.now();
  prune(now);
  const key = cacheKey(parsed.name, parsed.area, parsed.languageCode);
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
  if (!takeQuota(request, now)) {
    return Response.json({ code: "rate_limited" }, {
      status: 429,
      headers: { ...noStoreHeaders, "Retry-After": "3600" },
    });
  }

  try {
    const pending = fetchFreshVoices(parsed, anthropicApiKey).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    const result = await pending;
    resultCache.set(key, { expiresAt: now + cacheTtlMs, result });
    return Response.json(result, { headers: { ...noStoreHeaders, "X-TripCheck-Cache": "miss" } });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
