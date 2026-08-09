import { PROVIDER_QUOTA_SCHEMA_SQL } from "../../db/provider-quota-schema.ts";

export type DurableQuotaProvider = "google" | "anthropic";
export type DurableQuotaOperation =
  | "live_routes"
  | "place_resolution"
  | "place_intelligence"
  | "fresh_voices"
  | "hotel_recommendations"
  | "food_recommendations"
  | "food_ranking"
  | "route_recommendations";
export type DurableQuotaScope = "trip" | "session" | "day" | "month";

export type DurableQuotaPolicy = Readonly<{
  provider: DurableQuotaProvider;
  maxPerRequest: number;
  maxPerTrip: number;
  /** Anonymous-browser session allowance, reset on each UTC day. */
  maxPerSessionDay: number;
  maxPerDay: number;
  maxPerMonth: number;
}>;

export type DurableQuotaPolicies = Readonly<Record<DurableQuotaOperation, DurableQuotaPolicy>>;

export const DURABLE_PROVIDER_QUOTA_POLICIES: DurableQuotaPolicies = Object.freeze({
  live_routes: Object.freeze({
    provider: "google",
    maxPerRequest: 20,
    maxPerTrip: 20,
    maxPerSessionDay: 60,
    maxPerDay: 2_000,
    maxPerMonth: 20_000,
  }),
  place_resolution: Object.freeze({
    provider: "google",
    maxPerRequest: 12,
    maxPerTrip: 12,
    maxPerSessionDay: 36,
    maxPerDay: 1_200,
    maxPerMonth: 12_000,
  }),
  place_intelligence: Object.freeze({
    provider: "google",
    maxPerRequest: 1,
    maxPerTrip: 10,
    maxPerSessionDay: 30,
    maxPerDay: 1_000,
    maxPerMonth: 10_000,
  }),
  fresh_voices: Object.freeze({
    provider: "anthropic",
    maxPerRequest: 2,
    maxPerTrip: 24,
    maxPerSessionDay: 48,
    maxPerDay: 192,
    maxPerMonth: 1_920,
  }),
  // A route-wide hotel recommendation can issue three Google searches and a
  // fourth fallback when the nearby search fails. Reserve that worst case so
  // an internal fallback can never escape the durable ceiling.
  hotel_recommendations: Object.freeze({
    provider: "google",
    maxPerRequest: 4,
    maxPerTrip: 20,
    maxPerSessionDay: 60,
    maxPerDay: 600,
    maxPerMonth: 6_000,
  }),
  // Nearby food discovery may make one bounded radius expansion. A fourteen
  // day trip can have lunch and dinner slots, hence 56 provider events/trip.
  food_recommendations: Object.freeze({
    provider: "google",
    maxPerRequest: 2,
    maxPerTrip: 56,
    maxPerSessionDay: 112,
    maxPerDay: 2_000,
    maxPerMonth: 20_000,
  }),
  food_ranking: Object.freeze({
    provider: "anthropic",
    maxPerRequest: 1,
    maxPerTrip: 28,
    maxPerSessionDay: 56,
    maxPerDay: 192,
    maxPerMonth: 1_920,
  }),
  // Search Along Route can fall back to the two route endpoints. Reserve all
  // three searches even when the first one is sufficient.
  route_recommendations: Object.freeze({
    provider: "google",
    maxPerRequest: 3,
    maxPerTrip: 42,
    maxPerSessionDay: 84,
    maxPerDay: 75,
    maxPerMonth: 2_250,
  }),
});

export const DURABLE_QUOTA_KILL_SWITCHES = Object.freeze({
  global: "TRIPCHECK_PAID_API_DISABLED",
  google: "TRIPCHECK_GOOGLE_API_DISABLED",
  anthropic: "TRIPCHECK_ANTHROPIC_API_DISABLED",
});

export type D1RunResultLike = Readonly<{
  success?: boolean;
  results?: readonly Record<string, unknown>[];
  error?: string;
}>;

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResultLike>;
}

/** Minimal structural type needed from a Cloudflare D1 binding. */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  /** D1 executes one batch transactionally and rolls it back if a statement fails. */
  batch(statements: D1PreparedStatementLike[]): Promise<D1RunResultLike[]>;
}

export type DurableQuotaEnvironment = Readonly<{
  TRIPCHECK_PAID_API_DISABLED?: string;
  TRIPCHECK_GOOGLE_API_DISABLED?: string;
  TRIPCHECK_ANTHROPIC_API_DISABLED?: string;
  /** Private server secret used to make stored SHA-256 subjects opaque. */
  TRIPCHECK_QUOTA_HASH_SECRET?: string;
}>;

export type DurableProviderQuotaRequest = Readonly<{
  provider: DurableQuotaProvider;
  operation: DurableQuotaOperation;
  units: number;
  /** Random, non-personal anonymous browser token. Never stored in D1. */
  anonymousSessionId: string;
  /** Random per-trip token. Never stored in D1. */
  tripId: string;
}>;

export type DurableQuotaDenialCode =
  | "paid_api_disabled"
  | "provider_disabled"
  | "invalid_quota_request"
  | "request_cap_exceeded"
  | "budget_exhausted"
  | "quota_store_unavailable";

