import { fetchJpyRate, parseFxBase } from "../../../lib/fx-rates";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

/*
 * Unlike the POST routes, a same-origin GET fetch carries no Origin header,
 * so "no Origin" is the normal browser case here — cross-site callers are
 * rejected via Sec-Fetch-Site and via Origin when one is present.
 */
function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/* Reference rates move daily, not per request; 6 hours of worker-side cache
 * keeps rebuild spam away from the free providers. */
const cache = new Map<string, { expires: number; body: unknown }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  if (!sameOrigin(request)) {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  const base = parseFxBase(new URL(request.url).searchParams.get("base"));
  if (!base) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  const cached = cache.get(base);
  if (cached && cached.expires > Date.now()) {
    return Response.json(cached.body, { headers: noStoreHeaders });
  }
  try {
    const result = await fetchJpyRate(base);
    cache.set(base, { expires: Date.now() + CACHE_TTL_MS, body: result });
    return Response.json(result, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
