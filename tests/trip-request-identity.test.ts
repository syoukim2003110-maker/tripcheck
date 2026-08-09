import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createTripRequestIdentity,
  TRIP_REQUEST_HEADER,
  TRIP_REQUEST_STORAGE_KEY,
} from "../lib/trip-request-identity.ts";
import { requestPlaceResolution } from "../lib/place-resolution-client.ts";
import {
  requestFreshVoices,
  requestPlaceIntelligence,
} from "../lib/place-intelligence-client.ts";
import {
  fetchPlanningTransitEvidence,
  type PlanningTransitLegRequest,
} from "../lib/planning-live-routes-client.ts";
import type { RouteStop } from "../lib/route-optimizer.ts";

function tokenSequence(...tokens: string[]) {
  let index = 0;
  return () => tokens[Math.min(index++, tokens.length - 1)];
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem(key: string) { return values.get(key) ?? null; },
      setItem(key: string, value: string) { values.set(key, value); },
    },
  };
}

test("one planning run keeps a stable opaque token and restores it from session storage", () => {
  const persisted = memoryStorage();
  const first = createTripRequestIdentity({
    storage: () => persisted.storage,
    generateToken: tokenSequence("trip_aaaaaaaaaaaaaaaa", "trip_bbbbbbbbbbbbbbbb"),
  });
  assert.equal(first.currentToken(), "trip_aaaaaaaaaaaaaaaa");
  assert.equal(first.currentToken(), "trip_aaaaaaaaaaaaaaaa");
  assert.equal(persisted.values.get(TRIP_REQUEST_STORAGE_KEY), "trip_aaaaaaaaaaaaaaaa");

  const reloaded = createTripRequestIdentity({
    storage: () => persisted.storage,
    generateToken: () => "trip_cccccccccccccccc",
  });
  assert.equal(reloaded.currentToken(), "trip_aaaaaaaaaaaaaaaa");
});

test("rotation produces a new token without changing public/user content", () => {
  const persisted = memoryStorage();
  const identity = createTripRequestIdentity({
    storage: () => persisted.storage,
    generateToken: tokenSequence("trip_first0000000000", "trip_second000000000"),
  });
  const first = identity.currentToken();
  const second = identity.rotateToken();
  assert.notEqual(second, first);
  assert.equal(second, "trip_second000000000");
  assert.equal(persisted.values.get(TRIP_REQUEST_STORAGE_KEY), second);
});

test("invalid persisted content is ignored and never becomes a request header", () => {
  const persisted = memoryStorage({ [TRIP_REQUEST_STORAGE_KEY]: "raw itinerary: Secret hotel" });
  const identity = createTripRequestIdentity({
    storage: () => persisted.storage,
    generateToken: () => "trip_clean00000000000",
  });
  const headers = identity.headers({ "Content-Type": "application/json" });
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get(TRIP_REQUEST_HEADER), "trip_clean00000000000");
  assert.equal(persisted.values.get(TRIP_REQUEST_STORAGE_KEY), "trip_clean00000000000");
});

test("sessionStorage failures fall back to a stable in-memory identity", () => {
  const identity = createTripRequestIdentity({
    storage: () => ({
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    }),
    generateToken: tokenSequence("trip_memory000000000", "trip_rotated00000000"),
  });
  assert.equal(identity.currentToken(), "trip_memory000000000");
  assert.equal(identity.currentToken(), "trip_memory000000000");
  assert.equal(identity.headers().get(TRIP_REQUEST_HEADER), "trip_memory000000000");
  assert.equal(identity.rotateToken(), "trip_rotated00000000");
});

