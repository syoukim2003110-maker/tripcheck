import assert from "node:assert/strict";
import test from "node:test";
import { fetchGoogleResolvedPlace, parsePlaceResolutionRequest } from "../lib/google-place-resolver.ts";
import { buildPlaceResolutionPayload } from "../lib/place-resolution-client.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";

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
    }] });
  });
  assert.ok(place);
  assert.equal(place.area, "奈良県奈良市");
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

test("rejects oversized resolver batches", () => {
  assert.equal(parsePlaceResolutionRequest({ queries: Array.from({ length: 13 }, (_, index) => `place ${index}`), hotelQuery: null, languageCode: "en" }), null);
});

test("strips stay-duration and bare-time markers before querying Google", () => {
  const payload = buildPlaceResolutionPayload("奈良公園 — 滞在90分\n東大寺 — 15:30\nNara Park stay 45 min", "", "ja");

  assert.deepEqual(payload.queries, ["奈良公園", "東大寺", "Nara Park"]);
});
