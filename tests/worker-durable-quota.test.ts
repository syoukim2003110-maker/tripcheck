import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResultLike,
} from "../lib/server/durable-provider-quota.ts";
import { googleProviderCircuit } from "../lib/server/provider-resilience.ts";
import { PROVIDER_QUOTA_SCHEMA_SQL, PROVIDER_QUOTA_TABLE_INFO_SQL } from "../db/provider-quota-schema.ts";

type AppFetch = (request: Request, env: unknown, context: unknown) => Promise<Response>;
const testGlobal = globalThis as typeof globalThis & { __tripCheckAppFetch?: AppFetch };
testGlobal.__tripCheckAppFetch = async () => Response.json({ delegated: true });

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "vinext/server/app-router-entry") {
      return { url: "tripcheck-test:app-router", shortCircuit: true };
    }
    if (specifier === "vinext/server/image-optimization") {
      return { url: "tripcheck-test:image-optimization", shortCircuit: true };
    }
    if (specifier === "../lib/security-headers" && context.parentURL?.endsWith("/worker/index.ts")) {
      return nextResolve(new URL("../lib/security-headers.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "tripcheck-test:app-router") {
      return {
        format: "module",
        source: "export default { fetch(request, env, context) { return globalThis.__tripCheckAppFetch(request, env, context); } };",
        shortCircuit: true,
      };
    }
    if (url === "tripcheck-test:image-optimization") {
      return {
        format: "module",
        source: "export const DEFAULT_DEVICE_SIZES = []; export const DEFAULT_IMAGE_SIZES = []; export async function handleImageOptimization() { throw new Error('not used'); }",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

type WorkerHandler = {
  fetch(request: Request, env: WorkerTestEnvironment, context: WorkerTestContext): Promise<Response>;
};

const { default: worker } = await import(new URL("../worker/index.ts", import.meta.url).href) as { default: WorkerHandler };
hooks.deregister();

class WorkerTestStatement implements D1PreparedStatementLike {
  readonly database: WorkerTestD1;
  readonly sql: string;
  bindings: unknown[] = [];

  constructor(database: WorkerTestD1, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values: unknown[]) {
    const statement = new WorkerTestStatement(this.database, this.sql);
    statement.bindings = values;
    return statement;
  }

  run(): Promise<D1RunResultLike> {
    if (this.sql === PROVIDER_QUOTA_TABLE_INFO_SQL) {
      return Promise.resolve({ success: true, results: [{ sql: PROVIDER_QUOTA_SCHEMA_SQL }] });
    }
    this.database.schemaRuns += 1;
    return Promise.resolve({ success: true, results: [] });
  }
}

class WorkerTestD1 implements D1DatabaseLike {
  schemaRuns = 0;
  batches: WorkerTestStatement[][] = [];

  prepare(query: string) {
    return new WorkerTestStatement(this, query);
  }

  async batch(statements: D1PreparedStatementLike[]) {
    const concrete = statements as WorkerTestStatement[];
    this.batches.push(concrete);
    return concrete.map((statement) => ({
      success: true,
      results: [{
        used_count: Number(statement.bindings[5] ?? 1),
        hard_limit: Number(statement.bindings[6] ?? 20),
      }],
    }));
  }
}

class DenySecondReservationD1 extends WorkerTestD1 {
  private reservationCount = 0;

  override async batch(statements: D1PreparedStatementLike[]) {
    const concrete = statements as WorkerTestStatement[];
    if (concrete[0]?.sql.includes("INSERT INTO provider_quota_counters")) {
      this.reservationCount += 1;
      if (this.reservationCount === 2) {
        this.batches.push(concrete);
        throw new Error("CHECK constraint failed: provider_quota_used_within_limit");
      }
    }
    return super.batch(statements);
  }
}

type WorkerTestEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: WorkerTestD1;
  IMAGES: never;
  TRIPCHECK_PUBLIC_ORIGIN?: string;
  TRIPCHECK_QUOTA_HASH_SECRET?: string;
  TRIPCHECK_PAID_API_DISABLED?: string;
  TRIPCHECK_GOOGLE_API_DISABLED?: string;
  TRIPCHECK_ANTHROPIC_API_DISABLED?: string;
  HOTEL_RECOMMENDATIONS_ENABLED?: string;
  FOOD_RECOMMENDATIONS_ENABLED?: string;
  ROUTE_RECOMMENDATIONS_ENABLED?: string;
  ANTHROPIC_REQUESTS_ENABLED?: string;
};

type WorkerTestContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

const context: WorkerTestContext = {
  waitUntil() {},
  passThroughOnException() {},
};

function environment(db?: WorkerTestD1): WorkerTestEnvironment {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: db,
    IMAGES: undefined as never,
    TRIPCHECK_PUBLIC_ORIGIN: "https://tripcheck.test",
    TRIPCHECK_QUOTA_HASH_SECRET: "worker-test-secret-that-is-at-least-32-characters",
    ANTHROPIC_REQUESTS_ENABLED: "true",
  };
}

function paidPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://tripcheck.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tripcheck.test",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("paid paths fail closed before the application handler when D1 is missing", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ shouldNotRun: true });
  };
  const response = await worker.fetch(paidPost("/api/live-routes", { legs: [{}] }), environment(), context);
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, "quota_store_unavailable");
  assert.equal(appCalls, 0);
  assert.equal(response.headers.get("X-TripCheck-Quota-Durable"), "false");
  assert.equal(response.headers.get("X-TripCheck-Quota-Scope"), "durable-d1");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("all core paid paths reserve the expected provider operation and conservative provider-event count", async () => {
  testGlobal.__tripCheckAppFetch = async () => Response.json({ delegated: true });
  const cases = [
    ["/api/live-routes", { legs: [{ private: "A" }, { private: "B" }] }, "google", "live_routes", 2],
    // Typing must never draw down the budget the build depends on, so
    // autocomplete is charged to its own operation.
    ["/api/place-suggestions", { query: "Private place text", languageCode: "en", destination: "auto" }, "google", "place_suggestions", 1],
    ["/api/place-resolution", { queries: ["Private place A", "Private place B"], hotelQuery: "Private hotel" }, "google", "place_resolution", 3],
    ["/api/place-intelligence", { name: "Private place" }, "google", "place_intelligence", 1],
    ["/api/place-intelligence/fresh", { name: "Private place", depth: "deep" }, "anthropic", "fresh_voices", 2],
    ["/api/hotel-recommendations", { area: "Private area", query: "" }, "google", "hotel_recommendations", 4],
    ["/api/food-recommendations", { area: "Private meal area" }, "google", "food_recommendations", 2],
    ["/api/food-recommendations/ai", { area: "Private meal area", candidates: [{ name: "Private food" }] }, "anthropic", "food_ranking", 1],
    ["/api/route-recommendations", { routePoints: [{ private: "A" }, { private: "B" }] }, "google", "route_recommendations", 3],
  ] as const;

  for (const [path, body, provider, operation, units] of cases) {
    const db = new WorkerTestD1();
    const response = await worker.fetch(paidPost(path, body), environment(db), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-TripCheck-Quota-Durable"), "true");
    assert.equal(response.headers.get("X-TripCheck-Quota-Scope"), "durable-d1");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(response.headers.get("Set-Cookie") ?? "", /^tc_paid_session=/);
    assert.equal(db.batches.length, 1);
    assert.equal(db.batches[0].length, 4);
    for (const statement of db.batches[0]) {
      assert.equal(statement.bindings[0], provider);
      assert.equal(statement.bindings[1], operation);
      assert.equal(statement.bindings[5], units);
    }
    const persistedInputs = JSON.stringify(db.batches[0].map((statement) => statement.bindings));
    assert.doesNotMatch(persistedInputs, /Private place|Private hotel|Private area|Private meal|Private food|"A"|"B"/i);
  }
});

test("a named hotel search is charged as one focused provider event", async () => {
  testGlobal.__tripCheckAppFetch = async () => Response.json({ delegated: true });
  const db = new WorkerTestD1();
  const response = await worker.fetch(paidPost("/api/hotel-recommendations", {
    area: "Private area",
    query: "Private named hotel",
  }), environment(db), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-TripCheck-Quota-Charged-Units"), "1");
  assert.ok(db.batches[0].every((statement) => statement.bindings[1] === "hotel_recommendations" && statement.bindings[5] === 1));
  assert.doesNotMatch(JSON.stringify(db.batches[0].map((statement) => statement.bindings)), /Private named hotel|Private area/i);
});

function exactOverrides(count: number) {
  return Array.from({ length: count }, (_, inputIndex) => ({
    inputIndex,
    input: `Private exact input ${inputIndex}`,
    providerRef: `ChIJ_exact_${inputIndex}`,
  }));
}

test("exact-only place resolution charges every validated provider choice", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ delegated: true });
  };
  const db = new WorkerTestD1();
  const response = await worker.fetch(paidPost("/api/place-resolution", {
    queries: [],
    providerOverrides: exactOverrides(3),
    hotelQuery: null,
  }), environment(db), context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-TripCheck-Quota-Charged-Units"), "3");
  assert.equal(appCalls, 1);
  assert.equal(db.batches.length, 1);
  assert.ok(db.batches[0].every((statement) => statement.bindings[5] === 3));
  const persistedInputs = JSON.stringify(db.batches[0].map((statement) => statement.bindings));
  assert.doesNotMatch(persistedInputs, /Private exact input|ChIJ_exact/i);
});

