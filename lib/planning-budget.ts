/**
 * Hard per-trip ceilings for paid planning facts.
 *
 * Once a ceiling is reached, the remaining fact stays unknown. Callers must
 * not replace it with a fabricated live value or start an unbounded pass.
 */
export const PLANNING_BUDGET = Object.freeze({
  routeEvents: 20,
  placeResolutions: 12,
  /**
   * Keyless lookups cost nothing per call, so the ceiling is about being a
   * polite client and a bounded request, not about money. Thirty names is a
   * full week's wishlist.
   */
  openPlaceResolutions: 30,
  openingHours: 10,
});

export function takeWithinPlanningBudget<T>(
  values: readonly T[],
  budget: number,
  alreadyUsed = 0,
) {
  const remaining = Math.max(0, Math.floor(budget) - Math.max(0, Math.floor(alreadyUsed)));
  return values.slice(0, remaining);
}

/**
 * How many places one trip may hold. The day-assignment search is exact
 * enough and fast enough (under a second) up to here; beyond it the answer
 * would be a rough grouping presented as a plan.
 */
export const MAX_WISHLIST_PLACES = 24;
