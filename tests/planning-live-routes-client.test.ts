import assert from "node:assert/strict";
import test from "node:test";
import { LiveRoutesError } from "../lib/live-routes-client.ts";
import {
  buildPlanningRouteLegs,
  planningRouteRequestKey,
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

test("a cancelled build aborts the route prefetch instead of substituting estimates", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const controller = new AbortController();
  controller.abort();
  let sawAbortedSignal = false;
  const fetcher: typeof fetch = async (_input, init) => {
    sawAbortedSignal = init?.signal?.aborted === true;
    throw new DOMException("Aborted", "AbortError");
  };

  await assert.rejects(
    () => prefetchPlanningRouteDurations(draft, "en", { fetcher, signal: controller.signal, concurrency: 1 }),
    LiveRoutesError,
  );
  assert.equal(sawAbortedSignal, true);
});

test("already-measured legs are excluded from a follow-up prefetch", async () => {
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
  });
  const allLegs = buildPlanningRouteLegs(draft);
  const excludeKeys = allLegs.slice(0, 2).map(planningRouteRequestKey);
  const requestedIds: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { travelMode: "TRANSIT" | "WALK"; legs: Array<{ id: string }> };
    requestedIds.push(...payload.legs.map((leg) => leg.id));
    return Response.json({
      provider: "google_maps",
      fetchedAt: "2026-07-21T00:00:00.000Z",
      travelMode: payload.travelMode,
      legs: payload.legs.map((leg) => ({ id: leg.id, durationMinutes: 12, distanceMeters: 900, status: "ok" })),
    });
  };

  const result = await prefetchPlanningRouteDurations(draft, "en", { fetcher, concurrency: 1, excludeKeys });
  assert.equal(result.legs.length, allLegs.length - 2);
  for (const excluded of excludeKeys) {
    assert.equal(requestedIds.includes(excluded.split("|")[1]), false);
  }

  const nothingLeft = await prefetchPlanningRouteDurations(draft, "en", {
    fetcher: async () => { throw new Error("must not fetch"); },
    excludeKeys: allLegs.map(planningRouteRequestKey),
  });
  assert.equal(nothingLeft.legs.length, 0);
  assert.equal(nothingLeft.fetchedAt, null);
});

test("a changed departure time is not excluded by an earlier speculative route", async () => {
  const initial = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    dayStartTimes: { 0: "09:00" },
  });
  const shifted = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    dayStartTimes: { 0: "10:00" },
  });
  const initialKeys = buildPlanningRouteLegs(initial).map(planningRouteRequestKey);
  const shiftedLegs = buildPlanningRouteLegs(shifted);
  assert.ok(shiftedLegs.some((leg) => !initialKeys.includes(planningRouteRequestKey(leg))));

  let requested = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { travelMode: "TRANSIT" | "WALK"; legs: Array<{ id: string }> };
    requested += payload.legs.length;
    return Response.json({
      provider: "google_maps",
      fetchedAt: "2026-07-21T00:00:00.000Z",
      travelMode: payload.travelMode,
      legs: payload.legs.map((leg) => ({ id: leg.id, durationMinutes: 14, distanceMeters: 1_000, status: "ok" })),
    });
  };
  await prefetchPlanningRouteDurations(shifted, "en", { fetcher, excludeKeys: initialKeys });
  assert.ok(requested > 0);
});

test("nightly bases produce distinct start and end hotel legs", () => {
  const nightHotel = (id: string, name: string, latitude: number, longitude: number) => ({
    id,
    input: name,
    name,
    area: "Tokyo",
    address: `1 ${name}`,
    latitude,
    longitude,
    sourceUrl: `https://maps.google.com/${id}`,
    verifiedAt: "2026-07-21T00:00:00Z",
    confidence: "medium" as const,
    planningDurationMinutes: 0,
    isAnchor: false,
  });
  const draft = buildTripFromWishlist("Senso-ji\nTokyo Skytree\nMeiji Shrine\nShibuya Crossing\nUeno Park\nGinza", 3, "balanced", "en", {
    tripStartDate: "2026-09-14",
    hotelQuery: "Shinjuku",
    nightBases: {
      0: nightHotel("night-0", "Asakusa Stay", 35.711, 139.797),
      1: nightHotel("night-1", "Shibuya Stay", 35.658, 139.7),
    },
  });
  const legs = buildPlanningRouteLegs(draft);
  const ids = legs.map((leg) => leg.id).join("\n");
  assert.match(ids, /base-night-0::/);
  assert.match(ids, /::base-night-1/);
});
