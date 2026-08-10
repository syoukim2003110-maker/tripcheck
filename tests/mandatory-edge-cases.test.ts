import assert from "node:assert/strict";
import test from "node:test";

import { localDateIn, localDateTimeWithOffset } from "../lib/destinations.ts";
import { fetchGoogleRoutes, type LiveRoutesRequest } from "../lib/google-routes.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { assessTripFit, generateTripCounterfactuals } from "../lib/trip-scenarios.ts";

test("mandatory case: a hotel/base change is returned only after a measured counterfactual improvement", () => {
  const raw = "Senso-ji\nTokyo Skytree";
  const context = {
    hotelQuery: "hotel near Shinjuku Station",
    tripStartDate: "2026-09-14",
    dayEndTarget: "22:00",
  };
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, plan);
  const alternatives = generateTripCounterfactuals(raw, 1, "balanced", "en", context, plan, fit);
  const baseChange = alternatives.find((alternative) => alternative.kind === "CHANGE_BASE");

  assert.ok(baseChange, "the deterministic base candidates should expose a closer base");
  assert.ok((baseChange.improvement.slackMinutesGained ?? 0) > 0);
  assert.equal(baseChange.after.hardConflictCount <= baseChange.before.hardConflictCount, true);
  assert.notEqual(baseChange.change.baseId, plan.selectedBase?.id);
});

test("mandatory cases: local trip dates do not inherit the device timezone", () => {
  const instant = new Date("2026-01-01T10:30:00.000Z");
  assert.equal(localDateIn("Pacific/Auckland", instant), "2026-01-01");
  assert.equal(localDateIn("America/Los_Angeles", instant), "2026-01-01");

  const crossing = new Date("2026-01-01T23:30:00.000Z");
  assert.equal(localDateIn("Pacific/Auckland", crossing), "2026-01-02");
  assert.equal(localDateIn("America/Los_Angeles", crossing), "2026-01-01");
});

test("mandatory case: DST dates use the destination's actual UTC offset", () => {
  const before = localDateTimeWithOffset("2026-03-07", "09:00", "America/New_York");
  const after = localDateTimeWithOffset("2026-03-08", "09:00", "America/New_York");
  assert.equal(before, "2026-03-07T09:00:00-05:00");
  assert.equal(after, "2026-03-08T09:00:00-04:00");
});

test("mandatory cases: no walking route or an island/ferry gap never fabricates time or geometry", async () => {
  const request: LiveRoutesRequest = {
    languageCode: "en",
    travelMode: "WALK",
    legs: [
      {
        id: "island-ferry-gap",
        origin: { latitude: 64.1466, longitude: -21.9426 },
        destination: { latitude: 63.985, longitude: -22.6056 },
        departureTime: "2026-09-14T09:00:00.000Z",
      },
    ],
  };
  const result = await fetchGoogleRoutes(request, "test-key", async () => Response.json({ routes: [] }));
  assert.deepEqual(result, [{
    id: "island-ferry-gap",
    durationMinutes: null,
    distanceMeters: null,
    encodedPolyline: null,
    transferCount: null,
    transitSteps: null,
    walkToStopMinutes: null,
    walkFromStopMinutes: null,
    status: "unavailable",
  }]);
});
