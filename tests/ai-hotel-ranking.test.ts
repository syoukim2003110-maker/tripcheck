import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnthropicHotelRankingBody,
  HOTEL_RANKING_MAX_WEB_SEARCHES,
  HOTEL_RANKING_MODEL,
  parseHotelRankingRequest,
  parseHotelRankingResponseText,
} from "../lib/ai-hotel-ranking.ts";

const validRequest = {
  destination: "スイス",
  area: "Lauterbrunnen",
  tripDays: 4,
  purpose: "balanced",
  languageCode: "ja" as const,
  candidates: [
    { id: "hotel-a", name: "Hotel Alpina", area: "Lauterbrunnen", rating: 4.6, reviewCount: 2100, totalTravelMinutes: 480, styles: ["luxury"], priceHint: "~¥32,000/night" },
    { id: "hotel-b", name: "Valley Hostel", area: "Lauterbrunnen", rating: 4.3, reviewCount: 3000, totalTravelMinutes: 452, styles: [], priceHint: null },
  ],
};

test("parses a valid ranking request and rejects malformed ones", () => {
  const parsed = parseHotelRankingRequest(validRequest);
  assert.ok(parsed);
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.candidates[1].priceHint, null);

  assert.equal(parseHotelRankingRequest(null), null);
  assert.equal(parseHotelRankingRequest({ ...validRequest, candidates: [validRequest.candidates[0]] }), null);
  assert.equal(parseHotelRankingRequest({ ...validRequest, languageCode: "fr" }), null);
  assert.equal(parseHotelRankingRequest({ ...validRequest, tripDays: 0 }), null);
  assert.equal(parseHotelRankingRequest({
    ...validRequest,
    candidates: [...validRequest.candidates, { ...validRequest.candidates[0] }],
  }), null, "duplicate ids must be rejected");
  assert.equal(parseHotelRankingRequest({
    ...validRequest,
    candidates: Array.from({ length: 7 }, (_, index) => ({ ...validRequest.candidates[0], id: `hotel-${index}` })),
  }), null, "more than six candidates must be rejected");
});

test("request body binds the model, bounded web search and a JSON-only contract", () => {
  const parsed = parseHotelRankingRequest(validRequest)!;
  const body = buildAnthropicHotelRankingBody(parsed);
  assert.equal(body.model, HOTEL_RANKING_MODEL);
  assert.equal(body.tools[0].name, "web_search");
  assert.equal(body.tools[0].max_uses, HOTEL_RANKING_MAX_WEB_SEARCHES);
  assert.match(body.system, /Never add a hotel/);
  assert.match(body.system, /recommendedId/);
  const payload = JSON.parse(body.messages[0].content) as { candidates: Array<{ id: string }> };
  assert.deepEqual(payload.candidates.map(({ id }) => id), ["hotel-a", "hotel-b"]);
});

test("response parsing accepts only supplied ids and tolerates fences", () => {
  const ids = ["hotel-a", "hotel-b"];
  const good = parseHotelRankingResponseText(
    '```json\n{"recommendedId":"hotel-b","ranked":[{"id":"hotel-b","reason":"口コミ3000件で最安","tag":"実力店"},{"id":"hotel-a","reason":"高評価だが遠い","tag":"高級"}]}\n```',
    ids,
  );
  assert.ok(good);
  assert.equal(good.recommendedId, "hotel-b");
  assert.deepEqual(good.ranked.map(({ id }) => id), ["hotel-b", "hotel-a"]);

  assert.equal(parseHotelRankingResponseText('{"recommendedId":"hotel-x","ranked":[{"id":"hotel-a","reason":"r","tag":"t"}]}', ids), null, "recommendedId outside the shortlist is rejected");
  assert.equal(parseHotelRankingResponseText('{"recommendedId":"hotel-a","ranked":[{"id":"hotel-x","reason":"r","tag":"t"}]}', ids), null, "an invented hotel id is dropped, leaving nothing");
  const deduped = parseHotelRankingResponseText(
    '{"recommendedId":"hotel-a","ranked":[{"id":"hotel-a","reason":"r","tag":"t"},{"id":"hotel-a","reason":"r2","tag":"t2"}]}',
    ids,
  );
  assert.ok(deduped);
  assert.equal(deduped.ranked.length, 1);
  assert.equal(parseHotelRankingResponseText("no json here", ids), null);
});
