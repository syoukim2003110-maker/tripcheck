import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// App routes use extensionless bundler imports. Resolve only app/api -> lib
// edges so the real handlers can be exercised by Node's strip-types runner.
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
const { POST: postLiveRoutes } = await import(new URL("../app/api/live-routes/route.ts", import.meta.url).href) as { POST: PostHandler };
const { POST: postPlaceResolution } = await import(new URL("../app/api/place-resolution/route.ts", import.meta.url).href) as { POST: PostHandler };
const { POST: postPlaceIntelligence } = await import(new URL("../app/api/place-intelligence/route.ts", import.meta.url).href) as { POST: PostHandler };
const { POST: postFreshVoices } = await import(new URL("../app/api/place-intelligence/fresh/route.ts", import.meta.url).href) as { POST: PostHandler };
routeHooks.deregister();

const handlers = [postLiveRoutes, postPlaceResolution, postPlaceIntelligence, postFreshVoices];

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://tripcheck.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("the global kill switch blocks every integrated paid route before provider access", async () => {
  const originalSwitch = process.env.TRIPCHECK_PAID_API_DISABLED;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  process.env.TRIPCHECK_PAID_API_DISABLED = "true";
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  }) as typeof fetch;
  try {
    for (const handler of handlers) {
      const response = await handler(post("/api/test", {}));
      const body = await response.json() as { code: string; quota: { globallyDurable: boolean } };
      assert.equal(response.status, 503);
      assert.equal(body.code, "paid_api_disabled");
      assert.equal(body.quota.globallyDurable, false);
      assert.equal(response.headers.get("X-TripCheck-Quota-Scope"), "process-local");
      assert.equal(response.headers.get("X-TripCheck-Quota-Durable"), "false");
    }
    assert.equal(providerCalls, 0);
  } finally {
    restore("TRIPCHECK_PAID_API_DISABLED", originalSwitch);
    globalThis.fetch = originalFetch;
  }
});

test("provider switches independently block Google and Anthropic route families", async () => {
  const originalGoogle = process.env.TRIPCHECK_GOOGLE_API_DISABLED;
  const originalAnthropic = process.env.TRIPCHECK_ANTHROPIC_API_DISABLED;
  process.env.TRIPCHECK_GOOGLE_API_DISABLED = "true";
  process.env.TRIPCHECK_ANTHROPIC_API_DISABLED = "true";
  try {
    for (const handler of [postLiveRoutes, postPlaceResolution, postPlaceIntelligence]) {
      const response = await handler(post("/api/test", {}));
      assert.equal(response.status, 503);
      assert.equal((await response.json() as { code: string }).code, "provider_disabled");
    }
    const anthropic = await postFreshVoices(post("/api/test", {}));
    assert.equal(anthropic.status, 503);
    assert.equal((await anthropic.json() as { code: string }).code, "provider_disabled");
  } finally {
    restore("TRIPCHECK_GOOGLE_API_DISABLED", originalGoogle);
    restore("TRIPCHECK_ANTHROPIC_API_DISABLED", originalAnthropic);
  }
});

test("production handlers require matching Origin and Sec-Fetch-Site before reading paid inputs", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPublicOrigin = process.env.TRIPCHECK_PUBLIC_ORIGIN;
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  mutableEnvironment.NODE_ENV = "production";
  process.env.TRIPCHECK_PUBLIC_ORIGIN = "https://tripcheck.test";
  try {
    for (const handler of handlers) {
      const missingFetchMetadata = await handler(post("/api/test", {}, { Origin: "https://tripcheck.test" }));
      assert.equal(missingFetchMetadata.status, 403);
      const crossSite = await handler(post("/api/test", {}, {
        Origin: "https://evil.test",
        "Sec-Fetch-Site": "cross-site",
      }));
      assert.equal(crossSite.status, 403);
    }
  } finally {
    restore("NODE_ENV", originalNodeEnv);
    restore("TRIPCHECK_PUBLIC_ORIGIN", originalPublicOrigin);
  }
});

test("place resolution counts the optional hotel inside the twelve-event request cap", async () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("provider must not be called for an over-cap request");
  }) as typeof fetch;
  try {
    const response = await postPlaceResolution(post("/api/place-resolution", {
      queries: Array.from({ length: 12 }, (_, index) => `Synthetic place ${index}`),
      hotelQuery: "Synthetic hotel",
      languageCode: "en",
      destination: "auto",
    }));
    const body = await response.json() as { code: string; reason: string; quota: { globallyDurable: boolean } };
    assert.equal(response.status, 429);
    assert.equal(body.code, "request_cap_exceeded");
    assert.equal(body.reason, "request_cap");
    assert.equal(body.quota.globallyDurable, false);
    assert.equal(providerCalls, 0);
  } finally {
    restore("GOOGLE_PLACES_API_KEY", originalKey);
    globalThis.fetch = originalFetch;
  }
});

test("an entirely unavailable live-route batch is retryable at the Worker boundary", async () => {
  const originalRoutesKey = process.env.GOOGLE_ROUTES_API_KEY;
  const originalPlacesKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_ROUTES_API_KEY = "test-key";
  delete process.env.GOOGLE_PLACES_API_KEY;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response("provider unavailable", { status: 503 });
  }) as typeof fetch;
  try {
    const response = await postLiveRoutes(post("/api/live-routes", {
      legs: [{
        id: "leg-1",
        origin: { latitude: 35.6812, longitude: 139.7671 },
        destination: { latitude: 35.7101, longitude: 139.8107 },
        departureTime: "2026-08-10T01:00:00.000Z",
      }],
      languageCode: "en",
      travelMode: "TRANSIT",
    }));
    const body = await response.json() as { legs: Array<{ status: string }> };
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("X-TripCheck-Provider-Failed-Units"), "1");
    assert.deepEqual(body.legs.map((leg) => leg.status), ["unavailable"]);
    assert.equal(providerCalls, 1, "the origin performs one attempt; the Worker owns retry policy");
  } finally {
    restore("GOOGLE_ROUTES_API_KEY", originalRoutesKey);
    restore("GOOGLE_PLACES_API_KEY", originalPlacesKey);
    globalThis.fetch = originalFetch;
  }
});
