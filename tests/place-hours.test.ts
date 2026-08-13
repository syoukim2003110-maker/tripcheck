import assert from "node:assert/strict";
import test from "node:test";
import { placeHasOpeningHoursEvidence, placeRequiresOpeningHours } from "../lib/place-hours.ts";
import type { PlaceIntelligenceResult } from "../lib/place-intelligence.ts";

test("geographic destinations do not create business-hours tasks", () => {
  assert.equal(placeRequiresOpeningHours({ openingHoursApplicable: false }), false);
  assert.equal(placeRequiresOpeningHours({ placeTypes: ["locality", "political"] }), false);
  assert.equal(placeRequiresOpeningHours({ placeTypes: ["natural_feature", "tourist_attraction"] }), false);
  assert.equal(placeRequiresOpeningHours({ placeTypes: ["museum", "tourist_attraction"] }), true);
  assert.equal(placeRequiresOpeningHours({ placeTypes: ["restaurant", "food"] }), true);
});

test("only actual Google hours or closure data counts as opening-hours evidence", () => {
  const place = {
    businessStatus: "OPERATIONAL",
    hours: [],
    currentOpeningPeriods: null,
    regularOpeningPeriods: null,
  } as unknown as PlaceIntelligenceResult["place"];
  assert.equal(placeHasOpeningHoursEvidence(place), false);
  assert.equal(placeHasOpeningHoursEvidence({ ...place, hours: ["Monday: 09:00–17:00"] }), true);
  assert.equal(placeHasOpeningHoursEvidence({ ...place, regularOpeningPeriods: [{ open: { day: 1, hour: 9 } }] }), true);
  assert.equal(placeHasOpeningHoursEvidence({ ...place, businessStatus: "CLOSED_TEMPORARILY" }), true);
});
