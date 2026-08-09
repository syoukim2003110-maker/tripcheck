import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_QUOTA_SCHEMA_SQL } from "../db/provider-quota-schema.ts";
import {
  DURABLE_PROVIDER_QUOTA_POLICIES,
  createDurableProviderQuotaEnforcer,
  enforceDurableProviderQuota,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1RunResultLike,
  type DurableProviderQuotaRequest,
  type DurableQuotaPolicies,
} from "../lib/server/durable-provider-quota.ts";

type StoredCounter = {
  provider: string;
  operation: string;
  scope: string;
  subjectHash: string;
  bucket: string;
  used: number;
  failures: number;
  limit: number;
  updatedAt: number;
};

class FakeStatement implements D1PreparedStatementLike {
  readonly sql: string;
  readonly database: FakeD1;
  bindings: unknown[] = [];

  constructor(database: FakeD1, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values: unknown[]) {
    const bound = new FakeStatement(this.database, this.sql);
    bound.bindings = values;
    return bound;
  }

  run() {
    return this.database.run(this);
  }
}

class FakeD1 implements D1DatabaseLike {
  rows = new Map<string, StoredCounter>();
  batchCalls: FakeStatement[][] = [];
  schemaRuns = 0;
  failSchema = false;
  failBatches = false;
  private transactionTail: Promise<void> = Promise.resolve();

  prepare(query: string) {
    return new FakeStatement(this, query);
  }

  async run(statement: FakeStatement): Promise<D1RunResultLike> {
    if (this.failSchema) throw new Error("D1 unavailable");
    if (statement.sql === PROVIDER_QUOTA_SCHEMA_SQL) {
      this.schemaRuns += 1;
      return { success: true, results: [] };
    }
    throw new Error("unexpected direct statement");
  }

  batch(statements: D1PreparedStatementLike[]) {
    const concrete = statements as FakeStatement[];
    this.batchCalls.push(concrete);
    const execute = async () => {
      if (this.failBatches) throw new Error("D1 unavailable");
      const nextRows = new Map([...this.rows].map(([key, row]) => [key, { ...row }]));
      const results: D1RunResultLike[] = [];
      for (const statement of concrete) {
        if (statement.sql.startsWith("INSERT INTO provider_quota_counters")) {
          results.push(this.reserve(nextRows, statement.bindings));
        } else if (statement.sql.startsWith("UPDATE provider_quota_counters")) {
          results.push(this.recordFailure(nextRows, statement.bindings));
        } else {
          throw new Error("unexpected batch statement");
        }
      }
      this.rows = nextRows;
      return results;
    };
    const result = this.transactionTail.then(execute, execute);
    this.transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private reserve(rows: Map<string, StoredCounter>, bindings: unknown[]): D1RunResultLike {
    const [provider, operation, scope, subjectHash, bucket, units, limit, updatedAt] = bindings;
    assert.equal(typeof provider, "string");
    assert.equal(typeof operation, "string");
    assert.equal(typeof scope, "string");
    assert.match(String(subjectHash), /^[0-9a-f]{64}$/);
    assert.equal(typeof bucket, "string");
    assert.equal(typeof units, "number");
    assert.equal(typeof limit, "number");
    assert.equal(typeof updatedAt, "number");
    const key = [provider, operation, scope, subjectHash, bucket].join("|");
    const existing = rows.get(key);
    const used = (existing?.used ?? 0) + Number(units);
    if (used > Number(limit)) {
      throw new Error("CHECK constraint failed: provider_quota_used_within_limit");
    }
    rows.set(key, {
      provider: String(provider),
      operation: String(operation),
      scope: String(scope),
      subjectHash: String(subjectHash),
      bucket: String(bucket),
      used,
      failures: existing?.failures ?? 0,
      limit: Number(limit),
      updatedAt: Number(updatedAt),
    });
    return { success: true, results: [{ used_count: used, hard_limit: Number(limit) }] };
  }

  private recordFailure(rows: Map<string, StoredCounter>, bindings: unknown[]): D1RunResultLike {
    const [failures, updatedAt, provider, operation, scope, subjectHash, bucket] = bindings;
    const key = [provider, operation, scope, subjectHash, bucket].join("|");
    const row = rows.get(key);
    if (row) {
      row.failures = Math.min(row.used, row.failures + Number(failures));
      row.updatedAt = Number(updatedAt);
    }
    return { success: true, results: [] };
  }
}

const secret = "test-only-quota-secret-with-32-bytes-minimum";
const baseRequest: DurableProviderQuotaRequest = {
  provider: "google",
  operation: "live_routes",
  units: 1,
  anonymousSessionId: "session_00000001",
  tripId: "trip_00000001",
};

function policies(overrides: Partial<DurableQuotaPolicies["live_routes"]> = {}): DurableQuotaPolicies {
  return {
    ...DURABLE_PROVIDER_QUOTA_POLICIES,
    live_routes: {
      provider: "google",
      maxPerRequest: 1,
      maxPerTrip: 2,
      maxPerSessionDay: 3,
      maxPerDay: 4,
      maxPerMonth: 5,
      ...overrides,
    },
    place_resolution: {
      provider: "google",
      maxPerRequest: 1,
      maxPerTrip: 1,
      maxPerSessionDay: 1,
      maxPerDay: 1,
      maxPerMonth: 1,
    },
    place_intelligence: {
      provider: "google",
      maxPerRequest: 1,
      maxPerTrip: 1,
      maxPerSessionDay: 1,
      maxPerDay: 1,
      maxPerMonth: 1,
    },
    fresh_voices: {
      provider: "anthropic",
      maxPerRequest: 1,
      maxPerTrip: 1,
      maxPerSessionDay: 1,
      maxPerDay: 1,
      maxPerMonth: 1,
    },
  };
}

function environment(overrides: Record<string, string | undefined> = {}) {
  return { TRIPCHECK_QUOTA_HASH_SECRET: secret, ...overrides };
}

test("schema keeps only constrained opaque counters and uses CHECK for atomic cap rollback", () => {
  assert.match(PROVIDER_QUOTA_SCHEMA_SQL, /subject_hash TEXT NOT NULL/);
  assert.match(PROVIDER_QUOTA_SCHEMA_SQL, /length\(subject_hash\) = 64/);
  assert.match(PROVIDER_QUOTA_SCHEMA_SQL, /provider_quota_used_within_limit/);
  assert.match(PROVIDER_QUOTA_SCHEMA_SQL, /used_count <= hard_limit/);
  assert.doesNotMatch(PROVIDER_QUOTA_SCHEMA_SQL, /itinerary|place_name|hotel|reservation|travel_date/i);
});

test("request cap rejects before schema initialization or a D1 reservation", async () => {
  const db = new FakeD1();
  const enforce = createDurableProviderQuotaEnforcer({ policies: policies() });
  const result = await enforce({ ...baseRequest, units: 2 }, db, environment());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "request_cap_exceeded");
    assert.equal(result.status, 429);
  }
  assert.equal(db.schemaRuns, 0);
  assert.equal(db.batchCalls.length, 0);
});

