import assert from "node:assert/strict";
import test from "node:test";
import {
  TripIdeasProviderError,
  buildTripIdeasBody,
  parseTripIdeasRequest,
  parseTripIdeasResponse,
} from "../lib/trip-ideas.ts";

test("trip-ideas requests are bounded and validated", () => {
  assert.deepEqual(parseTripIdeasRequest({ concept: " 大阪 食い倒れ 2泊3日 ", languageCode: "ja" }), {
    concept: "大阪 食い倒れ 2泊3日",
    languageCode: "ja",
  });
  assert.equal(parseTripIdeasRequest({ concept: "a", languageCode: "ja" }), null);
  assert.equal(parseTripIdeasRequest({ concept: "x".repeat(121), languageCode: "ja" }), null);
  assert.equal(parseTripIdeasRequest({ concept: "Osaka", languageCode: "fr" }), null);
});

test("the drafting prompt demands strict JSON and forbids invented places", () => {
  const body = buildTripIdeasBody({ concept: "大阪 食い倒れ", languageCode: "ja" });
  assert.match(body.system, /Never invent a place/);
  assert.match(body.system, /ONLY a JSON array/);
  assert.equal(body.temperature, 0);
});

test("responses are parsed defensively: fences stripped, duplicates dropped, junk rejected", () => {
  const result = parseTripIdeasResponse({
    content: [{ type: "text", text: "```json\n[\"道頓堀\", \"黒門市場\", \"道頓堀\", 42, \"新世界\"]\n```" }],
  }, "大阪 食い倒れ");
  assert.deepEqual(result.places, ["道頓堀", "黒門市場", "新世界"]);

  assert.throws(() => parseTripIdeasResponse({ content: [{ type: "text", text: "not json" }] }, "x"), TripIdeasProviderError);
  assert.throws(() => parseTripIdeasResponse({ content: [{ type: "text", text: "{\"a\":1}" }] }, "x"), TripIdeasProviderError);
  assert.throws(() => parseTripIdeasResponse({ content: [] }, "x"), TripIdeasProviderError);
});
