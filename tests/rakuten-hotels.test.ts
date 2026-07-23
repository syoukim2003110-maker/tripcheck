import assert from "node:assert/strict";
import test from "node:test";
import { buildRakutenSearchUrl, fetchRakutenHotelFacts, matchRakutenFact, parseRakutenHotels } from "../lib/rakuten-hotels.ts";

test("rakuten search uses WGS84 degrees and a bounded radius", () => {
  const url = buildRakutenSearchUrl("app-id", 34.66, 135.43);
  assert.match(url, /datumType=1/);
  assert.match(url, /searchRadius=3/);
  assert.match(url, /^https:\/\/openapi\.rakuten\.co\.jp\/engine\/api\/Travel\/SimpleHotelSearch\/20170426\?/);
  assert.doesNotMatch(url, /accessKey=/, "the access key belongs in a header, not a logged URL");
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
      { hotel: [{ hotelBasicInfo: { hotelName: "壊れたデータ", latitude: 34.6, longitude: 135.4 } }] },
      { hotel: [{}] },
    ],
  });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].minCharge, 9800);
  assert.equal(facts[0].reviewAverage, 4.21);
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
