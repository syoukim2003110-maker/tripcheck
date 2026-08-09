import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderAttemptNotAuthorizedError,
  ProviderAttemptTimeoutError,
  ProviderCallCancelledError,
  ProviderCircuitOpenError,
  RollingProviderCircuitBreaker,
  providerFetchWithParentSignal,
  runResilientProviderCall,
} from "../lib/server/provider-resilience.ts";

test("retries one transient failure with deterministic exponential backoff", async () => {
  const circuit = new RollingProviderCircuitBreaker();
  const statuses = [502, 200];
  const delays: number[] = [];
  let calls = 0;
  const result = await runResilientProviderCall({
    circuit,
    attempt: async () => ({ status: statuses[calls++] }),
    isFailure: (value) => value.status >= 500,
    isRetryable: (value) => value.status === 502,
    random: () => 0.25,
    sleep: async (delay) => { delays.push(delay); },
  });

  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [175]);
  assert.deepEqual(circuit.snapshot(), {
    state: "closed",
    sampleCount: 2,
    failureCount: 1,
    failureRate: 0.5,
    retryAfterMs: 0,
  });
});

test("does not retry a non-transient provider response", async () => {
  let calls = 0;
  const result = await runResilientProviderCall({
    circuit: new RollingProviderCircuitBreaker(),
    attempt: async () => {
      calls += 1;
      return { status: 400 };
    },
    isFailure: (value) => value.status >= 500,
    isRetryable: (value) => value.status === 502,
    sleep: async () => { throw new Error("must not sleep"); },
  });
  assert.equal(result.status, 400);
  assert.equal(calls, 1);
});

test("keeps the first provider failure when retry quota is not authorized", async () => {
  let attempts = 0;
  const firstFailure = { status: 502, body: "provider unavailable" };
  const result = await runResilientProviderCall({
    circuit: new RollingProviderCircuitBreaker(),
    attempt: async (attemptIndex) => {
      attempts += 1;
      if (attemptIndex === 0) return firstFailure;
      throw new ProviderAttemptNotAuthorizedError({ status: 429 });
    },
    isFailure: (value) => value.status >= 500,
    isRetryable: (value) => value.status === 502,
    backoffBaseMs: 0,
    jitterMs: 0,
  });
  assert.equal(result, firstFailure);
  assert.equal(attempts, 2);
});

test("times out each attempt and never exceeds one retry", async () => {
  let attempts = 0;
  const circuit = new RollingProviderCircuitBreaker();
  await assert.rejects(runResilientProviderCall({
    circuit,
    attempt: async (_attemptIndex, signal) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    isFailure: () => true,
    isRetryable: () => true,
    timeoutMs: 5,
    backoffBaseMs: 0,
    jitterMs: 0,
  }), ProviderAttemptTimeoutError);
  assert.equal(attempts, 2);
  assert.equal(circuit.snapshot().failureCount, 2);
});

test("does not retry or poison the circuit when the caller cancels", async () => {
  let attempts = 0;
  const circuit = new RollingProviderCircuitBreaker();
  await assert.rejects(runResilientProviderCall({
    circuit,
    attempt: async () => {
      attempts += 1;
      throw new ProviderCallCancelledError();
    },
    isFailure: () => true,
    isRetryable: () => true,
    backoffBaseMs: 0,
    jitterMs: 0,
  }), ProviderCallCancelledError);
  assert.equal(attempts, 1);
  assert.equal(circuit.snapshot().sampleCount, 0);
});

test("opens above fifty percent failures for five minutes and then probes again", async () => {
  let now = 1_000;
  const circuit = new RollingProviderCircuitBreaker({ now: () => now });
  let calls = 0;
  const fail = () => runResilientProviderCall({
    circuit,
    attempt: async () => {
      calls += 1;
      return { status: 502 };
    },
    isFailure: (value) => value.status >= 500,
    isRetryable: (value) => value.status === 502,
    backoffBaseMs: 0,
    jitterMs: 0,
  });

  assert.equal((await fail()).status, 502);
  assert.equal(calls, 2);
  assert.equal(circuit.snapshot().state, "open");
  await assert.rejects(fail(), ProviderCircuitOpenError);
  assert.equal(calls, 2, "an open circuit must fail before provider access");

  now += 5 * 60 * 1000 + 1;
  const recovered = await runResilientProviderCall({
    circuit,
    attempt: async () => {
      calls += 1;
      return { status: 200 };
    },
    isFailure: (value) => value.status >= 500,
    isRetryable: (value) => value.status === 502,
  });
  assert.equal(recovered.status, 200);
  assert.equal(circuit.snapshot().state, "closed");
});

test("combines the Worker deadline with the provider's own abort signal", async () => {
  const parent = new AbortController();
  const provider = new AbortController();
  let observed: AbortSignal | undefined;
  const wrapped = providerFetchWithParentSignal(parent.signal, (async (_input, init) => {
    observed = init?.signal ?? undefined;
    return new Response("ok");
  }) as typeof fetch);

  await wrapped("https://provider.test", { signal: provider.signal });
  assert.ok(observed);
  assert.equal(observed.aborted, false);
  parent.abort(new Error("deadline"));
  assert.equal(observed.aborted, true);
});
