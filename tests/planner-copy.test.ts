import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlannerEvidenceSnapshot,
  deriveFeasibilityResult,
} from "../lib/feasibility-result.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { assessTripFit } from "../lib/trip-scenarios.ts";
import { feasibilityStateCopy, minimumDaysCopy, ui } from "../lib/presentation/planner-copy.ts";

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

// Copy Deck build.stage1-3: the build screen narrates exactly three outcome
// stages, verbatim, with no counts and no provider names.
test("build stages carry the three Copy Deck outcome strings", () => {
  assert.deepEqual(ui.ja.buildSteps, {
    grouping: "近い場所を同じ日にまとめています",
    ordering: "回る順番を整えています",
    enriching: "ホテルと食事の候補を探しています",
  });
  assert.deepEqual(ui.en.buildSteps, {
    grouping: "Grouping nearby places into days",
    ordering: "Finding a practical order",
    enriching: "Finding a practical base and meal stops",
  });
  for (const line of [...Object.values(ui.ja.buildSteps), ...Object.values(ui.en.buildSteps)]) {
    assert.doesNotMatch(line, /\d/, "stage copy must carry no counts");
    assert.doesNotMatch(line, /Google|Rakuten|楽天/i, "stage copy must carry no provider names");
  }
});

// Copy Deck plan.state.conditional / plan.state.infeasible: real day and check
// counts parameterize the headline; a conditional state without a countable
// check keeps the assumptions phrasing instead of fabricating a number, and a
// booking conflict with nothing unplaced keeps its specific honest copy.
test("conditional and infeasible state copy follow the deck with real counts only", () => {
  assert.equal(feasibilityStateCopy("FEASIBLE_IF_ASSUMPTIONS", "ja", 4, 8, 0, 2).headline, "4日で回れます。2か所だけ確認が必要です");
  assert.equal(feasibilityStateCopy("FEASIBLE_IF_ASSUMPTIONS", "en", 4, 8, 0, 2).headline, "This works in 4 days, with 2 details to check");
  assert.equal(feasibilityStateCopy("FEASIBLE_IF_ASSUMPTIONS", "en", 4, 8, 0, 1).headline, "This works in 4 days, with 1 detail to check");
  assert.equal(feasibilityStateCopy("FEASIBLE_IF_ASSUMPTIONS", "ja", 4, 8, 0, 0).headline, "この条件なら4日で回れます");
  assert.equal(feasibilityStateCopy("FEASIBLE_IF_ASSUMPTIONS", "en", 4, 8, 0, 0).headline, "This works in 4 days with these assumptions");

  assert.equal(feasibilityStateCopy("INFEASIBLE_HARD_CONFLICT", "ja", 3, 8, 1).headline, "3日だと1か所外す必要があります");
  assert.equal(feasibilityStateCopy("INFEASIBLE_HARD_CONFLICT", "en", 3, 8, 1).headline, "In 3 days, one stop needs to move or be removed");
  assert.equal(feasibilityStateCopy("INFEASIBLE_HARD_CONFLICT", "en", 3, 8, 2).headline, "In 3 days, 2 stops need to move or be removed");
  assert.equal(feasibilityStateCopy("INFEASIBLE_HARD_CONFLICT", "ja", 3, 8, 0).headline, "このままだと予約・時間に間に合いません");
  assert.equal(feasibilityStateCopy("INFEASIBLE_HARD_CONFLICT", "en", 3, 8, 0).headline, "A booking or time constraint cannot be met as planned");
});
