import { parsePlaceResolutionRequest } from "../../../../lib/google-place-resolver";
import {
  fetchOpenPlaceResolutions,
  OPEN_PLACE_ATTRIBUTION,
} from "../../../../lib/open-place-resolver";
import { PLANNING_BUDGET } from "../../../../lib/planning-budget";
import { appleMapsPlaceSearch } from "../../../../lib/server/apple-maps-places";

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
 * Keyless resolution for an explicit review/build action: Wikipedia and
 * Wikidata first, OpenStreetMap search for whatever they do not know. The
 * autocomplete endpoint never calls this route — public Nominatim explicitly
 * forbids that usage pattern.
 */
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
  const parsed = parsePlaceResolutionRequest(body, PLANNING_BUDGET.openPlaceResolutions);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  const publicLookups = parsed.queries.length + (parsed.hotelQuery ? 1 : 0);
  if (publicLookups > PLANNING_BUDGET.openPlaceResolutions) {
    return Response.json({ code: "request_cap_exceeded" }, { status: 429, headers: noStoreHeaders });
  }

  try {
    // Apple Maps joins only when its credentials are configured, and only
    // for the lines the open sources could not settle.
    const mapsSearch = appleMapsPlaceSearch();
    const result = await fetchOpenPlaceResolutions(parsed, request.signal, undefined, mapsSearch);
    return Response.json({
      provider: "open_place_data",
      attribution: mapsSearch
        ? { ...OPEN_PLACE_ATTRIBUTION, label: `${OPEN_PLACE_ATTRIBUTION.label} · Apple Maps` }
        : OPEN_PLACE_ATTRIBUTION,
      fetchedAt: new Date().toISOString(),
      ...result,
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
