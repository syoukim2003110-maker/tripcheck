import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RETIRED_ROUTE_KEYS, ROUTES_KEY, parseStoredRoutes, serializeRoutes } from "../lib/shiori/route-store.ts";
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
