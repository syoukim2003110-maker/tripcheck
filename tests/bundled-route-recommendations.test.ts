import assert from "node:assert/strict";
import test from "node:test";

import { bundledSightsNearRoute, cafesNearRoute } from "../lib/bundled-route-recommendations.ts";
import type { PopularDestination } from "../lib/popular-sights.ts";

const kyoto: PopularDestination = {
  id: "kyoto", ja: "京都", en: "Kyoto", lat: 35.0116, lon: 135.7681, radiusKm: 13,
  sights: [
    { q: "Q1", ja: "清水寺", en: "Kiyomizu-dera", lat: 34.9948, lon: 135.785, kind: "buddhist temple" },
    { q: "Q2", ja: "金閣寺", en: "Kinkaku-ji", lat: 35.0395, lon: 135.7285, kind: "buddhist temple" },
    { q: "Q3", ja: "八坂神社", en: "Yasaka Shrine", lat: 35.0037, lon: 135.7786, kind: "shinto shrine" },
    { q: "Q4", ja: "円山公園", en: "Maruyama Park", lat: 35.0036, lon: 135.7809, kind: "urban park" },
    { q: "Q5", ja: "京都市動物園", en: "Kyoto City Zoo", lat: 35.0129, lon: 135.7862, kind: "zoo" },
    { q: "Q6", ja: "建仁寺", en: "Kennin-ji", lat: 35.0006, lon: 135.7736, kind: "buddhist temple" },
  ],
};
const tokyo: PopularDestination = {
  id: "tokyo", ja: "東京", en: "Tokyo", lat: 35.6812, lon: 139.7671, radiusKm: 16,
  sights: [{ q: "Q9", ja: "東京タワー", en: "Tokyo Tower", lat: 35.6586, lon: 139.7454, kind: "observation tower" }],
};
// A day around Gion and Kiyomizu-dera.
const route = [{ latitude: 35.0035, longitude: 135.7751 }, { latitude: 34.9948, longitude: 135.785 }];

test("near today's plan: famous places a short walk away that are not on the list yet", () => {
  const ideas = bundledSightsNearRoute({ routePoints: route, excludedNames: ["清水寺", "祇園"], languageCode: "ja", cities: [tokyo, kyoto] });
  const names = ideas.map((idea) => idea.name);
  // Already on the wishlist, across the city, in another city, or a day out: none of them.
  assert.equal(names.includes("清水寺"), false);
  assert.equal(names.includes("金閣寺"), false);
  assert.equal(names.includes("東京タワー"), false);
  assert.equal(names.includes("京都市動物園"), false);
  assert.deepEqual([...names].sort(), ["八坂神社", "円山公園", "建仁寺"].sort());
  // More famous first when both are a short walk away.
  assert.equal(names[0], "八坂神社");
  const shrine = ideas[0];
  assert.equal(shrine.id, "wikidata-Q3");
  assert.equal(shrine.type, "神社");
  assert.equal(shrine.address, "京都");
  assert.ok(shrine.routeDistanceMeters < 500);
  // Nothing a source did not supply is claimed.
  assert.ok(ideas.every((idea) => idea.rating === null && idea.userRatingCount === null && idea.photoName === null));
});

test("a gap that asked for a park gets parks, and a café-only gap gets no sights", () => {
  const input = { routePoints: route, excludedNames: [], languageCode: "en" as const, cities: [kyoto] };
  assert.deepEqual(bundledSightsNearRoute({ ...input, suggestionKinds: ["PARK"] }).map((idea) => idea.name), ["Maruyama Park"]);
  assert.deepEqual(bundledSightsNearRoute({ ...input, suggestionKinds: ["CAFE", "BAKERY"] }), []);
  assert.deepEqual(bundledSightsNearRoute({ ...input, routePoints: [] }), []);
});

test("cafés come from the relay, nearest first, only when the gap wants one", async () => {
  const asked: Array<{ query: string; withinMeters: number; poiCategories: readonly string[] }> = [];
  const search = async (options: { query: string; withinMeters: number; poiCategories: readonly string[] }) => {
    asked.push(options);
    return [
      { id: "B", name: "遠いカフェ", latitude: 35.0005, longitude: 135.781, formattedAddress: "京都市\n東山区", poiCategory: "Cafe" },
      { id: "A", name: "近いパン屋", latitude: 35.0036, longitude: 135.7752, formattedAddress: "京都市東山区", poiCategory: "Bakery" },
      { id: "C", name: "祇園", latitude: 35.0035, longitude: 135.7751, formattedAddress: "", poiCategory: "Cafe" },
    ];
  };
  const cafes = await cafesNearRoute({ routePoints: route, excludedNames: ["祇園"], languageCode: "ja", suggestionKinds: ["CAFE"], search });
  assert.deepEqual(asked.map((entry) => [entry.query, entry.withinMeters, [...entry.poiCategories]]), [["カフェ", 800, ["Cafe", "Bakery"]]]);
  assert.deepEqual(cafes.map((cafe) => [cafe.name, cafe.type]), [["近いパン屋", "ベーカリー"], ["遠いカフェ", "カフェ"]]);
  assert.equal(cafes[1].address, "京都市 東山区");

  let called = false;
  const none = await cafesNearRoute({ routePoints: route, excludedNames: [], languageCode: "ja", suggestionKinds: ["LOOKOUT"], search: async () => { called = true; return []; } });
  assert.deepEqual(none, []);
  assert.equal(called, false);
});