test("queries, exact choices and hotel can consume exactly twelve units", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ delegated: true });
  };
  const db = new WorkerTestD1();
  const response = await worker.fetch(paidPost("/api/place-resolution", {
    queries: ["Private query A", "Private query B"],
    providerOverrides: exactOverrides(9),
    hotelQuery: "Private hotel",
  }), environment(db), context);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-TripCheck-Quota-Charged-Units"), "12");
  assert.equal(appCalls, 1);
  assert.ok(db.batches[0].every((statement) => statement.bindings[5] === 12));
});

test("an aggregate of thirteen place provider events is denied before D1 or application access", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ shouldNotRun: true });
  };
  const db = new WorkerTestD1();
  const response = await worker.fetch(paidPost("/api/place-resolution", {
    queries: ["Private query A", "Private query B"],
    providerOverrides: exactOverrides(10),
    hotelQuery: "Private hotel",
  }), environment(db), context);

  assert.equal(response.status, 429);
  assert.equal((await response.json() as { code: string }).code, "request_cap_exceeded");
  assert.equal(appCalls, 0);
  assert.equal(db.schemaRuns, 0);
  assert.equal(db.batches.length, 0);
});

test("malformed provider overrides cannot bypass or distort place-resolution quota", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ shouldNotRun: true });
  };
  const invalidOverrides: unknown[] = [
    "not-an-array",
    [{ inputIndex: 0, input: "Missing ID" }],
    [{ inputIndex: 0, input: "Bad ID", providerRef: "https://maps.example/place" }],
    [
      { inputIndex: 0, input: "First", providerRef: "ChIJ_first" },
      { inputIndex: 0, input: "Duplicate", providerRef: "ChIJ_second" },
    ],
  ];

  for (const providerOverrides of invalidOverrides) {
    const db = new WorkerTestD1();
    const response = await worker.fetch(paidPost("/api/place-resolution", {
      queries: [],
      providerOverrides,
      hotelQuery: null,
    }), environment(db), context);
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "invalid_request");
    assert.equal(db.schemaRuns, 0);
    assert.equal(db.batches.length, 0);
  }
  assert.equal(appCalls, 0);
});

