import assert from "node:assert/strict";
import test from "node:test";

import { fetchAppleFoodCandidates } from "../lib/apple-food.ts";
import { defaultFoodDiscoveryQuery } from "../lib/google-food.ts";
import { OpenPlaceResolver } from "../lib/open-place-resolver.ts";
import {
  AppleMapsClient,
  AppleMapsError,
  appleMapsCredentialsFromEnvironment,
  signAppleMapsAuthToken,
} from "../lib/server/apple-maps.ts";
import { appleMapsPlaceSearch } from "../lib/server/apple-maps-places.ts";

async function testCredentials() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = btoa(Array.from(der, (byte) => String.fromCharCode(byte)).join("")).replace(/(.{64})/g, "$1\n");
  return {
    credentials: {
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`,
    },
    publicKey: pair.publicKey,
  };
}

function decode(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

type Fake = { calls: URL[]; authorizations: string[]; userAgents: string[]; fetcher: typeof fetch };

function fakeApple(handler: (url: URL, call: number) => Response): Fake {
  const fake: Fake = {
    calls: [],
    authorizations: [],
    userAgents: [],
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      fake.calls.push(url);
      fake.authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
      fake.userAgents.push(new Headers(init?.headers).get("User-Agent") ?? "");
      return handler(url, fake.calls.length);
    }) as typeof fetch,
  };
  return fake;
}

const tokenResponse = () => Response.json({ accessToken: "access-1", expiresInSeconds: 1_800 });

test("the auth token is a valid ES256 JWT carrying exactly Apple's documented claims", async () => {
  const { credentials, publicKey } = await testCredentials();
  const now = Date.UTC(2026, 10, 11, 3, 0, 0);
  const token = await signAppleMapsAuthToken(credentials, now);
  const [header, payload, signature] = token.split(".");

  assert.deepEqual(decode(header), { alg: "ES256", kid: "KEY1234567", typ: "JWT" });
  assert.deepEqual(decode(payload), {
    iss: "TEAM123456",
    iat: now / 1_000,
    exp: now / 1_000 + 1_800,
    scope: "server_api",
  });
  assert.equal(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${payload}`),
  ), true);
});

test("credentials are all-or-nothing and accept an escaped private key", () => {
  const key = "-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----";
  assert.equal(appleMapsCredentialsFromEnvironment({}), null);
  assert.equal(appleMapsCredentialsFromEnvironment({ APPLE_MAPS_TEAM_ID: "TEAM123456", APPLE_MAPS_KEY_ID: "KEY1234567" }), null);
  assert.equal(appleMapsCredentialsFromEnvironment({
    APPLE_MAPS_TEAM_ID: "short",
    APPLE_MAPS_KEY_ID: "KEY1234567",
    APPLE_MAPS_PRIVATE_KEY: key,
  }), null);
  const parsed = appleMapsCredentialsFromEnvironment({
    APPLE_MAPS_TEAM_ID: "TEAM123456",
    APPLE_MAPS_KEY_ID: "KEY1234567",
    APPLE_MAPS_PRIVATE_KEY: key,
  });
  assert.equal(parsed?.privateKey.includes("\n"), true);
});

