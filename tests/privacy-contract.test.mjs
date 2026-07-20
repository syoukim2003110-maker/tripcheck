import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSourceUrl = new URL("../app/TripPlannerApp.tsx", import.meta.url);
const engineSourceUrls = [
  new URL("../lib/route-optimizer.ts", import.meta.url),
  new URL("../lib/time-feasibility.ts", import.meta.url),
  new URL("../lib/trip-builder.ts", import.meta.url),
];

test("keeps the completed itinerary out of storage and direct network calls", async () => {
  const source = await readFile(appSourceUrl, "utf8");

  assert.match(source, /analyzeTrip\(itinerary, pace, locale, tripDays, \{/);
  assert.match(source, /requestPlaceResolution\(itinerary, hotelQuery, locale\)/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /sendBeacon\s*\(/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*itinerary/i);
  assert.doesNotMatch(source, /sessionStorage\.setItem\([^\n]*itinerary/i);
});

test("keeps deterministic route and time engines free of network calls", async () => {
  const sources = await Promise.all(engineSourceUrls.map((url) => readFile(url, "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /fetch\s*\(/);
    assert.doesNotMatch(source, /sendBeacon\s*\(/);
    assert.doesNotMatch(source, /XMLHttpRequest/);
  }
});

test("stores only the locale preference in the TripCheck app surface", async () => {
  const source = await readFile(appSourceUrl, "utf8");
  const storedKeys = [...source.matchAll(/localStorage\.setItem\("([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual([...new Set(storedKeys)], ["tripcheck-locale"]);
});
