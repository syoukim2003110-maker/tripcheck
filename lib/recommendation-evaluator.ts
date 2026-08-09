import type { BuiltTripPlan } from "./trip-builder.ts";
import type { TripFitAssessment } from "./trip-scenarios.ts";
import {
  createRecommendation,
  type FillerKind,
  type Recommendation,
  type RecommendationStatus,
} from "./itinerary-domain.ts";

export type RecommendationOpeningStatus = "OPEN" | "CLOSED" | "UNKNOWN";
export type RecommendationDecision = "ELIGIBLE" | "CONDITIONAL" | "REJECTED";
export type RecommendationRejectionCode =
  | "CONFIRMED_CLOSED"
  | "HARD_CONFLICT_INCREASED"
  | "HARD_CONFLICT_WORSENED"
  | "ANCHOR_DEFERRED"
  | "SOLVER_UNKNOWN";

export type RecommendationPlanSnapshot = Readonly<{
  solverStatus: "SOLVED" | "UNKNOWN";
  hardConflictCount: number;
  hardConflictMinutes: number;
  overrunMinutes: number;
  minimumSlackMinutes: number | null;
  deferredAnchorIds: readonly string[];
}>;

export type RecommendationEvaluation = Readonly<{
  recommendation: Recommendation;
  decision: RecommendationDecision;
  /** Only verified-open, fully re-solved candidates may be auto-accepted. */
  autoAcceptable: boolean;
  codes: readonly RecommendationRejectionCode[];
}>;

export type RecommendationEvaluationInput = Readonly<{
  recommendation: Recommendation;
  openingStatus: RecommendationOpeningStatus;
  baseline: RecommendationPlanSnapshot;
  candidate: RecommendationPlanSnapshot;
}>;

function stableUnique(values: Iterable<string>) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export type RecommendationPlaceIdentity = Readonly<{
  id: string;
  providerRef?: string | null;
}>;

/**
 * Food and gap discovery use separate provider searches, so the same Place ID
 * can arrive through either path. Check the actual scheduled provider
 * identities before accepting a Filler; local recommendation ids alone cannot
 * prevent an Anchor, lunch and micro-stop from duplicating one facility.
 */
export function recommendationPlaceAlreadyScheduled(
  providerRef: string,
  plannedStopIds: ReadonlySet<string>,
  places: readonly RecommendationPlaceIdentity[],
  excludingStopId: string | null = null,
) {
  return places.some((place) => (
    place.providerRef === providerRef
    && place.id !== excludingStopId
    && plannedStopIds.has(place.id)
  ));
}

/**
 * Filters already-owned places before the first recommendation is rendered.
 * A currently accepted choice stays first so reopening its slot never appears
 * to replace a traveller decision behind their back.
 */
export function distinctRecommendationCandidates<T extends { id: string }>(
  candidates: readonly T[],
  unavailableProviderRefs: ReadonlySet<string>,
  selectedId: string | null = null,
) {
  const selected = selectedId
    ? candidates.filter((candidate) => candidate.id === selectedId)
    : [];
  const remaining = candidates.filter((candidate) => (
    candidate.id !== selectedId && !unavailableProviderRefs.has(candidate.id)
  ));
  return [...selected, ...remaining];
}

/**
 * Builds one visible shortlist and reserves every displayed provider result.
 * Reserving alternatives as well as the primary prevents the same venue from
 * appearing in two meal slots at once (for example as a lunch alternative and
 * the dinner default).
 */
export function reserveDistinctRecommendationCandidates<T extends { id: string }>(
  candidates: readonly T[],
  unavailableProviderRefs: Set<string>,
  selectedId: string | null = null,
  limit = 3,
) {
  const shortlist = distinctRecommendationCandidates(
    candidates,
    unavailableProviderRefs,
    selectedId,
  ).slice(0, Math.max(0, Math.floor(limit)));
  shortlist.forEach((candidate) => unavailableProviderRefs.add(candidate.id));
  return shortlist;
}

/**
 * Adapts a real builder/fit result to the minimal metrics needed by the pure
 * evaluator. `anchorStopIds` must contain resolved user-input occurrence ids,
 * never recommendation ids.
 */
