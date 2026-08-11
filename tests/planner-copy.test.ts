import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlannerEvidenceSnapshot,
  deriveFeasibilityResult,
} from "../lib/feasibility-result.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { assessTripFit } from "../lib/trip-scenarios.ts";
import { minimumDaysCopy } from "../lib/presentation/planner-copy.ts";

// v1.1 TC-004: the computation cap (LIMIT) is a distinct user-facing cause.
// Each rendered minimum-days message names exactly ONE cause and ONE next
// action; the LIMIT action is reducing the candidate list.

const eightPlaces = `Ghibli Museum
Shibuya Sky
Senso-ji
Tokyo Skytree
teamLab Planets
Tsukiji Outer Market
Meiji Jingu
Akihabara`;

function timedOutResult() {
  const plan = buildTripFromWishlist(eightPlaces, 1, "balanced", "en");
  let tick = 0;
  const fit = assessTripFit(eightPlaces, 1, "balanced", "en", {}, plan, 14, {
    timeoutMs: 1,
    now: () => tick++,
  });
  assert.equal(fit.solverTimedOut, true);
  assert.equal(fit.minimumDays, null);
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: false,
    baseWasProvided: false,
    dayEndWasProvided: false,
    capturedAt: "2026-08-09T00:00:00.000Z",
    solverTimedOut: fit.solverTimedOut,
  });
  return deriveFeasibilityResult(plan, fit, evidence);
}

test("solverTimedOut surfaces as the distinct COMPUTATION_LIMIT cause, not a generic unknown", () => {
  const result = timedOutResult();
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.unknownCause, "COMPUTATION_LIMIT");

  const plan = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 1, "balanced", "en");
  const fit = assessTripFit("Senso-ji\nTokyo Skytree", 1, "balanced", "en", {}, plan);
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: false,
    baseWasProvided: false,
    dayEndWasProvided: false,
    capturedAt: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(deriveFeasibilityResult(plan, fit, evidence).unknownCause, null);

  const unresolvedRaw = "Senso-ji\nA private cafe from my notes";
  const unresolvedPlan = buildTripFromWishlist(unresolvedRaw, 1, "balanced", "en");
  const unresolvedFit = assessTripFit(unresolvedRaw, 1, "balanced", "en", {}, unresolvedPlan);
  const unresolvedEvidence = createPlannerEvidenceSnapshot(unresolvedPlan, {
    dateWasProvided: false,
    baseWasProvided: false,
    dayEndWasProvided: false,
    capturedAt: "2026-08-09T00:00:00.000Z",
    solverTimedOut: true,
  });
  // Unresolved places stay the operative blocker even when the solver also timed out.
  assert.equal(deriveFeasibilityResult(unresolvedPlan, unresolvedFit, unresolvedEvidence).unknownCause, "UNRESOLVED_PLACE");
});

test("the LIMIT cause renders one cause and the reduce-places action in both locales", () => {
  const result = timedOutResult();

  const ja = minimumDaysCopy(result, "ja");
  assert.ok(ja.includes("計算の上限"), "ja copy must name the computation limit as the cause");
  assert.ok(ja.includes("場所を15件以下にしてください"), "ja copy must offer the reduce-places action");
  // Exactly one cause: no blending with unresolved places, day pins or fixed conflicts.
  assert.doesNotMatch(ja, /未解決|日指定|固定条件/);

  const en = minimumDaysCopy(result, "en");
  assert.match(en, /computation limit/i, "en copy must name the computation limit as the cause");
  assert.match(en, /Remove optional places .*15 or fewer/, "en copy must offer removing optional candidates");
  assert.doesNotMatch(en, /unresolved|day pin|fixed constraint/i);
});

test("the exhausted-search fallback names only the fixed-constraint cause with one action", () => {
  const result = timedOutResult();
  const searched = { ...result, unknownCause: null, searchedThroughDays: 14 };

  const ja = minimumDaysCopy(searched, "ja");
  assert.ok(ja.includes("固定条件が競合"));
  assert.ok(ja.includes("見直してください"), "ja copy must carry one next action");
  assert.doesNotMatch(ja, /計算|上限|未解決/);

  const en = minimumDaysCopy(searched, "en");
  assert.match(en, /fixed constraint/);
  assert.match(en, /Revisit one/);
  assert.doesNotMatch(en, /computation|limit|unresolved/i);
});