test("trip, anonymous-session, UTC-day and UTC-month limits each fail closed", async (t) => {
  await t.test("trip", async () => {
    const db = new FakeD1();
    const enforce = createDurableProviderQuotaEnforcer({ policies: policies({ maxPerTrip: 1, maxPerSessionDay: 10, maxPerDay: 10, maxPerMonth: 10 }) });
    assert.equal((await enforce(baseRequest, db, environment())).ok, true);
    const denied = await enforce(baseRequest, db, environment());
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.code, "budget_exhausted");
  });

  await t.test("anonymous session per UTC day", async () => {
    const db = new FakeD1();
    const enforce = createDurableProviderQuotaEnforcer({ policies: policies({ maxPerTrip: 1, maxPerSessionDay: 2, maxPerDay: 10, maxPerMonth: 10 }) });
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await enforce({ ...baseRequest, tripId: `trip_session_${index}` }, db, environment())).ok, true);
    }
    const denied = await enforce({ ...baseRequest, tripId: "trip_session_2" }, db, environment());
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.code, "budget_exhausted");
  });

  await t.test("global UTC day", async () => {
    const db = new FakeD1();
    const enforce = createDurableProviderQuotaEnforcer({ policies: policies({ maxPerTrip: 1, maxPerSessionDay: 1, maxPerDay: 2, maxPerMonth: 10 }) });
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await enforce({ ...baseRequest, anonymousSessionId: `session_day_${index}`, tripId: `trip_day_${index}` }, db, environment())).ok, true);
    }
    const denied = await enforce({ ...baseRequest, anonymousSessionId: "session_day_2", tripId: "trip_day_2" }, db, environment());
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.code, "budget_exhausted");
  });

  await t.test("global UTC month across day buckets", async () => {
    const db = new FakeD1();
    let now = Date.parse("2026-08-09T12:00:00.000Z");
    const enforce = createDurableProviderQuotaEnforcer({
      policies: policies({ maxPerTrip: 1, maxPerSessionDay: 1, maxPerDay: 2, maxPerMonth: 3 }),
      now: () => now,
    });
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await enforce({ ...baseRequest, anonymousSessionId: `session_month_a_${index}`, tripId: `trip_month_a_${index}` }, db, environment())).ok, true);
    }
    now = Date.parse("2026-08-10T12:00:00.000Z");
    assert.equal((await enforce({ ...baseRequest, anonymousSessionId: "session_month_b_0", tripId: "trip_month_b_0" }, db, environment())).ok, true);
    const denied = await enforce({ ...baseRequest, anonymousSessionId: "session_month_b_1", tripId: "trip_month_b_1" }, db, environment());
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.code, "budget_exhausted");
  });
});

