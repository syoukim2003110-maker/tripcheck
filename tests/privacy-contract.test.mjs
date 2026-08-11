import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSourceUrl = new URL("../app/TripPlannerApp.tsx", import.meta.url);
// TripPlannerApp is now a thin entry point (refactor spec v2.1
// "TripPlannerApp → TripPlannerShell + hooks"); the planner surface lives in
// the shell. Both files stay scanned: the surface contracts hold wherever the
// code lives, and the thin entry must stay free of network and storage too.
const shellSourceUrl = new URL("../app/components/planner/TripPlannerShell.tsx", import.meta.url);
// The build pipeline (place resolution, buildPlan, demo/reset lifecycle)
// moved into a hook (refactor spec v2.1); its privacy contracts hold
// wherever the code lives, so those checks target the hook file.
const buildHookSourceUrl = new URL("../app/components/planner/hooks/usePlanBuild.tsx", import.meta.url);
// The domain derivations (the plan/fit memos, the local share code and the
// recent-trip payload) moved into the domain-model hook (refactor spec v2.1);
// their privacy contracts hold wherever the code lives, so those checks
// target the hook file.
const domainHookSourceUrl = new URL("../app/components/planner/hooks/useTripDomainModel.tsx", import.meta.url);
const privacySourceUrl = new URL("../app/privacy/page.tsx", import.meta.url);
const tripStoreSourceUrl = new URL("../lib/trip-store.ts", import.meta.url);
const engineSourceUrls = [
  new URL("../lib/route-optimizer.ts", import.meta.url),
  new URL("../lib/time-feasibility.ts", import.meta.url),
  new URL("../lib/trip-builder.ts", import.meta.url),
  new URL("../lib/trip-scenarios.ts", import.meta.url),
];

/* The planner surface is split across TripPlannerApp, TripPlannerShell, the
 * hooks and the extracted components (refactor spec v2.1). The no-network /
 * no-itinerary-storage contract must bind ALL of it - a scan pinned to a few
 * files would silently exempt code that used to live inside the one scanned
 * monolith. Everything except the lib/*-client service layer is enumerated. */
async function plannerSurfaceFiles() {
  const { readdir } = await import("node:fs/promises");
  const files = [{ path: "app/TripPlannerApp.tsx", url: appSourceUrl }];
  const roots = [
    { url: new URL("../app/components/planner/", import.meta.url), filter: /\.tsx?$/ },
    { url: new URL("../lib/presentation/", import.meta.url), filter: /\.ts$/ },
  ];
  for (const root of roots) {
    const entries = await readdir(root.url, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !root.filter.test(entry.name)) continue;
      const fileUrl = new URL(`${entry.parentPath.replace(/\/?$/, "/")}${entry.name}`, "file://");
      files.push({ path: fileUrl.pathname, url: fileUrl });
    }
  }
  files.push({ path: "lib/planner-app-state.ts", url: new URL("../lib/planner-app-state.ts", import.meta.url) });
  return Promise.all(files.map(async (file) => ({ path: file.path, text: await readFile(file.url, "utf8") })));
}

