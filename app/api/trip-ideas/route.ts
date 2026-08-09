import {
  TripIdeasProviderError,
  fetchTripIdeas,
  parseTripIdeasRequest,
  type TripIdeasResult,
} from "../../../lib/trip-ideas";
import { enabledAnthropicApiKey } from "../../../lib/anthropic-runtime";
import { nonCoreApiGate } from "../../../lib/server/non-core-api-gate";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const cacheTtlMs = 60 * 60 * 1000;
const quotaWindowMs = 60 * 60 * 1000;
const perClientQuota = 12;
const globalQuota = 60;
const resultCache = new Map<string, { expiresAt: number; result: TripIdeasResult }>();
const clientWindows = new Map<string, { startedAt: number; count: number }>();
let globalWindow = { startedAt: Date.now(), count: 0 };

async function cacheKey(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "local";
}

function withinQuota(key: string) {
  const now = Date.now();
  if (now - globalWindow.startedAt > quotaWindowMs) globalWindow = { startedAt: now, count: 0 };
  if (globalWindow.count >= globalQuota) return false;
  const client = clientWindows.get(key);
  if (!client || now - client.startedAt > quotaWindowMs) {
    clientWindows.set(key, { startedAt: now, count: 1 });
    globalWindow.count += 1;
    return true;
  }
  if (client.count >= perClientQuota) return false;
  client.count += 1;
  globalWindow.count += 1;
  return true;
}

export async function POST(request: Request) {
  const featureGate = nonCoreApiGate("trip_ideas");
  if (featureGate) return featureGate;
  if (!sameOrigin(request) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  const apiKey = enabledAnthropicApiKey();
  if (!apiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseTripIdeasRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  const cacheId = await cacheKey(`${parsed.destination}|${parsed.languageCode}|${parsed.concept.normalize("NFKC").toLocaleLowerCase()}`);
  const cached = resultCache.get(cacheId);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.result, { headers: noStoreHeaders });
  }
  if (!withinQuota(clientKey(request))) {
    return Response.json({ code: "rate_limited" }, { status: 429, headers: noStoreHeaders });
  }

  try {
    const result = await fetchTripIdeas(parsed, apiKey);
    resultCache.set(cacheId, { expiresAt: Date.now() + cacheTtlMs, result });
    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) {
    const reason = error instanceof TripIdeasProviderError ? error.reason : "unavailable";
    return Response.json({ code: reason }, { status: 502, headers: noStoreHeaders });
  }
}
