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

// P0-05. A Google 502 is retryable, but the Worker used to keep the incoming
// streaming Request as the retry template and clone it per attempt. Cloning a
// stream the previous attempt may still be draining throws `TypeError:
// unusable`, so the retry never reached the origin and the traveller was
// handed the 502 the retry existed to absorb. It failed ~3 times in 100 here
// and 25 times in 30 on the reviewer's machine — a race, not a constant.
// These tests read the body in the handler, exactly as every real paid route
// does, and require byte-identical content on both attempts.

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
  fetch(request: Request, env: RetryTestEnvironment, context: RetryTestContext): Promise<Response>;
};

const { default: worker } = await import(new URL("../worker/index.ts", import.meta.url).href) as { default: WorkerHandler };
hooks.deregister();

class RetryTestStatement implements D1PreparedStatementLike {
  readonly database: RetryTestD1;
  readonly sql: string;
  bindings: unknown[] = [];

  constructor(database: RetryTestD1, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values: unknown[]) {
    const statement = new RetryTestStatement(this.database, this.sql);
    statement.bindings = values;
    return statement;
  }

  run(): Promise<D1RunResultLike> {
    if (this.sql === PROVIDER_QUOTA_TABLE_INFO_SQL) {
      return Promise.resolve({ success: true, results: [{ sql: PROVIDER_QUOTA_SCHEMA_SQL }] });
    }
    return Promise.resolve({ success: true, results: [] });
  }
}

class RetryTestD1 implements D1DatabaseLike {
  batches: RetryTestStatement[][] = [];

  prepare(query: string) {
    return new RetryTestStatement(this, query);
  }

  async batch(statements: D1PreparedStatementLike[]) {
    const concrete = statements as RetryTestStatement[];
    this.batches.push(concrete);
    return concrete.map((statement) => ({
      success: true,
      results: [{
        used_count: Number(statement.bindings[5] ?? 1),
        hard_limit: Number(statement.bindings[6] ?? 20),
      }],
    }));
  }

  get reservations() {
    return this.batches.filter((batch) => batch[0]?.sql.includes("INSERT INTO provider_quota_counters")).length;
  }
}

type RetryTestEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: RetryTestD1;
  IMAGES: never;
  TRIPCHECK_PUBLIC_ORIGIN?: string;
  TRIPCHECK_QUOTA_HASH_SECRET?: string;
};

type RetryTestContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

const context: RetryTestContext = {
  waitUntil() {},
  passThroughOnException() {},
};

function environment(db?: RetryTestD1): RetryTestEnvironment {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: db,
    IMAGES: undefined as never,
    TRIPCHECK_PUBLIC_ORIGIN: "https://tripcheck.test",
    TRIPCHECK_QUOTA_HASH_SECRET: "worker-test-secret-that-is-at-least-32-characters",
  };
}

function paidPost(path: string, body: string, headers: Record<string, string> = {}) {
  return new Request(`https://tripcheck.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tripcheck.test",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body,
  });
}

/** Every real paid route reads its body; a template the retry cannot replay only breaks there. */
async function runRecoveringRetry(requestBody: string) {
  googleProviderCircuit.reset();
  const bodiesSeen: string[] = [];
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async (request) => {
    appCalls += 1;
    try {
      bodiesSeen.push(await request.text());
    } catch (error) {
      bodiesSeen.push(`unreadable:${(error as Error).name}`);
    }
    return appCalls === 1
      ? Response.json({ code: "unavailable" }, { status: 502 })
      : Response.json({ recovered: true });
  };
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const db = new RetryTestD1();
    const response = await worker.fetch(paidPost("/api/place-intelligence", requestBody), environment(db), context);
    return { response, appCalls, bodiesSeen, db };
  } finally {
    Math.random = originalRandom;
    googleProviderCircuit.reset();
  }
}

test("a retried paid request replays byte-identical content and recovers", async () => {
  const body = JSON.stringify({ name: "not persisted" });
  const { response, appCalls, bodiesSeen } = await runRecoveringRetry(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recovered: true });
  assert.equal(appCalls, 2, "the retry must reach the application handler");
  assert.deepEqual(bodiesSeen, [body, body], "both attempts must read the same bytes");
});

test("the retry path is not a race — 120 consecutive recoveries, zero lost retries", async () => {
  const body = JSON.stringify({ name: "not persisted" });
  const failures: { run: number; status: number; appCalls: number; bodiesSeen: string[] }[] = [];
  for (let run = 0; run < 120; run += 1) {
    const { response, appCalls, bodiesSeen } = await runRecoveringRetry(body);
    const bodiesMatch = bodiesSeen.length === 2 && bodiesSeen.every((seen) => seen === body);
    if (response.status !== 200 || appCalls !== 2 || !bodiesMatch) {
      failures.push({ run, status: response.status, appCalls, bodiesSeen });
    }
  }
  assert.deepEqual(failures, [], "every attempt must be replayable from the same materialised body");
});

test("an oversized body is refused before any attempt or D1 reservation", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ shouldNotRun: true });
  };
  const db = new RetryTestD1();
  const oversized = JSON.stringify({ name: "x".repeat(256 * 1024) });
  const response = await worker.fetch(paidPost("/api/live-routes", oversized), environment(db), context);
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { code: string }).code, "invalid_request");
  assert.equal(appCalls, 0, "an oversized body must never reach the application handler");
  assert.equal(db.reservations, 0, "an oversized body must never reserve durable quota");
});

test("an oversized body without Content-Length is still measured in real bytes", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ shouldNotRun: true });
  };
  const db = new RetryTestD1();
  const oversized = new TextEncoder().encode(JSON.stringify({ legs: [{ pad: "x".repeat(300 * 1024) }] }));
  const streamed = new Request("https://tripcheck.test/api/live-routes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://tripcheck.test",
      "Sec-Fetch-Site": "same-origin",
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const response = await worker.fetch(streamed, environment(db), context);
  assert.equal(response.status, 400);
  assert.equal(appCalls, 0);
  assert.equal(db.reservations, 0);
});

test("an unparseable body is refused before D1 for operations that price by content", async () => {
  let appCalls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    appCalls += 1;
    return Response.json({ shouldNotRun: true });
  };
  const db = new RetryTestD1();
  const response = await worker.fetch(paidPost("/api/live-routes", "{not json"), environment(db), context);
  assert.equal(response.status, 400);
  assert.equal(appCalls, 0);
  assert.equal(db.reservations, 0);
});
