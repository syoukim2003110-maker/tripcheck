import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResultLike,
} from "../lib/server/durable-provider-quota.ts";
import { PROVIDER_QUOTA_SCHEMA_SQL, PROVIDER_QUOTA_TABLE_INFO_SQL } from "../db/provider-quota-schema.ts";
import {
  PLACE_PHOTO_TOKEN_TTL_SECONDS,
  signPlacePhotoName,
  verifyPlacePhotoToken,
} from "../lib/server/place-photo-token.ts";
import { signPlacePhotoNames } from "../lib/server/sign-place-photos.ts";
import { placePhotoSrc } from "../lib/presentation/place-photo.ts";

// P0-01. `GET /api/place-photo` spends a Google Places Photo event. It used to
// sit outside the Worker's paid-route table entirely — that table was consulted
// for POSTs only — so it met no origin gate, no durable quota and no kill
// switch. Its single defence, `Sec-Fetch-Site !== "cross-site"`, is passed by
// any client that simply sends no headers at all.

const SECRET = "place-photo-test-secret-at-least-32-characters";
const PHOTO_NAME = "places/ChIJabcdefghijkl/photos/AeJbb3fabcdefghijklmnop";

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
  fetch(request: Request, env: PhotoTestEnvironment, context: PhotoTestContext): Promise<Response>;
};

const { default: worker } = await import(new URL("../worker/index.ts", import.meta.url).href) as { default: WorkerHandler };
hooks.deregister();

class PhotoTestStatement implements D1PreparedStatementLike {
  readonly database: PhotoTestD1;
  readonly sql: string;
  bindings: unknown[] = [];

  constructor(database: PhotoTestD1, sql: string) {
    this.database = database;
    this.sql = sql;
  }

  bind(...values: unknown[]) {
    const statement = new PhotoTestStatement(this.database, this.sql);
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

class PhotoTestD1 implements D1DatabaseLike {
  batches: PhotoTestStatement[][] = [];

  prepare(query: string) {
    return new PhotoTestStatement(this, query);
  }

  async batch(statements: D1PreparedStatementLike[]) {
    const concrete = statements as PhotoTestStatement[];
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
    return this.batches.filter((batch) => batch[0]?.sql.includes("INSERT INTO provider_quota_counters"));
  }
}

type PhotoTestEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: PhotoTestD1;
  IMAGES: never;
  TRIPCHECK_PUBLIC_ORIGIN?: string;
  TRIPCHECK_QUOTA_HASH_SECRET?: string;
  TRIPCHECK_PAID_API_DISABLED?: string;
  TRIPCHECK_GOOGLE_API_DISABLED?: string;
};

type PhotoTestContext = { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void };
const context: PhotoTestContext = { waitUntil() {}, passThroughOnException() {} };

function environment(db?: PhotoTestD1, extra: Partial<PhotoTestEnvironment> = {}): PhotoTestEnvironment {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    DB: db,
    IMAGES: undefined as never,
    TRIPCHECK_PUBLIC_ORIGIN: "https://tripcheck.test",
    TRIPCHECK_QUOTA_HASH_SECRET: SECRET,
    ...extra,
  };
}

async function validSignature(photoName = PHOTO_NAME) {
  return await signPlacePhotoName(photoName, SECRET, Math.floor(Date.now() / 1000) + 600) ?? "";
}

function photoRequest(query: string, headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" }) {
  return new Request(`https://tripcheck.test/api/place-photo?${query}`, { method: "GET", headers });
}

async function upstreamAttempts(query: string, headers?: Record<string, string>) {
  let calls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { Location: "https://lh3.googleusercontent.com/example" } });
  };
  const db = new PhotoTestD1();
  const response = await worker.fetch(photoRequest(query, headers), environment(db), context);
  return { response, calls, db };
}

test("a header-free client never reaches Google", async () => {
  const signature = await validSignature();
  const { response, calls, db } = await upstreamAttempts(
    `name=${encodeURIComponent(PHOTO_NAME)}&sig=${signature}`,
    {},
  );
  assert.equal(response.status, 403);
  assert.equal(calls, 0, "no Sec-Fetch-Site means no photo");
  assert.equal(db.reservations.length, 0);
});

test("an unsigned photo name never reaches Google", async () => {
  const { response, calls, db } = await upstreamAttempts(`name=${encodeURIComponent(PHOTO_NAME)}`);
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
  assert.equal(db.reservations.length, 0, "a forgery must not even cost a quota row");
});

