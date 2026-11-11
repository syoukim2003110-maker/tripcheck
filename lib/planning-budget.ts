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
