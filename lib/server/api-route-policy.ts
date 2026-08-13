import type { ProviderCostOperation, ProviderCostProvider } from "./provider-cost-policy.ts";

/**
 * Every HTTP method the app exposes under `/api`, classified once.
 *
 * The Worker used to keep a paid-route table that only POSTs were looked up
 * in, so `GET /api/place-photo` — which spends a Google Places Photo event on
 * every call — never met the origin gate, the durable quota or the kill
 * switch. And the contract test only asserted the table had "at least eight"
 * entries, so deleting two of them stayed green.
 *
 * This manifest is exhaustive by construction:
 * `tests/api-route-policy-exhaustive.test.ts` diffs it against the exported
 * handlers under `app/api/**\/route.ts` and fails on any route-method that is
 * missing, extra, or misclassified. Adding a route without a decision here is
 * a build failure, not a silent hole in the cost boundary.
 */

export type ApiRouteClass =
  /** Spends a metered provider key. Must pass origin + durable quota. */
  | "paid"
  /** Reaches a keyless third party. Costs nothing but leaves the deployment. */
  | "free_public"
  /** Answered entirely from this deployment. */
  | "local";

export type ApiRouteOrigin =
  /** Rejected unless Origin and Sec-Fetch-Site say same-origin. */
  | "strict_same_origin"
  /**
   * Reached by `<img src>`, which cannot carry Origin or custom headers.
   * Authorised by a server-issued signature on the resource itself instead.
   */
  | "signed_resource"
  /** No provider spend behind it; the route's own handler guards it. */
  | "handler_guarded";

export type PaidFeatureFlagName =
  | "HOTEL_RECOMMENDATIONS_ENABLED"
  | "FOOD_RECOMMENDATIONS_ENABLED"
  | "ROUTE_RECOMMENDATIONS_ENABLED"
  | "ANTHROPIC_REQUESTS_ENABLED";

export type PaidFeatureFlag = Readonly<{
  name: PaidFeatureFlagName;
  /** `default-on` runs unless set to "false"; `explicit-on` needs "true". */
  mode: "default-on" | "explicit-on";
}>;

export type ApiRoutePolicy = Readonly<{
  method: "GET" | "POST";
  path: string;
  class: ApiRouteClass;
  provider?: ProviderCostProvider;
  operation?: ProviderCostOperation;
  featureFlags?: readonly PaidFeatureFlag[];
  origin: ApiRouteOrigin;
  cache: "no_store" | "private_short";
}>;

export type ApiRouteKey = `${"GET" | "POST"} ${string}`;

function route(policy: ApiRoutePolicy): readonly [ApiRouteKey, ApiRoutePolicy] {
  return [`${policy.method} ${policy.path}` as ApiRouteKey, Object.freeze(policy)];
}

const HOTEL_ON: readonly PaidFeatureFlag[] = Object.freeze([
  Object.freeze({ name: "HOTEL_RECOMMENDATIONS_ENABLED", mode: "default-on" } as const),
]);
const FOOD_ON: readonly PaidFeatureFlag[] = Object.freeze([
  Object.freeze({ name: "FOOD_RECOMMENDATIONS_ENABLED", mode: "default-on" } as const),
]);
const ROUTE_ON: readonly PaidFeatureFlag[] = Object.freeze([
  Object.freeze({ name: "ROUTE_RECOMMENDATIONS_ENABLED", mode: "default-on" } as const),
]);
const HOTEL_AI_ON: readonly PaidFeatureFlag[] = Object.freeze([
  Object.freeze({ name: "HOTEL_RECOMMENDATIONS_ENABLED", mode: "default-on" } as const),
  Object.freeze({ name: "ANTHROPIC_REQUESTS_ENABLED", mode: "explicit-on" } as const),
]);
const FOOD_AI_ON: readonly PaidFeatureFlag[] = Object.freeze([
  Object.freeze({ name: "FOOD_RECOMMENDATIONS_ENABLED", mode: "default-on" } as const),
  Object.freeze({ name: "ANTHROPIC_REQUESTS_ENABLED", mode: "explicit-on" } as const),
]);

export const API_ROUTE_POLICIES: Readonly<Record<ApiRouteKey, ApiRoutePolicy>> = Object.freeze(
  Object.fromEntries([
    route({ method: "POST", path: "/api/live-routes", class: "paid", provider: "google", operation: "live_routes", origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/place-suggestions", class: "paid", provider: "google", operation: "place_suggestions", origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/place-resolution", class: "paid", provider: "google", operation: "place_resolution", origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/place-intelligence", class: "paid", provider: "google", operation: "place_intelligence", origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/place-intelligence/fresh", class: "paid", provider: "anthropic", operation: "fresh_voices", origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/hotel-recommendations", class: "paid", provider: "google", operation: "hotel_recommendations", featureFlags: HOTEL_ON, origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/hotel-recommendations/ai", class: "paid", provider: "anthropic", operation: "hotel_ranking", featureFlags: HOTEL_AI_ON, origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/food-recommendations", class: "paid", provider: "google", operation: "food_recommendations", featureFlags: FOOD_ON, origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/food-recommendations/ai", class: "paid", provider: "anthropic", operation: "food_ranking", featureFlags: FOOD_AI_ON, origin: "strict_same_origin", cache: "no_store" }),
    route({ method: "POST", path: "/api/route-recommendations", class: "paid", provider: "google", operation: "route_recommendations", featureFlags: ROUTE_ON, origin: "strict_same_origin", cache: "no_store" }),
    // An `<img>` sends neither Origin nor a custom header, so this one is
    // authorised by the signature the server minted with the photo name.
    // The redirect is briefly cacheable so scrolling a card back into view
    // does not buy the same photo twice.
    route({ method: "GET", path: "/api/place-photo", class: "paid", provider: "google", operation: "place_photo", origin: "signed_resource", cache: "private_short" }),
    // Keyless third parties. They leave the deployment but cost nothing, and
    // each handler enforces its own same-origin check.
    route({ method: "POST", path: "/api/weather", class: "free_public", origin: "handler_guarded", cache: "no_store" }),
    route({ method: "POST", path: "/api/holidays", class: "free_public", origin: "handler_guarded", cache: "no_store" }),
    route({ method: "POST", path: "/api/link-preview", class: "free_public", origin: "handler_guarded", cache: "no_store" }),
    // Reached by an <img>, so like the photo route it authorises itself with
    // the signature this server minted rather than with an Origin header.
    route({ method: "GET", path: "/api/link-image", class: "free_public", origin: "signed_resource", cache: "private_short" }),
    // Answered from this deployment alone.
    route({ method: "GET", path: "/api/ai-status", class: "local", origin: "handler_guarded", cache: "no_store" }),
    route({ method: "POST", path: "/api/product-events", class: "local", origin: "handler_guarded", cache: "no_store" }),
  ]),
) as Readonly<Record<ApiRouteKey, ApiRoutePolicy>>;

export const API_ROUTE_KEYS = Object.freeze(Object.keys(API_ROUTE_POLICIES) as ApiRouteKey[]);

export function apiRoutePolicy(method: string, pathname: string): ApiRoutePolicy | undefined {
  return API_ROUTE_POLICIES[`${method} ${pathname}` as ApiRouteKey];
}

export function paidApiRoutePolicies(): readonly ApiRoutePolicy[] {
  return API_ROUTE_KEYS
    .map((key) => API_ROUTE_POLICIES[key])
    .filter((policy) => policy.class === "paid");
}
