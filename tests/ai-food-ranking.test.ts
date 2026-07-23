import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnthropicFoodRankingBody,
  fetchAnthropicFoodRanking,
  FOOD_RANKING_MODEL,
  parseFoodRankingRequest,
} from "../lib/ai-food-ranking.ts";
import { buildFoodRankingPayload } from "../lib/food-recommendations-client.ts";
import type { FoodRecommendationSlot } from "../lib/trip-builder.ts";

process.env.ANTHROPIC_REQUESTS_ENABLED = "true";

const request = {
  area: "渋谷",
  mealKind: "dinner" as const,
  query: "焼き鳥",
  languageCode: "ja" as const,
  candidates: [
    { id: "place-1", name: "炭火食堂", address: "東京都渋谷区1-2-3", type: "焼き鳥店" },
    { id: "place-2", name: "路地裏酒場", address: "東京都渋谷区4-5-6", type: "居酒屋" },
  ],
};

test("accepts only a small, bounded candidate set", () => {
  assert.deepEqual(parseFoodRankingRequest(request), request);
  assert.equal(parseFoodRankingRequest({ ...request, languageCode: "ko" }), null);
  assert.equal(parseFoodRankingRequest({ ...request, candidates: [] }), null);
  assert.equal(parseFoodRankingRequest({ ...request, candidates: Array.from({ length: 5 }, (_, index) => ({ ...request.candidates[0], id: `p-${index}` })) }), null);
});

test("builds a fast, tightly-scoped structured Claude request", () => {
  const body = buildAnthropicFoodRankingBody(request);
  assert.equal(body.model, FOOD_RANKING_MODEL);
  assert.equal(body.max_tokens, 320);
  assert.equal(body.temperature, 0);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(JSON.stringify(body).includes("itinerary"), false);
});

test("client sends candidate metadata but strips Google URLs and itinerary fields", () => {
  const slot: FoodRecommendationSlot = {
    id: "food-1-dinner",
    dayIndex: 0,
    dayLabel: "1日目",
    date: "2026-09-19",
    kind: "dinner",
    area: "渋谷",
    latitude: 35.6595,
    longitude: 139.7005,
    window: "17:30–21:00",
    rationale: "移動しやすい",
    queryIdeas: ["焼き鳥"],
  };
  const payload = buildFoodRankingPayload(slot, "焼き鳥", [{
    ...request.candidates[0],
    googleMapsUrl: "https://maps.google.com/secret",
  }], "ja");
  assert.deepEqual(payload.candidates, [request.candidates[0]]);
  assert.equal(JSON.stringify(payload).includes("googleMapsUrl"), false);
  assert.equal(JSON.stringify(payload).includes("rationale"), false);
  assert.equal(JSON.stringify(payload).includes("latitude"), false);
});

test("keeps only unique rankings for supplied place ids", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, FOOD_RANKING_MODEL);
    return Response.json({
      content: [{
        type: "text",
        text: JSON.stringify({ ranked: [
          { id: "place-2", reason: "居酒屋気分にも合う", tag: "気軽" },
          { id: "unknown", reason: "不明", tag: "除外" },
          { id: "place-2", reason: "重複", tag: "除外" },
          { id: "place-1", reason: "焼き鳥の希望に最も近い", tag: "本命" },
        ] }),
      }],
    });
  }) as typeof fetch;
  const ranked = await fetchAnthropicFoodRanking(request, "secret", fetcher);
  assert.deepEqual(ranked.map(({ id }) => id), ["place-2", "place-1"]);
});