test("Worker forwards only opaque quota identity headers and preserves the application response", async () => {
  let forwardedSession = "";
  let forwardedTrip = "";
  testGlobal.__tripCheckAppFetch = async (request) => {
    forwardedSession = request.headers.get("X-TripCheck-Session") ?? "";
    forwardedTrip = request.headers.get("X-TripCheck-Trip") ?? "";
    return Response.json({ delegated: true }, { headers: { "X-App-Header": "kept" } });
  };
  const db = new WorkerTestD1();
  const response = await worker.fetch(paidPost("/api/place-intelligence", { name: "not persisted" }), environment(db), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { delegated: true });
  assert.equal(response.headers.get("X-App-Header"), "kept");
  assert.match(forwardedSession, /^[A-Za-z0-9_-]{8,128}$/);
  assert.match(forwardedTrip, /^[A-Za-z0-9_-]{8,128}$/);
  assert.doesNotMatch(forwardedSession + forwardedTrip, /not persisted/i);
});

test("a Google retry receives a second durable reservation and preserves the same opaque identity", async () => {
  googleProviderCircuit.reset();
  const sessions: string[] = [];
  const trips: string[] = [];
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async (request) => {
    appCalls += 1;
    sessions.push(request.headers.get("X-TripCheck-Session") ?? "");
    trips.push(request.headers.get("X-TripCheck-Trip") ?? "");
    return appCalls === 1
      ? Response.json({ code: "unavailable" }, { status: 502 })
      : Response.json({ recovered: true });
  };
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const db = new WorkerTestD1();
    const response = await worker.fetch(paidPost("/api/place-intelligence", { name: "not persisted" }), environment(db), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recovered: true });
    assert.equal(appCalls, 2);
    const reservationBatches = db.batches.filter((batch) => batch[0]?.sql.includes("INSERT INTO provider_quota_counters"));
    const failureBatches = db.batches.filter((batch) => batch[0]?.sql.includes("UPDATE provider_quota_counters"));
    assert.equal(reservationBatches.length, 2, "each provider attempt must reserve D1 quota independently");
    assert.equal(failureBatches.length, 1, "the failed first attempt must be recorded separately");
    assert.ok(reservationBatches.every((batch) => batch.every((statement) => statement.bindings[5] === 1)));
    assert.equal(new Set(sessions).size, 1);
    assert.equal(new Set(trips).size, 1);
    assert.equal(googleProviderCircuit.snapshot().failureRate, 0.5);
    assert.equal(googleProviderCircuit.snapshot().state, "closed");
  } finally {
    Math.random = originalRandom;
    googleProviderCircuit.reset();
  }
});

