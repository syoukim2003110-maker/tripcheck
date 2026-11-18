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

test("a region where transit never answers stops being asked about transit", async () => {
  const { appleRelayEta } = await import("../lib/apple-relay-client.ts");
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get("mode")!);
    return url.searchParams.get("mode") === "transit"
      ? Response.json({ minutes: null, distanceMeters: null })
      : Response.json({ minutes: 20, distanceMeters: 1500 });
  }) as typeof fetch;
  const relay = "https://example.test/coverage-test/apple.php";
  const leg = (index: number, mode: "transit" | "walk") => appleRelayEta({
    origin: { latitude: 35.0 + index * 0.01, longitude: 135.75 },
    destination: { latitude: 35.2, longitude: 135.70 + index * 0.01 },
    mode,
  }, relay, fetcher);

  for (let index = 0; index < 6; index += 1) assert.equal(await leg(index, "transit"), null);
  // Three unanswered lookups were enough; the other three cost nothing.
  assert.equal(calls.filter((mode) => mode === "transit").length, 3);
  // Walking is unaffected, and so is transit somewhere else entirely.
  assert.deepEqual(await leg(9, "walk"), { minutes: 20, distanceMeters: 1500 });
  await appleRelayEta({ origin: { latitude: 22.3, longitude: 114.17 }, destination: { latitude: 22.28, longitude: 114.15 }, mode: "transit" }, relay, fetcher);
  assert.equal(calls.filter((mode) => mode === "transit").length, 4);
});

test("the relay returns the way along the streets, and remembers it", async () => {
  const { appleRelayRoute } = await import("../lib/apple-relay-client.ts");
  let calls = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("op"), "route");
    assert.equal(url.searchParams.get("from"), "35.69400,139.74400");
    assert.equal(url.searchParams.get("mode"), "walk");
    return Response.json({ minutes: 24, distanceMeters: 1339, path: [[35.694, 139.744], [35.69, 139.75], ["x", 1], [35.685, 139.753]] });
  }) as typeof fetch;
  const options = { origin: { latitude: 35.694, longitude: 139.744 }, destination: { latitude: 35.685, longitude: 139.753 }, mode: "walk" as const };
  const route = await appleRelayRoute(options, "https://example.test/route-a.php", fetcher);
  assert.equal(route?.minutes, 24);
  assert.equal(route?.distanceMeters, 1339);
  // The malformed point is dropped, not repaired.
  assert.equal(route?.path.length, 3);
  await appleRelayRoute(options, "https://example.test/route-a.php", fetcher);
  assert.equal(calls, 1);
});

test("no route from the map service is an answer, a failing relay is an error", async () => {
  const { appleRelayRoute } = await import("../lib/apple-relay-client.ts");
  const options = { origin: { latitude: 1, longitude: 2 }, destination: { latitude: 1.01, longitude: 2.01 }, mode: "drive" as const };
  const none = (async () => Response.json({ minutes: null, distanceMeters: null, path: [] })) as typeof fetch;
  assert.equal(await appleRelayRoute(options, "https://example.test/route-b.php", none), null);
  const down = (async () => Response.json({ code: "unavailable" }, { status: 502 })) as typeof fetch;
  await assert.rejects(() => appleRelayRoute(options, "https://example.test/route-c.php", down), AppleRelayError);
  await assert.rejects(() => appleRelayRoute(options, null), AppleRelayError);
});

test("a leg Apple cannot route is asked of the open router, once", async () => {
  const { fetchStreetRoute, OPEN_ROUTER_ORIGIN } = await import("../lib/street-route-client.ts");
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.origin === OPEN_ROUTER_ORIGIN ? `osm ${url.pathname.split("/")[1]}` : `apple ${url.searchParams.get("mode")}`);
    if (url.origin !== OPEN_ROUTER_ORIGIN) return Response.json({ minutes: null, distanceMeters: null, path: [] });
    // GeoJSON order: longitude first.
    assert.match(url.pathname, /\/139\.74269,35\.69396;139\.75210,35\.68250$/);
    return Response.json({ code: "Ok", routes: [{ duration: 2520, geometry: { coordinates: [[139.74269, 35.69396], [139.75, 35.69], [139.7521, 35.6825]] } }] });
  }) as typeof fetch;
  const options = { origin: { latitude: 35.69396, longitude: 139.74269 }, destination: { latitude: 35.6825, longitude: 139.7521 }, mode: "walk" as const };
  const dependencies = { relayUrl: "https://example.test/street-a.php", fetcher };
  const answer = await fetchStreetRoute(options, dependencies);
  assert.ok(answer.status === "found");
  assert.equal(answer.route.source, "osm");
  assert.equal(answer.route.minutes, 42);
  assert.deepEqual(answer.route.path[1], { latitude: 35.69, longitude: 139.75 });
  await fetchStreetRoute(options, dependencies);
  assert.deepEqual(seen, ["apple walk", "osm routed-foot"]);
});

