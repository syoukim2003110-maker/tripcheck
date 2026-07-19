import assert from "node:assert/strict";
import test from "node:test";
import { optimizeItineraryRoute } from "../lib/route-optimizer.ts";

test("optimizes a day locally while keeping its first stop fixed", () => {
  const result = optimizeItineraryRoute(`Day 1
09:00 Tsukiji Outer Market
11:00 Shibuya Sky
13:00 Senso-ji
15:00 Tokyo Skytree
18:00 Shinjuku`);

  assert.equal(result.recognizedStopCount, 5);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].optimizedStops[0].id, "tsukiji-market");
  assert.ok(result.days[0].optimizedDistanceKm < result.days[0].originalDistanceKm);
  assert.ok(result.days[0].distanceSavedKm > 5);
  assert.equal(result.days[0].exact, true);
});

test("keeps separate days separate and builds an explicit Google Maps handoff", () => {
  const result = optimizeItineraryRoute(`1日目
09:00 浅草寺
12:00 東京スカイツリー
2日目
10:00 明治神宮
14:00 渋谷スカイ
18:00 新宿`, "ja");

  assert.equal(result.days.length, 2);
  assert.deepEqual(result.days.map((day) => day.label), ["1日目", "2日目"]);
  assert.match(result.days[1].googleMapsUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?/);
  assert.match(result.days[1].googleMapsUrl, /travelmode=transit/);
  assert.doesNotMatch(result.days[1].googleMapsUrl, /浅草寺|明治神宮/);
});

test("does not claim a route when fewer than two known stops exist", () => {
  const result = optimizeItineraryRoute(`Day 1
09:00 A private address
12:00 Senso-ji`);

  assert.equal(result.recognizedStopCount, 1);
  assert.equal(result.days.length, 0);
  assert.equal(result.distanceSavedKm, 0);
});
