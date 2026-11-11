import assert from "node:assert/strict";
import test from "node:test";
import {
  PlaceResolutionError,
  requestPlaceResolution,
  setOpenPlaceResolutionTransport,
} from "../lib/place-resolution-client.ts";

// These tests pin the HTTP boundary of a deployment that runs server routes;
// the default transport resolves inside the page and is covered separately.
setOpenPlaceResolutionTransport("http");

function restoreOptIn(value: string | undefined) {
  if (value === undefined) delete process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  else process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED = value;
}

function successfulResolution(provider: "google_maps" | "open_place_data") {
  return Response.json({
    provider,
    fetchedAt: "2026-08-15T00:00:00.000Z",
    places: [],
    hotel: null,
    ambiguous: [],
  });
}

test("zero-cost mode resolves through the open endpoint and never probes Google", async () => {
  const originalFetch = globalThis.fetch;
  const originalOptIn = process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  const calls: string[] = [];
  delete process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    if (String(input) === "/api/place-resolution/open") return successfulResolution("open_place_data");
    throw new Error("paid endpoint must not be reached");
  }) as typeof fetch;
  try {
    const result = await requestPlaceResolution("Synthetic open place", "", "en");
    assert.equal(result.provider, "open_place_data");
    assert.deepEqual(calls, ["/api/place-resolution/open"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreOptIn(originalOptIn);
  }
});

test("an open-provider outage still never spends without the explicit paid opt-in", async () => {
  const originalFetch = globalThis.fetch;
  const originalOptIn = process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  const calls: string[] = [];
  delete process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return Response.json({ code: "unavailable" }, { status: 502 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      requestPlaceResolution("Synthetic unavailable place", "", "en"),
      (error: unknown) => error instanceof PlaceResolutionError && error.code === "unavailable",
    );
    assert.deepEqual(calls, ["/api/place-resolution/open"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreOptIn(originalOptIn);
  }
});

test("Google is a fallback only after both an open failure and an explicit paid opt-in", async () => {
  const originalFetch = globalThis.fetch;
  const originalOptIn = process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  const calls: string[] = [];
  process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED = "true";
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    if (String(input) === "/api/place-resolution/open") {
      return Response.json({ code: "unavailable" }, { status: 502 });
    }
    if (String(input) === "/api/place-resolution") return successfulResolution("google_maps");
    return Response.json({ code: "unexpected_endpoint" }, { status: 500 });
  }) as typeof fetch;
  try {
    const result = await requestPlaceResolution("Synthetic opted-in place", "", "en");
    assert.equal(result.provider, "google_maps");
    assert.deepEqual(calls, ["/api/place-resolution/open", "/api/place-resolution"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreOptIn(originalOptIn);
  }
});

test("an opted-in exact Google choice is rehydrated exactly, never text-searched by OSM", async () => {
  const originalFetch = globalThis.fetch;
  const originalOptIn = process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED = "true";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return url.endsWith("/open")
      ? successfulResolution("open_place_data")
      : successfulResolution("google_maps");
  }) as typeof fetch;
  try {
    const result = await requestPlaceResolution(
      "Chosen exact place",
      "",
      "en",
      "auto",
      undefined,
      [{ inputIndex: 0, providerRef: "ChIJ_exact_google_id" }],
    );
    assert.equal(result.provider, "google_maps");
    assert.deepEqual(calls.map((call) => call.url), ["/api/place-resolution/open", "/api/place-resolution"]);
    assert.deepEqual(calls[0]?.body.queries, []);
    assert.deepEqual(calls[0]?.body.providerOverrides, [{
      inputIndex: 0,
      input: "Chosen exact place",
      providerRef: "ChIJ_exact_google_id",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreOptIn(originalOptIn);
  }
});

test("invalid open requests never cross into the paid boundary even when opted in", async () => {
  const originalFetch = globalThis.fetch;
  const originalOptIn = process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED;
  const calls: string[] = [];
  process.env.NEXT_PUBLIC_TRIPCHECK_PAID_PLACE_RESOLUTION_ENABLED = "true";
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return Response.json({ code: "invalid_request" }, { status: 400 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      requestPlaceResolution("Synthetic invalid place", "", "en"),
      (error: unknown) => error instanceof PlaceResolutionError && error.code === "invalid_request",
    );
    assert.deepEqual(calls, ["/api/place-resolution/open"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreOptIn(originalOptIn);
  }
});