test("missing, unconfigured, or unavailable D1 fails closed", async () => {
  const missing = await enforceDurableProviderQuota(baseRequest, null, environment());
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "quota_store_unavailable");

  const missingSecret = await enforceDurableProviderQuota(baseRequest, new FakeD1(), {});
  assert.equal(missingSecret.ok, false);
  if (!missingSecret.ok) assert.equal(missingSecret.code, "quota_store_unavailable");

  const unavailableSchema = new FakeD1();
  unavailableSchema.failSchema = true;
  const schemaResult = await enforceDurableProviderQuota(baseRequest, unavailableSchema, environment());
  assert.equal(schemaResult.ok, false);
  if (!schemaResult.ok) assert.equal(schemaResult.code, "quota_store_unavailable");

  const unavailableBatch = new FakeD1();
  unavailableBatch.failBatches = true;
  const batchResult = await enforceDurableProviderQuota(baseRequest, unavailableBatch, environment());
  assert.equal(batchResult.ok, false);
  if (!batchResult.ok) assert.equal(batchResult.code, "quota_store_unavailable");
});

test("global and provider kill switches deny without touching D1", async () => {
  for (const [request, env] of [
    [baseRequest, environment({ TRIPCHECK_PAID_API_DISABLED: "true" })],
    [baseRequest, environment({ TRIPCHECK_GOOGLE_API_DISABLED: "1" })],
    [{ ...baseRequest, provider: "anthropic", operation: "fresh_voices" }, environment({ TRIPCHECK_ANTHROPIC_API_DISABLED: "yes" })],
  ] as const) {
    const db = new FakeD1();
    const result = await enforceDurableProviderQuota(request, db, env);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.code, /disabled$/);
    assert.equal(db.schemaRuns, 0);
    assert.equal(db.batchCalls.length, 0);
  }
});

test("one four-statement D1 batch reserves all scopes and runtime init is coalesced", async () => {
  const db = new FakeD1();
  const enforce = createDurableProviderQuotaEnforcer({ policies: policies({ maxPerTrip: 5, maxPerSessionDay: 5, maxPerDay: 5, maxPerMonth: 5 }) });
  const first = await enforce(baseRequest, db, environment());
  assert.equal(first.ok, true);
  assert.equal(db.schemaRuns, 1);
  assert.equal(db.batchCalls.length, 1);
  assert.equal(db.batchCalls[0].length, 4);
  assert.deepEqual(db.batchCalls[0].map((statement) => statement.bindings[2]), ["trip", "session", "day", "month"]);
  assert.equal(first.headers["X-TripCheck-Quota-Durable"], "true");
  assert.equal(first.headers["X-TripCheck-Quota-Cross-Instance"], "true");

  assert.equal((await enforce({ ...baseRequest, tripId: "trip_00000002" }, db, environment())).ok, true);
  assert.equal(db.schemaRuns, 1);
  assert.equal(db.batchCalls.length, 2);
});

test("only opaque hashes and operational counters reach D1; failures remain charged", async () => {
  const db = new FakeD1();
  const enforce = createDurableProviderQuotaEnforcer({ policies: policies({ maxPerTrip: 1, maxPerSessionDay: 5, maxPerDay: 5, maxPerMonth: 5 }) });
  const privateInput = {
    ...baseRequest,
    itinerary: "Senso-ji then private reservation ABC-123",
    place: "Secret place",
    hotel: "Private hotel",
    travelDate: "2031-04-05",
  } as DurableProviderQuotaRequest & Record<string, string | number>;
  const access = await enforce(privateInput, db, environment());
  assert.equal(access.ok, true);
  if (!access.ok) return;
  assert.equal(await access.complete({ failedUnits: 99 }), true);
  assert.equal(await access.complete({ failedUnits: 1 }), false, "completion is locally idempotent");

  const serialized = JSON.stringify({
    rows: [...db.rows.values()],
    bindings: db.batchCalls.map((batch) => batch.map((statement) => statement.bindings)),
  });
  assert.doesNotMatch(serialized, /Senso-ji|reservation|Secret place|Private hotel|2031-04-05|session_00000001|trip_00000001/i);
  assert.ok([...db.rows.values()].every((row) => /^[0-9a-f]{64}$/.test(row.subjectHash)));
  assert.ok([...db.rows.values()].every((row) => row.used === 1 && row.failures === 1));

  const stillCharged = await enforce(baseRequest, db, environment());
  assert.equal(stillCharged.ok, false);
  if (!stillCharged.ok) assert.equal(stillCharged.code, "budget_exhausted");
});

test("serialized D1 batch semantics admit only one concurrent reservation at the cap", async () => {
  const db = new FakeD1();
  const enforce = createDurableProviderQuotaEnforcer({ policies: policies({ maxPerTrip: 1, maxPerSessionDay: 1, maxPerDay: 1, maxPerMonth: 1 }) });
  const results = await Promise.all([
    enforce(baseRequest, db, environment()),
    enforce(baseRequest, db, environment()),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.code === "budget_exhausted").length, 1);
  assert.equal(db.batchCalls.length, 2);
  assert.ok(db.batchCalls.every((batch) => batch.length === 4));
  assert.equal(db.rows.size, 4);
  assert.ok([...db.rows.values()].every((row) => row.used === 1));
});
