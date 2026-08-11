import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeRoutePolyline,
  fetchGoogleRouteRecommendations,
  gapGeometrySearchPoints,
  parseRouteRecommendationRequest,
  rankRouteRecommendations,
  recommendationQueryForKinds,
  recommendationTypesForKinds,
  sampleRoutePoints,
  type RouteRecommendation,
} from "../lib/route-recommendations.ts";

test("route recommendation request keeps bounded coordinates and removes a same-base return", () => {
  const parsed = parseRouteRecommendationRequest({
    routePoints: [
      { latitude: 35.68, longitude: 139.76 },
      { latitude: 35.69, longitude: 139.7 },
      { latitude: 35.68, longitude: 139.76 },
    ],
    excludedPlaceIds: ["google-existing"],
    excludedNames: ["Already going"],
    languageCode: "en",
    destination: "japan",
  });
  assert.equal(parsed?.routePoints.length, 2);
  assert.equal(parsed?.destination, "japan");
});

test("route recommendation request rejects oversized or invalid payloads", () => {
  assert.equal(parseRouteRecommendationRequest({ routePoints: [], languageCode: "en" }), null);
  assert.equal(parseRouteRecommendationRequest({
    routePoints: [{ latitude: 100, longitude: 0 }],
    languageCode: "en",
  }), null);
});

test("route recommendation request accepts known suggestion kinds and rejects invented ones", () => {
  const base = {
    routePoints: [{ latitude: 35.68, longitude: 139.76 }],
    excludedPlaceIds: [],
    excludedNames: [],
    languageCode: "en" as const,
    destination: "japan" as const,
  };
  assert.deepEqual(
    parseRouteRecommendationRequest({ ...base, suggestionKinds: ["CAFE", "PARK", "CAFE"] })?.suggestionKinds,
    ["CAFE", "PARK"],
  );
  assert.equal(parseRouteRecommendationRequest({ ...base })?.suggestionKinds, undefined);
  assert.equal(parseRouteRecommendationRequest({ ...base, suggestionKinds: ["THEME_PARK"] }), null);
  assert.equal(parseRouteRecommendationRequest({ ...base, suggestionKinds: "CAFE" }), null);
});

test("suggestion kinds drive the accepted type set; ATTRACTION alone opens tourist spots", () => {
  const short = recommendationTypesForKinds(["CAFE", "BAKERY", "PARK", "LOOKOUT"]);
  assert.equal(short.has("cafe"), true);
  assert.equal(short.has("park"), true);
  assert.equal(short.has("museum"), false, "a short gap must not surface facilities");
  assert.equal(short.has("tourist_attraction"), false, "a short gap must not surface tourist attractions");

  const medium = recommendationTypesForKinds(["SMALL_FACILITY", "WALK", "CAFE_AND_WALK"]);
  assert.equal(medium.has("museum"), true);
  assert.equal(medium.has("cafe"), true);
  assert.equal(medium.has("tourist_attraction"), false, "only the 120+ band opens normal tourist spots");

  const long = recommendationTypesForKinds(["ATTRACTION", "SMALL_FACILITY", "WALK", "CAFE_AND_WALK"]);
  assert.equal(long.has("tourist_attraction"), true);
  assert.equal(long.has("theme_park"), true);

  // Absent kinds keep the full supported catalogue (legacy requests).
  assert.equal(recommendationTypesForKinds(undefined).has("tourist_attraction"), true);
});

test("suggestion kinds drive the provider text query deterministically", () => {
  assert.equal(recommendationQueryForKinds(["CAFE", "PARK"], "ja"), "評価の高い カフェ 公園 庭園");
  assert.equal(recommendationQueryForKinds(["PARK", "CAFE"], "ja"), "評価の高い カフェ 公園 庭園", "kind order is canonical");
  assert.match(recommendationQueryForKinds(["SMALL_FACILITY", "WALK", "CAFE_AND_WALK"], "en"), /^highly rated /);
  assert.equal(
    recommendationQueryForKinds(["ATTRACTION", "SMALL_FACILITY"], "en"),
    "highly rated attractions scenic places parks museums and cafes",
  );
  assert.equal(recommendationQueryForKinds(undefined, "ja"), "評価の高い観光名所 景勝地 公園 美術館 カフェ");
});

