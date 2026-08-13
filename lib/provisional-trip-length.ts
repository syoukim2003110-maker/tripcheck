import { buildTripFromWishlist, type BuiltTripPlan, type Pace, type TripPlannerContext } from "./trip-builder.ts";
import { assessTripFit } from "./trip-scenarios.ts";
import { clampTripDays, provisionalBaseAsResolved } from "./planner-app-state.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import type { PlannerLocale } from "./presentation/planner-copy.ts";

/**
 * Settles "how many days is this trip?" and "where does it start from?"
 * together, so the answer the traveller is shown is the answer their plan
 * actually produced.
 *
 * A trip with no typed hotel still routes through a deterministic provisional
 * base, and pays an outbound and an inbound transfer leg every day for it. The
 * minimum-day search used to run before that base existed: three Tokyo places
 * with a 09:00–16:00 window were offered "one day is enough", and the plan
 * built moments later — now carrying 75 minutes of hotel transfers — reported
 * a 45-minute overrun and a two-day minimum. The proposal and the result
 * contradicted each other on one screen.
 *
 * Day count and base are mutually dependent: more days spread the stops, which
 * can move the recommended area, which changes the daily transfer legs. The
 * loop below is a bounded fixed point over that pair. It is deterministic —
 * no provider call is involved — and whatever the last round agreed on is what
 * gets built.
 */
export const PROVISIONAL_TRIP_LENGTH_ROUNDS = 3;

export type ProvisionalTripLength = Readonly<{
  days: number;
  base: ResolvedInputStop | null;
  plan: BuiltTripPlan;
  /** True when the loop reached a self-consistent pair before running out. */
  settled: boolean;
  rounds: number;
}>;

export function resolveProvisionalTripLength(input: Readonly<{
  itinerary: string;
  requestedDays: number;
  daysUndecided: boolean;
  pace: Pace;
  locale: PlannerLocale;
  /** The traveller's own hotel, when place resolution produced one. */
  resolvedHotel: ResolvedInputStop | null;
  contextFor: (base: ResolvedInputStop | null) => TripPlannerContext;
}>): ProvisionalTripLength {
  const baseFor = (candidate: BuiltTripPlan) => input.resolvedHotel
    ?? (candidate.baseRecommendations[0]?.base
      ? provisionalBaseAsResolved(candidate.baseRecommendations[0].base)
      : null);

  let days = input.requestedDays;
  let plan = buildTripFromWishlist(input.itinerary, days, input.pace, input.locale, input.contextFor(input.resolvedHotel));
  let base = baseFor(plan);
  // The traveller named a length. It is theirs to keep; only the base is
  // derived, and the plan is rebuilt from it so nothing downstream sees a
  // context the day count was not measured against.
  if (!input.daysUndecided) {
    return {
      days,
      base,
      plan: buildTripFromWishlist(input.itinerary, days, input.pace, input.locale, input.contextFor(base)),
      settled: true,
      rounds: 0,
    };
  }

  let settled = false;
  let rounds = 0;
  for (let round = 0; round < PROVISIONAL_TRIP_LENGTH_ROUNDS; round += 1) {
    rounds = round + 1;
    const fit = assessTripFit(input.itinerary, days, input.pace, input.locale, input.contextFor(base));
    const proposed = fit.minimumDays ?? fit.partialMinimumDays;
    const nextDays = proposed === null ? days : clampTripDays(proposed);
    const nextPlan = buildTripFromWishlist(input.itinerary, nextDays, input.pace, input.locale, input.contextFor(base));
    const nextBase = baseFor(nextPlan);
    settled = nextDays === days && (nextBase?.id ?? null) === (base?.id ?? null);
    days = nextDays;
    base = nextBase;
    plan = nextPlan;
    if (settled) break;
  }

  return {
    days,
    base,
    // The base may have moved on the final round. Build from the pair that was
    // actually agreed, so the plan and the day count share one context.
    plan: buildTripFromWishlist(input.itinerary, days, input.pace, input.locale, input.contextFor(base)),
    settled,
    rounds,
  };
}
