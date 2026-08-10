import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  coreRecommendationApiEnabled,
  coreRecommendationApiGate,
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

test("core recommendations ignore unrelated environment flags but retain individual operator kills", async () => {
  assert.equal(coreRecommendationApiEnabled("hotel_recommendations", {}), true);
  assert.equal(coreRecommendationApiEnabled("food_recommendations", { SOME_UNRELATED_FLAG: "false" }), true);
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

test("enabled core routes reach input validation", async () => {
  const originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalAnthropicSwitch = process.env.ANTHROPIC_REQUESTS_ENABLED;
  const originalRouteSwitch = process.env.ROUTE_RECOMMENDATIONS_ENABLED;
  const originalHotelSwitch = process.env.HOTEL_RECOMMENDATIONS_ENABLED;
  const originalFoodSwitch = process.env.FOOD_RECOMMENDATIONS_ENABLED;
  process.env.HOTEL_RECOMMENDATIONS_ENABLED = "true";
  process.env.FOOD_RECOMMENDATIONS_ENABLED = "true";
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_REQUESTS_ENABLED = "true";
  process.env.ROUTE_RECOMMENDATIONS_ENABLED = "true";
  try {
    for (const [, handler] of coreRoutes) {
      const response = await handler(post());
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, "invalid_request");
    }
  } finally {
    restore("GOOGLE_PLACES_API_KEY", originalGoogleKey);
    restore("ANTHROPIC_API_KEY", originalAnthropicKey);
    restore("ANTHROPIC_REQUESTS_ENABLED", originalAnthropicSwitch);
    restore("ROUTE_RECOMMENDATIONS_ENABLED", originalRouteSwitch);
    restore("HOTEL_RECOMMENDATIONS_ENABLED", originalHotelSwitch);
    restore("FOOD_RECOMMENDATIONS_ENABLED", originalFoodSwitch);
  }
});
