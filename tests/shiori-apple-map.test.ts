import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * The booklet's map is Apple's (MapKit JS). These pin what the switch must
 * not lose: the dashed "unknown way", the credits for TripCheck's own lines,
 * a booklet that still works when the map cannot be shown, and one MapKit
 * script and token for the map and the place card together.
 */

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a leg whose way is unknown is still drawn dashed and grey, never as a route", async () => {
  const map = await read("app/shiori/ShioriMap.tsx");
  const straight = map.slice(map.indexOf('line.kind === "straight").map'), map.indexOf("// A white edge"));
  assert.match(straight, /strokeColor: UNKNOWN_WAY/);
  assert.match(straight, /lineDash: \[\d+, \d+\]/);
  // Rail and street lines are solid.
  const solid = map.slice(map.indexOf("// A white edge"), map.indexOf("function prefersLessMotion"));
  assert.doesNotMatch(solid, /lineDash/);
});

test("the map credits TripCheck's own lines beside Apple's map, in both languages", async () => {
  const map = await read("app/shiori/ShioriMap.tsx");
  assert.match(map, /href="https:\/\/www\.openstreetmap\.org\/copyright"/);
  const page = await read("app/shiori/ShioriApp.tsx");
  for (const key of ["mapRailCredit", "mapStreetCredit", "mapFailed"]) {
    assert.equal(page.match(new RegExp(`\\n    ${key}: "`, "g"))?.length, 2, `${key} must exist in Japanese and English`);
  }
  assert.equal(page.match(/© OpenStreetMap contributors/g)?.length, 4, "map credit and footer credit, in two languages");
  assert.doesNotMatch(page, /OpenFreeMap/);
  assert.match(page, /credits: "地図 Apple マップ/);
  assert.match(page, /credits: "Map: Apple Maps/);
});

test("when MapKit cannot be shown the booklet says so and goes on without a map", async () => {
  const map = await read("app/shiori/ShioriMap.tsx");
  assert.match(map, /if \(!appleRelayUrl\(\)\) \{ fail\(\); return; \}/);
  assert.match(map, /\.catch\(fail\)/);
  assert.match(map, /if \(state === "failed"\) fail\(\);/);
  assert.match(map, /\{failed \? <p className="shiori-map-note">\{text\.failed\}<\/p> : null\}/);
  const loader = await read("lib/mapkit-loader.ts");
  // Apple's refusals after loading ("Unauthorized", "Too Many Requests") reach the map.
  assert.match(loader, /mapkit\.addEventListener\("error", \(\) => setState\("failed"\)\)/);
});

test("the map and the place card share one MapKit script, one initialisation and one token", async () => {
  const card = await read("lib/apple-place-card.ts");
  const map = await read("app/shiori/ShioriMap.tsx");
  for (const source of [card, map]) {
    assert.match(source, /loadMapKit/);
    assert.doesNotMatch(source, /createElement\("script"\)/);
    assert.doesNotMatch(source, /mapkit\.init\(/);
  }
  const loader = await read("lib/mapkit-loader.ts");
  assert.equal(loader.match(/createElement\("script"\)/g)?.length, 1);
  assert.equal(loader.match(/mapkit\.init\(/g)?.length, 1);
  assert.match(loader, /mapkitReady \?\?= new Promise/);
});

test("Apple's own points of interest stay off the booklet's map, and north stays up", async () => {
  const map = await read("app/shiori/ShioriMap.tsx");
  assert.match(map, /pointOfInterestFilter: mapkit\.PointOfInterestFilter\.excludingAllCategories/);
  assert.match(map, /isRotationEnabled: false/);
});