test("sampleRoutePoints keeps endpoints within the budget and passes short input through", () => {
  const short = [
    { latitude: 35, longitude: 139 },
    { latitude: 35.01, longitude: 139.01 },
  ];
  assert.deepEqual(sampleRoutePoints(short, 12), short);

  const long = Array.from({ length: 60 }, (_, index) => ({ latitude: 35 + index * 0.001, longitude: 139 + index * 0.001 }));
  const sampled = sampleRoutePoints(long, 12);
  assert.equal(sampled.length, 12);
  assert.deepEqual(sampled[0], long[0]);
  assert.deepEqual(sampled.at(-1), long.at(-1));
  for (let index = 1; index < sampled.length; index += 1) {
    assert.ok(sampled[index].latitude > sampled[index - 1].latitude, "samples follow the geometry order");
  }
});

test("gap search points pick real geometry when present and fall back to anchors", () => {
  const anchors = [
    { latitude: 35, longitude: 139 },
    { latitude: 35.05, longitude: 139.05 },
  ];
  const geometry = Array.from({ length: 30 }, (_, index) => ({ latitude: 35 + index * 0.002, longitude: 139 + index * 0.001 }));
  const withGeometry = gapGeometrySearchPoints(geometry, anchors, 12);
  assert.equal(withGeometry.length, 12, "the sampled geometry fills the 12-point budget");
  assert.deepEqual(withGeometry[0], geometry[0]);
  assert.deepEqual(withGeometry.at(-1), geometry.at(-1));

  assert.deepEqual(gapGeometrySearchPoints(null, anchors), anchors, "no geometry keeps the anchor proxy");
  assert.deepEqual(gapGeometrySearchPoints([geometry[0]], anchors), anchors, "one point is not geometry");
});

test("polyline encoder follows Google's documented example", () => {
  assert.equal(encodeRoutePolyline([
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ]), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
});

function candidate(overrides: Partial<RouteRecommendation>): RouteRecommendation {
  return {
    id: "google-candidate",
    providerRef: "candidate",
    name: "Candidate",
    address: "Address",
    type: "Museum",
    placeTypes: ["museum"],
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: null,
    googleMapsUrl: "https://maps.google.com/",
    latitude: 35.68,
    longitude: 139.76,
    rating: 4.5,
    userRatingCount: 100,
    routeDistanceMeters: 300,
    photoName: null,
    photoAttribution: null,
    ...overrides,
  };
}

test("ranking requires supported ratings and favors a useful quality/proximity balance", () => {
  const ranked = rankRouteRecommendations([
    candidate({ id: "google-unsupported", rating: 4.9, userRatingCount: 2, routeDistanceMeters: 20 }),
    candidate({ id: "google-near", rating: 4.5, userRatingCount: 400, routeDistanceMeters: 180 }),
    candidate({ id: "google-far", rating: 4.6, userRatingCount: 400, routeDistanceMeters: 2_200 }),
  ]);
  assert.deepEqual(ranked.map(({ id }) => id), ["google-near", "google-far"]);
});

test("Google adapter uses Search Along Route and excludes existing places", async () => {
  const sentBodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    sentBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ places: [
      {
        id: "existing",
        displayName: { text: "Already going" },
        formattedAddress: "Tokyo",
        googleMapsUri: "https://maps.google.com/existing",
        businessStatus: "OPERATIONAL",
        primaryType: "museum",
        types: ["museum", "tourist_attraction"],
        primaryTypeDisplayName: { text: "Museum" },
        location: { latitude: 35.6805, longitude: 139.7605 },
        rating: 4.9,
        userRatingCount: 1000,
      },
      {
        id: "new",
        displayName: { text: "A good museum" },
        formattedAddress: "Tokyo",
        googleMapsUri: "https://maps.google.com/new",
        businessStatus: "OPERATIONAL",
        primaryType: "museum",
        types: ["museum", "tourist_attraction"],
        primaryTypeDisplayName: { text: "Museum" },
        location: { latitude: 35.6805, longitude: 139.7605 },
        rating: 4.6,
        userRatingCount: 500,
      },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await fetchGoogleRouteRecommendations({
    routePoints: [{ latitude: 35.68, longitude: 139.76 }, { latitude: 35.69, longitude: 139.7 }],
    excludedPlaceIds: ["google-existing"],
    excludedNames: ["Already going"],
    languageCode: "en",
    destination: "japan",
  }, "test", fetcher);
  assert.ok("searchAlongRouteParameters" in sentBodies[0]);
  assert.equal(sentBodies[0].pageSize, 20);
  assert.equal("maxResultCount" in sentBodies[0], false);
  assert.deepEqual(result.map(({ id }) => id), ["google-new"]);
  assert.deepEqual(result.map(({ providerRef }) => providerRef), ["new"]);
});

test("Google adapter accepts a highly rated cafe as a useful route stop", async () => {
  const fetcher: typeof fetch = async () => Response.json({ places: [{
    id: "cafe",
    displayName: { text: "Scenic Cafe" },
    formattedAddress: "Tokyo",
    googleMapsUri: "https://maps.google.com/cafe",
    businessStatus: "OPERATIONAL",
    primaryType: "cafe",
    types: ["cafe", "tourist_attraction"],
    primaryTypeDisplayName: { text: "Cafe" },
    location: { latitude: 35.6805, longitude: 139.7605 },
    rating: 4.9,
    userRatingCount: 1000,
  }] });
  const result = await fetchGoogleRouteRecommendations({
    routePoints: [{ latitude: 35.68, longitude: 139.76 }],
    excludedPlaceIds: [],
    excludedNames: [],
    languageCode: "en",
    destination: "japan",
  }, "test", fetcher);
  assert.deepEqual(result.map(({ id }) => id), ["google-cafe"]);
  assert.deepEqual(result.map(({ providerRef }) => providerRef), ["cafe"]);
});

test("the gap band's kinds bound the adapter's query and its accepted results", async () => {
  const sentBodies: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    sentBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ places: [{
      id: "museum",
      displayName: { text: "Big museum" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/museum",
      businessStatus: "OPERATIONAL",
      primaryType: "museum",
      types: ["museum", "tourist_attraction"],
      primaryTypeDisplayName: { text: "Museum" },
      location: { latitude: 35.6805, longitude: 139.7605 },
      rating: 4.8,
      userRatingCount: 2000,
    }, {
      id: "cafe",
      displayName: { text: "Corner cafe" },
      formattedAddress: "Tokyo",
      googleMapsUri: "https://maps.google.com/cafe",
      businessStatus: "OPERATIONAL",
      primaryType: "cafe",
      types: ["cafe"],
      primaryTypeDisplayName: { text: "Cafe" },
      location: { latitude: 35.6805, longitude: 139.7605 },
      rating: 4.5,
      userRatingCount: 400,
    }] });
  };
  const result = await fetchGoogleRouteRecommendations({
    routePoints: [{ latitude: 35.68, longitude: 139.76 }, { latitude: 35.69, longitude: 139.7 }],
    excludedPlaceIds: [],
    excludedNames: [],
    languageCode: "ja",
    destination: "japan",
    suggestionKinds: ["CAFE", "BAKERY", "PARK", "LOOKOUT"],
  }, "test", fetcher);
  assert.equal(sentBodies[0].textQuery, "評価の高い カフェ ベーカリー 公園 庭園 展望スポット 景勝地");
  assert.deepEqual(result.map(({ id }) => id), ["google-cafe"], "a short gap never surfaces a museum");
});

