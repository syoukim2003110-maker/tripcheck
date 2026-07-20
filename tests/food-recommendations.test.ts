import assert from "node:assert/strict";
import test from "node:test";
import { buildFoodSearchPayload } from "../lib/food-recommendations-client.ts";
import { fetchGoogleFoodCandidates, parseFoodSearchRequest } from "../lib/google-food.ts";
import type { FoodRecommendationSlot } from "../lib/trip-builder.ts";

const validRequest = {
  latitude: 35.6595,
  longitude: 139.7005,
  area: "Shibuya",
  mealKind: "dinner",
  query: "small-plate izakaya",
  languageCode: "en",
};

test("accepts a bounded food search and rejects unsupported input", () => {
  assert.deepEqual(parseFoodSearchRequest(validRequest), validRequest);
  assert.equal(parseFoodSearchRequest({ ...validRequest, latitude: 80 }), null);
  assert.equal(parseFoodSearchRequest({ ...validRequest, languageCode: "ko" }), null);
  assert.equal(parseFoodSearchRequest({ ...validRequest, query: "" }), null);
});

test("requests only minimal Google Places fields near the planned area", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify({
      places: [{
        id: "place-1",
        displayName: { text: "Shibuya Table" },
        formattedAddress: "1-2-3 Shibuya, Tokyo",
        googleMapsUri: "https://maps.google.com/?cid=1",
        primaryTypeDisplayName: { text: "Izakaya" },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const results = await fetchGoogleFoodCandidates(validRequest, "secret", fetcher);
  assert.equal(results[0].name, "Shibuya Table");
  assert.equal(captured?.url, "https://places.googleapis.com/v1/places:searchText");
  const headers = captured?.init.headers as Record<string, string>;
  assert.equal(headers["X-Goog-FieldMask"], "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location,places.primaryTypeDisplayName,places.photos");
  const body = JSON.parse(String(captured?.init.body));
  assert.equal(body.locationBias.circle.radius, 1500);
  assert.equal(body.pageSize, 4);
  assert.equal(body.includedType, "restaurant");
  assert.equal(JSON.stringify(body).includes("itinerary"), false);
});

test("client payload excludes itinerary prose and timing details", () => {
  const slot: FoodRecommendationSlot = {
    id: "food-1-dinner",
    dayIndex: 0,
    dayLabel: "Day 1",
    date: "2026-09-19",
    kind: "dinner",
    area: "Shibuya",
    anchorStopId: "shibuya",
    latitude: 35.6595,
    longitude: 139.7005,
    window: "17:30–21:00",
    rationale: "Easy to reach.",
    queryIdeas: ["izakaya"],
  };
  assert.deepEqual(buildFoodSearchPayload(slot, "izakaya", "en"), {
    latitude: 35.6595,
    longitude: 139.7005,
    area: "Shibuya",
    mealKind: "dinner",
    query: "izakaya",
    languageCode: "en",
  });
});
