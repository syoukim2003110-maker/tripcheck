import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { areaFromAddress, fetchGooglePlaceResolutions, fetchGoogleResolvedPlace, parsePlaceResolutionRequest } from "../lib/google-place-resolver.ts";
import { destinationById } from "../lib/destinations.ts";
import { buildPlaceResolutionPayload, placeResolutionQueryCount, placeReviewInputSignature, placeReviewStatus } from "../lib/place-resolution-client.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";

test("the automatic build preserves its place-review identity for Review details", () => {
  const appSource = readFileSync(new URL("../app/TripPlannerApp.tsx", import.meta.url), "utf8");
  const buildStart = appSource.indexOf("async function buildPlan(");
  const resetStart = appSource.indexOf("function resetTrip()", buildStart);
  assert.ok(buildStart >= 0 && resetStart > buildStart);
  const buildSource = appSource.slice(buildStart, resetStart);

  assert.match(buildSource, /const inputSignatureAtBuildStart = currentInputSignature;/);
  assert.match(
    buildSource,
    /setHotelSearchSignature\(hotelPlanSignature\(draft\)\);\s*setReviewedInputSignature\(inputSignatureAtBuildStart\);\s*setActiveDay\(0\);\s*setHasPlan\(true\);/,
    "the review identity must commit atomically with the provider-backed result",
  );
});

test("a completed direct review distinguishes resolved, ambiguous and unknown places", () => {
  assert.equal(placeReviewStatus({ reviewCompleted: false, hasResolvedPlace: true, hasAmbiguousMatch: false }), "parsed");
  assert.equal(placeReviewStatus({ reviewCompleted: true, hasResolvedPlace: true, hasAmbiguousMatch: false }), "confirmed");
  assert.equal(placeReviewStatus({ reviewCompleted: true, hasResolvedPlace: false, hasAmbiguousMatch: true }), "review");
  assert.equal(placeReviewStatus({ reviewCompleted: true, hasResolvedPlace: false, hasAmbiguousMatch: false }), "unresolved");
  assert.equal(
    placeReviewStatus({ reviewCompleted: true, hasResolvedPlace: true, hasAmbiguousMatch: true }),
    "confirmed",
    "an occurrence-bound provider choice must win over a stale ambiguous shortlist",
  );
});

test("a retained reviewed plan moves its identity with the selected language", () => {
  const english = placeReviewInputSignature("  Chapel Bridge  ", "en", "switzerland");
  const japanese = placeReviewInputSignature("Chapel Bridge", "ja", "switzerland");
  assert.notEqual(english, japanese);
  assert.equal(english, JSON.stringify(["Chapel Bridge", "en", "switzerland"]));

  const appSource = readFileSync(new URL("../app/TripPlannerApp.tsx", import.meta.url), "utf8");
  const localeStart = appSource.indexOf("function changeLocale(");
  const demoStart = appSource.indexOf("function loadDemo(", localeStart);
  assert.ok(localeStart >= 0 && demoStart > localeStart);
  assert.match(
    appSource.slice(localeStart, demoStart),
    /setReviewedInputSignature\(placeReviewInputSignature\(itinerary, next, destinationChoice\)\);/,
  );
});

test("sends only unresolved place names, not day headings or timing notes", () => {
  const payload = buildPlaceResolutionPayload(`1日目
09:00 浅草寺
- 東大寺 — 2日目 10:00 予約
奈良公園`, "奈良駅前ホテル", "ja");
  assert.deepEqual(payload.queries, ["東大寺", "奈良公園"]);
  assert.equal(payload.hotelQuery, "奈良駅前ホテル");
  assert.doesNotMatch(JSON.stringify(payload), /10:00|予約|浅草寺/);
});

test("requests minimal route-building fields from Google Places", async () => {
  let fields = "";
  const place = await fetchGoogleResolvedPlace("東大寺", "ja", "test-key", async (_url, init) => {
    fields = new Headers(init?.headers).get("X-Goog-FieldMask") ?? "";
    return Response.json({ places: [{
      id: "nara-1",
      displayName: { text: "東大寺" },
      formattedAddress: "日本、奈良県奈良市雑司町406-1",
      location: { latitude: 34.689, longitude: 135.8398 },
      googleMapsUri: "https://maps.google.com/example",
      primaryType: "train_station",
      types: ["train_station", "transit_station"],
    }] });
  });
  assert.ok(place);
  assert.equal(place.area, "奈良県奈良市");
  assert.deepEqual(place.placeTypes, ["train_station", "transit_station"]);
  assert.match(fields, /places\.location/);
  assert.doesNotMatch(fields, /rating|openingHours|websiteUri/);
});

