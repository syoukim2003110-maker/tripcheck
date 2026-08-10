import {
  fetchAnthropicHotelRanking,
  HOTEL_RANKING_MODEL,
  parseHotelRankingRequest,
} from "../../../../lib/ai-hotel-ranking";
import { enabledAnthropicApiKey } from "../../../../lib/anthropic-runtime";
import { coreRecommendationApiGate } from "../../../../lib/server/non-core-api-gate";
import { paidApiDenialResponse, paidProviderGateway } from "../../../../lib/server/provider-gateway";
import { providerFetchWithParentSignal } from "../../../../lib/server/provider-resilience";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const preflight = paidProviderGateway.preflight(request, "anthropic");
  if (!preflight.ok) return paidApiDenialResponse(preflight, noStoreHeaders);
  const featureGate = coreRecommendationApiGate("hotel_recommendations");
  if (featureGate) return featureGate;
  const apiKey = enabledAnthropicApiKey();
  if (!apiKey) return Response.json({ code: "not_configured" }, { status: 503, headers: noStoreHeaders });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = parseHotelRankingRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  const access = paidProviderGateway.reserve(preflight, "hotel_ranking", 1);
  if (!access.ok) return paidApiDenialResponse(access, noStoreHeaders);

  try {
    const result = await fetchAnthropicHotelRanking(parsed, apiKey, providerFetchWithParentSignal(request.signal));
    access.complete();
    return Response.json({
      provider: "anthropic",
      model: HOTEL_RANKING_MODEL,
      recommendedId: result.recommendedId,
      ranked: result.ranked,
    }, { headers: { ...noStoreHeaders, ...access.headers } });
  } catch {
    access.complete({ failedUnits: 1 });
    return Response.json({ code: "unavailable" }, {
      status: 502,
      headers: { ...noStoreHeaders, ...access.headers, "X-TripCheck-Provider-Failed-Units": "1" },
    });
  }
}
