import assert from "node:assert/strict";
import test from "node:test";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { totalPlanBufferMinutes } from "../lib/trip-scenarios.ts";
import { mealAcceptSimulation, planImpactMetrics } from "../lib/recommendation-impact.ts";
import {
  PLANNER_UNDO_LIMIT,
  attachPlannerBaseToHistory,
  emptyPlannerEditState,
  type PlannerEditState,
} from "../lib/planner-app-state.ts";
import {
  commitPlannerHistory,
  createPlannerHistory,
  redoPlannerHistory,
  undoPlannerHistory,
} from "../lib/planner-history.ts";
import {
  bufferDeltaLine,
  bufferToastDetail,
  travelDeltaLine,
  ui,
} from "../lib/presentation/planner-copy.ts";
import { destinationById } from "../lib/destinations.ts";
import type { FoodCandidate } from "../lib/google-food.ts";
import type { ResolvedInputStop } from "../lib/route-optimizer.ts";

// v1.1 TC-048/TC-050: recommendation accepts are first-class history
// operations, their card metrics come from a really simulated candidate plan,
// and the accept toast reports the buffer (余裕) change per the Copy Deck.

const raw = "Senso-ji\nteamLab Planets";

function sampleMealSetup() {
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", { mealPlan: "all" });
  const slot = plan.foodRecommendationSlots[0];
  assert.ok(slot, "the sample plan must offer at least one meal slot");
  const candidate: FoodCandidate = {
    id: "gplace-test-diner",
    name: "Test Diner",
    address: "1-1 Asakusa, Taito City, Tokyo",
    type: "restaurant",
    googleMapsUrl: "https://maps.google.com/?cid=1",
    latitude: slot.latitude + 0.0005,
    longitude: slot.longitude + 0.0005,
    distanceMeters: 120,
    rating: 4.4,
    userRatingCount: 210,
    openNow: true,
    plannedOpen: true,
    hours: [],
    businessStatus: "OPERATIONAL",
    paymentEvidence: [],
    reviewSnippets: [],
    websiteUrl: null,
  };
  const simulation = mealAcceptSimulation({
    itinerary: raw,
    tripDays: 1,
    pace: "balanced",
    locale: "en",
    context: { mealPlan: "all" },
    resolvedStops: [],
    slot,
    candidate,
    fetchedAt: "2026-08-12T00:00:00.000Z",
    destination: destinationById("japan"),
    currentStopId: null,
  });
  assert.ok(simulation, "a candidate with coordinates must simulate");
  return { plan, slot, candidate, simulation };
}

test("a meal accept commits as ONE history operation and undo restores the exact prior tracked state", () => {
  const { slot, candidate, simulation } = sampleMealSetup();
  const prior: PlannerEditState = { ...emptyPlannerEditState(), tripDays: 1, itinerary: raw };
  const accepted: PlannerEditState = {
    ...prior,
    itinerary: simulation.candidateItinerary,
    resolvedStops: [simulation.resolved],
    resolutionOverrides: [{ inputIndex: simulation.resolved.inputIndex!, providerRef: candidate.id }],
    dayOverrides: { [simulation.resolved.id]: slot.dayIndex + 1 },
    mealSelections: { [slot.id]: candidate.id },
  };

  // The provider-resolved stop must be storable history state (JSON-safe) —
  // commitPlannerHistory clones strictly and would throw otherwise.
  const history = commitPlannerHistory(createPlannerHistory(prior, { limit: PLANNER_UNDO_LIMIT }), accepted);
  assert.equal(history.past.length, 1, "the whole accept is exactly one undo step");

  const undone = undoPlannerHistory(history);
  assert.deepEqual(undone.present, prior, "undo restores the exact prior tracked state");
  const redone = redoPlannerHistory(undone);
  assert.deepEqual(redone.present, accepted, "redo restores the accept");
});