test("builds a nationwide itinerary from fresh runtime place results", () => {
  const plan = buildTripFromWishlist("東大寺\n清水寺", 2, "balanced", "ja", {
    resolvedStops: [
      { id: "google-nara", input: "東大寺", name: "東大寺", area: "奈良県奈良市", address: "奈良県奈良市", latitude: 34.689, longitude: 135.8398, sourceUrl: "https://maps.google.com/nara", verifiedAt: "now", confidence: "medium", planningDurationMinutes: 90, isAnchor: false },
      { id: "google-kyoto", input: "清水寺", name: "清水寺", area: "京都府京都市", address: "京都府京都市", latitude: 34.9949, longitude: 135.785, sourceUrl: "https://maps.google.com/kyoto", verifiedAt: "now", confidence: "medium", planningDurationMinutes: 90, isAnchor: false },
    ],
  });
  assert.equal(plan.recognizedStopCount, 2);
  assert.equal(plan.unknownEntries.length, 0);
  assert.deepEqual(plan.days.flatMap((day) => day.stops.filter((stop) => stop.kind === "place").map((stop) => stop.stop.name)).sort(), ["東大寺", "清水寺"]);
  assert.ok(plan.baseRecommendations.some((recommendation) => /奈良|京都/.test(recommendation.base.name)));
});

test("accepts an ordinary multi-day list but rejects oversized resolver batches", () => {
  assert.ok(parsePlaceResolutionRequest({ queries: Array.from({ length: 12 }, (_, index) => `place ${index}`), hotelQuery: null, languageCode: "en" }));
  assert.equal(parsePlaceResolutionRequest({ queries: Array.from({ length: 13 }, (_, index) => `place ${index}`), hotelQuery: null, languageCode: "en" }), null);
  assert.ok(parsePlaceResolutionRequest({
    queries: Array.from({ length: 11 }, (_, index) => `place ${index}`),
    providerOverrides: [{ inputIndex: 11, input: "chosen place", providerRef: "ChIJ_chosen" }],
    hotelQuery: "hotel",
    languageCode: "en",
  }), "the route-level gateway receives the full event count and rejects an aggregate over twelve atomically");
});

test("discloses the external lookup count and keeps hotel plus places inside twelve events", () => {
  const raw = Array.from({ length: 14 }, (_, index) => `Synthetic unknown ${index}`).join("\n");
  assert.equal(placeResolutionQueryCount(raw, "en"), 14);
  const withoutHotel = buildPlaceResolutionPayload(raw, "", "en");
  assert.equal(withoutHotel.queries.length, 12);
  const withHotel = buildPlaceResolutionPayload(raw, "Synthetic hotel", "en");
  assert.equal(withHotel.queries.length, 11);
  assert.equal(withHotel.hotelQuery, "Synthetic hotel");
});

test("strips stay-duration and bare-time markers before querying Google", () => {
  const payload = buildPlaceResolutionPayload("奈良公園 — 滞在90分\n東大寺 — 15:30\nNara Park stay 45 min", "", "ja");

  assert.deepEqual(payload.queries, ["奈良公園", "東大寺", "Nara Park"]);
});

test("projects exact provider choices and keeps manual pins away from Google", () => {
  const payload = buildPlaceResolutionPayload(
    "Synthetic provider place\nSynthetic manual place\nSynthetic search place",
    "",
    "en",
    "auto",
    [
      { inputIndex: 0, providerRef: "ChIJ_exact-choice" },
      {
        inputIndex: 1,
        name: "Traveller pin",
        address: "Traveller-entered address",
        latitude: 35.6,
        longitude: 139.7,
      },
    ],
  );

  assert.deepEqual(payload.providerOverrides, [{
    inputIndex: 0,
    input: "Synthetic provider place",
    providerRef: "ChIJ_exact-choice",
  }]);
  assert.deepEqual(payload.queries, ["Synthetic search place"]);
  assert.equal(JSON.stringify(payload).includes("Traveller pin"), false);
  assert.equal(JSON.stringify(payload).includes("Traveller-entered address"), false);
});

