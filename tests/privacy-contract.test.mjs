import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSourceUrl = new URL("../app/TripPlannerApp.tsx", import.meta.url);
const privacySourceUrl = new URL("../app/privacy/page.tsx", import.meta.url);
const recentTripsSourceUrl = new URL("../lib/recent-trips.ts", import.meta.url);
const engineSourceUrls = [
  new URL("../lib/route-optimizer.ts", import.meta.url),
  new URL("../lib/time-feasibility.ts", import.meta.url),
  new URL("../lib/trip-builder.ts", import.meta.url),
];

test("keeps the completed itinerary out of direct client network calls", async () => {
  const source = await readFile(appSourceUrl, "utf8");

  assert.match(source, /buildTripFromWishlist\(itinerary, tripDays, pace, locale, \{/);
  assert.match(source, /requestPlaceResolution\(itinerary, hotelQuery, locale, controller\.signal\)/);
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

test("keeps recent-plan device storage bounded and disclosed", async () => {
  const [appSource, recentSource, privacySource] = await Promise.all([
    readFile(appSourceUrl, "utf8"),
    readFile(recentTripsSourceUrl, "utf8"),
    readFile(privacySourceUrl, "utf8"),
  ]);
  const storedKeys = [...appSource.matchAll(/localStorage\.setItem\("([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual([...new Set(storedKeys)], ["tripcheck-locale"]);
  assert.match(recentSource, /STORAGE_KEY = "tripcheck-recent-trips"/);
  assert.match(recentSource, /MAX_ENTRIES = 5/);
  assert.match(privacySource, /up to five recently generated plans/);
  assert.match(privacySource, /browser&apos;s local storage/);
  assert.match(privacySource, /Share links/);
});

test("discloses the bounded planning-time public-web search", async () => {
  const source = await readFile(privacySourceUrl, "utf8");

  assert.match(source, /resolved place, restaurant or hotel name/);
  assert.match(source, /deeper place or hotel check at two/);
  assert.match(source, /capped at 24 search units/);
  assert.match(source, /server memory for up to 30 minutes/);
  assert.match(source, /rejects sources verifiably older than 90 days/);
  assert.match(source, /automatically sends only the origin and destination coordinates/);
  assert.match(source, /browser also sends route coordinates/);
  assert.match(source, /Structured opening periods are checked against each travel date/);
});
