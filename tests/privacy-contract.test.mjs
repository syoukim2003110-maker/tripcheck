import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSourceUrl = new URL("../app/TripPlannerApp.tsx", import.meta.url);
const privacySourceUrl = new URL("../app/privacy/page.tsx", import.meta.url);
const recentTripsSourceUrl = new URL("../lib/recent-trips.ts", import.meta.url);
const tripStoreSourceUrl = new URL("../lib/trip-store.ts", import.meta.url);
const engineSourceUrls = [
  new URL("../lib/route-optimizer.ts", import.meta.url),
  new URL("../lib/time-feasibility.ts", import.meta.url),
  new URL("../lib/trip-builder.ts", import.meta.url),
  new URL("../lib/trip-scenarios.ts", import.meta.url),
];

test("keeps the completed itinerary out of direct client network calls", async () => {
  const source = await readFile(appSourceUrl, "utf8");

  assert.match(source, /buildTripFromWishlist\(itinerary, tripDays, pace, locale, activePlannerContext\)/);
  assert.match(source, /assessTripFit\(itinerary, tripDays, pace, locale, activePlannerContext, plan\)/);
  assert.match(source, /requestPlaceResolution\(\s*rawAtStart,\s*"",\s*locale,\s*destinationChoice,\s*controller\.signal,\s*resolutionOverrides,\s*\)/);
  assert.match(source, /requestPlaceResolution\(\s*canReusePlaceReview \? "" : itinerary,\s*hotelQuery,\s*locale,\s*buildDestination,\s*controller\.signal,\s*canReusePlaceReview \? \[\] : resolutionOverrides,\s*\)/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /sendBeacon\s*\(/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*itinerary/i);
  assert.doesNotMatch(source, /sessionStorage\.setItem\([^\n]*itinerary/i);
});

test("persists only explicit occurrence-scoped place decisions", async () => {
  const source = await readFile(appSourceUrl, "utf8");
  const localStart = source.indexOf("const localTripCode = useMemo");
  const localEnd = source.indexOf("const localTripTitle", localStart);
  assert.ok(localStart >= 0 && localEnd > localStart);
  const localPayload = source.slice(localStart, localEnd);

  assert.match(source, /setResolutionOverrides\(shared\.resolutionOverrides \?\? \[\]\)/);
  assert.match(localPayload, /resolutionOverrides,/);
  assert.doesNotMatch(localPayload, /resolvedStops|ambiguousPlaces|sourceUrl|verifiedAt/);
  assert.match(source, /setResolutionOverrides\(\(current\) => upsertResolutionOverride\(current, \{/);
});

test("rehydrates saved trips without reusing or persisting mutable provider display data", async () => {
  const source = await readFile(appSourceUrl, "utf8");
  const hydrateStart = source.indexOf("const applySharedTripInput");
  const hydrateEnd = source.indexOf("const sharedHydrationRef", hydrateStart);
  const hydrate = source.slice(hydrateStart, hydrateEnd);
  const removeStart = source.indexOf("function removeStopFromPlan");
  const removeEnd = source.indexOf("function restoreRemovedStop", removeStart);
  const remove = source.slice(removeStart, removeEnd);

  assert.match(hydrate, /setReviewedInputSignature\(""\)/);
  assert.match(hydrate, /setResolvedStops\(\[\]\)/);
  assert.match(hydrate, /setAmbiguousPlaces\(\[\]\)/);
  assert.match(hydrate, /safeRemovedStopLabels\(shared\.removedStops, shared\.itinerary, locale\)/);
  assert.match(source, /const localTripTitle = useMemo\(\(\) => parsedWishlistPlaces\(itinerary\)\[0\]\?\.name \?\? "Trip"/);
  assert.doesNotMatch(source, /const localTripTitle = useMemo\(\(\) => plan\?/);
  assert.doesNotMatch(remove, /name: stop\.name/);
  assert.match(remove, /const authoredName = occurrenceName/);
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
  const [appSource, recentSource, tripStoreSource, privacySource] = await Promise.all([
    readFile(appSourceUrl, "utf8"),
    readFile(recentTripsSourceUrl, "utf8"),
    readFile(tripStoreSourceUrl, "utf8"),
    readFile(privacySourceUrl, "utf8"),
  ]);
  const storedKeys = [...appSource.matchAll(/localStorage\.setItem\("([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual([...new Set(storedKeys)], ["tripcheck-locale", "tripcheck.passportExpiry"]);
  assert.match(recentSource, /STORAGE_KEY = "tripcheck-recent-trips"/);
  assert.match(recentSource, /MAX_ENTRIES = 5/);
  assert.match(tripStoreSource, /TRIP_STORE_MAX_RECORDS = 10/);
  assert.match(privacySource, /up to ten recently generated plans/);
  assert.match(privacySource, /Plans use IndexedDB/);
  assert.match(privacySource, /non-persistent in-memory storage/);
  assert.match(privacySource, /stable Google Place ID/);
  assert.match(privacySource, /does not save Google&apos;s display name, address, hours, reviews, photos, route response/);
  assert.match(privacySource, /A manual pin retains only the name, address and coordinates you entered/);
  assert.match(privacySource, /passport expiry date/);
  assert.match(privacySource, /never sent to TripCheck or any provider/);
  assert.match(privacySource, /Share links/);
  assert.match(privacySource, /explicit Place-ID choices/);
});

test("discloses the holiday and exchange-rate lookups as data-minimal", async () => {
  const privacySource = await readFile(privacySourceUrl, "utf8");

  assert.match(privacySource, /two-letter country code and the bare calendar dates/);
  assert.match(privacySource, /three-letter currency code/);
  assert.match(privacySource, /No place names, itinerary text or coordinates/);
});

test("discloses bounded AI enrichment and on-demand public-web search", async () => {
  const source = await readFile(privacySourceUrl, "utf8");

  assert.match(source, /resolved place, restaurant or hotel name/);
  assert.match(source, /only when you request recent public-source context/);
  assert.match(source, /does not automatically run public-web searches for every place/);
  assert.match(source, /quick check is capped at one search/);
  assert.match(source, /server memory for up to 30 minutes/);
  assert.match(source, /rejects sources verifiably older than 90 days/);
  assert.match(source, /hotel-search anchor coordinates to Rakuten Web Service/);
  assert.match(source, /does not send your itinerary text, travel dates, airport details or completed schedule to Rakuten/);
  assert.match(source, /automatically sends only the origin and destination coordinates/);
  assert.match(source, /encoded route geometry so the map can follow actual roads and transit paths/);
  assert.match(source, /supplied candidate names, public addresses, place types, meal period and area to Anthropic/);
  assert.match(source, /AI cannot add a restaurant or invent ratings, opening hours, prices or menu facts/);
  assert.match(source, /Structured opening periods are checked against each travel date/);
});

test("discloses along-route discovery and keeps it opt-in", async () => {
  const [privacySource, routeSource] = await Promise.all([
    readFile(privacySourceUrl, "utf8"),
    readFile(new URL("../app/api/route-recommendations/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(privacySource, /When you choose &ldquo;Near today&apos;s plan,&rdquo;/);
  assert.match(privacySource, /selected lodging is the day&apos;s base/);
  assert.match(privacySource, /does not send your itinerary lines, hotel text, dates, reservation notes or completed schedule/);
  assert.match(privacySource, /never added automatically/);
  assert.match(routeSource, /process\.env\.GOOGLE_PLACES_API_KEY/);
  assert.match(routeSource, /ROUTE_RECOMMENDATIONS_DAILY_LIMIT/);
  assert.match(routeSource, /Cache-Control": "no-store/);
});

test("discloses optional concept drafting and avoids caching the raw concept", async () => {
  const [privacySource, routeSource] = await Promise.all([
    readFile(privacySourceUrl, "utf8"),
    readFile(new URL("../app/api/trip-ideas/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(privacySource, /Optional concept drafts/);
  assert.match(privacySource, /sent to Anthropic/);
  assert.match(privacySource, /one-way SHA-256 digest/);
  assert.match(routeSource, /crypto\.subtle\.digest\("SHA-256"/);
  assert.doesNotMatch(routeSource, /const cacheId = `\$\{parsed\.destination\}[^\n]*parsed\.concept/);
});
