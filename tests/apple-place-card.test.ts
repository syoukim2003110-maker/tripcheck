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

test("only the same name, or the name plus a harmless word, counts as the same place", () => {
  assert.equal(placeNamesMatch("東京スカイツリー", "東京スカイツリー®"), true);
  assert.equal(placeNamesMatch("ＴＯＫＹＯ　Ｓｋｙｔｒｅｅ", "tokyo skytree town"), true);
  assert.equal(placeNamesMatch("靖国神社", "靖國神社"), true);
  assert.equal(placeNamesMatch("すしざんまい", "すしざんまい 本店"), true);
  // The reviewer's wrong places: each contains the stop's name, or starts like it, and is somewhere else.
  assert.equal(placeNamesMatch("東京タワー", "東京タワー水族館"), false);
  assert.equal(placeNamesMatch("東京タワー", "東京タワー駐車場"), false);
  assert.equal(placeNamesMatch("清水寺", "清水寺前バス停"), false);
  assert.equal(placeNamesMatch("ホテルニューオータニ", "ホテルニューオータニ 鉄板焼 石心亭"), false);
  assert.equal(placeNamesMatch("東京国立博物館", "東京国立近代美術館"), false);
  assert.equal(placeNamesMatch("東京ディズニーランド", "東京ディズニーシー"), false);
  assert.equal(placeNamesMatch("渋谷スクランブル交差点", "渋谷スクランブルスクエア"), false);
  assert.equal(placeNamesMatch("浅草寺", "浅草神社"), false);
  assert.equal(placeNamesMatch("東京スカイツリー", "すみだ水族館"), false);
  // A single shared character is no evidence.
  assert.equal(placeNamesMatch("寺", "浅草寺"), false);
});

test("a search result is accepted only under the stop's name and close enough for how sure the name is", () => {
  const near = place("IAAAAAAAAAAAAAAA1", "東京スカイツリー", skytree.lat + 0.0005, skytree.lon);
  assert.equal(matchApplePlace(skytree, [near])?.id, "IAAAAAAAAAAAAAAA1");
  // The very same name 220 m away is the same large site; 600 m away is another branch.
  assert.equal(matchApplePlace(skytree, [place("IAAAAAAAAAAAAAAA2", "東京スカイツリー", skytree.lat + 0.002, skytree.lon)])?.id, "IAAAAAAAAAAAAAAA2");
  assert.equal(matchApplePlace(skytree, [place("IAAAAAAAAAAAAAAA5", "東京スカイツリー", skytree.lat + 0.0055, skytree.lon)]), null);
  // A name with a harmless word added must be within 150 m.
  assert.equal(matchApplePlace(skytree, [place("IAAAAAAAAAAAAAAA6", "東京スカイツリータウン", skytree.lat + 0.002, skytree.lon)]), null);
  // On the spot, wrong name: the aquarium in the same building.
  assert.equal(matchApplePlace(skytree, [place("IAAAAAAAAAAAAAAA3", "すみだ水族館", skytree.lat, skytree.lon)]), null);
  // The same name beats a nearer longer one: the tower 80 m off, not the town 10 m off.
  const town = place("IAAAAAAAAAAAAAAA4", "東京スカイツリータウン", skytree.lat + 0.0001, skytree.lon);
  assert.equal(matchApplePlace(skytree, [town, near])?.id, "IAAAAAAAAAAAAAAA1");
  // Of two with the same name, the nearer one.
  const nearest = place("IAAAAAAAAAAAAAAA7", "東京スカイツリー", skytree.lat + 0.0001, skytree.lon);
  assert.equal(matchApplePlace(skytree, [near, nearest])?.id, "IAAAAAAAAAAAAAAA7");
  // Found live: a bus stop named exactly "東京国立博物館" beat the museum's own "東京国立博物館 本館".
  const museum = { name: "東京国立博物館", lat: 35.71889, lon: 139.77639 };
  const busStop = { ...place("IAAAAAAAAAAAAAAA8", "東京国立博物館", museum.lat + 0.0003, museum.lon), poiCategory: "PublicTransport" };
  const mainHall = { ...place("IAAAAAAAAAAAAAAA9", "東京国立博物館 本館", museum.lat + 0.0006, museum.lon), poiCategory: "Museum" };
  assert.equal(matchApplePlace(museum, [mainHall, busStop])?.id, "IAAAAAAAAAAAAAAA9");
  assert.equal(matchApplePlace(museum, [busStop]), null);
  // Without an Apple id there is nothing to look up.
  assert.equal(matchApplePlace(skytree, [place(null, "東京スカイツリー", skytree.lat, skytree.lon)]), null);
});

test("a searched stop asks the relay once, near itself, and a map-search stop not at all", async () => {
  const asked: unknown[] = [];
  const search = async (options: unknown) => { asked.push(options); return [place("IBBBBBBBBBBBBBBBB", "東京スカイツリー", skytree.lat, skytree.lon)]; };
  const stop = { id: "wikidata-Q-test-skytree", ...skytree };
  assert.equal(await applePlaceIdFor(stop, "ja", search as never), "IBBBBBBBBBBBBBBBB");
  assert.equal(await applePlaceIdFor(stop, "ja", search as never), "IBBBBBBBBBBBBBBBB");
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], { query: "東京スカイツリー", language: "ja-JP", near: { latitude: skytree.lat, longitude: skytree.lon }, withinMeters: 450, poiOnly: true });
  assert.equal(await applePlaceIdFor({ id: "apple-I63802885C8189B2B", ...skytree }, "en", search as never), "I63802885C8189B2B");
  assert.equal(asked.length, 1);
  // A made-up place: the search finds nothing that is certainly it.
  assert.equal(await applePlaceIdFor({ id: "custom-nowhere", name: "ぽんぽこ秘密基地", lat: skytree.lat, lon: skytree.lon }, "ja", search as never), null);
});