export function recommendationPlanSnapshot(
  plan: BuiltTripPlan,
  fit: TripFitAssessment,
  anchorStopIds: Iterable<string>,
): RecommendationPlanSnapshot {
  const anchors = new Set(anchorStopIds);
  const scheduledAnchorIds = new Set(plan.days.flatMap((day) => day.stops.flatMap(({ stop }) => (
    anchors.has(stop.id) ? [stop.id] : []
  ))));
  const explicitlyDeferred = [
    ...plan.deferredOptionalStops,
    ...plan.deferredUnavailableStops,
  ].flatMap((stop) => anchors.has(stop.id) ? [stop.id] : []);
  const missing = [...anchors].filter((id) => !scheduledAnchorIds.has(id));
  const deferredAnchorIds = stableUnique([...explicitlyDeferred, ...missing]);
  const hardConflictCount = plan.days.reduce((sum, day) => (
    sum
    + day.reservationConflictCount
    + day.openingConflictCount
    + Number(day.deadlineOverrunMinutes > 0)
  ), 0) + plan.deferredUnavailableStops.filter((stop) => anchors.has(stop.id)).length;
  const hardConflictMinutes = plan.days.reduce((sum, day) => (
    sum
    + day.deadlineOverrunMinutes
    + day.stops.reduce((daySum, stop) => daySum + stop.reservationLateMinutes, 0)
  ), 0);
  const usableFitDays = fit.days.filter((day) => day.placeCount > 0);
  return Object.freeze({
    solverStatus: fit.status === "timed_out" || fit.status === "incomplete" ? "UNKNOWN" : "SOLVED",
    hardConflictCount,
    hardConflictMinutes,
    overrunMinutes: fit.days.reduce((sum, day) => sum + day.overrunMinutes, 0),
    minimumSlackMinutes: usableFitDays.length > 0
      ? Math.min(...usableFitDays.map((day) => day.slackMinutes))
      : null,
    deferredAnchorIds: Object.freeze(deferredAnchorIds),
  });
}

function withStatus(recommendation: Recommendation, status: RecommendationStatus) {
  return createRecommendation({ ...recommendation, status });
}

/**
 * Safety gate for a candidate already simulated through the deterministic
 * builder. No LLM judgment participates in this decision.
 */
export function evaluateRecommendationCandidate(input: RecommendationEvaluationInput): RecommendationEvaluation {
  const codes: RecommendationRejectionCode[] = [];
  if (input.openingStatus === "CLOSED") codes.push("CONFIRMED_CLOSED");
  if (input.candidate.hardConflictCount > input.baseline.hardConflictCount) codes.push("HARD_CONFLICT_INCREASED");
  if (
    input.candidate.hardConflictCount === input.baseline.hardConflictCount
    && input.candidate.hardConflictMinutes > input.baseline.hardConflictMinutes
  ) codes.push("HARD_CONFLICT_WORSENED");
  const baselineDeferred = new Set(input.baseline.deferredAnchorIds);
  if (input.candidate.deferredAnchorIds.some((id) => !baselineDeferred.has(id))) codes.push("ANCHOR_DEFERRED");

  const hardRejected = codes.length > 0;
  if (hardRejected) return Object.freeze({
    recommendation: withStatus(input.recommendation, "REJECTED"),
    decision: "REJECTED",
    autoAcceptable: false,
    codes: Object.freeze(codes),
  });

  if (input.baseline.solverStatus === "UNKNOWN" || input.candidate.solverStatus === "UNKNOWN") {
    return Object.freeze({
      recommendation: withStatus(input.recommendation, "PROPOSED"),
      decision: "CONDITIONAL",
      autoAcceptable: false,
      codes: Object.freeze(["SOLVER_UNKNOWN"] as const),
    });
  }
  if (input.openingStatus === "UNKNOWN") {
    return Object.freeze({
      recommendation: withStatus(input.recommendation, "PROPOSED"),
      decision: "CONDITIONAL",
      autoAcceptable: false,
      codes: Object.freeze([]),
    });
  }
  return Object.freeze({
    recommendation: withStatus(input.recommendation, "PROPOSED"),
    decision: "ELIGIBLE",
    autoAcceptable: true,
    codes: Object.freeze([]),
  });
}

type DailyFillerSlot = "LUNCH" | "DINNER" | "MICRO";

