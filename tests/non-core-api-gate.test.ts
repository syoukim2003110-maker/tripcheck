import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  coreRecommendationApiEnabled,
  coreRecommendationApiGate,
  nonCoreApiGate,
  nonCoreApisEnabled,
} from "../lib/server/non-core-api-gate.ts";

const routeHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const match = specifier.match(/^(?:\.\.\/){3,4}lib\/(.+)$/);
    if (match && context.parentURL?.includes("/app/api/")) {
      return nextResolve(new URL(`../lib/${match[1]}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

type PostHandler = (request: Request) => Promise<Response>;
const coreRoutes = [
  ["hotel_recommendations", (await import(new URL("../app/api/hotel-recommendations/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
  ["food_recommendations", (await import(new URL("../app/api/food-recommendations/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
  ["food_recommendations", (await import(new URL("../app/api/food-recommendations/ai/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
  ["route_recommendations", (await import(new URL("../app/api/route-recommendations/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
] as const;
const tripIdeasRoute = (await import(new URL("../app/api/trip-ideas/route.ts", import.meta.url).href) as { POST: PostHandler }).POST;
routeHooks.deregister();

function post() {
  return new Request("https://tripcheck.test/api/non-core", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tripcheck.test",
      "Sec-Fetch-Site": "same-origin",
    },
    body: "{}",
  });
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("only the exact server-side true value enables non-core APIs", () => {
  assert.equal(nonCoreApisEnabled({}), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "false" }), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "TRUE" }), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "1" }), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "true" }), true);
  assert.equal(nonCoreApiGate("trip_ideas", { TRIPCHECK_NON_CORE_APIS_ENABLED: "true" }), null);
});

test("trip ideas remains non-core and fails closed before reading input or calling a provider", async () => {
  const originalSwitch = process.env.TRIPCHECK_NON_CORE_APIS_ENABLED;
  const originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.TRIPCHECK_NON_CORE_APIS_ENABLED;
  process.env.GOOGLE_PLACES_API_KEY = "must-not-be-used";
  process.env.ANTHROPIC_API_KEY = "must-not-be-used";
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  }) as typeof fetch;
  try {
    const response = await tripIdeasRoute(post());
    const body = await response.json() as { code: string; reason: string; feature: string };
    assert.equal(response.status, 503);
    assert.deepEqual(body, {
      code: "non_core_api_disabled",
      reason: "p0_core_only",
      feature: "trip_ideas",
    });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("X-TripCheck-Feature-Scope"), "non-core");
    assert.equal(providerCalls, 0);
  } finally {
    restore("TRIPCHECK_NON_CORE_APIS_ENABLED", originalSwitch);
    restore("GOOGLE_PLACES_API_KEY", originalGoogleKey);
    restore("ANTHROPIC_API_KEY", originalAnthropicKey);
    globalThis.fetch = originalFetch;
  }
});

test("core recommendations ignore the broad experiment gate but retain individual operator kills", async () => {
  assert.equal(coreRecommendationApiEnabled("hotel_recommendations", {}), true);
  assert.equal(coreRecommendationApiEnabled("food_recommendations", { TRIPCHECK_NON_CORE_APIS_ENABLED: "false" }), true);
  assert.equal(coreRecommendationApiEnabled("route_recommendations", { ROUTE_RECOMMENDATIONS_ENABLED: "false" }), false);
  assert.equal(coreRecommendationApiGate("hotel_recommendations", { HOTEL_RECOMMENDATIONS_ENABLED: "true" }), null);

  const previous = {
    hotel: process.env.HOTEL_RECOMMENDATIONS_ENABLED,
    food: process.env.FOOD_RECOMMENDATIONS_ENABLED,
    route: process.env.ROUTE_RECOMMENDATIONS_ENABLED,
  };
  process.env.HOTEL_RECOMMENDATIONS_ENABLED = "false";
  process.env.FOOD_RECOMMENDATIONS_ENABLED = "false";
  process.env.ROUTE_RECOMMENDATIONS_ENABLED = "false";
  try {
    for (const [feature, handler] of coreRoutes) {
      const response = await handler(post());
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        code: "feature_disabled",
        reason: "operator_kill_switch",
        feature,
      });
      assert.equal(response.headers.get("X-TripCheck-Feature-Scope"), "core-recommendation");
    }
  } finally {
    restore("HOTEL_RECOMMENDATIONS_ENABLED", previous.hotel);
    restore("FOOD_RECOMMENDATIONS_ENABLED", previous.food);
    restore("ROUTE_RECOMMENDATIONS_ENABLED", previous.route);
  }
});

test("enabled core routes and trip ideas reach input validation", async () => {
  const originalSwitch = process.env.TRIPCHECK_NON_CORE_APIS_ENABLED;
  const originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalAnthropicSwitch = process.env.ANTHROPIC_REQUESTS_ENABLED;
  const originalRouteSwitch = process.env.ROUTE_RECOMMENDATIONS_ENABLED;
  const originalHotelSwitch = process.env.HOTEL_RECOMMENDATIONS_ENABLED;
  const originalFoodSwitch = process.env.FOOD_RECOMMENDATIONS_ENABLED;
  process.env.TRIPCHECK_NON_CORE_APIS_ENABLED = "true";
  process.env.HOTEL_RECOMMENDATIONS_ENABLED = "true";
  process.env.FOOD_RECOMMENDATIONS_ENABLED = "true";
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_REQUESTS_ENABLED = "true";
  process.env.ROUTE_RECOMMENDATIONS_ENABLED = "true";
  try {
    for (const handler of [tripIdeasRoute, ...coreRoutes.map(([, route]) => route)]) {
      const response = await handler(post());
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, "invalid_request");
    }
  } finally {
    restore("TRIPCHECK_NON_CORE_APIS_ENABLED", originalSwitch);
    restore("GOOGLE_PLACES_API_KEY", originalGoogleKey);
    restore("ANTHROPIC_API_KEY", originalAnthropicKey);
    restore("ANTHROPIC_REQUESTS_ENABLED", originalAnthropicSwitch);
    restore("ROUTE_RECOMMENDATIONS_ENABLED", originalRouteSwitch);
    restore("HOTEL_RECOMMENDATIONS_ENABLED", originalHotelSwitch);
    restore("FOOD_RECOMMENDATIONS_ENABLED", originalFoodSwitch);
  }
});
