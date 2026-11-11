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

test("a line picked from the list is placed with no lookup; a name with two meanings is not", async () => {
  const { knownStopsForQueries } = await import("../lib/bundled-sights-resolution.ts");
  const data = {
    generatedAt: "2026-11-11",
    cities: [
      { id: "kyoto", ja: "京都", en: "Kyoto", lat: 35.01, lon: 135.76, radiusKm: 13, sights: [kiyomizu, { ...kinkaku, ja: "金閣寺" }] },
      { id: "bangkok", ja: "バンコク", en: "Bangkok", lat: 13.75, lon: 100.5, radiusKm: 16, sights: [{ q: "Q1", ja: "王宮", en: "Grand Palace", lat: 13.75, lon: 100.49, kind: "palace" }] },
      { id: "madrid", ja: "マドリード", en: "Madrid", lat: 40.41, lon: -3.7, radiusKm: 9, sights: [{ q: "Q2", ja: "王宮", en: "Royal Palace of Madrid", lat: 40.418, lon: -3.714, kind: "palace" }] },
    ],
  };
  const known = knownStopsForQueries(["清水寺", "金閣寺", "王宮", "だれも知らない店", "Grand Palace"], "ja", data);

  assert.deepEqual([...known.keys()], ["清水寺", "金閣寺", "Grand Palace"]);
  const temple = known.get("清水寺")!;
  assert.equal(temple.id, "wikidata-Q221716");
  assert.equal(temple.area, "京都");
  assert.equal(temple.countryCode, "JP");
  assert.equal(temple.planningDurationMinutes, 60);
  assert.deepEqual(temple.placeTypes, ["buddhist_temple"]);
  assert.equal(temple.verifiedAt, "2026-11-11T00:00:00.000Z");
  // "王宮" is Bangkok's and Madrid's: guessing is the lookup's job, not this table's.
  assert.equal(known.has("王宮"), false);
});

test("picked sights cost no request and still tell the lookup where the trip is", async () => {
  const { OpenPlaceResolver } = await import("../lib/open-place-resolver.ts");
  const { knownStopsForQueries } = await import("../lib/bundled-sights-resolution.ts");
  const data = { generatedAt: "2026-11-11", cities: [{ id: "kyoto", ja: "京都", en: "Kyoto", lat: 35.01, lon: 135.76, radiusKm: 13, sights: [kiyomizu, { ...kinkaku, ja: "金閣寺" }] }] };
  const searched: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.host === "ja.wikipedia.org" && url.searchParams.get("list") === "search") {
      const text = (url.searchParams.get("srsearch") ?? "").replace(/\s*nearcoord:\S+/, "");
      searched.push(text);
      // Two 東寺: Kyoto's, and a namesake far away.
      return Response.json({ query: { search: text === "東寺" ? [{ pageid: 2, title: "東寺 (遠方)" }, { pageid: 1, title: "東寺" }] : [] } });
    }
    if (url.host === "ja.wikipedia.org") {
      return Response.json({ query: { pages: [
        { pageid: 1, title: "東寺", length: 30_000, coordinates: [{ lat: 34.9806, lon: 135.7478, primary: true, globe: "earth" }] },
        { pageid: 2, title: "東寺 (遠方)", length: 30_000, coordinates: [{ lat: 38.0, lon: 140.0, primary: true, globe: "earth" }] },
      ] } });
    }
    if (url.host === "www.wikidata.org") return Response.json({ query: { pages: [] } });
    if (url.host === "query.wikidata.org") return Response.json({ results: { bindings: [] } });
    if (url.host === "nominatim.openstreetmap.org") return Response.json([]);
    return new Response("busy", { status: 503 });
  }) as typeof fetch;
  const queries = ["清水寺", "金閣寺", "東寺"];
  const resolver = new OpenPlaceResolver({ fetcher, hostIntervalMs: 0, sleep: async () => {} });
  const result = await resolver.resolve(
    { queries, providerOverrides: [], hotelQuery: null, languageCode: "ja", destination: "auto" },
    undefined,
    null,
    knownStopsForQueries(queries, "ja", data),
  );

  // Only the typed line was looked up.
  assert.deepEqual([...new Set(searched)], ["東寺"]);
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.places.map((place) => place.input).sort(), ["東寺", "清水寺", "金閣寺"]);
  // The two picked Kyoto sights settled which 東寺 was meant.
  assert.ok(Math.abs(result.places.find((place) => place.input === "東寺")!.latitude - 34.9806) < 0.001);
  assert.equal(result.places.find((place) => place.input === "金閣寺")?.area, "京都");
});
