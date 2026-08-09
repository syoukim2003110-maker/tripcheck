import {
  fetchAnthropicFoodRanking,
  FOOD_RANKING_MODEL,
  parseFoodRankingRequest,
} from "../../../../lib/ai-food-ranking";
import { enabledAnthropicApiKey } from "../../../../lib/anthropic-runtime";
import { nonCoreApiGate } from "../../../../lib/server/non-core-api-gate";

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

export async function POST(request: Request) {
  const featureGate = nonCoreApiGate("food_recommendations");
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
  const parsed = parseFoodRankingRequest(body);
  if (!parsed) return Response.json({ code: "invalid_request" }, { status: 400, headers: noStoreHeaders });

  try {
    const ranked = await fetchAnthropicFoodRanking(parsed, apiKey);
    return Response.json({ provider: "anthropic", model: FOOD_RANKING_MODEL, ranked }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ code: "unavailable" }, { status: 502, headers: noStoreHeaders });
  }
}