test("one token exchange serves concurrent searches, and search sends the documented parameters", async () => {
  const { credentials } = await testCredentials();
  const fake = fakeApple((url) => url.pathname === "/v1/token"
    ? tokenResponse()
    : Response.json({ results: [{
      id: "I123",
      name: "一蘭 香港",
      coordinate: { latitude: 22.2801, longitude: 114.1832 },
      formattedAddressLines: ["謝斐道440號", "銅鑼灣", "香港"],
      structuredAddress: { locality: "香港", subLocality: "銅鑼灣" },
      countryCode: "hk",
      poiCategory: "Restaurant",
    }, { name: "座標なし" }] }));
  const client = new AppleMapsClient(credentials, { fetcher: fake.fetcher });

  const [first] = await Promise.all([
    client.search({
      query: "ラーメン",
      language: "ja-JP",
      near: { latitude: 22.28, longitude: 114.18 },
      withinMeters: 1_000,
      poiCategories: ["Restaurant", "Cafe"],
      poiOnly: true,
    }),
    client.search({ query: "カフェ", language: "ja-JP" }),
  ]);

  assert.equal(fake.calls.filter((url) => url.pathname === "/v1/token").length, 1);
  assert.match(fake.authorizations[0], /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const search = fake.calls.find((url) => url.searchParams.get("q") === "ラーメン")!;
  assert.equal(search.origin + search.pathname, "https://maps-api.apple.com/v1/search");
  assert.equal(search.searchParams.get("lang"), "ja-JP");
  assert.equal(search.searchParams.get("resultTypeFilter"), "Poi");
  assert.equal(search.searchParams.get("includePoiCategories"), "Restaurant,Cafe");
  // Apple answers 400 when both hints are sent: a bounded search carries the
  // region only, an unbounded one the point only.
  assert.equal(search.searchParams.get("searchLocation"), null);
  const unbounded = fake.calls.find((url) => url.searchParams.get("q") === "カフェ")!;
  assert.equal(unbounded.searchParams.get("searchRegion"), null);
  assert.equal(search.searchParams.get("searchRegionPriority"), "required");
  // north, east, south, west — and the box actually surrounds the point.
  const [north, east, south, west] = search.searchParams.get("searchRegion")!.split(",").map(Number);
  assert.ok(north > 22.28 && south < 22.28 && east > 114.18 && west < 114.18);
  assert.equal(fake.authorizations.at(-1), "Bearer access-1");
  // The Workers runtime sends no User-Agent of its own.
  assert.ok(fake.userAgents.every((value) => value.startsWith("TripCheck/")));
  // A result with no coordinate is dropped, never given an invented one.
  assert.deepEqual(first, [{
    id: "I123",
    name: "一蘭 香港",
    latitude: 22.2801,
    longitude: 114.1832,
    formattedAddress: "謝斐道440號, 銅鑼灣, 香港",
    locality: "香港",
    subLocality: "銅鑼灣",
    countryCode: "HK",
    poiCategory: "Restaurant",
  }]);
});

test("a revoked access token is exchanged once; quota and outages are distinct errors", async () => {
  const { credentials } = await testCredentials();
  const revoked = fakeApple((url, call) => {
    if (url.pathname === "/v1/token") return tokenResponse();
    return call === 2 ? new Response("{}", { status: 401 }) : Response.json({ results: [] });
  });
  assert.deepEqual(await new AppleMapsClient(credentials, { fetcher: revoked.fetcher }).search({ query: "x", language: "en-US" }), []);
  assert.equal(revoked.calls.filter((url) => url.pathname === "/v1/token").length, 2);

  const limited = fakeApple((url) => url.pathname === "/v1/token" ? tokenResponse() : new Response("{}", { status: 429 }));
  await assert.rejects(
    () => new AppleMapsClient(credentials, { fetcher: limited.fetcher }).search({ query: "x", language: "en-US" }),
    (error) => error instanceof AppleMapsError && error.code === "quota_exhausted",
  );

  // The process's own ceiling stops calls before Apple's quota is reached.
  const capped = fakeApple((url) => url.pathname === "/v1/token" ? tokenResponse() : Response.json({ results: [] }));
  const cappedClient = new AppleMapsClient(credentials, { fetcher: capped.fetcher, dailyCallCeiling: 2 });
  await cappedClient.search({ query: "x", language: "en-US" });
  await assert.rejects(
    () => cappedClient.search({ query: "y", language: "en-US" }),
    (error) => error instanceof AppleMapsError && error.code === "quota_exhausted",
  );
  assert.equal(capped.calls.length, 2);
});

test("meal candidates are ordered by distance and never claim a rating", async () => {
  const places = (names: Array<[string, number]>) => names.map(([name, offset]) => ({
    // (An Apple Place ID is letters and digits; one is made from the name.)
    id: `I${Buffer.from(name).toString("hex").slice(0, 20).toUpperCase()}`,
    name,
    latitude: 35.7148 + offset,
    longitude: 139.7967,
    formattedAddress: "台東区浅草",
    locality: "台東区",
    subLocality: "浅草",
    countryCode: "JP",
    poiCategory: "Restaurant",
  }));
  const searches: Array<{ query: string; withinMeters?: number | null }> = [];
  const client = {
    search: async (options: { query: string; withinMeters?: number | null }) => {
      searches.push(options);
      return options.withinMeters === 1_200
        ? places([["遠い店", 0.008], ["近い店", 0.001]])
        : places([["近い店", 0.001], ["もっと遠い店", 0.02]]);
    },
  };
  const candidates = await fetchAppleFoodCandidates({
    latitude: 35.7148,
    longitude: 139.7967,
    area: "浅草",
    mealKind: "lunch",
    query: defaultFoodDiscoveryQuery("ja"),
    languageCode: "ja",
    destination: "japan",
  }, client as never);

  // Two results were too few, so the wider search ran; the duplicate merged.
  assert.deepEqual(searches.map((entry) => [entry.query, entry.withinMeters]), [["レストラン", 1_200], ["レストラン", 3_000]]);
  assert.deepEqual(candidates.map((candidate) => candidate.name), ["近い店", "遠い店", "もっと遠い店"]);
  assert.ok(candidates.every((candidate) => candidate.rating === null && candidate.userRatingCount === null));
  assert.ok(candidates[0].distanceMeters! < candidates[1].distanceMeters!);
  // Apple's place opens in Apple Maps: Apple's data is not handed to another map.
  assert.match(candidates[0].googleMapsUrl, /^https:\/\/maps\.apple\.com\/\?q=/);
  assert.match(candidates[0].id, /^apple-I[0-9A-F]+$/);
});

test("Apple only sees the wishlist lines the open sources could not settle", async () => {
  const asked: string[] = [];
  const search = appleMapsPlaceSearch({
    search: async ({ query }: { query: string }) => {
      asked.push(query);
      return query === "だれも知らないラーメン店" ? [{
        id: "A1",
        name: "だれも知らないラーメン店",
        latitude: 35.662,
        longitude: 139.701,
        formattedAddress: "渋谷区道玄坂",
        locality: "渋谷区",
        subLocality: "道玄坂",
        countryCode: "JP",
        poiCategory: "Restaurant",
      }] : [];
    },
  } as never)!;
  const wiki = [
    { id: 1, title: "明治神宮", lat: 35.6764, lon: 139.6993 },
    { id: 2, title: "新宿御苑", lat: 35.6853, lon: 139.7097 },
  ];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.host === "ja.wikipedia.org" && url.searchParams.get("list") === "search") {
      const text = (url.searchParams.get("srsearch") ?? "").replace(/\s*nearcoord:\S+/, "");
      return Response.json({ query: { search: wiki.filter((page) => page.title === text).map((page) => ({ pageid: page.id, title: page.title })) } });
    }
    if (url.host === "ja.wikipedia.org") {
      const ids = (url.searchParams.get("pageids") ?? "").split("|").map(Number);
      return Response.json({ query: { pages: wiki.filter((page) => ids.includes(page.id)).map((page) => ({
        pageid: page.id, title: page.title, length: 30_000, coordinates: [{ lat: page.lat, lon: page.lon, primary: true, globe: "earth" }],
      })) } });
    }
    if (url.host === "www.wikidata.org") return Response.json({ query: { pages: [] } });
    if (url.host === "query.wikidata.org") return Response.json({ results: { bindings: [] } });
    if (url.host === "nominatim.openstreetmap.org") return Response.json([]);
    return new Response("busy", { status: 503 });
  }) as typeof fetch;
  const resolver = new OpenPlaceResolver({ fetcher, hostIntervalMs: 0, sleep: async () => {} });
  const result = await resolver.resolve({
    queries: ["明治神宮", "新宿御苑", "だれも知らないラーメン店"],
    providerOverrides: [],
    hotelQuery: null,
    languageCode: "ja",
    destination: "auto",
  }, undefined, search);

  assert.deepEqual(asked, ["だれも知らないラーメン店"]);
  const shop = result.places.find((place) => place.input === "だれも知らないラーメン店");
  assert.equal(shop?.area, "道玄坂");
  assert.equal(shop?.planningDurationMinutes, 45);
  assert.equal(result.places.length, 3);
});

