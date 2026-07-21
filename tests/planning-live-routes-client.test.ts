import assert from "node:assert/strict";
import test from "node:test";
import { LiveRoutesError } from "../lib/live-routes-client.ts";
import {
  buildPlanningRouteLegs,
  prefetchPlanningRouteDurations,
} from "../lib/planning-live-routes-client.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";

test("builds hotel and stop legs from a hidden draft using Japan-local departures", () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const legs = buildPlanningRouteLegs(draft);

  assert.equal(legs.length, 3);
  assert.match(legs[0].id, /^base-shinjuku::(?:sensoji|tokyo-skytree)$/);
  assert.match(legs[0].departureTime, /^2026-09-14T\d{2}:\d{2}:00\+09:00$/);
  assert.deepEqual(Object.keys(legs[0]).sort(), ["departureTime", "destination", "id", "mode", "origin"]);
});

test("prefetches real transit and walking results through the existing endpoint", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const capturedBodies: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = String(init?.body);
    capturedBodies.push(body);
    const payload = JSON.parse(body) as {
      travelMode: "TRANSIT" | "WALK";
      legs: Array<{ id: string }>;
    };
    const durationMinutes = payload.travelMode === "TRANSIT" ? 18 : 42;
    return Response.json({
      provider: "google_maps",
      fetchedAt: payload.travelMode === "TRANSIT" ? "2026-07-21T00:00:00.000Z" : "2026-07-21T00:00:01.000Z",
      travelMode: payload.travelMode,
      legs: payload.legs.map((leg) => ({
        id: leg.id,
        durationMinutes,
        distanceMeters: 2100,
        status: "ok",
      })),
    });
  };

  const result = await prefetchPlanningRouteDurations(draft, "en", { fetcher, concurrency: 1 });

  assert.equal(capturedBodies.length, 2);
  assert.ok(capturedBodies.some((body) => body.includes('"travelMode":"TRANSIT"')));
  assert.ok(capturedBodies.some((body) => body.includes('"travelMode":"WALK"')));
  assert.doesNotMatch(capturedBodies.join("\n"), /Senso-ji|Tokyo Skytree|private hotel note/i);
  assert.equal(Object.values(result.transitMinutes)[0], 18);
  assert.equal(Object.values(result.walkingMinutes)[0], 42);
  assert.equal(result.legs.length, 3);
  assert.equal(result.fetchedAt, "2026-07-21T00:00:01.000Z");
  assert.equal(result.skippedLegCount, 0);
});

test("requires a real trip date instead of inventing a departure", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en");
  await assert.rejects(
    prefetchPlanningRouteDurations(draft, "en", { fetcher: async () => Response.json({}) }),
    (error: unknown) => error instanceof LiveRoutesError && error.code === "missing_date",
  );
});
