import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { assessTripFit } from "../lib/trip-scenarios.ts";
import {
  PROVISIONAL_TRIP_LENGTH_ROUNDS,
  resolveProvisionalTripLength,
} from "../lib/provisional-trip-length.ts";
import type { ResolvedInputStop } from "../lib/route-optimizer.ts";

// P0-02. When the traveller leaves the length undecided, the planner proposes
// a minimum day count and then builds the plan. The proposal used to be
// measured without a base and the plan built with one, so the screen offered
// "one day is enough" and then declared the same trip needs two — a 75-minute
// pair of hotel transfer legs the probe never saw.

const TOKYO_THREE = "Ghibli Museum\nShibuya Sky\nSenso-ji";
const DAY_WINDOW = { defaultDayStart: "09:00", dayEndTarget: "16:00" } as const;

function contextFor(base: ResolvedInputStop | null) {
  return { ...DAY_WINDOW, resolvedBase: base };
}

function resolve(itinerary = TOKYO_THREE, requestedDays = 3) {
  return resolveProvisionalTripLength({
    itinerary,
    requestedDays,
    daysUndecided: true,
    pace: "balanced",
    locale: "en",
    resolvedHotel: null,
    contextFor,
  });
}

test("the day count the traveller is offered is the one their own plan reports", () => {
  const provisional = resolve();
  const fitOfTheBuiltPlan = assessTripFit(
    TOKYO_THREE,
    provisional.days,
    "balanced",
    "en",
    contextFor(provisional.base),
  );
  const reported = fitOfTheBuiltPlan.minimumDays ?? fitOfTheBuiltPlan.partialMinimumDays;
  assert.equal(
    reported,
    provisional.days,
    "re-measuring the delivered plan must return the number that was proposed",
  );
});

test("probe and plan are measured against the same base", () => {
  const provisional = resolve();
  // The base the plan was built from is the base the proposal was measured
  // against — that identity is the whole fix.
  const rebuilt = buildTripFromWishlist(TOKYO_THREE, provisional.days, "balanced", "en", contextFor(provisional.base));
  assert.deepEqual(
    rebuilt.days.map((day) => [day.hotelOutboundMinutes, day.hotelInboundMinutes, day.deadlineOverrunMinutes]),
    provisional.plan.days.map((day) => [day.hotelOutboundMinutes, day.hotelInboundMinutes, day.deadlineOverrunMinutes]),
    "the delivered plan must be reproducible from the settled context alone",
  );
});

test("a base-less probe really would have disagreed — this is the defect, stated", () => {
  // Measuring without a base is what produced the contradiction. Keeping the
  // comparison here means a future refactor that quietly reintroduces the
  // base-less probe has something concrete to fail against.
  const baseless = assessTripFit(TOKYO_THREE, 3, "balanced", "en", contextFor(null));
  const provisional = resolve();
  const withBase = assessTripFit(TOKYO_THREE, provisional.days, "balanced", "en", contextFor(provisional.base));
  const baselessMinimum = baseless.minimumDays ?? baseless.partialMinimumDays;
  const settledMinimum = withBase.minimumDays ?? withBase.partialMinimumDays;
  assert.equal(settledMinimum, provisional.days);
  if (provisional.base) {
    const carriesHotelLegs = provisional.plan.days.some((day) => (day.hotelOutboundMinutes ?? 0) > 0 || (day.hotelInboundMinutes ?? 0) > 0);
    assert.ok(carriesHotelLegs, "the delivered plan really does pay for a base");
    assert.ok(
      baselessMinimum === null || settledMinimum === null || baselessMinimum <= settledMinimum,
      "ignoring the base can only ever understate the length, never overstate it",
    );
  }
});

test("the same input settles on the same day count and base every time", () => {
  const first = resolve();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const again = resolve();
    assert.equal(again.days, first.days);
    assert.equal(again.base?.id ?? null, first.base?.id ?? null);
    assert.equal(again.plan.days.length, first.plan.days.length);
  }
});

test("the search is bounded and reports whether it settled", () => {
  const provisional = resolve();
  assert.ok(provisional.rounds >= 1 && provisional.rounds <= PROVISIONAL_TRIP_LENGTH_ROUNDS);
  assert.equal(provisional.settled, true, "three Tokyo places must reach a self-consistent pair");
});

test("a traveller who names a length keeps it, and still gets a base-aware plan", () => {
  const chosen = resolveProvisionalTripLength({
    itinerary: TOKYO_THREE,
    requestedDays: 2,
    daysUndecided: false,
    pace: "balanced",
    locale: "en",
    resolvedHotel: null,
    contextFor,
  });
  assert.equal(chosen.days, 2, "a stated length is never overridden");
  assert.equal(chosen.plan.days.length, 2);
  assert.deepEqual(
    chosen.plan.days.map((day) => day.startBase?.id ?? null),
    buildTripFromWishlist(TOKYO_THREE, 2, "balanced", "en", contextFor(chosen.base)).days.map((day) => day.startBase?.id ?? null),
  );
});

test("a traveller's own hotel is never replaced by a provisional area", () => {
  const hotel = {
    id: "traveller-hotel",
    input: "Hotel Gajoen",
    name: "Hotel Gajoen",
    area: "Meguro",
    address: "Meguro",
    latitude: 35.6339,
    longitude: 139.7157,
    sourceUrl: null,
    verifiedAt: null,
    confidence: "high",
    planningDurationMinutes: 0,
    isAnchor: false,
  } as unknown as ResolvedInputStop;
  const provisional = resolveProvisionalTripLength({
    itinerary: TOKYO_THREE,
    requestedDays: 3,
    daysUndecided: true,
    pace: "balanced",
    locale: "en",
    resolvedHotel: hotel,
    contextFor,
  });
  assert.equal(provisional.base?.id, "traveller-hotel");
});

test("the build hook reads the settled context rather than probing on its own", () => {
  const source = readFileSync(new URL("../app/components/planner/hooks/usePlanBuild.tsx", import.meta.url), "utf8");
  assert.match(source, /resolveProvisionalTripLength\(\{/, "the hook must use the shared settlement");
  assert.doesNotMatch(
    source,
    /assessTripFit\(itinerary, buildDays, pace, locale, plannerContext\(resolvedHotel\)\)/,
    "the base-less minimum-day probe must not come back",
  );
  assert.match(source, /draft = provisional\.plan/, "the delivered plan is the one the settlement produced");
});
