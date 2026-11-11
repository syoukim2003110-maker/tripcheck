import { fetchAppleFoodCandidates } from "../../../../lib/apple-food";
import { parseFoodSearchRequest } from "../../../../lib/google-food";
import { AppleMapsError, appleMapsClient } from "../../../../lib/server/apple-maps";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const expected = new URL(process.env.TRIPCHECK_PUBLIC_ORIGIN?.trim() || request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

/**
 * Meal candidates without a paid provider: Apple Maps Server API, which is
 * quota-metered under the Apple Developer Program rather than billed per
 * call. Receives only the meal area's coordinate, the meal kind, the language
 * and the search words — never itinerary text. Without Apple credentials it
 * answers `not_configured` and the client may try the paid route instead.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return Response.json({ code: "forbidden" }, { status: 403, headers: noStoreHeaders });
  }
  if (process.env.FOOD_RECOMMENDATIONS_ENABLED?.trim() === "false") {
    return Response.json({ code: "feature_disabled" }, { status: 503, headers: noStoreHeaders });
  }
  const client = appleMapsClient();
  if (!client) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseFoodSearchRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  try {
    const candidates = await fetchAppleFoodCandidates(parsed, client, request.signal);
    return Response.json({
      provider: "apple_maps",
      ranking: "distance",
      fetchedAt: new Date().toISOString(),
      candidates,
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof AppleMapsError && error.code === "quota_exhausted") {
      return Response.json({ code: "budget_exhausted" }, { status: 429, headers: noStoreHeaders });
    }
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