test("keeps the completed itinerary out of direct client network calls", async () => {
  const buildSource = await readFile(buildHookSourceUrl, "utf8");
  const domainSource = await readFile(domainHookSourceUrl, "utf8");

  assert.match(domainSource, /buildTripFromWishlist\(itinerary, tripDays, pace, locale, activePlannerContext\)/);
  assert.match(domainSource, /assessTripFit\(itinerary, tripDays, pace, locale, activePlannerContext, plan\)/);
  assert.match(buildSource, /requestPlaceResolution\(\s*rawAtStart,\s*"",\s*locale,\s*destinationChoice,\s*controller\.signal,\s*resolutionOverrides,\s*\)/);
  assert.match(buildSource, /requestPlaceResolution\(\s*canReusePlaceReview \? "" : itinerary,\s*hotelQuery,\s*locale,\s*buildDestination,\s*controller\.signal,\s*canReusePlaceReview \? \[\] : resolutionOverrides,\s*\)/);
  const surface = await plannerSurfaceFiles();
  assert.ok(surface.length > 30, `planner surface enumeration looks too small: ${surface.length} files`);
  for (const { path, text } of surface) {
    assert.doesNotMatch(text, /fetch\s*\(/, `bare fetch( in ${path}`);
    assert.doesNotMatch(text, /sendBeacon\s*\(/, `sendBeacon( in ${path}`);
    assert.doesNotMatch(text, /localStorage\.setItem\([^\n]*itinerary/i, `itinerary in localStorage in ${path}`);
    assert.doesNotMatch(text, /sessionStorage\.setItem\([^\n]*itinerary/i, `itinerary in sessionStorage in ${path}`);
  }
});

test("persists only explicit occurrence-scoped place decisions", async () => {
  const source = await readFile(shellSourceUrl, "utf8");
  // The occurrence-scoped confirm actions (ambiguous choice, manual pin)
  // moved into the build hook; the explicit-override contract holds there.
  const buildSource = await readFile(buildHookSourceUrl, "utf8");
  const domainSource = await readFile(domainHookSourceUrl, "utf8");
  const localStart = domainSource.indexOf("const localTripCode = useMemo");
  const localEnd = domainSource.indexOf("const localTripTitle", localStart);
  assert.ok(localStart >= 0 && localEnd > localStart);
  const localPayload = domainSource.slice(localStart, localEnd);

  assert.match(source, /setResolutionOverrides\(shared\.resolutionOverrides \?\? \[\]\)/);
  assert.match(localPayload, /resolutionOverrides,/);
  assert.doesNotMatch(localPayload, /resolvedStops|ambiguousPlaces|sourceUrl|verifiedAt/);
  assert.match(buildSource, /setResolutionOverrides\(\(current\) => upsertResolutionOverride\(current, \{/);
});

test("rehydrates saved trips without reusing or persisting mutable provider display data", async () => {
  const source = await readFile(shellSourceUrl, "utf8");
  // The planner edit actions moved into a hook (refactor spec v2.1); the
  // authored-name contract holds across the planner surface, wherever it lives.
  const plannerEditsSource = await readFile(
    new URL("../app/components/planner/hooks/usePlannerEdits.tsx", import.meta.url),
    "utf8",
  );
  // The hydration applier is the last piece before the shell's effects; the
  // ref that used to bound this slice moved into useTripPersistence, so the
  // slice now ends at the first effect after the callback. Bounds are
  // asserted so a future move breaks the test loudly instead of widening
  // the slice to the whole file.
  const hydrateStart = source.indexOf("const applySharedTripInput");
  const hydrateEnd = source.indexOf("useEffect", hydrateStart);
  assert.ok(hydrateStart >= 0 && hydrateEnd > hydrateStart, "hydrate slice anchors missing in TripPlannerShell");
  const hydrate = source.slice(hydrateStart, hydrateEnd);
  const removeStart = plannerEditsSource.indexOf("function removeStopFromPlan");
  const removeEnd = plannerEditsSource.indexOf("function restoreRemovedStop", removeStart);
  assert.ok(removeStart >= 0 && removeEnd > removeStart);
  const remove = plannerEditsSource.slice(removeStart, removeEnd);

  assert.match(hydrate, /setReviewedInputSignature\(""\)/);
  assert.match(hydrate, /setResolvedStops\(\[\]\)/);
  assert.match(hydrate, /setAmbiguousPlaces\(\[\]\)/);
  assert.match(hydrate, /safeRemovedStopLabels\(shared\.removedStops, shared\.itinerary, locale\)/);
  const domainSource = await readFile(domainHookSourceUrl, "utf8");
  assert.match(domainSource, /const localTripTitle = useMemo\(\(\) => parsedWishlistPlaces\(itinerary\)\[0\]\?\.name \?\? "Trip"/);
  assert.doesNotMatch(domainSource, /const localTripTitle = useMemo\(\(\) => plan\?/);
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
  const [tripStoreSource, privacySource] = await Promise.all([
    readFile(tripStoreSourceUrl, "utf8"),
    readFile(privacySourceUrl, "utf8"),
  ]);
  // The allowlist binds the WHOLE planner surface - hooks and components
  // included - so device-storage code cannot grow new keys unnoticed.
  const surface = await plannerSurfaceFiles();
  const storedKeys = surface
    .flatMap(({ text }) => [...text.matchAll(/localStorage\.setItem\("([^"]+)"/g)])
    .map((match) => match[1]);

  assert.deepEqual([...new Set(storedKeys)], ["tripcheck-locale", "tripcheck.passportExpiry"]);
  assert.match(tripStoreSource, /LEGACY_RECENT_TRIPS_KEY = "tripcheck-recent-trips"/);
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

test("discloses the holiday lookup as data-minimal", async () => {
  const privacySource = await readFile(privacySourceUrl, "utf8");

  assert.match(privacySource, /two-letter country code and the bare calendar dates/);
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
  // TC-049: ranking authority is deterministic; the AI only writes labels.
  assert.match(source, /deterministic TripCheck code chooses the recommended order and the recommended base/);
  assert.match(source, /AI only writes short explanation labels/);
  assert.doesNotMatch(source, /AI decides only among the shortlisted hotels/);
  assert.match(source, /up to three web searches/);
  assert.match(source, /Structured opening periods are checked against each travel date/);
});

test("discloses automatic core recommendations and their paid-provider controls", async () => {
  const [privacySource, hotelSource, foodSource, routeSource, gateSource] = await Promise.all([
    readFile(privacySourceUrl, "utf8"),
    readFile(new URL("../app/api/hotel-recommendations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/food-recommendations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/route-recommendations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/non-core-api-gate.ts", import.meta.url), "utf8"),
  ]);

  assert.match(privacySource, /automatically looks up bounded hotel and meal shortlists/);
  // Spec gap bands: 30+ minute gaps are searched; the length picks categories.
  assert.match(privacySource, /completed day has a gap of 30 minutes or more/);
  assert.match(privacySource, /gap&apos;s length selects only which bounded nearby-place categories/);
  assert.match(privacySource, /up to twelve sampled coordinates/);
  assert.match(privacySource, /Google receives the bounded location, category or query and language\/region fields, not that travel date or time/);
  assert.match(privacySource, /do not send Google your raw itinerary lines, raw hotel text, travel dates, reservation notes, airport details or completed schedule/);
  assert.match(privacySource, /Food and gap-fill suggestions stay in page memory and are never automatically accepted/);
  assert.match(privacySource, /require same-origin requests/);
  assert.match(privacySource, /individual hotel, food and route feature kill switches/);
  assert.match(privacySource, /Production requests fail closed when the durable quota store is unavailable/);
  assert.match(privacySource, /only opaque subject hashes plus provider, operation, scope, time bucket and counts/);

  const routes = [
    [hotelSource, "hotel_recommendations"],
    [foodSource, "food_recommendations"],
    [routeSource, "route_recommendations"],
  ];
  for (const [source, feature] of routes) {
    assert.match(source, /paidProviderGateway\.preflight\(request, "google"\)/);
    assert.match(source, new RegExp(`coreRecommendationApiGate\\("${feature}"\\)`));
    assert.match(source, /paidProviderGateway\.reserve\(preflight,/);
    assert.match(source, /Cache-Control": "no-store/);
  }
  assert.match(gateSource, /hotel_recommendations: "HOTEL_RECOMMENDATIONS_ENABLED"/);
  assert.match(gateSource, /food_recommendations: "FOOD_RECOMMENDATIONS_ENABLED"/);
  assert.match(gateSource, /route_recommendations: "ROUTE_RECOMMENDATIONS_ENABLED"/);
  assert.doesNotMatch(routeSource, /ROUTE_RECOMMENDATIONS_DAILY_LIMIT/);
});

