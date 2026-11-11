import assert from "node:assert/strict";
import test from "node:test";

import { appleRelayClient, appleRelayPlaceSearch, AppleRelayError, appleRelaySearch } from "../lib/apple-relay-client.ts";
import { OpenPlaceResolver } from "../lib/open-place-resolver.ts";
import { requestPlaceResolution, setOpenPlaceResolutionTransport } from "../lib/place-resolution-client.ts";

test("in a page the resolver asks Wikimedia for anonymous CORS and sets no User-Agent", async () => {
  const seen: Array<{ url: URL; userAgent: string | null }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
    if (url.host === "ja.wikipedia.org" && url.searchParams.get("list") === "search") {
      return Response.json({ query: { search: [{ pageid: 1, title: "新宿御苑" }] } });
    }
    if (url.host === "ja.wikipedia.org") {
      return Response.json({ query: { pages: [{ pageid: 1, title: "新宿御苑", length: 30_000, coordinates: [{ lat: 35.6853, lon: 139.7097, primary: true, globe: "earth" }] }] } });
    }
    if (url.host === "www.wikidata.org") return Response.json({ query: { pages: [] } });
    if (url.host === "query.wikidata.org") return Response.json({ results: { bindings: [] } });
    return new Response("busy", { status: 503 });
  }) as typeof fetch;
  const resolver = new OpenPlaceResolver({ fetcher, hostIntervalMs: 0, sleep: async () => {}, browser: true });
  const result = await resolver.resolve({ queries: ["新宿御苑"], providerOverrides: [], hotelQuery: null, languageCode: "ja", destination: "auto" });

  assert.equal(result.places[0]?.name, "新宿御苑");
  // A custom User-Agent would turn every lookup into a CORS preflight.
  assert.ok(seen.every((call) => call.userAgent === null));
  for (const call of seen.filter(({ url }) => url.host === "ja.wikipedia.org" || url.host === "www.wikidata.org")) {
    assert.equal(call.url.searchParams.get("origin"), "*", call.url.host);
  }
  // The query service answers CORS without the parameter and rejects unknown ones.
  assert.ok(seen.filter(({ url }) => url.host === "query.wikidata.org").every(({ url }) => !url.searchParams.has("origin")));
});

test("the default transport resolves inside the page and never calls this origin's API", async () => {
  const originalFetch = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const text = String(input);
    assert.ok(!text.startsWith("/api/"), `unexpected same-origin API call ${text}`);
    const url = new URL(text);
    hosts.push(url.host);
    if (url.host === "en.wikipedia.org" && url.searchParams.get("list") === "search") {
      return Response.json({ query: { search: [{ pageid: 7, title: "Synthetic Tower" }] } });
    }
    if (url.host === "en.wikipedia.org") {
      return Response.json({ query: { pages: [{ pageid: 7, title: "Synthetic Tower", length: 30_000, coordinates: [{ lat: 48.8583, lon: 2.2945, primary: true, globe: "earth" }] }] } });
    }
    if (url.host === "www.wikidata.org") return Response.json({ query: { pages: [] } });
    if (url.host === "query.wikidata.org") return Response.json({ results: { bindings: [] } });
    return new Response("busy", { status: 503 });
  }) as typeof fetch;
  setOpenPlaceResolutionTransport("browser");
  try {
    const result = await requestPlaceResolution("Synthetic Tower", "", "en");
    assert.equal(result.provider, "open_place_data");
    assert.equal(result.places[0]?.name, "Synthetic Tower");
    assert.ok(hosts.includes("en.wikipedia.org"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the relay client sends only a search and reads back places", async () => {
  const calls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(new URL(String(input)));
    return Response.json({ results: [
      { id: "A1", name: "一蘭 渋谷店", latitude: 35.6611, longitude: 139.7011, formattedAddress: "渋谷区神南", locality: "渋谷区", subLocality: "神南", countryCode: "jp", poiCategory: "Restaurant" },
      { name: "座標なし" },
    ] });
  }) as typeof fetch;
  const places = await appleRelaySearch({
    query: "一蘭",
    language: "ja-JP",
    near: { latitude: 35.66, longitude: 139.7 },
    withinMeters: 1_200,
    poiCategories: ["Restaurant", "Cafe"],
    poiOnly: true,
  }, "https://example.test/api/apple.php", fetcher);

  assert.deepEqual(Object.fromEntries(calls[0].searchParams), {
    q: "一蘭",
    lang: "ja-JP",
    near: "35.66000,139.70000",
    within: "1200",
    categories: "Restaurant,Cafe",
    poi: "1",
  });
  assert.equal(places.length, 1);
  assert.equal(places[0].countryCode, "JP");
});

test("no relay configured means not available, never a guess", async () => {
  assert.equal(appleRelayClient(null), null);
  assert.equal(appleRelayPlaceSearch(null), null);
  await assert.rejects(
    () => appleRelaySearch({ query: "x", language: "en-US" }, null),
    (error) => error instanceof AppleRelayError && error.code === "not_configured",
  );
  const limited = (async () => Response.json({ code: "budget_exhausted" }, { status: 429 })) as typeof fetch;
  await assert.rejects(
    () => appleRelaySearch({ query: "x", language: "en-US" }, "https://example.test/apple.php", limited),
    (error) => error instanceof AppleRelayError && error.code === "quota_exhausted",
  );
});

test("travel times: one request per pair, mode and hour; no answer stays no answer", async () => {
  const { appleRelayEta } = await import("../lib/apple-relay-client.ts");
  const calls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    return url.searchParams.get("mode") === "transit"
      ? Response.json({ minutes: null, distanceMeters: null })
      : Response.json({ minutes: 87, distanceMeters: 3911 });
  }) as typeof fetch;
  const relay = "https://example.test/eta-test/apple.php";
  const leg = {
    origin: { latitude: 22.284, longitude: 114.15 },
    destination: { latitude: 22.2755, longitude: 114.1438 },
    departureTime: "2026-11-14T10:11:00+08:00",
  };

  assert.deepEqual(await appleRelayEta({ ...leg, mode: "walk" }, relay, fetcher), { minutes: 87, distanceMeters: 3911 });
  // A few minutes later in the same hour: answered from memory.
  assert.deepEqual(await appleRelayEta({ ...leg, mode: "walk", departureTime: "2026-11-14T10:40:00+08:00" }, relay, fetcher), { minutes: 87, distanceMeters: 3911 });
  // Apple has no transit data here: null, and that is remembered too.
  assert.equal(await appleRelayEta({ ...leg, mode: "transit" }, relay, fetcher), null);
  assert.equal(await appleRelayEta({ ...leg, mode: "transit" }, relay, fetcher), null);
  // The same point twice is not a journey.
  assert.deepEqual(await appleRelayEta({ ...leg, destination: leg.origin, mode: "drive" }, relay, fetcher), { minutes: 1, distanceMeters: 0 });

  assert.equal(calls.length, 2);
  assert.deepEqual(Object.fromEntries(calls[0].searchParams), {
    op: "eta",
    from: "22.28400,114.15000",
    to: "22.27550,114.14380",
    mode: "walk",
    depart: "2026-11-14T10:11:00+08:00",
  });
});
