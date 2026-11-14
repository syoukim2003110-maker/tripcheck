import assert from "node:assert/strict";
import { test } from "node:test";

import { applePlaceIdFor, applePlaceIdOfStop, createMapTokenSource, matchApplePlace, placeNamesMatch, readMapToken } from "../lib/apple-place-card.ts";
import type { AppleRelayPlace } from "../lib/apple-relay-client.ts";

const place = (id: string | null, name: string, latitude: number, longitude: number): AppleRelayPlace => ({
  id, name, latitude, longitude, formattedAddress: "", locality: null, subLocality: null, countryCode: "JP", poiCategory: null,
});

// Tokyo Skytree; 0.001° of latitude is about 111 m.
const skytree = { name: "東京スカイツリー", lat: 35.71006, lon: 139.8107 };

test("a token is fetched once and reused until shortly before it expires", async () => {
  let now = 1_000;
  let calls = 0;
  const token = createMapTokenSource(async () => { calls += 1; return { token: `t${calls}`, expiresAt: now + 1200 }; }, () => now);
  assert.equal(await token(), "t1");
  now += 1100;
  assert.equal(await token(), "t1");
  assert.equal(calls, 1);
  // Inside the last minute the old token is no longer handed out.
  now += 50;
  assert.equal(await token(), "t2");
  assert.equal(calls, 2);
});

test("callers arriving together share one token request, and a failure is not remembered", async () => {
  let calls = 0;
  let fail = true;
  const token = createMapTokenSource(async () => {
    calls += 1;
    if (fail) throw new Error("down");
    return { token: "ok", expiresAt: 5_000 };
  }, () => 0);
  await assert.rejects(token());
  fail = false;
  assert.deepEqual(await Promise.all([token(), token(), token()]), ["ok", "ok", "ok"]);
  assert.equal(calls, 2);
});

test("only a well-formed relay answer is taken as a token", () => {
  assert.deepEqual(readMapToken({ token: "a.b-c.d_e", expiresAt: 10 }), { token: "a.b-c.d_e", expiresAt: 10 });
  assert.equal(readMapToken({ token: "not a jwt", expiresAt: 10 }), null);
  assert.equal(readMapToken({ token: "a.b.c" }), null);
  assert.equal(readMapToken({ code: "budget_exhausted" }), null);
  assert.equal(readMapToken(null), null);
});

test("a stop from the map search carries its Apple id; one named after coordinates does not", () => {
  assert.equal(applePlaceIdOfStop("apple-I63802885C8189B2B"), "I63802885C8189B2B");
  assert.equal(applePlaceIdOfStop("apple-35.65858,139.74543"), null);
  assert.equal(applePlaceIdOfStop("wikidata-Q1136"), null);
  assert.equal(applePlaceIdOfStop("hotpepper-J001234567"), null);
});

test("names match when one contains the other or they share their first four characters", () => {
  assert.equal(placeNamesMatch("東京スカイツリー", "東京スカイツリー®"), true);
  assert.equal(placeNamesMatch("ＴＯＫＹＯ　Ｓｋｙｔｒｅｅ", "tokyo skytree town"), true);
  assert.equal(placeNamesMatch("東京国立博物館", "東京国立近代美術館"), true);
  assert.equal(placeNamesMatch("浅草寺", "浅草神社"), false);
  assert.equal(placeNamesMatch("東京スカイツリー", "すみだ水族館"), false);
  // A single shared character is no evidence.
  assert.equal(placeNamesMatch("寺", "浅草寺"), false);
});

test("a search result is accepted only within 150 m and under a matching name", () => {
  const near = place("IAAAAAAAAAAAAAAA1", "東京スカイツリー", skytree.lat + 0.0005, skytree.lon);
  assert.equal(matchApplePlace(skytree, [near])?.id, "IAAAAAAAAAAAAAAA1");
  // Right name, 220 m away: another branch or another entrance, not certain enough.
  assert.equal(matchApplePlace(skytree, [place("IAAAAAAAAAAAAAAA2", "東京スカイツリー", skytree.lat + 0.002, skytree.lon)]), null);
  // On the spot, wrong name: the aquarium in the same building.
  assert.equal(matchApplePlace(skytree, [place("IAAAAAAAAAAAAAAA3", "すみだ水族館", skytree.lat, skytree.lon)]), null);
  // Without an Apple id there is nothing to look up.
  assert.equal(matchApplePlace(skytree, [place(null, "東京スカイツリー", skytree.lat, skytree.lon)]), null);
  // Of two that qualify, the nearer one.
  const nearer = place("IAAAAAAAAAAAAAAA4", "東京スカイツリータウン", skytree.lat + 0.0001, skytree.lon);
  assert.equal(matchApplePlace(skytree, [near, nearer])?.id, "IAAAAAAAAAAAAAAA4");
});

test("a searched stop asks the relay once, near itself, and a map-search stop not at all", async () => {
  const asked: unknown[] = [];
  const search = async (options: unknown) => { asked.push(options); return [place("IBBBBBBBBBBBBBBBB", "東京スカイツリー", skytree.lat, skytree.lon)]; };
  const stop = { id: "wikidata-Q-test-skytree", ...skytree };
  assert.equal(await applePlaceIdFor(stop, "ja", search as never), "IBBBBBBBBBBBBBBBB");
  assert.equal(await applePlaceIdFor(stop, "ja", search as never), "IBBBBBBBBBBBBBBBB");
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], { query: "東京スカイツリー", language: "ja-JP", near: { latitude: skytree.lat, longitude: skytree.lon }, withinMeters: 400, poiOnly: true });
  assert.equal(await applePlaceIdFor({ id: "apple-I63802885C8189B2B", ...skytree }, "en", search as never), "I63802885C8189B2B");
  assert.equal(asked.length, 1);
  // A made-up place: the search finds nothing that is certainly it.
  assert.equal(await applePlaceIdFor({ id: "custom-nowhere", name: "ぽんぽこ秘密基地", lat: skytree.lat, lon: skytree.lon }, "ja", search as never), null);
});
