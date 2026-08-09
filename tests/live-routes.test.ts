import assert from "node:assert/strict";
import test from "node:test";
import { fetchGoogleRoutes, fetchGoogleTransitRoutes, parseLiveRoutesRequest, resolveGoogleRoutesApiKey } from "../lib/google-routes.ts";
import { decodeGooglePolyline } from "../lib/google-polyline.ts";
import { prefetchPlanningRouteDurations } from "../lib/planning-live-routes-client.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";

const now = new Date("2026-07-18T00:00:00Z");
const request = {
  languageCode: "en",
  legs: [{
    id: "sensoji::tokyo-skytree",
    origin: { latitude: 35.7148, longitude: 139.7967 },
    destination: { latitude: 35.7101, longitude: 139.8107 },
    departureTime: "2026-09-14T01:00:00Z",
    name: "this extra private text must be discarded",
  }],
};

test("an empty dedicated Routes key falls back to the configured Places key", () => {
  assert.equal(resolveGoogleRoutesApiKey({
    GOOGLE_ROUTES_API_KEY: "  ",
    GOOGLE_PLACES_API_KEY: " places-key ",
  }), "places-key");
  assert.equal(resolveGoogleRoutesApiKey({}), null);
});

test("accepts only bounded Japan coordinate routes in Google's transit date window", () => {
  const parsed = parseLiveRoutesRequest(request, now);

  assert.ok(parsed);
  assert.equal(parsed.travelMode, "TRANSIT");
  assert.equal(parsed.legs.length, 1);
  assert.deepEqual(Object.keys(parsed.legs[0]).sort(), ["departureTime", "destination", "id", "origin"]);
  assert.equal(parseLiveRoutesRequest({ ...request, legs: Array(25).fill(request.legs[0]) }, now), null);
  assert.equal(parseLiveRoutesRequest({ ...request, legs: [{ ...request.legs[0], departureTime: "2027-01-01T00:00:00Z" }] }, now), null);
  assert.equal(parseLiveRoutesRequest({ ...request, travelMode: "DRIVE" }, now)?.travelMode, "DRIVE");
  assert.equal(parseLiveRoutesRequest({ ...request, travelMode: "BICYCLE" }, now), null);
});

test("requests only the minimum Google route fields and normalizes duration", async () => {
  let capturedBody = "";
  const fetcher: typeof fetch = async (_input, init) => {
    capturedBody = String(init?.body);
    assert.equal(
      new Headers(init?.headers).get("X-Goog-FieldMask"),
      "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.travelMode",
    );
    return Response.json({ routes: [{
      duration: "901s",
      distanceMeters: 3120,
      polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
      legs: [{ steps: [
        { travelMode: "WALK" },
        { travelMode: "TRANSIT" },
        { travelMode: "WALK" },
        { travelMode: "TRANSIT" },
      ] }],
    }] });
  };
  const parsed = parseLiveRoutesRequest(request, now)!;
  const results = await fetchGoogleTransitRoutes(parsed, "private-key", fetcher);

  assert.equal(results[0].durationMinutes, 16);
  assert.equal(results[0].distanceMeters, 3120);
  assert.equal(results[0].encodedPolyline, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.equal(results[0].transferCount, 1, "two transit rides require one change");
  assert.doesNotMatch(capturedBody, /private text|Senso-ji|hotel/i);
});

test("keeps transfer count unknown when transit step data is incomplete", async () => {
  const parsed = parseLiveRoutesRequest(request, now)!;
  const [missingSteps] = await fetchGoogleTransitRoutes(parsed, "private-key", async () => Response.json({
    routes: [{ duration: "600s", legs: [{ steps: [{ travelMode: "TRANSIT" }, {}] }] }],
  }));
  const [noLegs] = await fetchGoogleTransitRoutes(parsed, "private-key", async () => Response.json({
    routes: [{ duration: "600s" }],
  }));

  assert.equal(missingSteps.status, "ok", "duration evidence remains usable");
  assert.equal(missingSteps.transferCount, null);
  assert.equal(noLegs.transferCount, null);
});

test("decodes provider route geometry and rejects a truncated polyline", () => {
  assert.deepEqual(decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ]);
  assert.deepEqual(decodeGooglePolyline("_p~iF~ps|U_"), []);
});

test("requests walking facts without sending a transit departure to Google", async () => {
  let capturedBody = "";
  const fetcher: typeof fetch = async (_input, init) => {
    capturedBody = String(init?.body);
    assert.equal(
      new Headers(init?.headers).get("X-Goog-FieldMask"),
      "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      "non-transit calls do not request transit steps",
    );
    return Response.json({ routes: [{ duration: "600s", distanceMeters: 720 }] });
  };
  const parsed = parseLiveRoutesRequest({ ...request, travelMode: "WALK" }, now)!;
  const results = await fetchGoogleRoutes(parsed, "private-key", fetcher);

  assert.equal(results[0].durationMinutes, 10);
  assert.equal(results[0].transferCount, null);
  assert.match(capturedBody, /"travelMode":"WALK"/);
  assert.doesNotMatch(capturedBody, /departureTime/);
});

test("bounds concurrent Google route calls", async () => {
  const legs = Array.from({ length: 9 }, (_, index) => ({ ...request.legs[0], id: `leg-${index}` }));
  const parsed = parseLiveRoutesRequest({ ...request, legs }, now)!;
  let active = 0;
  let peak = 0;
  const fetcher: typeof fetch = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return Response.json({ routes: [{ duration: "300s", distanceMeters: 400 }] });
  };

  await fetchGoogleRoutes(parsed, "private-key", fetcher, 3);
  assert.equal(peak, 3);
});

test("client live-route request omits itinerary text and hotel details", async () => {
  const plan = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "private Ueno hotel note",
  });
  const originalFetch = globalThis.fetch;
  let capturedBody = "";
  globalThis.fetch = async (_input, init) => {
    capturedBody = String(init?.body);
    return Response.json({
      provider: "google_maps",
      fetchedAt: "2026-07-18T00:00:00Z",
      legs: [{ id: "sensoji::tokyo-skytree", durationMinutes: 12, distanceMeters: 1800, encodedPolyline: null, status: "ok" }],
    });
  };
  try {
    await prefetchPlanningRouteDurations(plan, "en");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.doesNotMatch(capturedBody, /Senso-ji|Tokyo Skytree|private Ueno|hotel/i);
  assert.match(capturedBody, /latitude/);
  assert.match(capturedBody, /departureTime/);
});