test("bounds exact choices, searches and hotel inside the same twelve calls", () => {
  const raw = Array.from({ length: 14 }, (_, index) => `Synthetic place ${index}`).join("\n");
  const providerChoices = Array.from({ length: 10 }, (_, inputIndex) => ({
    inputIndex,
    providerRef: `ChIJ_choice_${inputIndex}`,
  }));
  const payload = buildPlaceResolutionPayload(raw, "Synthetic hotel", "en", "auto", providerChoices);

  assert.equal(payload.providerOverrides.length, 10);
  assert.deepEqual(payload.queries, ["Synthetic place 10"]);
  assert.equal(payload.providerOverrides.length + payload.queries.length + Number(Boolean(payload.hotelQuery)), 12);
});

test("keeps a street address out of the day theme", () => {
  const switzerland = destinationById("switzerland");
  assert.equal(
    areaFromAddress("Losisgräbli 419, 3822 Lauterbrunnen, Switzerland", "Staubbachfall", switzerland),
    "Lauterbrunnen",
  );
  assert.equal(
    areaFromAddress("Grosser Muristalden 6", "Bern Old Town Viewpoint", switzerland),
    "Bern Old Town Viewpoint",
  );
});

test("returns same-name places in different countries for traveller confirmation", async () => {
  const result = await fetchGooglePlaceResolutions({
    queries: ["Springfield"],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "en",
    destination: "auto",
  }, "test-key", async () => Response.json({ places: [
    {
      id: "springfield-us",
      displayName: { text: "Springfield" },
      formattedAddress: "Springfield, Illinois, USA",
      addressComponents: [{ types: ["country"], shortText: "US" }],
      location: { latitude: 39.7817, longitude: -89.6501 },
      googleMapsUri: "https://maps.google.com/springfield-us",
      types: ["locality"],
    },
    {
      id: "springfield-au",
      displayName: { text: "Springfield" },
      formattedAddress: "Springfield, Queensland, Australia",
      addressComponents: [{ types: ["country"], shortText: "AU" }],
      location: { latitude: -27.653, longitude: 152.918 },
      googleMapsUri: "https://maps.google.com/springfield-au",
      types: ["locality"],
    },
  ] }));

  assert.deepEqual(result.places, []);
  assert.equal(result.ambiguous.length, 1);
  assert.deepEqual(result.ambiguous[0].candidates.map((candidate) => candidate.countryCode), ["US", "AU"]);
});

test("auto mode never chooses a country from differently qualified plausible matches", async () => {
  const result = await fetchGooglePlaceResolutions({
    queries: ["National Museum"],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "en",
    destination: "auto",
  }, "test-key", async () => Response.json({ places: [
    {
      id: "museum-jp",
      displayName: { text: "Tokyo National Museum" },
      formattedAddress: "Tokyo, Japan",
      addressComponents: [{ types: ["country"], shortText: "JP" }],
      location: { latitude: 35.7188, longitude: 139.7765 },
      googleMapsUri: "https://maps.google.com/museum-jp",
      types: ["museum"],
    },
    {
      id: "museum-sg",
      displayName: { text: "National Museum of Singapore" },
      formattedAddress: "Singapore",
      addressComponents: [{ types: ["country"], shortText: "SG" }],
      location: { latitude: 1.2966, longitude: 103.8485 },
      googleMapsUri: "https://maps.google.com/museum-sg",
      types: ["museum"],
    },
  ] }));

  assert.equal(result.places.length, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.deepEqual(result.ambiguous[0].candidates.map((candidate) => candidate.countryCode), ["JP", "SG"]);
});

test("rehydrates an explicit provider choice by exact ID with a route-only field mask", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await fetchGooglePlaceResolutions({
    queries: [],
    providerOverrides: [{ inputIndex: 7, input: "Original pasted name", providerRef: "ChIJ_exact_7" }],
    hotelQuery: null,
    languageCode: "en",
    destination: "auto",
  }, "test-key", async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({
      id: "ChIJ_exact_7",
      displayName: { text: "Current provider name" },
      formattedAddress: "Shibuya, Tokyo, Japan",
      addressComponents: [{ types: ["country"], shortText: "JP" }],
      location: { latitude: 35.6595, longitude: 139.7005 },
      googleMapsUri: "https://maps.google.com/exact-7",
      primaryType: "tourist_attraction",
      types: ["point_of_interest"],
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://places.googleapis.com/v1/places/ChIJ_exact_7?languageCode=en");
  assert.equal(calls[0].init?.method, "GET");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["X-Goog-FieldMask"].includes("rating"), false);
  assert.equal(headers["X-Goog-FieldMask"].includes("regularOpeningHours"), false);
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0].inputIndex, 7);
  assert.equal(result.places[0].input, "Original pasted name");
  assert.equal(result.places[0].providerRef, "ChIJ_exact_7");
});

