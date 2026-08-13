import { fetchGoogleFoodCandidates, parseFoodSearchRequest } from "../../../lib/google-food";
import { coreRecommendationApiGate } from "../../../lib/server/non-core-api-gate";
import { paidApiDenialResponse, paidProviderGateway } from "../../../lib/server/provider-gateway";
import { providerFetchWithParentSignal } from "../../../lib/server/provider-resilience";
import { signPlacePhotoNames } from "../../../lib/server/sign-place-photos";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const preflight = paidProviderGateway.preflight(request, "google");
  if (!preflight.ok) return paidApiDenialResponse(preflight, noStoreHeaders);
  const featureGate = coreRecommendationApiGate("food_recommendations");
  if (featureGate) return featureGate;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() || process.env.GOOGLE_ROUTES_API_KEY?.trim();
  if (!apiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseFoodSearchRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  const providerUnits = 2;
  const access = paidProviderGateway.reserve(preflight, "food_recommendations", providerUnits);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);

  try {
    const candidates = await fetchGoogleFoodCandidates(parsed, apiKey, providerFetchWithParentSignal(request.signal));
    access.complete();
    return Response.json(await signPlacePhotoNames({
      provider: "google_maps",
      ranking: "evidence_weighted",
      fetchedAt: new Date().toISOString(),
      candidates,
    }), { headers: { ...noStoreHeaders, ...access.headers } });
  } catch {
    access.complete({ failedUnits: providerUnits });
    return Response.json({ code: "unavailable" }, {
      status: 502,
      headers: { ...noStoreHeaders, ...access.headers, "X-TripCheck-Provider-Failed-Units": String(providerUnits) },
    });
  }
}
