import assert from "node:assert/strict";
import test from "node:test";
import { createRecommendation, type FillerKind, type Recommendation } from "../lib/itinerary-domain.ts";
import {
  RECOMMENDATION_DETOUR_CAP_MINUTES,
  acceptRecommendation,
  detourWalkingMinutes,
  distinctRecommendationCandidates,
  evaluateRecommendationCandidate,
  partitionRecommendationsByDetour,
  recommendationFillerSlot,
  recommendationPlaceAlreadyScheduled,
  reserveDistinctRecommendationCandidates,
  selectDailyDefaultRecommendations,
  shortlistRecommendations,
  type RecommendationEvaluation,
  type RecommendationPlanSnapshot,
} from "../lib/recommendation-evaluator.ts";

const safePlan: RecommendationPlanSnapshot = {
  solverStatus: "SOLVED",
  hardConflictCount: 0,
  hardConflictMinutes: 0,
  overrunMinutes: 0,
  minimumSlackMinutes: 90,
  deferredAnchorIds: [],
};

function recommendation(
  id: string,
  fillerKind: FillerKind,
  score: number,
  status: Recommendation["status"] = "PROPOSED",
  placeId = `place-${id}`,
) {
  return createRecommendation({
    id,
    type: fillerKind === "LUNCH" || fillerKind === "DINNER" ? "MEAL" : fillerKind === "CAFE" ? "CAFE" : "MICRO_STOP",
    fillerKind,
    slotId: fillerKind === "CAFE" || fillerKind === "MICRO_STOP" ? "gap-1" : `day-1-${fillerKind.toLowerCase()}`,
    placeId,
    proposedDayIndex: 0,
    proposedStartAt: "12:00",
    addedTravelMinutes: 5,
    score: { total: score, detour: score, timeFit: score, qualityConfidence: score, preferenceFit: score },
    reasons: ["fits"],
    evidenceIds: [`evidence-${id}`],
    status,
  });
}

function evaluate(
  item: Recommendation,
  openingStatus: "OPEN" | "CLOSED" | "UNKNOWN" = "OPEN",
  candidate: RecommendationPlanSnapshot = safePlan,
) {
  return evaluateRecommendationCandidate({ recommendation: item, openingStatus, baseline: safePlan, candidate });
}

test("rejects confirmed-closed candidates before they can be accepted", () => {
  const result = evaluate(recommendation("closed", "LUNCH", 95), "CLOSED");
  assert.equal(result.decision, "REJECTED");
  assert.equal(result.recommendation.status, "REJECTED");
  assert.deepEqual(result.codes, ["CONFIRMED_CLOSED"]);
});

test("keeps unknown hours as a conditional proposal, never an auto-accepted fact", () => {
  const result = evaluate(recommendation("unknown", "DINNER", 95), "UNKNOWN");
  assert.equal(result.decision, "CONDITIONAL");
  assert.equal(result.recommendation.status, "PROPOSED");
  assert.equal(result.autoAcceptable, false);
});

test("rejects increased hard conflicts, worsened lateness and newly deferred Anchors", () => {
  const item = recommendation("unsafe", "CAFE", 99);
  const increased = evaluate(item, "OPEN", { ...safePlan, hardConflictCount: 1 });
  assert.deepEqual(increased.codes, ["HARD_CONFLICT_INCREASED"]);
  const worsened = evaluate(item, "OPEN", { ...safePlan, hardConflictMinutes: 5 });
  assert.deepEqual(worsened.codes, ["HARD_CONFLICT_WORSENED"]);
  const deferred = evaluate(item, "OPEN", { ...safePlan, deferredAnchorIds: ["user-anchor-2"] });
  assert.deepEqual(deferred.codes, ["ANCHOR_DEFERRED"]);
  assert.equal(deferred.recommendation.status, "REJECTED");
});

