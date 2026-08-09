export const PROVIDER_RESILIENCE_DEFAULTS = Object.freeze({
  timeoutMs: 8_000,
  maxRetries: 1,
  circuitWindowMs: 5 * 60 * 1000,
  circuitFailureThreshold: 0.5,
  // One failed attempt followed by a successful retry is exactly 50% and does
  // not open the circuit. Two failed attempts are enough to stop the next call.
  circuitMinimumSamples: 2,
  backoffBaseMs: 150,
  jitterMs: 100,
});

type CircuitSample = Readonly<{ at: number; failed: boolean }>;

export type ProviderCircuitSnapshot = Readonly<{
  state: "closed" | "open";
  sampleCount: number;
  failureCount: number;
  failureRate: number;
  retryAfterMs: number;
}>;

/**
 * A small isolate-local rolling breaker. The durable quota remains the hard
 * cross-isolate cost boundary; this breaker only prevents repeatedly calling
 * an unhealthy provider from the same Worker isolate.
 */
export class RollingProviderCircuitBreaker {
  private samples: CircuitSample[] = [];
  private openUntil = 0;
  private readonly options: Readonly<{
    now: () => number;
    windowMs: number;
    failureThreshold: number;
    minimumSamples: number;
  }>;

  constructor(options: Partial<{
    now: () => number;
    windowMs: number;
    failureThreshold: number;
    minimumSamples: number;
  }> = {}) {
    this.options = {
      now: options.now ?? Date.now,
      windowMs: Math.max(1, Math.floor(options.windowMs ?? PROVIDER_RESILIENCE_DEFAULTS.circuitWindowMs)),
      failureThreshold: Math.min(1, Math.max(0, options.failureThreshold ?? PROVIDER_RESILIENCE_DEFAULTS.circuitFailureThreshold)),
      minimumSamples: Math.max(1, Math.floor(options.minimumSamples ?? PROVIDER_RESILIENCE_DEFAULTS.circuitMinimumSamples)),
    };
  }

  private prune(now: number) {
    const cutoff = now - this.options.windowMs;
    this.samples = this.samples.filter((sample) => sample.at > cutoff);
    if (this.openUntil <= now) this.openUntil = 0;
  }

  snapshot(): ProviderCircuitSnapshot {
    const now = this.options.now();
    this.prune(now);
    const failureCount = this.samples.filter((sample) => sample.failed).length;
    const sampleCount = this.samples.length;
    return {
      state: this.openUntil > now ? "open" : "closed",
      sampleCount,
      failureCount,
      failureRate: sampleCount > 0 ? failureCount / sampleCount : 0,
      retryAfterMs: Math.max(0, this.openUntil - now),
    };
  }

  record(failed: boolean) {
    const now = this.options.now();
    this.prune(now);
    this.samples.push({ at: now, failed });
    const failureCount = this.samples.filter((sample) => sample.failed).length;
    if (
      this.samples.length >= this.options.minimumSamples
      && failureCount / this.samples.length > this.options.failureThreshold
    ) {
      this.openUntil = Math.max(this.openUntil, now + this.options.windowMs);
    }
  }

  reset() {
    this.samples = [];
    this.openUntil = 0;
  }
}

export class ProviderCircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("provider_circuit_open");
    this.name = "ProviderCircuitOpenError";
    this.retryAfterMs = Math.max(0, Math.floor(retryAfterMs));
  }
}

/**
 * Raised by the server adapter when the next attempt cannot reserve quota.
 * It is deliberately not counted as a provider failure.
 */
export class ProviderAttemptNotAuthorizedError<T = unknown> extends Error {
  readonly response: T;

  constructor(response: T) {
    super("provider_attempt_not_authorized");
    this.name = "ProviderAttemptNotAuthorizedError";
    this.response = response;
  }
}

export class ProviderAttemptTimeoutError extends Error {
  constructor() {
    super("provider_attempt_timeout");
    this.name = "ProviderAttemptTimeoutError";
  }
}

/** A caller disconnect is not a provider failure and must never be retried. */
export class ProviderCallCancelledError extends Error {
  constructor() {
    super("provider_call_cancelled");
    this.name = "ProviderCallCancelledError";
  }
}

type ResilientProviderCallOptions<T> = Readonly<{
  circuit: RollingProviderCircuitBreaker;
  attempt(attemptIndex: number, signal: AbortSignal): Promise<T>;
  isFailure(value: T): boolean;
  isRetryable(value: T): boolean;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  jitterMs?: number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}>;

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function attemptWithTimeout<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderAttemptTimeoutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([attempt(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Executes one provider operation with an eight-second attempt timeout and at
 * most one retry. The adapter owns quota reservation inside `attempt`, so a
 * retry cannot happen unless its separate provider event was authorized.
 */
export async function runResilientProviderCall<T>(options: ResilientProviderCallOptions<T>): Promise<T> {
  const gate = options.circuit.snapshot();
  if (gate.state === "open") throw new ProviderCircuitOpenError(gate.retryAfterMs);

  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? PROVIDER_RESILIENCE_DEFAULTS.timeoutMs));
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? PROVIDER_RESILIENCE_DEFAULTS.maxRetries));
  const backoffBaseMs = Math.max(0, Math.floor(options.backoffBaseMs ?? PROVIDER_RESILIENCE_DEFAULTS.backoffBaseMs));
  const jitterMs = Math.max(0, Math.floor(options.jitterMs ?? PROVIDER_RESILIENCE_DEFAULTS.jitterMs));
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  let previousValue: T | undefined;
  let hasPreviousValue = false;
  let previousError: unknown;

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    try {
      const value = await attemptWithTimeout((signal) => options.attempt(attemptIndex, signal), timeoutMs);
      const failed = options.isFailure(value);
      options.circuit.record(failed);
      if (!failed || !options.isRetryable(value) || attemptIndex >= maxRetries) return value;
      previousValue = value;
      hasPreviousValue = true;
      previousError = undefined;
    } catch (error) {
      if (error instanceof ProviderAttemptNotAuthorizedError) {
        if (hasPreviousValue) return previousValue as T;
        if (previousError !== undefined) throw previousError;
        throw error;
      }
      if (error instanceof ProviderCallCancelledError) throw error;
      options.circuit.record(true);
      if (attemptIndex >= maxRetries) throw error;
      previousError = error;
      hasPreviousValue = false;
    }

    const exponential = backoffBaseMs * (2 ** attemptIndex);
    const boundedRandom = Math.min(1, Math.max(0, random()));
    const delayMs = exponential + Math.floor(boundedRandom * jitterMs);
    if (delayMs > 0) await sleep(delayMs);
  }

  // The loop always returns or throws. This guard keeps the generic return
  // type honest if retry limits are changed mechanically later.
  throw previousError ?? new Error("provider_attempt_failed");
}

/** Merge the Worker attempt deadline with provider-specific abort handling. */
export function providerFetchWithParentSignal(parentSignal: AbortSignal, fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init = {}) => fetcher(input, {
    ...init,
    signal: init.signal ? AbortSignal.any([parentSignal, init.signal]) : parentSignal,
  });
}

export const googleProviderCircuit = new RollingProviderCircuitBreaker();