export type DurableQuotaDenial = Readonly<{
  ok: false;
  status: 400 | 429 | 503;
  code: DurableQuotaDenialCode;
  headers: Record<string, string>;
}>;

export type DurableQuotaAccess = Readonly<{
  ok: true;
  headers: Record<string, string>;
  /**
   * Records provider failures without refunding the reservation. The returned
   * boolean reports whether the failure counters were durably updated.
   */
  complete(outcome?: { failedUnits?: number }): Promise<boolean>;
}>;

export type DurableQuotaResult = DurableQuotaDenial | DurableQuotaAccess;

type EnforcerOptions = Readonly<{
  policies?: DurableQuotaPolicies;
  now?: () => number;
  digest?: (secret: string, purpose: string, subject: string) => Promise<string>;
}>;

type CounterReservation = Readonly<{
  scope: DurableQuotaScope;
  subjectHash: string;
  bucket: string;
  limit: number;
}>;

const initializedDatabases = new WeakMap<object, Promise<void>>();
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

const RESERVE_COUNTER_SQL = `
INSERT INTO provider_quota_counters (
  provider,
  operation,
  scope,
  subject_hash,
  bucket,
  used_count,
  failure_count,
  hard_limit,
  updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
ON CONFLICT (provider, operation, scope, subject_hash, bucket)
DO UPDATE SET
  used_count = provider_quota_counters.used_count + excluded.used_count,
  hard_limit = excluded.hard_limit,
  updated_at_ms = excluded.updated_at_ms
RETURNING used_count, hard_limit
`.trim();

const RECORD_FAILURE_SQL = `
UPDATE provider_quota_counters
SET
  failure_count = MIN(used_count, failure_count + ?),
  updated_at_ms = ?
WHERE provider = ?
  AND operation = ?
  AND scope = ?
  AND subject_hash = ?
  AND bucket = ?
`.trim();

function enabledFlag(value: string | undefined) {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function baseHeaders(durable: boolean, extra: Record<string, string> = {}) {
  return {
    "X-TripCheck-Quota-Mode": "durable-d1-required",
    "X-TripCheck-Quota-Durable": String(durable),
    "X-TripCheck-Quota-Cross-Instance": String(durable),
    "Cache-Control": "private, no-store, max-age=0",
    ...extra,
  };
}

function denial(
  code: DurableQuotaDenialCode,
  status: DurableQuotaDenial["status"],
  durable = false,
): DurableQuotaDenial {
  return {
    ok: false,
    code,
    status,
    headers: baseHeaders(durable, status === 429 ? { "Retry-After": "86400" } : {}),
  };
}

function validDatabase(value: D1DatabaseLike | null | undefined): value is D1DatabaseLike {
  return Boolean(value && typeof value.prepare === "function" && typeof value.batch === "function");
}

function validPolicy(policy: DurableQuotaPolicy | undefined) {
  if (!policy) return false;
  return [
    policy.maxPerRequest,
    policy.maxPerTrip,
    policy.maxPerSessionDay,
    policy.maxPerDay,
    policy.maxPerMonth,
  ].every((value) => Number.isInteger(value) && value > 0);
}

function isConstraintCapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /provider_quota_used_within_limit|check constraint failed/i.test(message);
}