test("solver uncertainty remains conditional and an open re-solved candidate is eligible", () => {
  const item = recommendation("candidate", "MICRO_STOP", 80);
  const unknown = evaluate(item, "OPEN", { ...safePlan, solverStatus: "UNKNOWN" });
  assert.equal(unknown.decision, "CONDITIONAL");
  assert.deepEqual(unknown.codes, ["SOLVER_UNKNOWN"]);
  const eligible = evaluate(item);
  assert.equal(eligible.decision, "ELIGIBLE");
  assert.equal(eligible.autoAcceptable, true);

  const uncertainBaseline = evaluateRecommendationCandidate({
    recommendation: item,
    openingStatus: "OPEN",
    baseline: { ...safePlan, solverStatus: "UNKNOWN" },
    candidate: safePlan,
  });
  assert.equal(uncertainBaseline.decision, "CONDITIONAL");
  assert.equal(uncertainBaseline.autoAcceptable, false);
});

test("selects at most one lunch, dinner and shared cafe/micro recommendation per day", () => {
  const evaluations: RecommendationEvaluation[] = [
    evaluate(recommendation("lunch-low", "LUNCH", 70)),
    evaluate(recommendation("lunch-best", "LUNCH", 90)),
    evaluate(recommendation("dinner", "DINNER", 80)),
    evaluate(recommendation("cafe", "CAFE", 85)),
    evaluate(recommendation("micro-better", "MICRO_STOP", 95)),
  ];
  const selected = selectDailyDefaultRecommendations(evaluations, 0);
  assert.deepEqual(selected.map((entry) => entry.recommendation.id), ["lunch-best", "dinner", "micro-better"]);
  assert.equal(selected.length, 3);
  assert.equal(recommendationFillerSlot("CAFE"), "MICRO");
  assert.equal(recommendationFillerSlot("MICRO_STOP"), "MICRO");
});

test("daily defaults and alternatives never repeat the same facility", () => {
  const lunch = evaluate(recommendation("lunch", "LUNCH", 99, "PROPOSED", "same"));
  const duplicateDinner = evaluate(recommendation("dinner-duplicate", "DINNER", 98, "PROPOSED", "same"));
  const dinner = evaluate(recommendation("dinner", "DINNER", 80, "PROPOSED", "different"));
  const defaults = selectDailyDefaultRecommendations([lunch, duplicateDinner, dinner], 0);
  assert.deepEqual(defaults.map((entry) => entry.recommendation.id), ["lunch", "dinner"]);

  const shortlist = shortlistRecommendations([
    evaluate(recommendation("same-a", "LUNCH", 99, "PROPOSED", "same")),
    evaluate(recommendation("same-b", "LUNCH", 98, "PROPOSED", "same")),
    evaluate(recommendation("other", "LUNCH", 97, "PROPOSED", "other")),
  ], "day-1-lunch");
  assert.equal(shortlist.primary?.recommendation.id, "same-a");
  assert.deepEqual(shortlist.alternatives.map((entry) => entry.recommendation.id), ["other"]);
});

test("food and gap paths reject a Place ID already scheduled as an Anchor or Filler", () => {
  const scheduled = new Set(["anchor-1", "filler-1"]);
  const places = [
    { id: "anchor-1", providerRef: "places/shared" },
    { id: "filler-1", providerRef: "places/lunch" },
    { id: "removed-1", providerRef: "places/removed" },
  ];
  assert.equal(recommendationPlaceAlreadyScheduled("places/shared", scheduled, places), true);
  assert.equal(recommendationPlaceAlreadyScheduled("places/lunch", scheduled, places), true);
  assert.equal(recommendationPlaceAlreadyScheduled("places/removed", scheduled, places), false);
  assert.equal(recommendationPlaceAlreadyScheduled("places/lunch", scheduled, places, "filler-1"), false);
});

test("filters an existing Anchor before choosing the visible meal default", () => {
  const candidates = [{ id: "places/anchor" }, { id: "places/new" }, { id: "places/third" }];
  assert.deepEqual(
    distinctRecommendationCandidates(candidates, new Set(["places/anchor"])).map((candidate) => candidate.id),
    ["places/new", "places/third"],
  );
  assert.deepEqual(
    distinctRecommendationCandidates(candidates, new Set(["places/anchor", "places/new"]), "places/new").map((candidate) => candidate.id),
    ["places/new", "places/third"],
  );
});

