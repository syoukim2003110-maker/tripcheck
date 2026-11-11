import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  filterDestinations,
  toggleSightLine,
  wishlistHasSight,
  type PopularDestination,
} from "../lib/popular-sights.ts";

const kiyomizu = { q: "Q221716", ja: "清水寺", en: "Kiyomizu-dera", lat: 34.9948, lon: 135.785, kind: "buddhist temple" };
const kinkaku = { q: "Q270983", ja: "鹿苑寺", en: "Kinkaku-ji", lat: 35.0395, lon: 135.7285, kind: "buddhist temple" };
const destinations: PopularDestination[] = [
  { id: "kyoto", ja: "京都", en: "Kyoto", lat: 35.01, lon: 135.76, radiusKm: 13, sights: [kiyomizu, kinkaku] },
  { id: "tokyo", ja: "東京", en: "Tokyo", lat: 35.68, lon: 139.76, radiusKm: 16, sights: [] },
  { id: "naha", ja: "沖縄（那覇）", en: "Okinawa (Naha)", lat: 26.21, lon: 127.68, radiusKm: 25, sights: [] },
  { id: "hiroshima", ja: "広島・宮島", en: "Hiroshima", lat: 34.38, lon: 132.45, radiusKm: 22, sights: [] },
];

test("nothing typed shows the featured destinations, in the given order", () => {
  assert.deepEqual(filterDestinations(destinations, "", ["tokyo", "kyoto", "missing"]).map((entry) => entry.id), ["tokyo", "kyoto"]);
});

test("a destination answers to Japanese, English and either half of a combined name", () => {
  const ids = (query: string) => filterDestinations(destinations, query, []).map((entry) => entry.id);
  assert.deepEqual(ids("京都"), ["kyoto"]);
  // A name that starts with the typed text comes before one that contains it.
  assert.deepEqual(ids("kyo"), ["kyoto", "tokyo"]);
  assert.deepEqual(ids("ＫＹＯＴＯ"), ["kyoto"]);
  assert.deepEqual(ids("沖縄"), ["naha"]);
  assert.deepEqual(ids("那覇"), ["naha"]);
  assert.deepEqual(ids("宮島"), ["hiroshima"]);
  assert.deepEqual(ids("京都旅行"), ["kyoto"]);
  assert.deepEqual(ids("南極"), []);
});

test("a tap adds a sight as its own line and a second tap removes exactly that line", () => {
  const once = toggleSightLine("", kiyomizu, "ja");
  assert.equal(once, "清水寺\n");
  const twice = toggleSightLine(once, kinkaku, "ja");
  assert.equal(twice, "清水寺\n鹿苑寺\n");
  assert.equal(wishlistHasSight(twice, kiyomizu), true);
  assert.equal(toggleSightLine(twice, kiyomizu, "ja"), "鹿苑寺\n");
  // English wording in the English interface; either spelling counts as present.
  assert.equal(toggleSightLine("", kiyomizu, "en"), "Kiyomizu-dera\n");
  assert.equal(wishlistHasSight("kiyomizu dera", kiyomizu), true);
});

test("a line the traveller annotated is theirs and is never removed by a tap", () => {
  const annotated = "清水寺 必須\n錦市場";
  assert.equal(wishlistHasSight(annotated, kiyomizu), false);
  assert.equal(toggleSightLine(annotated, kiyomizu, "ja"), "清水寺 必須\n錦市場\n清水寺\n");
  // Typed text above is kept as-is when something is appended.
  assert.equal(toggleSightLine("東寺\n\n", kinkaku, "ja"), "東寺\n鹿苑寺\n");
});

test("the bundled list is well-formed: real coordinates, both names, no duplicates", { skip: !existsSync(new URL("../lib/popular-sights-data.json", import.meta.url)) }, () => {
  const data = JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] };
  assert.ok(data.cities.length >= 40, `only ${data.cities.length} destinations`);
  const ids = new Set<string>();
  for (const city of data.cities) {
    assert.ok(!ids.has(city.id), `duplicate destination ${city.id}`);
    ids.add(city.id);
    assert.ok(city.sights.length >= 6 && city.sights.length <= 36, `${city.id} has ${city.sights.length} sights`);
    const names = new Set<string>();
    for (const sight of city.sights) {
      assert.match(sight.q, /^Q\d+$/);
      assert.ok(sight.ja.trim() && sight.en.trim(), `${city.id}/${sight.q} lacks a name`);
      assert.ok(Math.abs(sight.lat) <= 90 && Math.abs(sight.lon) <= 180);
      // Inside the destination's own circle (with slack for its edge).
      const kmPerDegree = 111.32;
      const distance = Math.hypot((sight.lat - city.lat) * kmPerDegree, (sight.lon - city.lon) * kmPerDegree * Math.cos(city.lat * Math.PI / 180));
      assert.ok(distance <= city.radiusKm * 1.1 + 1, `${city.id}/${sight.ja} is ${distance.toFixed(1)} km out`);
      assert.ok(!names.has(sight.ja), `${city.id} lists ${sight.ja} twice`);
      names.add(sight.ja);
    }
  }
  for (const id of ["tokyo", "kyoto", "osaka", "hongkong", "seoul", "taipei", "bangkok", "paris"]) assert.ok(ids.has(id), `featured ${id} missing`);
});
