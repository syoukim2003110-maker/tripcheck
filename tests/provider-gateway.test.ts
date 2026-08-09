import assert from "node:assert/strict";
import test from "node:test";
import {
  PAID_OPERATION_POLICIES,
  PROCESS_LOCAL_QUOTA_METADATA,
  PaidProviderGateway,
  ProcessLocalProviderLedger,
  paidApiDenialResponse,
  type PaidOperationPolicies,
} from "../lib/server/provider-gateway.ts";

function policies(overrides: Partial<PaidOperationPolicies["live_routes"]> = {}): PaidOperationPolicies {
  return {
    ...PAID_OPERATION_POLICIES,
    live_routes: {
      provider: "google",
      maxPerRequest: 2,
      maxPerTrip: 3,
      maxPerSession: 4,
      maxPerProcessDay: 5,
      ...overrides,
    },
  };
}

function request(headers: Record<string, string> = {}) {
  return new Request("https://tripcheck.test/api/live-routes", {
    method: "POST",
    headers,
  });
}

test("the process-local ledger atomically enforces request, trip, session and day ceilings", () => {
  const configured = policies();
  const ledger = new ProcessLocalProviderLedger({
    now: () => Date.parse("2026-08-09T12:00:00.000Z"),
    policies: configured,
  });

  assert.deepEqual(ledger.reserve({ provider: "google", operation: "live_routes", units: 3, sessionId: "session-a", tripId: "trip-a" }), {
    ok: false,
    reason: "request_cap",
  });
  const first = ledger.reserve({ provider: "google", operation: "live_routes", units: 2, sessionId: "session-a", tripId: "trip-a" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(ledger.settle(first.reservation.id, 1), true);
  assert.equal(ledger.settle(first.reservation.id, 1), false, "settlement is idempotent");

  assert.equal(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-a", tripId: "trip-a" }).ok, true);
  assert.deepEqual(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-a", tripId: "trip-a" }), {
    ok: false,
    reason: "trip_cap",
  });
  assert.equal(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-a", tripId: "trip-b" }).ok, true);
  assert.deepEqual(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-a", tripId: "trip-c" }), {
    ok: false,
    reason: "session_cap",
  });
  assert.equal(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-b", tripId: "trip-c" }).ok, true);
  assert.deepEqual(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-c", tripId: "trip-d" }), {
    ok: false,
    reason: "process_day_cap",
  });

  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.metadata, PROCESS_LOCAL_QUOTA_METADATA);
  assert.equal(snapshot.counters.find((entry) => entry.scope === "process_day")?.used, 5);
  assert.equal(snapshot.counters.find((entry) => entry.scope === "process_day")?.failures, 1);
  assert.equal(snapshot.activeReservationCount, 3, "successful calls remain active until their handlers settle them");
});

test("parallel reservations cannot race past a trip ceiling within one process", async () => {
  const configured = policies({ maxPerRequest: 1, maxPerTrip: 10, maxPerSession: 10, maxPerProcessDay: 10 });
  const ledger = new ProcessLocalProviderLedger({ policies: configured });
  const results = await Promise.all(Array.from({ length: 40 }, async () => ledger.reserve({
    provider: "google",
    operation: "live_routes",
    units: 1,
    sessionId: "same-session",
    tripId: "same-trip",
  })));
  assert.equal(results.filter((result) => result.ok).length, 10);
  assert.equal(results.filter((result) => !result.ok).length, 30);
  assert.equal(ledger.snapshot().counters.find((entry) => entry.scope === "process_day")?.used, 10);
});

test("old UTC-day counters are pruned while current-day saturation fails closed", () => {
  let now = Date.parse("2026-08-09T23:59:00.000Z");
  const configured = policies({ maxPerRequest: 1, maxPerTrip: 2, maxPerSession: 2, maxPerProcessDay: 2 });
  const ledger = new ProcessLocalProviderLedger({ now: () => now, policies: configured, maxEntries: 3 });
  assert.equal(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-a", tripId: "trip-a" }).ok, true);
  assert.deepEqual(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-b", tripId: "trip-b" }), {
    ok: false,
    reason: "ledger_saturated",
  });

  now = Date.parse("2026-08-10T00:01:00.000Z");
  assert.equal(ledger.reserve({ provider: "google", operation: "live_routes", units: 1, sessionId: "session-b", tripId: "trip-b" }).ok, true);
  assert.ok(ledger.snapshot().counters.every((entry) => entry.day === "2026-08-10"));
});

test("production preflight requires both matching Origin and same-origin Fetch Metadata", () => {
  const gateway = new PaidProviderGateway({ environment: { NODE_ENV: "production", TRIPCHECK_PUBLIC_ORIGIN: "https://tripcheck.test" } });
  const accepted = gateway.preflight(request({ Origin: "https://tripcheck.test", "Sec-Fetch-Site": "same-origin" }), "google");
  assert.equal(accepted.ok, true);

  const invalidHeaders: Array<Record<string, string>> = [
    { "Sec-Fetch-Site": "same-origin" },
    { Origin: "https://tripcheck.test" },
    { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" },
    { Origin: "not a URL", "Sec-Fetch-Site": "same-origin" },
  ];
  for (const headers of invalidHeaders) {
    const denied = gateway.preflight(request(headers), "google");
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.code, "forbidden");
  }
});

test("global and provider kill switches fail closed without reserving quota", () => {
  const global = new PaidProviderGateway({ environment: { NODE_ENV: "test", TRIPCHECK_PAID_API_DISABLED: "true" } });
  const globalResult = global.preflight(request(), "google");
  assert.equal(globalResult.ok, false);
  if (!globalResult.ok) assert.equal(globalResult.code, "paid_api_disabled");

  const google = new PaidProviderGateway({ environment: { NODE_ENV: "test", TRIPCHECK_GOOGLE_API_DISABLED: "1" } });
  const googleResult = google.preflight(request(), "google");
  assert.equal(googleResult.ok, false);
  if (!googleResult.ok) assert.equal(googleResult.code, "provider_disabled");

  const anthropic = new PaidProviderGateway({ environment: { NODE_ENV: "test", TRIPCHECK_ANTHROPIC_API_DISABLED: "yes" } });
  const anthropicResult = anthropic.preflight(request(), "anthropic");
  assert.equal(anthropicResult.ok, false);
  if (!anthropicResult.ok) assert.equal(anthropicResult.code, "provider_disabled");
});

test("default identity issues a bounded anonymous HttpOnly cookie without storing request text", () => {
  const configured = policies();
  const ledger = new ProcessLocalProviderLedger({ policies: configured });
  const gateway = new PaidProviderGateway({
    environment: { NODE_ENV: "production", TRIPCHECK_PUBLIC_ORIGIN: "https://tripcheck.test" },
    policies: configured,
    ledger,
    createAnonymousId: () => "12345678-1234-1234-1234-123456789abc",
    now: () => Date.parse("2026-08-09T12:00:00.000Z"),
  });
  const preflight = gateway.preflight(request({
    Origin: "https://tripcheck.test",
    "Sec-Fetch-Site": "same-origin",
    "X-Private-Note": "Hotel reservation Secret-123",
  }), "google");
  assert.equal(preflight.ok, true);
  if (!preflight.ok) return;
  const access = gateway.reserve(preflight, "live_routes", 1);
  assert.equal(access.ok, true);
  if (!access.ok) return;
  assert.match(access.headers["Set-Cookie"], /^tc_paid_session=12345678123412341234123456789abc;/);
  assert.match(access.headers["Set-Cookie"], /HttpOnly/);
  assert.match(access.headers["Set-Cookie"], /SameSite=Lax/);
  assert.match(access.headers["Set-Cookie"], /Secure/);
  assert.doesNotMatch(JSON.stringify(ledger.snapshot()), /Hotel reservation|Secret-123/i);
  access.complete();
});

test("gateway reservations expose explicit non-durable metadata and count bounded failures", async () => {
  const configured = policies();
  const ledger = new ProcessLocalProviderLedger({ policies: configured });
  const gateway = new PaidProviderGateway({
    environment: { NODE_ENV: "test" },
    policies: configured,
    ledger,
    identityResolver: () => ({
      sessionId: "person@example.com",
      tripId: "Hotel Reservation ABC-123",
    }),
  });
  const preflight = gateway.preflight(request(), "google");
  assert.equal(preflight.ok, true);
  if (!preflight.ok) return;

  const overCap = gateway.reserve(preflight, "live_routes", 3);
  assert.equal(overCap.ok, false);
  if (!overCap.ok) assert.equal(overCap.code, "request_cap_exceeded");

  const access = gateway.reserve(preflight, "live_routes", 2);
  assert.equal(access.ok, true);
  if (!access.ok) return;
  assert.equal(access.headers["X-TripCheck-Quota-Scope"], "process-local");
  assert.equal(access.headers["X-TripCheck-Quota-Durable"], "false");
  assert.equal(access.headers["X-TripCheck-Quota-Cross-Instance"], "false");
  assert.equal(access.complete({ failedUnits: 7 }), true, "failed units are clamped to reserved units");
  assert.equal(access.complete({ failedUnits: 1 }), false);

  const serialized = JSON.stringify(ledger.snapshot());
  assert.doesNotMatch(serialized, /person@example|Hotel Reservation|ABC-123/i);
  assert.equal(ledger.snapshot().counters.find((entry) => entry.scope === "process_day")?.failures, 2);

  const denial = globalThis.Response
    ? await paidApiDenialResponse({ ok: false, code: "budget_exhausted", status: 429, reason: "trip_cap", headers: {} }).json()
    : null;
  assert.deepEqual(denial?.quota, PROCESS_LOCAL_QUOTA_METADATA);
});