test("hotel candidates are ordered by how little the whole trip has to travel", async () => {
  const { fetchAppleHotelCandidates } = await import("../lib/apple-hotels.ts");
  const hotel = (name: string, latitude: number, longitude: number) => ({
    id: `I${Buffer.from(name).toString("hex").slice(0, 20).toUpperCase()}`, name, latitude, longitude, formattedAddress: "東京都", poiCategory: "Hotel",
  });
  const searches: Array<{ query: string; withinMeters: number; poiCategories: readonly string[] }> = [];
  const client = {
    search: async (options: { query: string; withinMeters: number; poiCategories: readonly string[] }) => {
      searches.push(options);
      return options.withinMeters === 2_500
        ? [hotel("駅前ホテル", 35.6812, 139.7671), hotel("遠いホテル", 35.72, 139.82)]
        : [hotel("駅前ホテル", 35.6812, 139.7671), hotel("中間のホテル", 35.69, 139.75), hotel("渋谷のホテル", 35.659, 139.7)];
    },
  };
  const candidates = await fetchAppleHotelCandidates({
    latitude: 35.6812,
    longitude: 139.7671,
    area: "東京駅",
    // Day centres: Shibuya/Shinjuku side, Asakusa side, the bay.
    routePoints: [{ latitude: 35.67, longitude: 139.70 }, { latitude: 35.712, longitude: 139.79 }, { latitude: 35.65, longitude: 139.78 }],
    languageCode: "ja",
    destination: "japan",
  }, client);

  // Too few nearby, so the wider search ran; the duplicate merged.
  assert.deepEqual(searches.map((entry) => [entry.query, entry.withinMeters, [...entry.poiCategories]]), [["ホテル", 2_500, ["Hotel"]], ["ホテル", 5_000, ["Hotel"]]]);
  assert.equal(candidates.length, 4);
  // A hotel between the day centres beats one beside a single day's sights
  // and one out past all of them.
  assert.equal(candidates[0].name, "中間のホテル");
  assert.equal(candidates.at(-1)?.name, "遠いホテル");
  for (let index = 1; index < candidates.length; index += 1) {
    assert.ok(candidates[index - 1].routeBurdenMeters <= candidates[index].routeBurdenMeters);
  }
  // Nothing Apple did not supply is claimed.
  assert.ok(candidates.every((candidate) => candidate.rating === null && candidate.priceLevel === null && candidate.styles.length === 0));
});

