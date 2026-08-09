import { fetchGoogleRouteRecommendations, parseRouteRecommendationRequest } from "../../../lib/route-recommendations";
import { nonCoreApiGate } from "../../../lib/server/non-core-api-gate";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const clientWindows = new Map<string, { startedAt: number; count: number }>();
let dailyWindow = { day: "", count: 0 };
const clientWindowLimit = 500;

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
  return request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "local";
}

function allowedByBudget(request: Request, now = Date.now()) {
  const key = clientKey(request);
  const hour = 60 * 60 * 1_000;
  // Worker isolates are long-lived but not permanent. Bound the raw-IP map in
  // either case and discard expired entries before admitting another client.
  if (clientWindows.size >= clientWindowLimit) {
    for (const [client, window] of clientWindows) {
      if (now - window.startedAt >= hour) clientWindows.delete(client);
    }
    while (clientWindows.size >= clientWindowLimit) {
      const oldest = clientWindows.keys().next().value as string | undefined;
      if (!oldest) break;
      clientWindows.delete(oldest);
    }
  }
  const current = clientWindows.get(key);
  if (!current || now - current.startedAt >= hour) clientWindows.set(key, { startedAt: now, count: 1 });
  else {
    if (current.count >= 6) return false;
    current.count += 1;
  }

  const day = new Date(now).toISOString().slice(0, 10);
  if (dailyWindow.day !== day) dailyWindow = { day, count: 0 };
  const configured = Number(process.env.ROUTE_RECOMMENDATIONS_DAILY_LIMIT ?? "25");
  const limit = Number.isFinite(configured) ? Math.max(1, Math.min(1_000, Math.floor(configured))) : 25;
  if (dailyWindow.count >= limit) return false;
  dailyWindow.count += 1;
  return true;
}

export async function POST(request: Request) {
  const featureGate = nonCoreApiGate("route_recommendations");
  if (featureGate) return featureGate;
  if (!sameOrigin(request) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  if (process.env.ROUTE_RECOMMENDATIONS_ENABLED === "false") {
    return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseRouteRecommendationRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  if (!allowedByBudget(request)) {
    return Response.json({ code: "rate_limited" }, {
      status: 429,
      headers: { ...noStoreHeaders, "Retry-After": "3600" },
    });
  }

  try {
    const candidates = await fetchGoogleRouteRecommendations(parsed, apiKey);
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      candidates,
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
