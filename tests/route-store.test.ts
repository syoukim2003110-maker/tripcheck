import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RETIRED_ROUTE_KEYS, ROUTES_KEY, appleEndedLeg, parseStoredRoutes, serializeRoutes } from "../lib/shiori/route-store.ts";
import { buildShioriPlan } from "../lib/shiori/plan.ts";
import type { ShioriRoute } from "../lib/shiori/plan.ts";

const path = [{ latitude: 35.68, longitude: 139.76 }, { latitude: 35.69, longitude: 139.77 }];

test("the old untagged route store is retired and never the store in use", () => {
  assert.deepEqual([...RETIRED_ROUTE_KEYS], ["shiori-routes-v1"]);
  assert.notEqual(ROUTES_KEY, "shiori-routes-v1");
});

test("on load the page deletes the old route store before reading the new one", async () => {
  const page = await readFile(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /"shiori-routes-v1"/);
  const reader = page.slice(page.indexOf("function readRoutes"), page.indexOf("function writeRoutes"));
  assert.match(reader, /for \(const key of RETIRED_ROUTE_KEYS\) window\.localStorage\.removeItem\(key\)/);
  assert.ok(reader.indexOf("removeItem") < reader.indexOf("getItem"));
  // Every path the page keeps goes through the store's serializer.
  assert.match(page, /localStorage\.setItem\(ROUTES_KEY, serializeRoutes\(routes\)\)/);
});

test("only OpenStreetMap paths are written, each tagged with its source", () => {
  const routes = new Map<string, ShioriRoute | null>([
    ["walk|a-b", { minutes: 12, path, source: "osm" }],
    // A path with no source (as the old store held, Apple's among them) is not written.
    ["walk|c-d", { minutes: 9, path }],
    // Apple's answers live in the page's memory for the visit only.
    ["walk|g-h", { minutes: 7, path, source: "apple" }],
    ["drive|e-f", null],
  ]);
  const stored = JSON.parse(serializeRoutes(routes)) as unknown[][];
  assert.equal(stored.length, 1);
  assert.equal(stored[0][0], "walk|a-b");
  assert.equal(stored[0][3], "osm");
  assert.deepEqual(parseStoredRoutes(JSON.stringify(stored)).get("walk|a-b"), { minutes: 12, path, source: "osm" });
});

test("an entry without the OpenStreetMap tag is not read back, whatever it holds", () => {
  const raw = JSON.stringify([
    ["walk|a-b", 12, [[35.68, 139.76], [35.69, 139.77]]],
    ["walk|c-d", 12, [[35.68, 139.76], [35.69, 139.77]], "apple"],
    ["walk|e-f", 12, [[35.68, 139.76], [35.69, 139.77]], "osm"],
  ]);
  assert.deepEqual([...parseStoredRoutes(raw).keys()], ["walk|e-f"]);
  assert.equal(parseStoredRoutes("not json").size, 0);
  assert.equal(parseStoredRoutes(null).size, 0);
});

