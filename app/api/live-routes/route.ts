import { fetchGoogleRoutes, parseLiveRoutesRequest, resolveGoogleRoutesApiKey } from "../../../lib/google-routes";
import { paidApiDenialResponse, paidProviderGateway } from "../../../lib/server/provider-gateway";
import { providerFetchWithParentSignal } from "../../../lib/server/provider-resilience";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const preflight = paidProviderGateway.preflight(request, "google");
  if (!preflight.ok) return paidApiDenialResponse(preflight, noStoreHeaders);
  // An empty optional Routes entry in `.env` must not mask a configured Places
  // key that is also authorized for Routes.
  const apiKey = resolveGoogleRoutesApiKey({
    GOOGLE_ROUTES_API_KEY: process.env.GOOGLE_ROUTES_API_KEY,
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
  });
  if (!apiKey) {
    return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseLiveRoutesRequest(body);
  if (!parsed) {
    return Response.json({ code: "invalid_or_out_of_range" }, { status: 400, headers: noStoreHeaders });
  }

  const access = paidProviderGateway.reserve(preflight, "live_routes", parsed.legs.length);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);
  try {
    const legs = await fetchGoogleRoutes(parsed, apiKey, providerFetchWithParentSignal(request.signal));
    const failedUnits = legs.filter((leg) => leg.status !== "ok").length;
    access.complete({ failedUnits });
    const allUnavailable = failedUnits === legs.length;
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      travelMode: parsed.travelMode,
      legs,
    }, {
      status: allUnavailable ? 502 : 200,
      headers: {
        ...noStoreHeaders,
        ...access.headers,
        "X-TripCheck-Provider-Failed-Units": String(failedUnits),
      },
    });
  } catch {
    access.complete({ failedUnits: parsed.legs.length });
    return Response.json({ code: "unavailable" }, { status: 502, headers: { ...noStoreHeaders, ...access.headers } });
  }
}
