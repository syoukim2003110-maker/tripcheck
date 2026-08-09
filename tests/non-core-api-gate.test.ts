import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { nonCoreApiGate, nonCoreApisEnabled } from "../lib/server/non-core-api-gate.ts";

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
const routes = [
  ["hotel_recommendations", (await import(new URL("../app/api/hotel-recommendations/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
  ["food_recommendations", (await import(new URL("../app/api/food-recommendations/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
  ["food_recommendations", (await import(new URL("../app/api/food-recommendations/ai/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
  ["trip_ideas", (await import(new URL("../app/api/trip-ideas/route.ts", import.meta.url).href) as { POST: PostHandler }).POST],
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

test("only the exact server-side true value enables non-core APIs", () => {
  assert.equal(nonCoreApisEnabled({}), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "false" }), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "TRUE" }), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "1" }), false);
  assert.equal(nonCoreApisEnabled({ TRIPCHECK_NON_CORE_APIS_ENABLED: "true" }), true);
  assert.equal(nonCoreApiGate("hotel_recommendations", { TRIPCHECK_NON_CORE_APIS_ENABLED: "true" }), null);
});

test("all non-core routes fail closed before reading input or calling a provider", async () => {
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
    for (const [feature, handler] of routes) {
      const response = await handler(post());
      const body = await response.json() as { code: string; reason: string; feature: string };
      assert.equal(response.status, 503);
      assert.deepEqual(body, {
        code: "non_core_api_disabled",
        reason: "p0_core_only",
        feature,
      });
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
      assert.equal(response.headers.get("X-TripCheck-Feature-Scope"), "non-core");
    }
    assert.equal(providerCalls, 0);
  } finally {
    restore("TRIPCHECK_NON_CORE_APIS_ENABLED", originalSwitch);
    restore("GOOGLE_PLACES_API_KEY", originalGoogleKey);
    restore("ANTHROPIC_API_KEY", originalAnthropicKey);
    globalThis.fetch = originalFetch;
  }
});

test("route tests must explicitly enable non-core APIs", async () => {
  const originalSwitch = process.env.TRIPCHECK_NON_CORE_APIS_ENABLED;
  const originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalAnthropicSwitch = process.env.ANTHROPIC_REQUESTS_ENABLED;
  const originalRouteSwitch = process.env.ROUTE_RECOMMENDATIONS_ENABLED;
  process.env.TRIPCHECK_NON_CORE_APIS_ENABLED = "true";
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_REQUESTS_ENABLED = "true";
  delete process.env.ROUTE_RECOMMENDATIONS_ENABLED;
  try {
    for (const [, handler] of routes) {
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
  }
});