test("a stale exact provider ID stays unresolved without fuzzy Text Search fallback", async () => {
  const calls: string[] = [];
  const result = await fetchGooglePlaceResolutions({
    queries: [],
    providerOverrides: [{ inputIndex: 2, input: "Do not search this text", providerRef: "ChIJ_deleted" }],
    hotelQuery: null,
    languageCode: "en",
    destination: "auto",
  }, "test-key", async (input) => {
    calls.push(String(input));
    return new Response(null, { status: 404 });
  });

  assert.deepEqual(result.places, []);
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(calls, ["https://places.googleapis.com/v1/places/ChIJ_deleted?languageCode=en"]);
});

test("one exact-name candidate auto-resolves over its own facility derivatives", async () => {
  const result = await fetchGooglePlaceResolutions({
    queries: ["ゴルナーグラート"],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "ja",
    destination: "switzerland",
  }, "test-key", async () => Response.json({ places: [
    {
      id: "gornergrat-variant",
      displayName: { text: "ゴルネルグラート" },
      formattedAddress: "〒3920 ツェルマット ゴルネルグラート, スイス",
      addressComponents: [{ types: ["country"], shortText: "CH" }],
      location: { latitude: 45.9833, longitude: 7.7842 },
      googleMapsUri: "https://maps.google.com/gornergrat-variant",
      types: ["natural_feature"],
    },
    {
      id: "gornergrat-railway",
      displayName: { text: "ゴルナーグラート鉄道" },
      formattedAddress: "Bahnhofpl. 1, 3920 Zermatt, スイス",
      addressComponents: [{ types: ["country"], shortText: "CH" }],
      location: { latitude: 46.0235, longitude: 7.7465 },
      googleMapsUri: "https://maps.google.com/gornergrat-railway",
      types: ["tourist_attraction"],
    },
    {
      id: "gornergrat-peak",
      displayName: { text: "ゴルナーグラート" },
      formattedAddress: "〒3920 ツェルマット ゴルナーグラート, スイス",
      addressComponents: [{ types: ["country"], shortText: "CH" }],
      location: { latitude: 45.9833, longitude: 7.7842 },
      googleMapsUri: "https://maps.google.com/gornergrat-peak",
      types: ["mountain_peak"],
    },
  ] }));

  assert.equal(result.ambiguous.length, 0, "the exact-name summit must not be flagged ambiguous by its own railway");
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0].name, "ゴルナーグラート");
  assert.equal(result.places[0].providerRef, "gornergrat-peak");
});

test("a lone non-visit result with no textual overlap goes back to the traveller", async () => {
  const result = await fetchGooglePlaceResolutions({
    queries: ["ベルン旧市街"],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "ja",
    destination: "switzerland",
  }, "test-key", async () => Response.json({ places: [
    {
      id: "bern-university",
      displayName: { text: "ベルン大学" },
      formattedAddress: "Hochschulstrasse 6, 3012 Bern, スイス",
      addressComponents: [{ types: ["country"], shortText: "CH" }],
      location: { latitude: 46.9503, longitude: 7.4386 },
      googleMapsUri: "https://maps.google.com/bern-university",
      primaryType: "university",
      types: ["university", "point_of_interest"],
    },
  ] }));

  assert.deepEqual(result.places, [], "a university must never be silently planned for an old-town query");
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].candidates[0].name, "ベルン大学");
});

test("ja queries carry the localized country suffix to Google", async () => {
  let requestedQuery = "";
  await fetchGooglePlaceResolutions({
    queries: ["ベルン旧市街"],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "ja",
    destination: "switzerland",
  }, "test-key", async (_url, init) => {
    requestedQuery = (JSON.parse(String(init?.body)) as { textQuery: string }).textQuery;
    return Response.json({ places: [] });
  });
  assert.equal(requestedQuery, "ベルン旧市街 スイス");
});
