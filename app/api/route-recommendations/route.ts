import { fetchGoogleRouteRecommendations, parseRouteRecommendationRequest } from "../../../lib/route-recommendations";
import { coreRecommendationApiGate } from "../../../lib/server/non-core-api-gate";
import { paidApiDenialResponse, paidProviderGateway } from "../../../lib/server/provider-gateway";
import { providerFetchWithParentSignal } from "../../../lib/server/provider-resilience";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const preflight = paidProviderGateway.preflight(request, "google");
  if (!preflight.ok) return paidApiDenialResponse(preflight, noStoreHeaders);
  const featureGate = coreRecommendationApiGate("route_recommendations");
  if (featureGate) return featureGate;
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
  const providerUnits = 3;
  const access = paidProviderGateway.reserve(preflight, "route_recommendations", providerUnits);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);

  try {
    const candidates = await fetchGoogleRouteRecommendations(parsed, apiKey, providerFetchWithParentSignal(request.signal));
    access.complete();
    return Response.json({
      provider: "google_maps",
      fetchedAt: new Date().toISOString(),
      candidates,
    }, { headers: { ...noStoreHeaders, ...access.headers } });
  } catch {
    access.complete({ failedUnits: providerUnits });
    return Response.json({ code: "unavailable" }, {
      status: 502,
      headers: { ...noStoreHeaders, ...access.headers, "X-TripCheck-Provider-Failed-Units": String(providerUnits) },
    });
  }
}
