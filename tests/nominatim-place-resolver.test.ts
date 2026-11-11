import assert from "node:assert/strict";
import test from "node:test";
import { destinationById } from "../lib/destinations.ts";
import type { PlaceResolutionRequest } from "../lib/google-place-resolver.ts";
import {
  fetchNominatimPlaceResolutions,
  NominatimPlaceResolver,
} from "../lib/nominatim-place-resolver.ts";

function searchResult(input: Partial<Record<string, unknown>> = {}) {
  return {
    place_id: 123,
    osm_type: "relation",
    osm_id: 1682248,
    lat: "46.5938",
    lon: "7.9091",
    category: "place",
    type: "village",
    addresstype: "village",
    name: "Lauterbrunnen",
    display_name: "Lauterbrunnen, Verwaltungskreis Interlaken-Oberhasli, Bern, Schweiz/Suisse/Svizzera/Svizra",
    address: { country_code: "ch" },
    ...input,
  };
}

test("Nominatim search is destination-bounded, identified and converted to an evidence-backed stop", async () => {
  const fetchedAt = Date.parse("2026-08-15T00:00:00.000Z");
  let providerCalls = 0;
  const resolver = new NominatimPlaceResolver({
    now: () => fetchedAt,
    intervalMs: 1_000,
    userAgent: "TripCheck-test/1.0 (+https://tripcheck.test/contact)",
    fetcher: (async (input, init) => {
      providerCalls += 1;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://nominatim.openstreetmap.org");
      assert.equal(url.pathname, "/search");
      assert.equal(url.searchParams.get("q"), "Lauterbrunnen Switzerland");
      assert.equal(url.searchParams.get("format"), "jsonv2");
      assert.equal(url.searchParams.get("limit"), "3");
      assert.equal(url.searchParams.get("countrycodes"), "ch,li");
      assert.equal(url.searchParams.get("viewbox"), "5.8,47.9,10.6,45.6");
      assert.equal(url.searchParams.get("bounded"), "1");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("User-Agent"), "TripCheck-test/1.0 (+https://tripcheck.test/contact)");
      assert.equal(headers.get("Accept-Language"), "en");
      return Response.json([searchResult()]);
    }) as typeof fetch,
  });

  const candidates = await resolver.search("Lauterbrunnen", "en", destinationById("switzerland"));
  assert.equal(providerCalls, 1);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    id: "osm-relation-1682248",
    input: "Lauterbrunnen",
    name: "Lauterbrunnen",
    area: "Bern",
    address: "Lauterbrunnen, Verwaltungskreis Interlaken-Oberhasli, Bern, Schweiz/Suisse/Svizzera/Svizra",
    countryCode: "CH",
    latitude: 46.5938,
    longitude: 7.9091,
    sourceUrl: "https://www.openstreetmap.org/relation/1682248",
    verifiedAt: "2026-08-15T00:00:00.000Z",
    confidence: "medium",
    planningDurationMinutes: 90,
    isAnchor: false,
    placeTypes: ["place", "village"],
  });
  assert.equal(candidates[0]?.providerRef, undefined, "an OSM object must never masquerade as a Google Place ID");
});

test("positive and negative searches are cached instead of repeating public-service calls", async () => {
  let providerCalls = 0;
  const resolver = new NominatimPlaceResolver({
    now: () => 10_000,
    intervalMs: 1_000,
    userAgent: "TripCheck-test/1.0 (+https://tripcheck.test/contact)",
    fetcher: (async () => {
      providerCalls += 1;
      return Response.json(providerCalls === 1 ? [searchResult()] : []);
    }) as typeof fetch,
  });

  const first = await resolver.search("Lauterbrunnen", "en", destinationById("switzerland"));
  const sameNormalizedInput = await resolver.search("  LAUTERBRUNNEN ", "en", destinationById("switzerland"));
  assert.equal(providerCalls, 1);
  assert.equal(first[0]?.verifiedAt, sameNormalizedInput[0]?.verifiedAt);
  assert.equal(sameNormalizedInput[0]?.input, "  LAUTERBRUNNEN ");

  assert.deepEqual(await resolver.search("No result", "en", destinationById("worldwide")), []);
  assert.deepEqual(await resolver.search("No result", "en", destinationById("worldwide")), []);
  assert.equal(providerCalls, 2, "an empty result is cached too");
});

test("concurrent public searches start at least one second apart", async () => {
  let clock = 5_000;
  const networkStarts: number[] = [];
  let nextId = 10;
  const resolver = new NominatimPlaceResolver({
    now: () => clock,
    sleep: async (delayMs) => { clock += delayMs; },
    intervalMs: 1_000,
    userAgent: "TripCheck-test/1.0 (+https://tripcheck.test/contact)",
    fetcher: (async () => {
      networkStarts.push(clock);
      nextId += 1;
      return Response.json([searchResult({ osm_id: nextId })]);
    }) as typeof fetch,
  });

  await Promise.all([
    resolver.search("First place", "en", destinationById("worldwide")),
    resolver.search("Second place", "en", destinationById("worldwide")),
  ]);
  assert.deepEqual(networkStarts, [5_000, 6_000]);
});

test("worldwide same-name cross-country results stay ambiguous", async () => {
  const resolver = new NominatimPlaceResolver({
    now: () => Date.parse("2026-08-15T00:00:00.000Z"),
    intervalMs: 1_000,
    userAgent: "TripCheck-test/1.0 (+https://tripcheck.test/contact)",
    fetcher: (async () => Response.json([
      searchResult({ osm_id: 1, name: "Springfield", display_name: "Springfield, Illinois, United States", lat: "39.8", lon: "-89.6", address: { country_code: "us" } }),
      searchResult({ osm_id: 2, name: "Springfield", display_name: "Springfield, Queensland, Australia", lat: "-27.65", lon: "152.9", address: { country_code: "au" } }),
    ])) as typeof fetch,
  });
  const request: PlaceResolutionRequest = {
    queries: ["Springfield"],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "en",
    destination: "auto",
  };
  const result = await fetchNominatimPlaceResolutions(request, undefined, resolver);
  assert.deepEqual(result.places, []);
  assert.equal(result.ambiguous.length, 1);
  assert.deepEqual(result.ambiguous[0]?.candidates.map((candidate) => candidate.countryCode), ["US", "AU"]);
});

test("out-of-destination results are discarded and Google overrides never become fuzzy OSM queries", async () => {
  let providerCalls = 0;
  const resolver = new NominatimPlaceResolver({
    now: () => Date.parse("2026-08-15T00:00:00.000Z"),
    intervalMs: 1_000,
    userAgent: "TripCheck-test/1.0 (+https://tripcheck.test/contact)",
    fetcher: (async () => {
      providerCalls += 1;
      return Response.json([searchResult({ osm_id: 99, name: "Tokyo", display_name: "Tokyo, Japan", lat: "35.68", lon: "139.76", address: { country_code: "jp" } })]);
    }) as typeof fetch,
  });

  assert.deepEqual(await resolver.search("Tokyo", "en", destinationById("switzerland")), []);
  const overrideOnly: PlaceResolutionRequest = {
    queries: [],
    providerOverrides: [{ inputIndex: 0, input: "Chosen place", providerRef: "ChIJ_exact_google_id" }],
    hotelQuery: null,
    languageCode: "en",
    destination: "auto",
  };
  assert.deepEqual(await fetchNominatimPlaceResolutions(overrideOnly, undefined, resolver), {
    places: [],
    hotel: null,
    ambiguous: [],
  });
  assert.equal(providerCalls, 1, "the exact Google choice was not reissued as a text search");
});