test("a denied retry reservation never reaches Google or crosses the durable ceiling", async () => {
  googleProviderCircuit.reset();
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ code: "unavailable" }, { status: 502 });
  };
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const db = new DenySecondReservationD1();
    const response = await worker.fetch(paidPost("/api/place-intelligence", { name: "not persisted" }), environment(db), context);
    assert.equal(response.status, 502, "the original provider failure is retained");
    assert.equal(appCalls, 1, "a retry without durable authorization must not delegate");
    const reservationBatches = db.batches.filter((batch) => batch[0]?.sql.includes("INSERT INTO provider_quota_counters"));
    assert.equal(reservationBatches.length, 2, "the second atomic reservation was attempted and denied");
  } finally {
    Math.random = originalRandom;
    googleProviderCircuit.reset();
  }
});

test("origin and kill-switch denials retain edge security headers and never delegate", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return new Response("unexpected");
  };
  const db = new WorkerTestD1();
  const crossSite = await worker.fetch(paidPost("/api/place-intelligence", {}, {
    Origin: "https://evil.test",
    "Sec-Fetch-Site": "cross-site",
  }), environment(db), context);
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.headers.get("X-Frame-Options"), "DENY");

  const killedEnv = environment(db);
  killedEnv.TRIPCHECK_PAID_API_DISABLED = "true";
  const killed = await worker.fetch(paidPost("/api/place-intelligence", {}), killedEnv, context);
  assert.equal(killed.status, 503);
  assert.equal((await killed.json() as { code: string }).code, "paid_api_disabled");
  assert.equal(killed.headers.get("X-Frame-Options"), "DENY");

  const featureKilledEnv = environment(db);
  featureKilledEnv.FOOD_RECOMMENDATIONS_ENABLED = "false";
  const featureKilled = await worker.fetch(paidPost("/api/food-recommendations", { area: "Private meal area" }), featureKilledEnv, context);
  assert.equal(featureKilled.status, 503);
  assert.equal((await featureKilled.json() as { code: string }).code, "feature_disabled");
  assert.equal(featureKilled.headers.get("X-TripCheck-Feature-Scope"), "core-recommendation");
  assert.equal(featureKilled.headers.get("X-Frame-Options"), "DENY");
  assert.equal(appCalls, 0);
  assert.equal(db.batches.length, 0);
});