test("accepts current natural-feature types and a useful secondary type", async () => {
  const fetcher: typeof fetch = async () => Response.json({ places: [{
    id: "peak",
    displayName: { text: "Mountain viewpoint" },
    formattedAddress: "Switzerland",
    googleMapsUri: "https://maps.google.com/peak",
    businessStatus: "OPERATIONAL",
    primaryType: "mountain_peak",
    types: ["mountain_peak", "scenic_spot", "tourist_attraction"],
    primaryTypeDisplayName: { text: "Scenic spot" },
    location: { latitude: 46.0205, longitude: 7.7505 },
    rating: 4.8,
    userRatingCount: 900,
  }, {
    id: "bridge",
    displayName: { text: "Old bridge" },
    formattedAddress: "Switzerland",
    googleMapsUri: "https://maps.google.com/bridge",
    businessStatus: "OPERATIONAL",
    primaryType: "point_of_interest",
    types: ["point_of_interest", "bridge", "tourist_attraction"],
    primaryTypeDisplayName: { text: "Bridge" },
    location: { latitude: 46.021, longitude: 7.751 },
    rating: 4.6,
    userRatingCount: 300,
  }] });
  const result = await fetchGoogleRouteRecommendations({
    routePoints: [{ latitude: 46.02, longitude: 7.75 }],
    excludedPlaceIds: [],
    excludedNames: [],
    languageCode: "en",
    destination: "switzerland",
  }, "test", fetcher);
  assert.deepEqual(new Set(result.map(({ id }) => id)), new Set(["google-peak", "google-bridge"]));
});