function dailyFillerSlot(recommendation: Recommendation): DailyFillerSlot | null {
  if (recommendation.fillerKind === "LUNCH") return "LUNCH";
  if (recommendation.fillerKind === "DINNER") return "DINNER";
  if (recommendation.fillerKind === "CAFE" || recommendation.fillerKind === "MICRO_STOP") return "MICRO";
  return null;
}

function compareEvaluations(left: RecommendationEvaluation, right: RecommendationEvaluation) {
  return Number(right.autoAcceptable) - Number(left.autoAcceptable)
    || right.recommendation.score.total - left.recommendation.score.total
    || left.recommendation.addedTravelMinutes - right.recommendation.addedTravelMinutes
    || left.recommendation.id.localeCompare(right.recommendation.id);
}

/** One default lunch, dinner and shared cafe/micro slot per day; never more than three. */
export function selectDailyDefaultRecommendations(
  evaluations: readonly RecommendationEvaluation[],
  dayIndex: number,
) {
  const selected = new Map<DailyFillerSlot, RecommendationEvaluation>();
  const selectedPlaces = new Set<string>();
  const candidates = evaluations
    .filter((entry) => (
      entry.decision !== "REJECTED"
      && entry.recommendation.status !== "REJECTED"
      && entry.recommendation.proposedDayIndex === dayIndex
    ))
    .sort(compareEvaluations);
  for (const candidate of candidates) {
    const slot = dailyFillerSlot(candidate.recommendation);
    if (slot && !selected.has(slot) && !selectedPlaces.has(candidate.recommendation.placeId)) {
      selected.set(slot, candidate);
      selectedPlaces.add(candidate.recommendation.placeId);
    }
  }
  return Object.freeze([...selected.values()].sort((left, right) => {
    const order: Record<DailyFillerSlot, number> = { LUNCH: 0, DINNER: 1, MICRO: 2 };
    return order[dailyFillerSlot(left.recommendation)!] - order[dailyFillerSlot(right.recommendation)!];
  }));
}

export type RecommendationShortlist = Readonly<{
  primary: RecommendationEvaluation | null;
  alternatives: readonly RecommendationEvaluation[];
}>;

/** Returns one default and no more than two alternatives for one slot/Gap. */
export function shortlistRecommendations(
  evaluations: readonly RecommendationEvaluation[],
  slotId?: string,
): RecommendationShortlist {
  const eligible: RecommendationEvaluation[] = [];
  const places = new Set<string>();
  for (const entry of evaluations
    .filter((candidate) => (
      candidate.decision !== "REJECTED"
      && candidate.recommendation.status !== "REJECTED"
      && (slotId === undefined || candidate.recommendation.slotId === slotId)
    ))
    .sort(compareEvaluations)) {
    if (places.has(entry.recommendation.placeId)) continue;
    places.add(entry.recommendation.placeId);
    eligible.push(entry);
    if (eligible.length === 3) break;
  }
  return Object.freeze({
    primary: eligible[0] ?? null,
    alternatives: Object.freeze(eligible.slice(1, 3)),
  });
}

/** Accepting an alternative replaces the previous accepted choice in the same logical slot. */
export function acceptRecommendation(
  recommendations: readonly Recommendation[],
  recommendationId: string,
) {
  const target = recommendations.find((entry) => entry.id === recommendationId);
  if (!target || target.status === "REJECTED") return Object.freeze([...recommendations]);
  const targetSlot = dailyFillerSlot(target);
  return Object.freeze(recommendations.map((entry) => {
    if (entry.id === recommendationId) return withStatus(entry, "ACCEPTED");
    const sameExplicitSlot = Boolean(target.slotId && entry.slotId === target.slotId);
    const sameDailySlot = target.proposedDayIndex !== undefined
      && entry.proposedDayIndex === target.proposedDayIndex
      && targetSlot !== null
      && dailyFillerSlot(entry) === targetSlot;
    return entry.status === "ACCEPTED" && (sameExplicitSlot || sameDailySlot)
      ? withStatus(entry, "REPLACED")
      : entry;
  }));
}

/** Public helper for UI/domain adapters that need the shared cafe/micro cap. */
export function recommendationFillerSlot(kind: FillerKind): DailyFillerSlot {
  return kind === "LUNCH" ? "LUNCH" : kind === "DINNER" ? "DINNER" : "MICRO";
}