test("reserves every visible meal alternative across slots", () => {
  const used = new Set<string>();
  const lunch = reserveDistinctRecommendationCandidates(
    [{ id: "A" }, { id: "B" }, { id: "C" }],
    used,
  );
  const dinner = reserveDistinctRecommendationCandidates(
    [{ id: "B" }, { id: "D" }, { id: "E" }],
    used,
  );
  const visible = [...lunch, ...dinner].map((candidate) => candidate.id);
  assert.deepEqual(visible, ["A", "B", "C", "D", "E"]);
  assert.equal(new Set(visible).size, visible.length);
});

test("returns one primary and at most two alternatives, preferring verified-open safety", () => {
  const conditionalHigh = evaluate(recommendation("unknown-high", "LUNCH", 100), "UNKNOWN");
  const open = [90, 80, 70].map((score) => evaluate(recommendation(`open-${score}`, "LUNCH", score)));
  const shortlist = shortlistRecommendations([conditionalHigh, ...open], "day-1-lunch");
  assert.equal(shortlist.primary?.recommendation.id, "open-90");
  assert.deepEqual(shortlist.alternatives.map((entry) => entry.recommendation.id), ["open-80", "open-70"]);
});

test("accepting an alternative replaces the previous choice in the same slot", () => {
  const first = recommendation("first", "DINNER", 80, "ACCEPTED");
  const next = recommendation("next", "DINNER", 90);
  const result = acceptRecommendation([first, next], next.id);
  assert.deepEqual(result.map((entry) => [entry.id, entry.status]), [
    ["first", "REPLACED"],
    ["next", "ACCEPTED"],
  ]);
});

test("a rejected recommendation cannot be accepted through the status helper", () => {
  const rejected = recommendation("closed", "LUNCH", 100, "REJECTED");
  const result = acceptRecommendation([rejected], rejected.id);
  assert.equal(result[0].status, "REJECTED");
});

// ---- TC-044 / TC-047: the 15-walking-minute detour cap ---------------------

test("detour minutes use the displayed 80m-per-minute figure with a 1-minute floor", () => {
  assert.equal(detourWalkingMinutes(0), 1);
  assert.equal(detourWalkingMinutes(40), 1);
  assert.equal(detourWalkingMinutes(800), 10);
  assert.equal(detourWalkingMinutes(1_200), 15);
  assert.equal(detourWalkingMinutes(1_400), 18);
  assert.equal(detourWalkingMinutes(null), null);
  assert.equal(detourWalkingMinutes(undefined), null);
  assert.equal(detourWalkingMinutes(Number.NaN), null);
  assert.equal(detourWalkingMinutes(-5), null);
});

test("the detour cap keeps within-15-minute candidates auto-displayable and parks the rest", () => {
  assert.equal(RECOMMENDATION_DETOUR_CAP_MINUTES, 15);
  const candidates = [
    { id: "near", meters: 300 },
    { id: "edge", meters: 1_200 },
    { id: "far", meters: 1_600 },
    { id: "unknown", meters: null },
  ];
  const partition = partitionRecommendationsByDetour(candidates, (candidate) => candidate.meters);
  assert.deepEqual(partition.autoDisplay.map(({ id }) => id), ["near", "edge", "unknown"]);
  assert.deepEqual(partition.overCap.map(({ id }) => id), ["far"]);
  assert.equal(partition.nearestFallback, false);
});

test("when every candidate exceeds the cap, the nearest still shows as an honest fallback", () => {
  const candidates = [
    { id: "farther", meters: 2_400 },
    { id: "nearest-over", meters: 1_500 },
    { id: "farthest", meters: 3_000 },
  ];
  const partition = partitionRecommendationsByDetour(candidates, (candidate) => candidate.meters);
  assert.deepEqual(partition.autoDisplay.map(({ id }) => id), ["nearest-over"]);
  assert.deepEqual(partition.overCap.map(({ id }) => id), ["farther", "farthest"]);
  assert.equal(partition.nearestFallback, true);
});

test("an empty candidate list partitions to an empty auto display without a fallback", () => {
  const partition = partitionRecommendationsByDetour([], () => null);
  assert.deepEqual([...partition.autoDisplay], []);
  assert.equal(partition.nearestFallback, false);
});