test("the buffer delta is measured on the really simulated candidate plan", () => {
  const { plan, simulation } = sampleMealSetup();

  // Independent recomputation of the buffer definition: per-day slack is the
  // usable clock window (start → 22:00 default, deadline-capped) minus the
  // planned minutes.
  const clock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const expected = plan.days.reduce((sum, day) => {
    const deadline = day.deadlinePreviousDay ? 0 : day.deadline ? Math.min(22 * 60, clock(day.deadline)) : 22 * 60;
    return sum + Math.max(0, deadline - clock(day.startTime)) - day.totalMinutes;
  }, 0);
  assert.equal(totalPlanBufferMinutes(plan, {}), expected);

  const scheduled = simulation.candidatePlan.days
    .some((day) => day.stops.some(({ stop }) => stop.id === simulation.resolved.id));
  assert.equal(scheduled, true, "the simulated accept must land in the schedule");

  const impact = planImpactMetrics({
    plan,
    context: {},
    candidatePlan: simulation.candidatePlan,
    candidateContext: simulation.candidateContext,
  });
  assert.equal(
    impact.bufferDeltaMinutes,
    totalPlanBufferMinutes(simulation.candidatePlan, simulation.candidateContext) - totalPlanBufferMinutes(plan, {}),
  );
  // Adding a 60-minute lunch (plus any travel) can only SHRINK the buffer.
  assert.ok(impact.bufferDeltaMinutes <= -60, `expected ≤ -60, saw ${impact.bufferDeltaMinutes}`);
  assert.ok(impact.travelDeltaMinutes >= 0, "an inserted stop never reduces travel");
});

test("toast and card metric copy follows the Copy Deck in both locales", () => {
  assert.equal(ui.ja.toastAdded, "旅程に追加しました");
  assert.equal(ui.en.toastAdded, "Added to the itinerary");
  assert.equal(bufferDeltaLine(45, "ja"), "余裕 +45分");
  assert.equal(bufferDeltaLine(-45, "ja"), "余裕 −45分");
  assert.equal(bufferDeltaLine(45, "en"), "+45m buffer");
  assert.equal(bufferDeltaLine(-45, "en"), "−45m buffer");
  assert.equal(travelDeltaLine(12, "ja"), "移動 +12分");
  assert.equal(travelDeltaLine(-5, "en"), "travel −5 min");
  // A zero delta shows no toast metric rather than a fabricated one.
  assert.equal(bufferToastDetail(0, "ja"), null);
  assert.equal(bufferToastDetail(0, "en"), null);
  assert.equal(bufferToastDetail(-30, "ja"), "余裕 −30分");
});

test("the provisional-base attach rebases the whole history without adding an undo step", () => {
  const base: ResolvedInputStop = {
    id: "hotel-test",
    providerRef: "test",
    input: "Test Hotel",
    name: "Test Hotel",
    area: "Asakusa",
    address: "2-2 Asakusa, Taito City, Tokyo",
    latitude: 35.71,
    longitude: 139.79,
    sourceUrl: "",
    verifiedAt: "2026-08-12",
    confidence: "medium",
    planningDurationMinutes: 0,
    isAnchor: false,
  };
  const initial = { ...emptyPlannerEditState(), itinerary: raw };
  let history = createPlannerHistory(initial, { limit: PLANNER_UNDO_LIMIT });
  history = commitPlannerHistory(history, { ...initial, pace: "relaxed" });
  history = commitPlannerHistory(history, { ...initial, pace: "relaxed", tripDays: 2 });

  const attached = attachPlannerBaseToHistory(history, base);
  assert.equal(attached.past.length, history.past.length, "the attach adds no undo entry");
  assert.equal(attached.future.length, history.future.length);
  assert.deepEqual(attached.present.resolvedBase, base);
  for (const state of attached.past) assert.deepEqual(state.resolvedBase, base);

  // Undoing PAST the attach never resurrects the pre-attach routing base.
  const undone = undoPlannerHistory(undoPlannerHistory(attached));
  assert.deepEqual(undone.present.resolvedBase, base);
  assert.equal(undone.present.pace, "balanced", "user edits still unwind normally");
});

test("undo depth is capped at the spec's 10 operations", () => {
  assert.equal(PLANNER_UNDO_LIMIT, 10);
  let history = createPlannerHistory(emptyPlannerEditState(), { limit: PLANNER_UNDO_LIMIT });
  for (let step = 1; step <= 14; step += 1) {
    history = commitPlannerHistory(history, { ...emptyPlannerEditState(), tripDays: step % 13 + 1, hotelQuery: `q${step}` });
  }
  assert.equal(history.past.length, 10);
});