test("with no relay the open router draws the road, without a drive time to plan with", async () => {
  const { fetchStreetRoute } = await import("../lib/street-route-client.ts");
  const fetcher = (async (input: RequestInfo | URL) => {
    assert.match(String(input), /routed-car\/route\/v1\/driving/);
    return Response.json({ code: "Ok", routes: [{ duration: 600, geometry: { coordinates: [[2, 1], [2.01, 1.01]] } }] });
  }) as typeof fetch;
  const answer = await fetchStreetRoute({ origin: { latitude: 1, longitude: 2 }, destination: { latitude: 1.01, longitude: 2.01 }, mode: "drive" }, { relayUrl: null, fetcher });
  assert.ok(answer.status === "found");
  assert.equal(answer.route.minutes, null);
  assert.equal(answer.route.path.length, 2);
});

test("no route is an answer that is remembered; a failure is neither and is asked again", async () => {
  const { fetchStreetRoute } = await import("../lib/street-route-client.ts");
  let calls = 0;
  const noRoute = (async () => { calls += 1; return Response.json({ code: "NoRoute" }, { status: 400 }); }) as typeof fetch;
  const pair = { origin: { latitude: 3, longitude: 4 }, destination: { latitude: 3.1, longitude: 4.1 }, mode: "walk" as const };
  assert.deepEqual(await fetchStreetRoute(pair, { relayUrl: null, fetcher: noRoute }), { status: "none" });
  await fetchStreetRoute(pair, { relayUrl: null, fetcher: noRoute });
  assert.equal(calls, 1);

  // Busy, broken or offline: never an error thrown at the page, never cached.
  let attempts = 0;
  const busy = (async () => { attempts += 1; return Response.json({ message: "Too Many Requests" }, { status: 429 }); }) as typeof fetch;
  const other = { origin: { latitude: 5, longitude: 6 }, destination: { latitude: 5.1, longitude: 6.1 }, mode: "walk" as const };
  assert.deepEqual(await fetchStreetRoute(other, { relayUrl: null, fetcher: busy }), { status: "failed" });
  assert.deepEqual(await fetchStreetRoute(other, { relayUrl: null, fetcher: busy }), { status: "failed" });
  assert.equal(attempts, 2);
  const offline = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  assert.deepEqual(await fetchStreetRoute({ ...other, mode: "drive" }, { relayUrl: null, fetcher: offline }), { status: "failed" });
});

test("a relay that fails is left alone for a while, and the open router answers instead", async () => {
  const { fetchStreetRoute, OPEN_ROUTER_ORIGIN } = await import("../lib/street-route-client.ts");
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.origin === OPEN_ROUTER_ORIGIN ? "osm" : "relay");
    if (url.origin !== OPEN_ROUTER_ORIGIN) return Response.json({ code: "unavailable" }, { status: 502 });
    return Response.json({ code: "Ok", routes: [{ duration: 600, geometry: { coordinates: [[8, 7], [8.01, 7.01]] } }] });
  }) as typeof fetch;
  const dependencies = { relayUrl: "https://example.test/street-down.php", fetcher };
  const first = await fetchStreetRoute({ origin: { latitude: 7, longitude: 8 }, destination: { latitude: 7.01, longitude: 8.01 }, mode: "walk" }, dependencies);
  const second = await fetchStreetRoute({ origin: { latitude: 7.2, longitude: 8 }, destination: { latitude: 7.21, longitude: 8.01 }, mode: "walk" }, dependencies);
  assert.equal(first.status, "found");
  assert.equal(second.status, "found");
  // One wait on the broken relay, not one per leg.
  assert.deepEqual(seen, ["relay", "osm", "osm"]);
});

