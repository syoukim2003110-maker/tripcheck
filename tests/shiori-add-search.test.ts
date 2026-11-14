import assert from "node:assert/strict";
import test from "node:test";

import { addAnchor, addCandidates, kindOfCategory, kmBetween } from "../lib/shiori/add-search.ts";

const place = (name: string, latitude: number, longitude: number, id: string | null = name) => ({
  id, name, latitude, longitude, formattedAddress: `${name}の住所`, locality: null, subLocality: null, countryCode: "JP", poiCategory: "Restaurant",
});
const TOKYO = { lat: 35.6812, lon: 139.7671 };

test("a same-named shop in another city is not offered", () => {
  // The live bug: "もんじゃ 月島" answered with a shop in Yokohama (35.4428, 139.6338) and it was added unasked.
  const anchor = addAnchor(TOKYO, []);
  const found = addCandidates([place("もんじゃ 月島 横浜店", 35.44281, 139.63375), place("月島もんじゃ もへじ", 35.6638, 139.7812)], anchor, 20);
  assert.deepEqual(found.map((entry) => entry.name), ["月島もんじゃ もへじ"]);
  assert.ok(found[0].km < 3);
  // Within reach but outside the city (Yokohama from Tokyo): offered, but below the one in the city.
  const wide = addCandidates([place("もんじゃ 月島 横浜店", 35.44281, 139.63375), place("月島もんじゃ もへじ", 35.6638, 139.7812)], anchor, 100, 6, 20);
  assert.deepEqual(wide.map((entry) => entry.name), ["月島もんじゃ もへじ", "もんじゃ 月島 横浜店"]);
});

test("candidates keep the map's order, drop doubles and stop at the limit", () => {
  const anchor = addAnchor(TOKYO, []);
  const results = [place("A", 35.68, 139.76), place("A", 35.68, 139.76, "other-id"), place("B", 35.69, 139.77), place("C", 35.7, 139.78)];
  assert.deepEqual(addCandidates(results, anchor, 100, 2).map((entry) => entry.name), ["A", "B"]);
  assert.equal(addCandidates(results, anchor, 100)[0].id, "apple-A");
});

test("with no city the middle of the chosen places is the anchor, and with nothing chosen nothing is filtered", () => {
  const anchor = addAnchor(null, [{ lat: 35, lon: 139 }, { lat: 36, lon: 140 }]);
  assert.deepEqual(anchor, { latitude: 35.5, longitude: 139.5 });
  assert.equal(addAnchor(null, []), null);
  assert.equal(addCandidates([place("Far", 48.85, 2.35)], null, 10).length, 1);
});

test("distances and kind labels", () => {
  assert.ok(Math.abs(kmBetween({ latitude: 35.6812, longitude: 139.7671 }, { latitude: 35.6586, longitude: 139.7454 }) - 3.2) < 0.4);
  assert.equal(kindOfCategory("Cafe"), "cafe");
  assert.equal(kindOfCategory("Unknown"), null);
  assert.equal(kindOfCategory(null), null);
});

test("an id the map returns can always be saved with the trip", async () => {
  const { decodeTrip, emptyTrip, encodeTrip } = await import("../lib/shiori/state.ts");
  const found = addCandidates([
    place("Slash", 35.68, 139.76, "I/7+A=="),
    place("Long", 35.69, 139.77, "x".repeat(200)),
    place("Plain", 35.7, 139.78, "I63802885C8189B2B"),
    place("No id", 35.71, 139.79, null),
  ], addAnchor(TOKYO, []), 100);
  assert.equal(found.length, 4);
  for (const entry of found) assert.match(entry.id, /^[\w.:,@-]{1,160}$/);
  assert.equal(found[2].id, "apple-I63802885C8189B2B");
  const trip = { ...emptyTrip, places: found.map((entry) => ({ id: entry.id, name: entry.name, lat: entry.lat, lon: entry.lon, stayMinutes: 60 })) };
  assert.equal(decodeTrip(encodeTrip(trip))?.places.length, 4);
});
