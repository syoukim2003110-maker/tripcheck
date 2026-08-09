import { fetchTripHolidays, parseHolidaysRequest } from "../../../lib/holidays";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/*
 * A country-year holiday list is immutable in practice; caching it in the
 * worker saves the upstream round-trip when the user rebuilds or nudges the
 * trip dates, which produces the same payload again and again.
 */
const cache = new Map<string, { expires: number; body: unknown }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!sameOrigin(request) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseHolidaysRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  const cacheKey = `${parsed.countryCode}:${parsed.dates.join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return Response.json(cached.body, { headers: noStoreHeaders });
  }
  try {
    const result = await fetchTripHolidays(parsed);
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, body: result });
    return Response.json(result, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