test("a tampered photo name never reaches Google", async () => {
  const signature = await validSignature();
  const other = "places/ChIJzyxwvutsrqpo/photos/AeJbb3fzyxwvutsrqponml";
  const { response, calls } = await upstreamAttempts(`name=${encodeURIComponent(other)}&sig=${signature}`);
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("a tampered signature never reaches Google", async () => {
  const signature = await validSignature();
  const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  const { response, calls } = await upstreamAttempts(`name=${encodeURIComponent(PHOTO_NAME)}&sig=${flipped}`);
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("an expired signature never reaches Google", async () => {
  const expired = await signPlacePhotoName(PHOTO_NAME, SECRET, Math.floor(Date.now() / 1000) - 1) ?? "";
  const { response, calls } = await upstreamAttempts(`name=${encodeURIComponent(PHOTO_NAME)}&sig=${expired}`);
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("a signature minted far into the future is refused", async () => {
  const overlong = await signPlacePhotoName(
    PHOTO_NAME,
    SECRET,
    Math.floor(Date.now() / 1000) + PLACE_PHOTO_TOKEN_TTL_SECONDS + 60,
  ) ?? "";
  assert.equal(
    await verifyPlacePhotoToken({
      photoName: PHOTO_NAME,
      token: overlong,
      secret: SECRET,
      nowSeconds: Math.floor(Date.now() / 1000),
    }),
    false,
    "a valid MAC must not become an unbounded grant",
  );
});

test("a valid signed photo reserves exactly one durable unit", async () => {
  const signature = await validSignature();
  const { response, calls, db } = await upstreamAttempts(`name=${encodeURIComponent(PHOTO_NAME)}&sig=${signature}`);
  assert.equal(response.status, 302);
  assert.equal(calls, 1);
  assert.equal(db.reservations.length, 1, "one photo, one reservation");
  for (const statement of db.reservations[0]) {
    assert.equal(statement.bindings[1], "place_photo", "photos are charged to their own operation");
    assert.equal(statement.bindings[5], 1);
  }
});

test("the kill switch stops photos like every other paid route", async () => {
  const signature = await validSignature();
  let calls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    calls += 1;
    return new Response(null, { status: 302 });
  };
  const db = new PhotoTestD1();
  const response = await worker.fetch(
    photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&sig=${signature}`),
    environment(db, { TRIPCHECK_GOOGLE_API_DISABLED: "true" }),
    context,
  );
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test("photos fail closed when the durable ledger is unavailable", async () => {
  const signature = await validSignature();
  let calls = 0;
  testGlobal.__tripCheckAppFetch = async () => {
    calls += 1;
    return new Response(null, { status: 302 });
  };
  const response = await worker.fetch(
    photoRequest(`name=${encodeURIComponent(PHOTO_NAME)}&sig=${signature}`),
    environment(undefined),
    context,
  );
  assert.equal(response.status, 503);
  assert.equal(calls, 0, "no D1, no photo");
});

test("a served photo may be reused by the browser that asked for it, and nobody else", async () => {
  const signature = await validSignature();
  const { response } = await upstreamAttempts(`name=${encodeURIComponent(PHOTO_NAME)}&sig=${signature}`);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=900");
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
});

test("the signing pass reaches nested photo names in every payload shape", async () => {
  const env = { TRIPCHECK_QUOTA_HASH_SECRET: SECRET };
  const signed = await signPlacePhotoNames({
    candidates: [
      { photoName: PHOTO_NAME },
      { photo: { name: PHOTO_NAME, attribution: null } },
      { photoName: "not-a-photo-name" },
    ],
    place: { photoName: PHOTO_NAME } as Record<string, unknown>,
  }, env);
  const [byField, byNested, invalid] = signed.candidates as Record<string, unknown>[];
  assert.equal(typeof byField.photoSignature, "string");
  assert.equal(typeof (byNested.photo as Record<string, unknown>).signature, "string");
  assert.equal(invalid.photoSignature, undefined, "only real photo names are signed");
  assert.equal(typeof signed.place.photoSignature, "string");
  assert.ok(await verifyPlacePhotoToken({
    photoName: PHOTO_NAME,
    token: byField.photoSignature as string,
    secret: SECRET,
    nowSeconds: Math.floor(Date.now() / 1000),
  }));
});

test("a card with no signature renders no photo request at all", () => {
  assert.equal(placePhotoSrc(PHOTO_NAME, null), undefined);
  assert.equal(placePhotoSrc(null, "anything"), undefined);
  assert.equal(
    placePhotoSrc(PHOTO_NAME, "1234567890.abc"),
    `/api/place-photo?name=${encodeURIComponent(PHOTO_NAME)}&sig=1234567890.abc`,
  );
});
