export type CoreRecommendationApiFeature =
  | "hotel_recommendations"
  | "food_recommendations"
  | "route_recommendations";

type Environment = Readonly<Record<string, string | undefined>>;

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
