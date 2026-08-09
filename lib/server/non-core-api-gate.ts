export type CoreRecommendationApiFeature =
  | "hotel_recommendations"
  | "food_recommendations"
  | "route_recommendations";

export type NonCoreApiFeature = "trip_ideas";

type Environment = Readonly<Record<string, string | undefined>>;

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-TripCheck-Feature-Scope": "non-core",
};

const coreRecommendationHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-TripCheck-Feature-Scope": "core-recommendation",
};

export const CORE_RECOMMENDATION_FEATURE_FLAGS = Object.freeze({
  hotel_recommendations: "HOTEL_RECOMMENDATIONS_ENABLED",
  food_recommendations: "FOOD_RECOMMENDATIONS_ENABLED",
  route_recommendations: "ROUTE_RECOMMENDATIONS_ENABLED",
} satisfies Record<CoreRecommendationApiFeature, string>);

/**
 * Non-core provider routes are an explicit opt-in. NODE_ENV is deliberately
 * irrelevant: tests, previews and production all fail closed unless the same
 * server-side switch is set to the exact string "true".
 */
export function nonCoreApisEnabled(environment: Environment = process.env) {
  return environment.TRIPCHECK_NON_CORE_APIS_ENABLED === "true";
}

export function nonCoreApiGate(
  feature: NonCoreApiFeature,
  environment: Environment = process.env,
): Response | null {
  if (nonCoreApisEnabled(environment)) return null;
  return Response.json({
    code: "non_core_api_disabled",
    reason: "p0_core_only",
    feature,
  }, {
    status: 503,
    headers: noStoreHeaders,
  });
}

/**
 * v0.3 promotes contextual hotel, meal and route fillers to the core product.
 * They no longer depend on the broad experimental switch, but each retains a
 * route-specific emergency kill. Missing flags default on; the paid-provider
 * gateways still fail closed when D1, identity, origin or provider controls
 * are unavailable.
 */
export function coreRecommendationApiEnabled(
  feature: CoreRecommendationApiFeature,
  environment: Environment = process.env,
) {
  return environment[CORE_RECOMMENDATION_FEATURE_FLAGS[feature]] !== "false";
}

export function coreRecommendationApiGate(
  feature: CoreRecommendationApiFeature,
  environment: Environment = process.env,
): Response | null {
  if (coreRecommendationApiEnabled(feature, environment)) return null;
  return Response.json({
    code: "feature_disabled",
    reason: "operator_kill_switch",
    feature,
  }, {
    status: 503,
    headers: coreRecommendationHeaders,
  });
}