test("a path with an end at a place found through Apple is never kept: its ends are Apple's position of the place", () => {
  const routes = new Map<string, ShioriRoute | null>([
    ["walk|wikidata-Q1::wikidata-Q2", { minutes: 12, path, source: "osm" }],
    ["walk|wikidata-Q1::apple-I7EA0EDCABFD8E819", { minutes: 8, path, source: "osm" }],
    ["drive|apple-I7EA0EDCABFD8E819::osm-node-1", { minutes: 5, path, source: "osm" }],
    ["walk|maps-I7EA0EDCABFD8E819::wikidata-Q2", { minutes: 5, path, source: "osm" }],
    ["walk|base-shiori-hotel@at-34.3853,132.4553::wikidata-Q1", { minutes: 6, path, source: "osm" }],
    ["walk|wikidata-Q2::shiori-hotel@at-34.3853,132.4553", { minutes: 6, path, source: "osm" }],
    ["walk|base-shiori-hotel@apple-I7EA0EDCABFD8E819::wikidata-Q1", { minutes: 6, path, source: "osm" }],
    ["walk|wikidata-Q2::shiori-hotel@apple-34.3853,132.4553", { minutes: 6, path, source: "osm" }],
  ]);
  const keys = (text: string) => (JSON.parse(text) as Array<[string]>).map((entry) => entry[0]);
  // A hotel found elsewhere keeps its legs; one found through Apple (or kept without an id, which may be Apple's) does not.
  assert.deepEqual(keys(serializeRoutes(routes)), ["walk|wikidata-Q1::wikidata-Q2", "walk|base-shiori-hotel@at-34.3853,132.4553::wikidata-Q1", "walk|wikidata-Q2::shiori-hotel@at-34.3853,132.4553"]);
  // One kept before this rule is dropped when read.
  const older = JSON.stringify([["walk|wikidata-Q1::apple-I7EA0EDCABFD8E819", 8, [[35.68, 139.76], [35.69, 139.77]], "osm"], ["walk|a::b", 8, [[35.68, 139.76], [35.69, 139.77]], "osm"]]);
  assert.deepEqual([...parseStoredRoutes(older).keys()], ["walk|a::b"]);
});

test("a hotel leg kept in the old form, which does not say where the hotel came from, is dropped when read", () => {
  const older = JSON.stringify([
    ["walk|base-shiori-hotel@34.3853,132.4553::wikidata-Q1", 6, [[35.68, 139.76], [35.69, 139.77]], "osm"],
    ["walk|wikidata-Q1::shiori-hotel@-33.8688,151.2093", 6, [[35.68, 139.76], [35.69, 139.77]], "osm"],
    ["walk|wikidata-Q1::shiori-hotel@at-34.3853,132.4553", 6, [[35.68, 139.76], [35.69, 139.77]], "osm"],
  ]);
  assert.deepEqual([...parseStoredRoutes(older).keys()], ["walk|wikidata-Q1::shiori-hotel@at-34.3853,132.4553"]);
});

test("after an Apple hotel is swapped for another, the paths drawn to the Apple hotel are still not written", () => {
  const sights = [
    { id: "wikidata-Q1", name: "A", lat: 34.3955, lon: 132.4536, stayMinutes: 60 },
    { id: "wikidata-Q2", name: "B", lat: 34.3927, lon: 132.4524, stayMinutes: 60 },
  ];
  const keysOf = (hotel: { name: string; lat: number; lon: number; id?: string }) => {
    const plan = buildShioriPlan({ places: sights, days: 1, hotel, locale: "en" });
    return plan.days.flatMap((day) => [day.fromHotel, day.toHotel]).flatMap((leg) => (leg ? [`walk|${leg.key}`] : []));
  };
  const appleKeys = keysOf({ name: "Apple hotel", lat: 34.3853, lon: 132.4553, id: "apple-I7EA0EDCABFD8E819" });
  const otherKeys = keysOf({ name: "Other hotel", lat: 34.3853, lon: 132.4553, id: "osm-node-42" });
  assert.ok(appleKeys.length > 0 && otherKeys.length > 0);
  assert.ok(appleKeys.every(appleEndedLeg));
  assert.ok(otherKeys.every((key) => !appleEndedLeg(key)));
  // The page's street paths after the switch: both hotels' legs are in memory; only the other hotel's are written.
  const routes = new Map<string, ShioriRoute | null>([...appleKeys, ...otherKeys].map((key) => [key, { minutes: 5, path, source: "osm" }]));
  const written = (JSON.parse(serializeRoutes(routes)) as Array<[string]>).map((entry) => entry[0]);
  assert.deepEqual(written.sort(), [...otherKeys].sort());
  // A hotel kept from before hotels had ids may be Apple's: its legs are not written either.
  assert.ok(keysOf({ name: "Old hotel", lat: 34.3853, lon: 132.4553 }).every(appleEndedLeg));
});
