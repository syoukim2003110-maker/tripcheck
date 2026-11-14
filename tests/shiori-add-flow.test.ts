import assert from "node:assert/strict";
import test from "node:test";

import { openCandidate, searchAddCandidates, type AddCandidate, type AddSearch } from "../lib/shiori/add-search.ts";

const TOKYO = { latitude: 35.6812, longitude: 139.7671 };
const mapPlace = (name: string) => ({
  id: name, name, latitude: 35.68, longitude: 139.76, formattedAddress: "", locality: null, subLocality: null, countryCode: "JP", poiCategory: "Restaurant",
});
const openHit = (name: string): AddCandidate => ({ id: `osm-${name}`, name, lat: 35.68, lon: 139.76, address: "", category: null, km: 1 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const search = (over: Partial<AddSearch>): AddSearch => ({
  poiFirst: false, anchor: TOKYO, reachKm: 100, cityKm: 30, mapSearch: async () => [], openLookup: async () => null, isCurrent: () => true, ...over,
});

/**
 * The form as the page drives it: a counter that every new search (and every
 * keystroke) moves on, and a screen that only a delivered answer may change.
 */
function form() {
  let run = 0;
  const shown: Array<string[] | "failed"> = [];
  return {
    shown,
    moveOn: () => { run += 1; },
    async start(over: Partial<AddSearch>) {
      const mine = ++run;
      const found = await searchAddCandidates(search({ ...over, isCurrent: () => mine === run }));
      if (found === null) return;
      shown.push(found.length === 0 ? "failed" : found.map((entry) => entry.name));
    },
  };
}

test("only the latest search may change the form", async () => {
  const page = form();
  const a = deferred<ReturnType<typeof mapPlace>[]>();
  const b = deferred<ReturnType<typeof mapPlace>[]>();
  const first = page.start({ mapSearch: () => a.promise });
  const second = page.start({ mapSearch: () => b.promise });
  // B answers first, A late: A's list must not replace B's.
  b.resolve([mapPlace("B")]);
  await second;
  a.resolve([mapPlace("A")]);
  await first;
  assert.deepEqual(page.shown, [["B"]]);
});

test("a late failure of an earlier search does not show 'not found' beside the newer results", async () => {
  const page = form();
  const a = deferred<ReturnType<typeof mapPlace>[]>();
  let lookups = 0;
  const first = page.start({ mapSearch: () => a.promise, openLookup: async () => { lookups += 1; throw new Error("offline"); } });
  await page.start({ mapSearch: async () => [mapPlace("B")] });
  a.reject(new Error("relay down"));
  await first;
  assert.deepEqual(page.shown, [["B"]]);
  // And the search nobody is waiting for does not spend the fallback.
  assert.equal(lookups, 0);
});

test("typing while a search is in flight drops its answer and stops it spending more requests", async () => {
  const page = form();
  const a = deferred<ReturnType<typeof mapPlace>[]>();
  const asked: boolean[] = [];
  let lookups = 0;
  const first = page.start({
    poiFirst: true,
    mapSearch: (poiOnly) => { asked.push(poiOnly); return asked.length === 1 ? a.promise : Promise.resolve([mapPlace("late")]); },
    openLookup: async () => { lookups += 1; return openHit("late"); },
  });
  page.moveOn();
  a.resolve([]);
  await first;
  assert.deepEqual(page.shown, []);
  assert.deepEqual(asked, [true]);
  assert.equal(lookups, 0);
});

test("when the map search cannot be reached the open lookup is asked, once", async () => {
  let maps = 0;
  let lookups = 0;
  const found = await searchAddCandidates(search({
    mapSearch: async () => { maps += 1; throw new Error("quota_exhausted"); },
    openLookup: async () => { lookups += 1; return openHit("東京タワー"); },
  }));
  assert.deepEqual(found?.map((entry) => entry.name), ["東京タワー"]);
  assert.equal(maps, 1);
  assert.equal(lookups, 1);
});

test("a restaurant search whose wider second map search fails still falls back", async () => {
  const asked: boolean[] = [];
  const found = await searchAddCandidates(search({
    poiFirst: true,
    mapSearch: async (poiOnly) => { asked.push(poiOnly); if (!poiOnly) throw new Error("unavailable"); return []; },
    openLookup: async () => openHit("もへじ"),
  }));
  assert.deepEqual(asked, [true, false]);
  assert.deepEqual(found?.map((entry) => entry.name), ["もへじ"]);
});

test("map hits are the answer and the open lookup is left alone", async () => {
  let lookups = 0;
  const asked: boolean[] = [];
  const found = await searchAddCandidates(search({
    poiFirst: true,
    mapSearch: async (poiOnly) => { asked.push(poiOnly); return [mapPlace("A"), mapPlace("B")]; },
    openLookup: async () => { lookups += 1; return openHit("C"); },
  }));
  assert.deepEqual(found?.map((entry) => entry.name), ["A", "B"]);
  assert.deepEqual(asked, [true]);
  assert.equal(lookups, 0);
});

test("both sources failing is 'not found', after no more than two map searches", async () => {
  let maps = 0;
  const found = await searchAddCandidates(search({
    poiFirst: true,
    mapSearch: async () => { maps += 1; if (maps === 2) throw new Error("unavailable"); return []; },
    openLookup: async () => { throw new Error("offline"); },
  }));
  assert.deepEqual(found, []);
  assert.equal(maps, 2);
  // A build with no map search goes straight to the open lookup.
  assert.deepEqual((await searchAddCandidates(search({ mapSearch: null, openLookup: async () => openHit("X") })))?.map((entry) => entry.name), ["X"]);
});

test("the open lookup's hit is offered only within reach of the trip", () => {
  const hit = { id: "wikidata-Q1", name: "Tokyo Tower", latitude: 35.6586, longitude: 139.7454, planningDurationMinutes: 600, placeTypes: ["observation_deck"] };
  const near = openCandidate(hit, TOKYO, 100);
  assert.equal(near?.stayMinutes, 240);
  assert.equal(near?.kind, "observation deck");
  assert.ok(near && near.km < 5);
  assert.equal(openCandidate({ ...hit, latitude: 48.85, longitude: 2.35 }, TOKYO, 100), null);
  assert.equal(openCandidate({ ...hit, latitude: 48.85, longitude: 2.35 }, null, 100)?.km, 0);
});
