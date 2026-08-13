import { createHash, randomUUID } from "node:crypto";

import {
  PROVIDER_COST_OPERATIONS,
  PROVIDER_COST_POLICIES,
  type ProviderCostOperation,
  type ProviderCostProvider,
} from "./provider-cost-policy.ts";

export type PaidProvider = ProviderCostProvider;
export type PaidOperation = ProviderCostOperation;
export type QuotaScope = "trip" | "session" | "process_day";

export type PaidOperationPolicy = Readonly<{
  provider: PaidProvider;
  maxPerRequest: number;
  maxPerTrip: number;
  maxPerSession: number;
  maxPerProcessDay: number;
}>;

export type PaidOperationPolicies = Readonly<Record<PaidOperation, PaidOperationPolicy>>;

/**
 * The process-local view of `PROVIDER_COST_POLICIES`. Cost fail-safes are
 * expressed in provider request-events rather than currency, are intentionally
 * conservative, and are independent of client-side truncation: a malformed or
 * modified client cannot raise them. Both this table and the durable D1 ledger
 * are derived, so they can no longer drift apart.
 */
export const PAID_OPERATION_POLICIES: PaidOperationPolicies = Object.freeze(
  Object.fromEntries(PROVIDER_COST_OPERATIONS.map((operation) => {
    const policy = PROVIDER_COST_POLICIES[operation];
    return [operation, Object.freeze({
      provider: policy.provider,
      maxPerRequest: policy.maxPerRequest,
      maxPerTrip: policy.maxPerTrip,
      maxPerSession: policy.maxPerSessionDay,
      maxPerProcessDay: policy.maxPerDay,
    })];
  })),
) as PaidOperationPolicies;

export const PROCESS_LOCAL_QUOTA_METADATA = Object.freeze({
  enforcement: "process_local_fail_safe" as const,
  globallyDurable: false as const,
  crossInstance: false as const,
  resetsOnProcessRestart: true as const,
});

export const PAID_API_KILL_SWITCHES = Object.freeze({
  global: "TRIPCHECK_PAID_API_DISABLED",
  google: "TRIPCHECK_GOOGLE_API_DISABLED",
  anthropic: "TRIPCHECK_ANTHROPIC_API_DISABLED",
});

const SESSION_COOKIE = "tc_paid_session";
const DEFAULT_MAX_LEDGER_ENTRIES = 10_000;
let processSalt: string | undefined;

function getProcessSalt(): string {
  processSalt ??= randomUUID();
  return processSalt;
}

type Environment = Readonly<Record<string, string | undefined>>;

type GatewayIdentity = {
  sessionId: string;
  tripId: string;
  setCookie?: string;
};

export type LedgerDenialReason = "request_cap" | "trip_cap" | "session_cap" | "process_day_cap" | "ledger_saturated";

type LedgerReservation = {
  id: number;
  units: number;
  remainingTrip: number;
  remainingSession: number;
  remainingProcessDay: number;
};

type LedgerReservationResult =
  | { ok: true; reservation: LedgerReservation }
  | { ok: false; reason: LedgerDenialReason };

type LedgerCounter = {
  day: string;
  provider: PaidProvider;
  operation: PaidOperation;
  scope: QuotaScope;
  used: number;
  failures: number;
};

type ActiveReservation = {
  day: string;
  units: number;
  counterKeys: string[];
};

export type ProcessLocalLedgerSnapshot = {
  metadata: typeof PROCESS_LOCAL_QUOTA_METADATA;
  counters: Array<{
    day: string;
    provider: PaidProvider;
    operation: PaidOperation;
    scope: QuotaScope;
    used: number;
    failures: number;
  }>;
  activeReservationCount: number;
};

