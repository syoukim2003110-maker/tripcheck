import assert from "node:assert/strict";
import test from "node:test";
import { buildRakutenSearchUrl, fetchRakutenHotelFacts, matchRakutenFact, parseRakutenHotels } from "../lib/rakuten-hotels.ts";

test("rakuten search uses WGS84 degrees and a bounded radius", () => {
  const url = buildRakutenSearchUrl("app-id", 34.66, 135.43);
  assert.match(url, /datumType=1/);
  assert.match(url, /searchRadius=3/);
  assert.match(url, /^https:\/\/openapi\.rakuten\.co\.jp\/engine\/api\/Travel\/SimpleHotelSearch\/20260731\?/);
  assert.match(url, /elements=.*hotelMinCharge/);
  assert.doesNotMatch(url, /accessKey=/, "the access key belongs in a header, not a logged URL");
});

test("queue wait, rate spacing and fetch share one 2.5 second deadline without deadlocking", async () => {
  const abortAwareResponse = (delayMs: number) => (async (_input: string | URL | Request, init?: RequestInit) => (
    new Promise<Response>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(Response.json({ hotels: [] })), delayMs);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(init.signal?.reason ?? new Error("aborted"));
      }, { once: true });
    })
  )) as typeof fetch;

  // Prime the one-request-per-second clock, then make one request spend its
  // budget on both spacing and a slow fetch. A second request waits behind it.
  await fetchRakutenHotelFacts(35.401, 139.401, "deadline-app", "access-key", abortAwareResponse(0));
  const slow = fetchRakutenHotelFacts(35.501, 139.501, "deadline-app", "access-key", abortAwareResponse(2_000));
  const slowRejected = assert.rejects(slow);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const queued = fetchRakutenHotelFacts(35.601, 139.601, "deadline-app", "access-key", abortAwareResponse(2_000));
  const queuedRejected = assert.rejects(queued);
  await Promise.all([slowRejected, queuedRejected]);

  const afterTimeout = await fetchRakutenHotelFacts(35.701, 139.701, "deadline-app", "access-key", abortAwareResponse(0));
  assert.deepEqual(afterTimeout, [], "a timed-out queue turn must not strand later callers");
});

test("rakuten requests use the required access-key header", async () => {
  let requestUrl = "";
  let requestAccessKey = "";
  const facts = await fetchRakutenHotelFacts(35.6812, 139.7671, "application-id", "access-key", (async (input, init) => {
    requestUrl = String(input);
    requestAccessKey = new Headers(init?.headers).get("accessKey") ?? "";
    return Response.json({ hotels: [] });
  }) as typeof fetch);
  assert.deepEqual(facts, []);
  assert.match(requestUrl, /applicationId=application-id/);
  assert.equal(requestAccessKey, "access-key");
});

test("rakuten payloads parse defensively", () => {
  const facts = parseRakutenHotels({
    hotels: [
      { hotel: [{ hotelBasicInfo: { hotelName: "ホテル京阪 ユニバーサル・タワー", hotelMinCharge: 9800, reviewAverage: 4.21, reviewCount: 5321, hotelInformationUrl: "https://travel.rakuten.co.jp/HOTEL/1", latitude: 34.667, longitude: 135.435 } }] },
      { hotel: [{ hotelBasicInfo: { hotelName: "Affiliate hotel", hotelInformationUrl: "https://hb.afl.rakuten.co.jp/hgc/example", latitude: 35.1, longitude: 135.1 } }] },
      { hotel: [{ hotelBasicInfo: { hotelName: "Plain HTTP", hotelInformationUrl: "http://travel.rakuten.co.jp/HOTEL/2", latitude: 35.2, longitude: 135.2 } }] },
      { hotel: [{ hotelBasicInfo: { hotelName: "Lookalike host", hotelInformationUrl: "https://travel.rakuten.co.jp.evil.example/HOTEL/3", latitude: 35.3, longitude: 135.3 } }] },
      { hotel: [{ hotelBasicInfo: { hotelName: "Fake protocol", hotelInformationUrl: "httpx://travel.rakuten.co.jp/HOTEL/4", latitude: 35.4, longitude: 135.4 } }] },
      { hotel: [{ hotelBasicInfo: { hotelName: "壊れたデータ", latitude: 34.6, longitude: 135.4 } }] },
      { hotel: [{}] },
    ],
  });
  assert.equal(facts.length, 2);
  assert.equal(facts[0].minCharge, 9800);
  assert.equal(facts[0].reviewAverage, 4.21);
  assert.equal(facts[1].url, "https://hb.afl.rakuten.co.jp/hgc/example");
});

test("a fact attaches only to a clear same-building match", () => {
  const facts = parseRakutenHotels({
    hotels: [
      { hotel: [{ hotelBasicInfo: { hotelName: "ホテル京阪 ユニバーサル・タワー", hotelMinCharge: 9800, reviewAverage: 4.2, reviewCount: 100, hotelInformationUrl: "https://travel.rakuten.co.jp/HOTEL/1", latitude: 34.667, longitude: 135.435 } }] },
    ],
  });
  // Name fragment + ~150 m → match.
  assert.ok(matchRakutenFact({ name: "ホテル京阪ユニバーサル・タワー", latitude: 34.668, longitude: 135.4355 }, facts));
  // Same name but 5 km away → no match.
  assert.equal(matchRakutenFact({ name: "ホテル京阪ユニバーサル・タワー", latitude: 34.71, longitude: 135.43 }, facts), null);
  // Different name, near-exact coordinates → match (same building, alt spelling).
  assert.ok(matchRakutenFact({ name: "Keihan Universal Tower", latitude: 34.6672, longitude: 135.4351 }, facts));
  // Different name, 300 m away → no match.
  assert.equal(matchRakutenFact({ name: "全然違うホテル", latitude: 34.6695, longitude: 135.4335 }, facts), null);
});