async function defaultDigest(secret: string, purpose: string, subject: string) {
  const payload = new TextEncoder().encode(`${secret}\0${purpose}\0${subject}`);
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", payload));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function utcBuckets(now: number) {
  const iso = new Date(now).toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

function remainingHeaders(
  results: readonly D1RunResultLike[],
  reservations: readonly CounterReservation[],
) {
  const headers: Record<string, string> = {};
  results.forEach((result, index) => {
    const row = result.results?.[0];
    const used = typeof row?.used_count === "number" ? row.used_count : null;
    const hardLimit = typeof row?.hard_limit === "number" ? row.hard_limit : reservations[index]?.limit;
    if (used === null || typeof hardLimit !== "number") return;
    const scope = reservations[index]?.scope;
    if (!scope) return;
    const label = scope === "session" ? "Session-Day" : scope[0].toUpperCase() + scope.slice(1);
    headers[`X-TripCheck-Quota-Remaining-${label}`] = String(Math.max(0, hardLimit - used));
  });
  return headers;
}

/**
 * Creates the D1 table at runtime. Calls are coalesced per binding in one
 * isolate; CREATE TABLE IF NOT EXISTS keeps concurrent isolates safe.
 */
export async function initializeDurableProviderQuotaSchema(db: D1DatabaseLike) {
  const key = db as object;
  const existing = initializedDatabases.get(key);
  if (existing) return existing;
  const pending = db.prepare(PROVIDER_QUOTA_SCHEMA_SQL).run().then((result) => {
    if (result.success !== true) throw new Error("quota schema initialization failed");
  });
  initializedDatabases.set(key, pending);
  try {
    await pending;
  } catch (error) {
    initializedDatabases.delete(key);
    throw error;
  }
}

async function enforceWithOptions(
  request: DurableProviderQuotaRequest,
  db: D1DatabaseLike | null | undefined,
  env: DurableQuotaEnvironment,
  options: EnforcerOptions,
): Promise<DurableQuotaResult> {
  if (enabledFlag(env.TRIPCHECK_PAID_API_DISABLED)) {
    return denial("paid_api_disabled", 503);
  }
  if (enabledFlag(env[DURABLE_QUOTA_KILL_SWITCHES[request.provider]])) {
    return denial("provider_disabled", 503);
  }

  const policies = options.policies ?? DURABLE_PROVIDER_QUOTA_POLICIES;
  const policy = policies[request.operation];
  if (!validPolicy(policy) || policy.provider !== request.provider) {
    return denial("invalid_quota_request", 400);
  }
  if (!Number.isInteger(request.units) || request.units < 1 || request.units > policy.maxPerRequest) {
    return denial("request_cap_exceeded", 429);
  }
  if (!OPAQUE_TOKEN_PATTERN.test(request.anonymousSessionId) || !OPAQUE_TOKEN_PATTERN.test(request.tripId)) {
    return denial("invalid_quota_request", 400);
  }
  if (!validDatabase(db)) return denial("quota_store_unavailable", 503);
  const hashSecret = env.TRIPCHECK_QUOTA_HASH_SECRET?.trim();
  if (!hashSecret || hashSecret.length < 32) return denial("quota_store_unavailable", 503);

  const now = (options.now ?? Date.now)();
  if (!Number.isFinite(now) || now < 0) return denial("quota_store_unavailable", 503);

  try {
    await initializeDurableProviderQuotaSchema(db);
    const digest = options.digest ?? defaultDigest;
    const { day, month } = utcBuckets(now);
    const [sessionHash, tripHash, aggregateHash] = await Promise.all([
      digest(hashSecret, "anonymous-session", request.anonymousSessionId),
      digest(hashSecret, "trip", `${request.anonymousSessionId}\0${request.tripId}`),
      digest(hashSecret, "aggregate", `${request.provider}\0${request.operation}`),
    ]);
    const reservations: CounterReservation[] = [
      { scope: "trip", subjectHash: tripHash, bucket: "all", limit: policy.maxPerTrip },
      { scope: "session", subjectHash: sessionHash, bucket: day, limit: policy.maxPerSessionDay },
      { scope: "day", subjectHash: aggregateHash, bucket: day, limit: policy.maxPerDay },
      { scope: "month", subjectHash: aggregateHash, bucket: month, limit: policy.maxPerMonth },
    ];
    if (reservations.some((entry) => !/^[0-9a-f]{64}$/.test(entry.subjectHash))) {
      return denial("quota_store_unavailable", 503);
    }

    // D1 batch is the atomic boundary. If any scope crosses its CHECK-backed
    // hard limit, D1 rolls back all four increments rather than partially
    // charging a trip, session, day, or month.
    const results = await db.batch(reservations.map((entry) => db.prepare(RESERVE_COUNTER_SQL).bind(
      request.provider,
      request.operation,
      entry.scope,
      entry.subjectHash,
      entry.bucket,
      request.units,
      entry.limit,
      Math.floor(now),
    )));
    if (results.length !== reservations.length || results.some((result) => result.success !== true)) {
      throw new Error("quota reservation batch failed");
    }

    let completed = false;
    return {
      ok: true,
      headers: baseHeaders(true, {
        "X-TripCheck-Quota-Charged-Units": String(request.units),
        ...remainingHeaders(results, reservations),
      }),
      complete: async ({ failedUnits = 0 } = {}) => {
        if (completed) return false;
        completed = true;
        const failures = Math.min(request.units, Math.max(0, Math.floor(failedUnits)));
        if (failures === 0) return true;
        try {
          const failureResults = await db.batch(reservations.map((entry) => db.prepare(RECORD_FAILURE_SQL).bind(
            failures,
            Math.floor((options.now ?? Date.now)()),
            request.provider,
            request.operation,
            entry.scope,
            entry.subjectHash,
            entry.bucket,
          )));
          return failureResults.length === reservations.length
            && failureResults.every((result) => result.success === true);
        } catch {
          // The original used_count reservation remains charged. Failure
          // telemetry is best-effort and never causes a refund.
          return false;
        }
      },
    };
  } catch (error) {
    return isConstraintCapError(error)
      ? denial("budget_exhausted", 429, true)
      : denial("quota_store_unavailable", 503);
  }
}

/**
 * Durable quota gate for Worker route adapters. Call it before a paid provider
 * request. A missing or unhealthy D1 binding fails closed.
 */
export function enforceDurableProviderQuota(
  request: DurableProviderQuotaRequest,
  db: D1DatabaseLike | null | undefined,
  env: DurableQuotaEnvironment,
) {
  return enforceWithOptions(request, db, env, {});
}

/** Dependency-injected constructor used for deterministic policy tests. */
export function createDurableProviderQuotaEnforcer(options: EnforcerOptions = {}) {
  return (
    request: DurableProviderQuotaRequest,
    db: D1DatabaseLike | null | undefined,
    env: DurableQuotaEnvironment,
  ) => enforceWithOptions(request, db, env, options);
}