function enabledFlag(value: string | undefined) {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function utcDay(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

function stableSubjectHash(value: string) {
  return createHash("sha256").update(getProcessSalt()).update("\0").update(value).digest("hex").slice(0, 32);
}

/**
 * Atomic within one JavaScript process: every limit is checked before any
 * counter is incremented, and no await occurs inside reserve/settle.
 * It is deliberately not a distributed quota or durable billing ledger.
 */
export class ProcessLocalProviderLedger {
  readonly metadata = PROCESS_LOCAL_QUOTA_METADATA;
  private readonly counters = new Map<string, LedgerCounter>();
  private readonly activeReservations = new Map<number, ActiveReservation>();
  private readonly options: {
    now?: () => number;
    maxEntries?: number;
    policies?: PaidOperationPolicies;
    hashSubject?: (value: string) => string;
  };
  private nextReservationId = 1;

  constructor(options: {
    now?: () => number;
    maxEntries?: number;
    policies?: PaidOperationPolicies;
    hashSubject?: (value: string) => string;
  } = {}) {
    this.options = options;
  }

  private policies() {
    return this.options.policies ?? PAID_OPERATION_POLICIES;
  }

  private currentDay() {
    return utcDay((this.options.now ?? Date.now)());
  }

  private pruneOldDays(day: string) {
    for (const [key, counter] of this.counters) {
      if (counter.day !== day) this.counters.delete(key);
    }
    for (const [id, reservation] of this.activeReservations) {
      if (reservation.day !== day) this.activeReservations.delete(id);
    }
  }

  reserve(input: {
    provider: PaidProvider;
    operation: PaidOperation;
    units: number;
    sessionId: string;
    tripId: string;
  }): LedgerReservationResult {
    const policy = this.policies()[input.operation];
    if (policy.provider !== input.provider) return { ok: false, reason: "request_cap" };
    if (!Number.isInteger(input.units) || input.units < 1 || input.units > policy.maxPerRequest) {
      return { ok: false, reason: "request_cap" };
    }

    const day = this.currentDay();
    this.pruneOldDays(day);
    const hash = this.options.hashSubject ?? stableSubjectHash;
    const sessionHash = hash(input.sessionId);
    const tripHash = hash(`${input.sessionId}\0${input.tripId}`);
    const keys = {
      trip: `${day}|${input.provider}|${input.operation}|trip|${tripHash}`,
      session: `${day}|${input.provider}|${input.operation}|session|${sessionHash}`,
      process_day: `${day}|${input.provider}|${input.operation}|process_day|all`,
    } as const;
    const limits = {
      trip: policy.maxPerTrip,
      session: policy.maxPerSession,
      process_day: policy.maxPerProcessDay,
    } as const;
    const missingEntries = Object.values(keys).filter((key) => !this.counters.has(key)).length;
    const maxEntries = Math.max(3, Math.floor(this.options.maxEntries ?? DEFAULT_MAX_LEDGER_ENTRIES));
    if (this.counters.size + missingEntries > maxEntries) return { ok: false, reason: "ledger_saturated" };

    for (const scope of ["trip", "session", "process_day"] as const) {
      const used = this.counters.get(keys[scope])?.used ?? 0;
      if (used + input.units > limits[scope]) {
        return { ok: false, reason: scope === "process_day" ? "process_day_cap" : `${scope}_cap` };
      }
    }

    const counterKeys: string[] = [];
    for (const scope of ["trip", "session", "process_day"] as const) {
      const key = keys[scope];
      const counter = this.counters.get(key) ?? {
        day,
        provider: input.provider,
        operation: input.operation,
        scope,
        used: 0,
        failures: 0,
      };
      counter.used += input.units;
      this.counters.set(key, counter);
      counterKeys.push(key);
    }
    const id = this.nextReservationId;
    this.nextReservationId += 1;
    this.activeReservations.set(id, { day, units: input.units, counterKeys });
    return {
      ok: true,
      reservation: {
        id,
        units: input.units,
        remainingTrip: policy.maxPerTrip - this.counters.get(keys.trip)!.used,
        remainingSession: policy.maxPerSession - this.counters.get(keys.session)!.used,
        remainingProcessDay: policy.maxPerProcessDay - this.counters.get(keys.process_day)!.used,
      },
    };
  }

  settle(reservationId: number, failedUnits = 0) {
    const active = this.activeReservations.get(reservationId);
    if (!active) return false;
    this.activeReservations.delete(reservationId);
    const failures = Math.min(active.units, Math.max(0, Math.floor(failedUnits)));
    if (failures > 0) {
      for (const key of active.counterKeys) {
        const counter = this.counters.get(key);
        if (counter) counter.failures += failures;
      }
    }
    return true;
  }

  snapshot(): ProcessLocalLedgerSnapshot {
    const aggregated = new Map<string, ProcessLocalLedgerSnapshot["counters"][number]>();
    for (const counter of this.counters.values()) {
      const key = `${counter.day}|${counter.provider}|${counter.operation}|${counter.scope}`;
      const current = aggregated.get(key) ?? {
        day: counter.day,
        provider: counter.provider,
        operation: counter.operation,
        scope: counter.scope,
        used: 0,
        failures: 0,
      };
      current.used += counter.used;
      current.failures += counter.failures;
      aggregated.set(key, current);
    }
    return {
      metadata: this.metadata,
      counters: [...aggregated.values()].sort((left, right) => (
        left.day.localeCompare(right.day)
        || left.provider.localeCompare(right.provider)
        || left.operation.localeCompare(right.operation)
        || left.scope.localeCompare(right.scope)
      )),
      activeReservationCount: this.activeReservations.size,
    };
  }
}

export type GatewayDenialCode = "forbidden" | "paid_api_disabled" | "provider_disabled" | "request_cap_exceeded" | "budget_exhausted";

export type GatewayDenial = {
  ok: false;
  code: GatewayDenialCode;
  status: 403 | 429 | 503;
  reason?: LedgerDenialReason;
  headers: Record<string, string>;
};

export type GatewayPreflight = {
  ok: true;
  provider: PaidProvider;
  request: Request;
  environment: Environment;
};

export type GatewayAccess = {
  ok: true;
  provider: PaidProvider;
  operation: PaidOperation;
  units: number;
  headers: Record<string, string>;
  remaining: { trip: number; session: number; processDay: number };
  complete(outcome?: { failedUnits?: number }): boolean;
};

function quotaHeaders(extra: Record<string, string> = {}) {
  return {
    "X-TripCheck-Quota-Scope": "process-local",
    "X-TripCheck-Quota-Durable": "false",
    "X-TripCheck-Quota-Cross-Instance": "false",
    ...extra,
  };
}

function expectedOrigin(request: Request, environment: Environment) {
  const configured = environment.TRIPCHECK_PUBLIC_ORIGIN?.trim();
  try {
    return new URL(configured || request.url).origin;
  } catch {
    return null;
  }
}

function requestIsSameOrigin(request: Request, environment: Environment) {
  const production = environment.NODE_ENV === "production";
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.toLocaleLowerCase("en-US") ?? null;
  const expected = expectedOrigin(request, environment);
  let originMatches = false;
  if (origin && expected) {
    try {
      originMatches = new URL(origin).origin === expected;
    } catch {
      originMatches = false;
    }
  }
  if (production) return originMatches && fetchSite === "same-origin";
  if (origin && !originMatches) return false;
  return fetchSite !== "cross-site";
}

function parseCookie(request: Request, name: string) {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

function boundedOpaqueId(value: string | null) {
  // Keep this identical to the Worker boundary so a valid edge identity is
  // never silently replaced by a different process-local quota subject.
  return value && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
}

function defaultIdentity(
  request: Request,
  environment: Environment,
  createAnonymousId: () => string,
  now: () => number,
): GatewayIdentity {
  const suppliedSession = boundedOpaqueId(request.headers.get("X-TripCheck-Session"))
    ?? boundedOpaqueId(parseCookie(request, SESSION_COOKIE));
  const sessionId = suppliedSession ?? createAnonymousId().replaceAll("-", "");
  // The client may send a random per-trip token. Until every client does, a
  // four-hour bucket prevents one anonymous browser from being permanently
  // stuck at the per-trip ceiling while the stricter session/day ceilings
  // still bound deliberate token rotation.
  const tripId = boundedOpaqueId(request.headers.get("X-TripCheck-Trip"))
    ?? `time_bucket_${Math.floor(now() / (4 * 60 * 60 * 1000))}`;
  if (suppliedSession) return { sessionId, tripId };
  const secure = environment.NODE_ENV === "production" ? "; Secure" : "";
  return {
    sessionId,
    tripId,
    setCookie: `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}`,
  };
}

export class PaidProviderGateway {
  readonly metadata = PROCESS_LOCAL_QUOTA_METADATA;
  private readonly options: {
    ledger?: ProcessLocalProviderLedger;
    environment?: Environment | (() => Environment);
    identityResolver?: (request: Request, environment: Environment) => GatewayIdentity;
    createAnonymousId?: () => string;
    now?: () => number;
    policies?: PaidOperationPolicies;
  };

  constructor(options: {
    ledger?: ProcessLocalProviderLedger;
    environment?: Environment | (() => Environment);
    identityResolver?: (request: Request, environment: Environment) => GatewayIdentity;
    createAnonymousId?: () => string;
    now?: () => number;
    policies?: PaidOperationPolicies;
  } = {}) {
    this.options = options;
  }

  private environment() {
    const configured = this.options.environment;
    return typeof configured === "function" ? configured() : configured ?? process.env;
  }

  private ledger() {
    return this.options.ledger ?? defaultLedger;
  }

  private policies() {
    return this.options.policies ?? PAID_OPERATION_POLICIES;
  }

  preflight(request: Request, provider: PaidProvider): GatewayPreflight | GatewayDenial {
    const environment = this.environment();
    if (!requestIsSameOrigin(request, environment)) {
      return { ok: false, code: "forbidden", status: 403, headers: quotaHeaders() };
    }
    if (enabledFlag(environment[PAID_API_KILL_SWITCHES.global])) {
      return { ok: false, code: "paid_api_disabled", status: 503, headers: quotaHeaders() };
    }
    if (enabledFlag(environment[PAID_API_KILL_SWITCHES[provider]])) {
      return { ok: false, code: "provider_disabled", status: 503, headers: quotaHeaders() };
    }
    return { ok: true, provider, request, environment };
  }

  reserve(preflight: GatewayPreflight, operation: PaidOperation, units: number): GatewayAccess | GatewayDenial {
    const policy = this.policies()[operation];
    if (policy.provider !== preflight.provider || !Number.isInteger(units) || units < 1 || units > policy.maxPerRequest) {
      return { ok: false, code: "request_cap_exceeded", status: 429, reason: "request_cap", headers: quotaHeaders({ "Retry-After": "86400" }) };
    }
    const identity = (this.options.identityResolver ?? ((request, environment) => defaultIdentity(
      request,
      environment,
      this.options.createAnonymousId ?? randomUUID,
      this.options.now ?? Date.now,
    )))(preflight.request, preflight.environment);
    const reserved = this.ledger().reserve({
      provider: preflight.provider,
      operation,
      units,
      sessionId: identity.sessionId,
      tripId: identity.tripId,
    });
    const identityHeaders: Record<string, string> = {};
    if (identity.setCookie) identityHeaders["Set-Cookie"] = identity.setCookie;
    if (!reserved.ok) {
      return {
        ok: false,
        code: reserved.reason === "request_cap" ? "request_cap_exceeded" : "budget_exhausted",
        status: 429,
        reason: reserved.reason,
        headers: quotaHeaders({ ...identityHeaders, "Retry-After": "86400" }),
      };
    }
    const reservation = reserved.reservation;
    let completed = false;
    return {
      ok: true,
      provider: preflight.provider,
      operation,
      units,
      remaining: {
        trip: reservation.remainingTrip,
        session: reservation.remainingSession,
        processDay: reservation.remainingProcessDay,
      },
      headers: quotaHeaders({
        ...identityHeaders,
        "X-TripCheck-Quota-Remaining-Trip": String(reservation.remainingTrip),
        "X-TripCheck-Quota-Remaining-Session": String(reservation.remainingSession),
        "X-TripCheck-Quota-Remaining-Process-Day": String(reservation.remainingProcessDay),
      }),
      complete: ({ failedUnits = 0 } = {}) => {
        if (completed) return false;
        completed = true;
        return this.ledger().settle(reservation.id, failedUnits);
      },
    };
  }
}

const defaultLedger = new ProcessLocalProviderLedger();
export const paidProviderGateway = new PaidProviderGateway({ ledger: defaultLedger });

export function paidApiDenialResponse(denial: GatewayDenial, baseHeaders: Record<string, string> = {}) {
  return Response.json({
    code: denial.code,
    quota: PROCESS_LOCAL_QUOTA_METADATA,
    ...(denial.reason ? { reason: denial.reason } : {}),
  }, {
    status: denial.status,
    headers: { ...baseHeaders, ...denial.headers },
  });
}
