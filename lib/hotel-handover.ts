import { builtPlanTravelMinutes, plannerHardEditConflicts, type PlannerHardEditConflict } from "./planner-app-state.ts";
import type { BuiltTripPlan } from "./trip-builder.ts";
import type { PlannerLocale } from "./presentation/planner-copy.ts";

/**
 * Whether the planner may adopt a hotel on the traveller's behalf.
 *
 * The automatic shortlist used to be ranked on trip travel time alone and its
 * winner attached straight to the plan. A hotel that saved five minutes of
 * walking and made a booked museum entry five minutes late therefore won, was
 * applied without a word, and — because a system handover rebases history
 * rather than committing to it — did not even appear in Undo. Meanwhile the
 * traveller's own hotel swap ran the full simulate-then-confirm gate.
 *
 * Candidates are now scored against the whole trip through that same gate.
 * A candidate that breaks a fixed booking, drops a Must stop, misses an
 * airport cutoff or breaks verified opening hours is never chosen for the
 * traveller; it stays in the shortlist, where picking it asks first.
 */

/** An existing, working base is only worth disturbing for a real gain. */
export const HOTEL_REBASE_MIN_SAVED_MINUTES = 60;
export const HOTEL_REBASE_MIN_SAVED_RATIO = 0.15;

export type HotelCandidateEvaluation<T> = Readonly<{
  candidate: T;
  plan: BuiltTripPlan;
  travelMinutes: number;
  /** New hard damage this candidate would introduce. Empty means safe. */
  hardDamage: readonly PlannerHardEditConflict[];
  /** Hard conflicts in the current plan that this candidate removes. */
  resolvedHardConflicts: number;
  savedMinutes: number;
  savedRatio: number;
  safe: boolean;
}>;

export function rankHotelCandidates<T extends { id: string; score: number }>(input: Readonly<{
  currentPlan: BuiltTripPlan | null;
  locale: PlannerLocale;
  candidates: readonly Readonly<{ candidate: T; plan: BuiltTripPlan }>[];
}>): HotelCandidateEvaluation<T>[] {
  const currentTravelMinutes = input.currentPlan ? builtPlanTravelMinutes(input.currentPlan) : null;
  return input.candidates
    .map(({ candidate, plan }) => {
      const travelMinutes = builtPlanTravelMinutes(plan);
      const hardDamage = input.currentPlan
        ? plannerHardEditConflicts(input.currentPlan, plan, input.locale)
        : [];
      // Conflicts the candidate removes are exactly the damage the reverse
      // move would cause, so the same detector answers both questions.
      const resolvedHardConflicts = input.currentPlan
        ? plannerHardEditConflicts(plan, input.currentPlan, input.locale).length
        : 0;
      const savedMinutes = currentTravelMinutes === null ? 0 : currentTravelMinutes - travelMinutes;
      return {
        candidate,
        plan,
        travelMinutes,
        hardDamage,
        resolvedHardConflicts,
        savedMinutes,
        savedRatio: currentTravelMinutes ? savedMinutes / currentTravelMinutes : 0,
        safe: hardDamage.length === 0,
      };
    })
    .sort((left, right) => Number(right.safe) - Number(left.safe)
      || right.resolvedHardConflicts - left.resolvedHardConflicts
      || left.travelMinutes - right.travelMinutes
      || right.candidate.score - left.candidate.score
      || left.candidate.id.localeCompare(right.candidate.id));
}

/** The best candidate the planner may adopt with no question asked. */
export function safestHotelCandidate<T extends { id: string; score: number }>(
  evaluations: readonly HotelCandidateEvaluation<T>[],
) {
  return evaluations.find((evaluation) => evaluation.safe) ?? null;
}

/**
 * Whether replacing a base that already works is justified. A provisional or
 * absent base has nothing to lose and takes the first safe candidate; a base
 * that is already carrying the plan is only moved to fix real damage or to
 * save time the traveller would notice.
 */
export function hotelRebaseIsWorthwhile<T extends { id: string; score: number }>(
  evaluation: HotelCandidateEvaluation<T> | null,
  currentBaseIsProvisional: boolean,
) {
  if (!evaluation?.safe) return false;
  if (currentBaseIsProvisional) return true;
  return evaluation.resolvedHardConflicts > 0
    || evaluation.savedMinutes >= HOTEL_REBASE_MIN_SAVED_MINUTES
    || evaluation.savedRatio >= HOTEL_REBASE_MIN_SAVED_RATIO;
}