test("all paid planning clients send the same trip header and planning uses the narrow scope", async () => {
  const calls: Array<{ url: string; tripToken: string | null; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : {};
    calls.push({
      url,
      tripToken: new Headers(init?.headers).get(TRIP_REQUEST_HEADER),
      body,
    });

    if (url === "/api/place-resolution") {
      return Response.json({
        provider: "google_maps",
        fetchedAt: "2026-08-09T00:00:00.000Z",
        places: [],
        hotel: null,
        ambiguous: [],
      });
    }
    if (url === "/api/place-intelligence") {
      return Response.json({ provider: "google_places", checkedAt: "2026-08-09T00:00:00.000Z" });
    }
    if (url === "/api/place-intelligence/fresh") {
      return Response.json({ provider: "anthropic_web_search", checkedAt: "2026-08-09T00:00:00.000Z" });
    }
    if (url === "/api/live-routes") {
      return Response.json({
        provider: "google_maps",
        fetchedAt: "2026-08-09T00:00:00.000Z",
        legs: [{
          id: "transit-0",
          status: "ok",
          durationMinutes: 18,
          distanceMeters: 5_000,
          encodedPolyline: null,
          transferCount: 1,
        }],
      });
    }
    return Response.json({ code: "unexpected_test_endpoint" }, { status: 500 });
  }) as typeof fetch;

  globalThis.fetch = fakeFetch;
  try {
    await requestPlaceResolution("Synthetic identity venue", "", "en");
    const stop: RouteStop = {
      id: "google-synthetic",
      providerRef: "synthetic",
      name: "Synthetic identity venue",
      area: "Tokyo",
      latitude: 35.68,
      longitude: 139.76,
      sourceUrl: "https://example.test/place",
      verifiedAt: "2026-08-09",
      confidence: "medium",
      planningDurationMinutes: 60,
      isAnchor: false,
    };
    await requestPlaceIntelligence(stop, "en");
    await requestFreshVoices(stop, "en");

    const transitRequest: PlanningTransitLegRequest = {
      legId: "origin::destination",
      mode: "transit",
      departureTime: "2026-09-14T09:00:00+09:00",
      departureBucket: "2026-09-14T00:00:00.000Z",
      requestKey: "transit|origin::destination|2026-09-14T00:00:00.000Z",
      origin: { latitude: 35.68, longitude: 139.76 },
      destination: { latitude: 35.71, longitude: 139.78 },
      factIds: ["route:Day 1:origin:destination"],
    };
    await fetchPlanningTransitEvidence([transitRequest], "en", { fetcher: fakeFetch });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls.map((call) => call.url), [
    "/api/place-resolution",
    "/api/place-intelligence",
    "/api/place-intelligence/fresh",
    "/api/live-routes",
  ]);
  const tokens = calls.map((call) => call.tripToken);
  assert.ok(tokens.every((token) => token && /^trip_[A-Za-z0-9_-]+$/.test(token)));
  assert.equal(new Set(tokens).size, 1);
  assert.equal(calls.find((call) => call.url === "/api/place-intelligence")?.body.scope, "planning");
  assert.equal(calls.find((call) => call.url === "/api/place-intelligence/fresh")?.body.scope, undefined);
});

test("trip lifecycle rotation and provisional live-route preservation stay wired", () => {
  const appSource = readFileSync(new URL("../app/TripPlannerApp.tsx", import.meta.url), "utf8");
  const mapSource = readFileSync(new URL("../app/PlannerGoogleMap.tsx", import.meta.url), "utf8");

  assert.match(appSource, /const applySharedTripInput = useCallback\([^]*?=> \{\s*rotateTripRequestToken\(\);/);
  assert.match(appSource, /function loadDemo\([^]*?\) \{\s*rotateTripRequestToken\(\);/);
  assert.match(appSource, /function resetTrip\(\) \{\s*rotateTripRequestToken\(\);/);
  assert.match(
    appSource,
    /routeRequestsPaused=\{!tripDateTouched \|\| Boolean\(plan && !currentTransitConvergence\)\}/,
  );

  const finalDraftStart = appSource.indexOf("const finalDraft = buildTripFromWishlist(");
  const resetStart = appSource.indexOf("function resetTrip()", finalDraftStart);
  assert.ok(finalDraftStart >= 0 && resetStart > finalDraftStart);
  const finalCommitSource = appSource.slice(finalDraftStart, resetStart);
  assert.doesNotMatch(finalCommitSource, /setLive(?:Transit|Walking|Driving)\(measured/);
  assert.doesNotMatch(finalCommitSource, /attemptedLegKeysRef\.current\s*=/);

  assert.match(
    mapSource,
    /fetch\("\/api\/live-routes", \{[^]*?headers: tripRequestHeaders\(\{ "Content-Type": "application\/json" \}\)/,
  );
});