test("Apple being down or unreachable is an error; only Apple saying no to the pair is 'no answer'", async () => {
  const { credentials } = await testCredentials();
  const pair = { origin: { latitude: 35.69, longitude: 139.74 }, destination: { latitude: 35.68, longitude: 139.75 } };
  const answering = (status: number) => fakeApple((url) => url.pathname === "/v1/token" ? tokenResponse() : new Response("{}", { status }));
  const unavailable = (error: unknown) => error instanceof AppleMapsError && error.code === "unavailable";
  const offline = fakeApple((url) => {
    if (url.pathname === "/v1/token") return tokenResponse();
    throw new TypeError("offline");
  });

  // A line on the map: a timeout or a 503 must not be taken for "no route",
  // which the page would keep for the rest of the visit.
  await assert.rejects(() => new AppleMapsClient(credentials, { fetcher: answering(503).fetcher }).route({ ...pair, mode: "walk" }), unavailable);
  await assert.rejects(() => new AppleMapsClient(credentials, { fetcher: offline.fetcher }).route({ ...pair, mode: "walk" }), unavailable);
  await assert.rejects(() => new AppleMapsClient(credentials, { fetcher: answering(403).fetcher }).route({ ...pair, mode: "walk" }), unavailable);
  assert.equal(await new AppleMapsClient(credentials, { fetcher: answering(400).fetcher }).route({ ...pair, mode: "walk" }), null);

  // A travel time: the same for no reply and for a refused client. An error
  // status stays "no answer", as it is how Apple answers transit it has no
  // timetable for.
  await assert.rejects(() => new AppleMapsClient(credentials, { fetcher: offline.fetcher }).eta({ ...pair, mode: "transit" }), unavailable);
  await assert.rejects(() => new AppleMapsClient(credentials, { fetcher: answering(403).fetcher }).eta({ ...pair, mode: "transit" }), unavailable);
  assert.equal(await new AppleMapsClient(credentials, { fetcher: answering(400).fetcher }).eta({ ...pair, mode: "transit" }), null);
  assert.equal(await new AppleMapsClient(credentials, { fetcher: answering(503).fetcher }).eta({ ...pair, mode: "transit" }), null);
});