test("while the booklet shows no Apple map, Apple is never asked for a street", async (t) => {
  const { fetchStreetRoute, OPEN_ROUTER_ORIGIN } = await import("../lib/street-route-client.ts");
  // Past the minute an earlier test's failing relay is left alone for.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 5 * 60_000 });
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.origin === OPEN_ROUTER_ORIGIN ? "osm" : "apple");
    if (url.origin !== OPEN_ROUTER_ORIGIN) return Response.json({ minutes: 4, distanceMeters: 300, path: [[1, 2], [1.001, 2.001]] });
    return Response.json({ code: "NoRoute" }, { status: 400 });
  }) as typeof fetch;
  const leg = { origin: { latitude: 21, longitude: 22 }, destination: { latitude: 21.01, longitude: 22.01 }, mode: "walk" as const };
  // The page passes no relay while its Apple map is not on screen: the leg keeps its estimate.
  assert.deepEqual(await fetchStreetRoute(leg, { relayUrl: null, fetcher }), { status: "none" });
  assert.deepEqual(seen, ["osm"]);
  // Once the map is shown the same leg is asked of Apple: "none" from the open router was not kept for it.
  const answer = await fetchStreetRoute(leg, { relayUrl: "https://example.test/street-map-shown.php", fetcher });
  assert.ok(answer.status === "found");
  assert.equal(answer.route.source, "apple");
  assert.deepEqual(seen, ["osm", "apple"]);
});

test("the page asks Apple only while its Apple map is on screen, and drops Apple's lines when the map goes", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  assert.match(page, /const relayUrl = appleMap === "ready" \? appleRelayUrl\(\) : null;/);
  assert.match(page, /fetchStreetRoute\(\{[^}]*\}[^)]*\{ relayUrl \}\)/);
  // The streets wait for the map's answer rather than racing it.
  assert.match(page, /appleMap === "pending"\) return;/);
  const dropping = page.slice(page.indexOf("const onMapState = useCallback"), page.indexOf("}, []);", page.indexOf("const onMapState = useCallback")));
  assert.match(dropping, /route\?\.source === "apple"/);
  assert.match(dropping, /askedRoutes\.current\.delete\(key\)/);
});

// Last in this file: it moves the clock, and the relay's rest is kept per process.
test("a leg asked about during an outage is asked of Apple again once the relay is back", async (t) => {
  const { fetchStreetRoute, OPEN_ROUTER_ORIGIN } = await import("../lib/street-route-client.ts");
  // Past any rest an earlier test in this file started.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10 * 60_000 });
  let healthy = false;
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin === OPEN_ROUTER_ORIGIN) {
      seen.push("osm");
      throw new TypeError("offline");
    }
    seen.push("relay");
    // What the relay answers when Apple does not reply: an error, not a 200 with no route in it.
    if (!healthy) return Response.json({ code: "unavailable" }, { status: 502 });
    return Response.json({ minutes: 9, distanceMeters: 700, path: [[9, 10], [9.005, 10.005], [9.01, 10.01]] });
  }) as typeof fetch;
  const leg = { origin: { latitude: 9, longitude: 10 }, destination: { latitude: 9.01, longitude: 10.01 }, mode: "drive" as const };
  const dependencies = { relayUrl: "https://example.test/street-recover.php", fetcher };
  assert.deepEqual(await fetchStreetRoute(leg, dependencies), { status: "failed" });

  healthy = true;
  // Within the minute the relay is left alone…
  assert.deepEqual(await fetchStreetRoute(leg, dependencies), { status: "failed" });
  assert.deepEqual(seen, ["relay", "osm", "osm"]);
  // …and after it the same leg gets Apple's measured answer: nothing kept "no route" for it.
  t.mock.timers.tick(61_000);
  const answer = await fetchStreetRoute(leg, dependencies);
  assert.ok(answer.status === "found");
  assert.equal(answer.route.source, "apple");
  assert.equal(answer.route.minutes, 9);
  assert.deepEqual(seen, ["relay", "osm", "osm", "relay"]);
});
