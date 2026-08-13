/**
 * The one place a paid provider ceiling is written down.
 *
 * The durable D1 ledger and the process-local fail-safe used to carry their
 * own copy of every number, kept in step only by a comment. Nothing failed if
 * they drifted, so a single-digit edit on one side could raise the real spend
 * ceiling tenfold while every test stayed green. Both tables are now views of
 * this one, and `tests/provider-cost-policy.test.ts` pins the totals.
 *
 * Limits live in code only. There is deliberately no environment override: a
 * deployment can stop spending entirely through the kill switches, but it
 * cannot quietly raise a ceiling without a reviewed change to this file.
 *
 * Units are provider request-events, not currency. One unit is one billable
 * call to Google or Anthropic.
 */

export type ProviderCostProvider = "google" | "anthropic";

/**
 * Order matters: `PROVIDER_QUOTA_OPERATIONS` derives the D1 CHECK constraint
 * from this list, and the runtime migration compares the rendered SQL.
 */
export const PROVIDER_COST_OPERATIONS = [
  "live_routes",
  "place_resolution",
  "place_suggestions",
  "place_intelligence",
  "fresh_voices",
  "hotel_recommendations",
  "food_recommendations",
  "food_ranking",
  "hotel_ranking",
  "route_recommendations",
  "place_photo",
] as const;

export type ProviderCostOperation = (typeof PROVIDER_COST_OPERATIONS)[number];

export type ProviderCostPolicy = Readonly<{
  provider: ProviderCostProvider;
  /** Most units a single request may reserve at once. */
  maxPerRequest: number;
  /** One planning session's allowance for this operation. */
  maxPerTrip: number;
  /** Anonymous-browser session allowance, reset on each UTC day. */
  maxPerSessionDay: number;
  /** Deployment-wide daily ceiling — the actual cost guard. */
  maxPerDay: number;
  maxPerMonth: number;
}>;

/*
 * Sizing note (2026-08-10): one plan build alone can issue ~20 live-route
 * events and a handful of recommendation searches, and every edit rebuilds.
 * The original per-trip ceilings equalled ONE build, so a normal planning
 * session ended in 429 budget_exhausted and every downstream surface (meal
 * slots, transit evidence, hotel shortlists) looked broken. Per-trip and
 * per-session-day ceilings now cover a real planning session; the global
 * per-day/per-month rows remain the actual cost guard.
 */
export const PROVIDER_COST_POLICIES: Readonly<Record<ProviderCostOperation, ProviderCostPolicy>> = Object.freeze({
  live_routes: Object.freeze({
    provider: "google",
    maxPerRequest: 20,
    maxPerTrip: 120,
    maxPerSessionDay: 360,
    maxPerDay: 2_000,
    maxPerMonth: 20_000,
  }),
  place_resolution: Object.freeze({
    provider: "google",
    maxPerRequest: 12,
    maxPerTrip: 36,
    maxPerSessionDay: 108,
    maxPerDay: 1_200,
    maxPerMonth: 12_000,
  }),
  // Autocomplete is charged one event per accepted pause and must never draw
  // down place_resolution: an exhausted resolution budget breaks the build, an
  // exhausted suggestion budget only falls back to the Resolve step.
  place_suggestions: Object.freeze({
    provider: "google",
    maxPerRequest: 1,
    maxPerTrip: 60,
    maxPerSessionDay: 180,
    maxPerDay: 3_000,
    maxPerMonth: 30_000,
  }),
  place_intelligence: Object.freeze({
    provider: "google",
    maxPerRequest: 1,
    maxPerTrip: 30,
    maxPerSessionDay: 90,
    maxPerDay: 1_000,
    maxPerMonth: 10_000,
  }),
  fresh_voices: Object.freeze({
    provider: "anthropic",
    maxPerRequest: 2,
    maxPerTrip: 24,
    maxPerSessionDay: 48,
    maxPerDay: 192,
    maxPerMonth: 1_920,
  }),
  // A route-wide hotel recommendation can issue three Google searches and a
  // fourth fallback when the nearby search fails. Reserve that worst case so
  // an internal fallback can never escape the durable ceiling.
  hotel_recommendations: Object.freeze({
    provider: "google",
    maxPerRequest: 4,
    maxPerTrip: 60,
    maxPerSessionDay: 180,
    maxPerDay: 600,
    maxPerMonth: 6_000,
  }),
  // Nearby food discovery may make one bounded radius expansion; the ceiling
  // covers a fourteen-day trip's lunch+dinner slots with headroom for retries.
  food_recommendations: Object.freeze({
    provider: "google",
    maxPerRequest: 2,
    maxPerTrip: 112,
    maxPerSessionDay: 336,
    maxPerDay: 2_000,
    maxPerMonth: 20_000,
  }),
  food_ranking: Object.freeze({
    provider: "anthropic",
    maxPerRequest: 1,
    maxPerTrip: 28,
    maxPerSessionDay: 56,
    maxPerDay: 192,
    maxPerMonth: 1_920,
  }),
  hotel_ranking: Object.freeze({
    provider: "anthropic",
    maxPerRequest: 1,
    maxPerTrip: 12,
    maxPerSessionDay: 24,
    maxPerDay: 96,
    maxPerMonth: 960,
  }),
  // Search Along Route can fall back to the two route endpoints. Reserve all
  // three searches even when the first one is sufficient.
  route_recommendations: Object.freeze({
    provider: "google",
    maxPerRequest: 3,
    maxPerTrip: 84,
    maxPerSessionDay: 168,
    maxPerDay: 300,
    maxPerMonth: 9_000,
  }),
  // Places Photo media. One unit is one photo fetched for one card; a trip
  // shows a hotel shortlist, meal cards and inspector photos, and the redirect
  // is briefly cacheable so scrolling back does not re-bill the same image.
  place_photo: Object.freeze({
    provider: "google",
    maxPerRequest: 1,
    maxPerTrip: 150,
    maxPerSessionDay: 450,
    maxPerDay: 3_000,
    maxPerMonth: 30_000,
  }),
});

/** Total units this deployment may spend with one provider in a UTC day. */
export function providerDailyCeilingUnits(provider: ProviderCostProvider) {
  return PROVIDER_COST_OPERATIONS.reduce(
    (total, operation) => (PROVIDER_COST_POLICIES[operation].provider === provider
      ? total + PROVIDER_COST_POLICIES[operation].maxPerDay
      : total),
    0,
  );
}
