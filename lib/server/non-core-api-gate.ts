export type NonCoreApiFeature =
  | "hotel_recommendations"
  | "food_recommendations"
  | "trip_ideas"
  | "route_recommendations";

type Environment = Readonly<Record<string, string | undefined>>;

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-TripCheck-Feature-Scope": "non-core",
};

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
