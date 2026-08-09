import assert from "node:assert/strict";
import test from "node:test";
import {
  TripIdeasProviderError,
  buildTripIdeasBody,
  parseTripIdeasRequest,
  parseTripIdeasResponse,
} from "../lib/trip-ideas.ts";

test("trip-ideas requests are bounded and validated", () => {
  assert.deepEqual(parseTripIdeasRequest({ concept: " 大阪 食い倒れ 2泊3日 ", languageCode: "ja", destination: "japan" }), {
    concept: "大阪 食い倒れ 2泊3日",
    languageCode: "ja",
    destination: "japan",
  });
  assert.equal(parseTripIdeasRequest({ concept: "Alps in 5 days", languageCode: "en" })?.destination, "auto");
  assert.equal(parseTripIdeasRequest({ concept: "a", languageCode: "ja" }), null);
  assert.equal(parseTripIdeasRequest({ concept: "x".repeat(121), languageCode: "ja" }), null);
  assert.equal(parseTripIdeasRequest({ concept: "Osaka", languageCode: "fr" }), null);
});

test("the drafting prompt demands strict JSON and forbids invented places", () => {
  const body = buildTripIdeasBody({ concept: "大阪 食い倒れ", languageCode: "ja", destination: "japan" });
  assert.match(body.system, /Never invent a place/);
  assert.match(body.system, /ONLY a JSON array/);
  assert.match(body.system, /in Japan/);
  assert.equal(body.temperature, 0);
});

test("the drafting prompt follows the destination instead of always saying Japan", () => {
  const swiss = buildTripIdeasBody({ concept: "alpine views", languageCode: "en", destination: "switzerland" });
  assert.match(swiss.system, /in Switzerland/);
  assert.doesNotMatch(swiss.system, /Japan/);
  assert.match(swiss.messages[0].content, /Country: Switzerland/);

  // With no country yet, the prompt must not invent one.
  const anywhere = buildTripIdeasBody({ concept: "alpine views", languageCode: "en", destination: "auto" });
  assert.doesNotMatch(anywhere.system, /Japan|Switzerland/);
});

test("responses are parsed defensively: fences stripped, duplicates dropped, junk rejected", () => {
  const result = parseTripIdeasResponse({
    content: [{ type: "text", text: "```json\n[\"道頓堀\", \"黒門市場\", \"道頓堀\", 42, \"新世界\"]\n```" }],
  });
  assert.deepEqual(result.places, ["道頓堀", "黒門市場", "新世界"]);

  assert.throws(() => parseTripIdeasResponse({ content: [{ type: "text", text: "not json" }] }), TripIdeasProviderError);
  assert.throws(() => parseTripIdeasResponse({ content: [{ type: "text", text: "{\"a\":1}" }] }), TripIdeasProviderError);
  assert.throws(() => parseTripIdeasResponse({ content: [] }), TripIdeasProviderError);
});
