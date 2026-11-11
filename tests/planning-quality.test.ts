import assert from "node:assert/strict";
import test from "node:test";

import { resolveKnownStops, type ResolvedInputStop } from "../lib/route-optimizer.ts";
import { estimateStayMinutes } from "../lib/stay-estimates.ts";
import { estimateTravelOptions } from "../lib/time-feasibility.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";

function stop(name: string, latitude: number, longitude: number, minutes = 90): ResolvedInputStop {
  return {
    id: `test-${name}`,
    input: name,
    name,
    area: name,
    address: name,
    countryCode: "JP",
    latitude,
    longitude,
    sourceUrl: "https://example.test/",
    verifiedAt: "2026-11-11",
    confidence: "medium",
    planningDurationMinutes: minutes,
    isAnchor: false,
  };
}

test("a neighbourhood name does not swallow the longer place that starts with it", () => {
  const names = (line: string) => resolveKnownStops(line, "ja").map((entry) => entry.name);
  // These are their own places and must reach the real lookup.
  for (const line of ["新宿御苑", "西新宿", "Shinjuku Gyoen", "渋谷ヒカリエ", "築地本願寺", "浅草花やしき", "秋葉原電気街", "一蘭 渋谷", "Ichiran Shibuya"]) {
    assert.deepEqual(names(line), [], line);
  }
  // The neighbourhood itself, with the generic words people add to it.
  assert.deepEqual(names("新宿"), ["新宿"]);
  assert.deepEqual(names("新宿駅"), ["新宿"]);
  assert.deepEqual(names("Shibuya crossing"), ["渋谷"]);
  assert.deepEqual(names("浅草 必須"), ["浅草"]);
  assert.deepEqual(names("Asakusa 10:00 booked"), ["浅草"]);
  assert.deepEqual(names("築地"), ["築地場外市場"]);
  assert.deepEqual(names("Day 1: Shibuya, Harajuku"), ["渋谷", "原宿"]);
  assert.deepEqual(names("1日目 渋谷"), ["渋谷"]);
  assert.deepEqual(names("Day 2 Shinjuku"), ["新宿"]);
  // Venue entries are untouched.
  assert.deepEqual(names("浅草寺"), ["浅草寺"]);
  assert.deepEqual(names("築地場外市場"), ["築地場外市場"]);
});

test("on rail-dense ground a cross-town hop is a train, not a taxi", () => {
  // Kiyomizu-dera → Nijo Castle, about 4 km: 35-minute train, 20-minute drive.
  const crossTown = estimateTravelOptions(
    stop("清水寺", 34.9948, 135.785),
    stop("二条城", 35.0142, 135.7475),
    "auto",
    "transit_first",
  );
  assert.equal(crossTown.recommended.mode, "transit");
  // A taxi is still the answer when it is the profile's own preference.
  assert.equal(estimateTravelOptions(
    stop("A", 34.9948, 135.785),
    stop("B", 35.0142, 135.7475),
    "auto",
    "car_first",
  ).recommended.mode, "taxi");
});

test("a place with no category gets a stay that fits what its name says", () => {
  assert.equal(estimateStayMinutes("文武廟"), 60);
  assert.equal(estimateStayMinutes("スターフェリー"), 45);
  assert.equal(estimateStayMinutes("上野動物園"), 180);
  assert.equal(estimateStayMinutes("国立西洋美術館"), 120);
  assert.equal(estimateStayMinutes("錦市場"), 75);
  assert.equal(estimateStayMinutes("新宿御苑"), 75);
  // A typed venue keeps its type's duration over the generic name reading.
  assert.equal(estimateStayMinutes("寺町の水族館", ["aquarium"]), 150);
  // Nothing to go on: the caller's fallback stands.
  assert.equal(estimateStayMinutes("なぞの場所"), 90);
});

test("each day stays in one part of town instead of topping up a thin day across the city", () => {
  // The app's own failing case: Senso-ji was pulled out of its neighbourhood
  // (Ueno, Skytree) into a Tsukiji/Toyosu day to even out stay minutes.
  const places = [
    stop("浅草寺", 35.7148, 139.7967, 75),
    stop("東京スカイツリー", 35.7101, 139.8107, 120),
    stop("上野動物園", 35.7175, 139.7714, 180),
    stop("築地場外市場", 35.6654, 139.7707, 90),
    stop("チームラボプラネッツ", 35.6491, 139.7898, 120),
    stop("明治神宮", 35.6764, 139.6993, 90),
    stop("渋谷スカイ", 35.6585, 139.7023, 90),
    stop("新宿御苑", 35.6853, 139.7097, 75),
  ];
  const plan = buildTripFromWishlist(
    places.map((place) => `Place ${place.name}`).join("\n"),
    3,
    "balanced",
    "ja",
    { resolvedStops: places.map((place) => ({ ...place, input: `Place ${place.name}` })) },
  );
  const days = plan.days.map((day) => day.stops.map(({ stop: planned }) => planned.name).sort());
  const dayOf = (name: string) => days.findIndex((day) => day.includes(name));
  assert.equal(plan.unknownEntries.length, 0);
  assert.equal(dayOf("浅草寺"), dayOf("東京スカイツリー"));
  assert.equal(dayOf("浅草寺"), dayOf("上野動物園"));
  assert.equal(dayOf("築地場外市場"), dayOf("チームラボプラネッツ"));
  assert.equal(dayOf("明治神宮"), dayOf("渋谷スカイ"));
  assert.equal(dayOf("明治神宮"), dayOf("新宿御苑"));
  assert.notEqual(dayOf("浅草寺"), dayOf("築地場外市場"));
});
