import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeRoutePolyline,
  fetchGoogleRouteRecommendations,
  parseRouteRecommendationRequest,
  rankRouteRecommendations,
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
