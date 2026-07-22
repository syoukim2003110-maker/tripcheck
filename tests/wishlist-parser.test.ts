import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceResolutionPayload } from "../lib/place-resolution-client.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { formatWishlistLines, parsedWishlistPlaces, parseWishlist } from "../lib/wishlist-parser.ts";

test("a day heading with content keeps the place instead of dropping the line", () => {
  const [line] = parsedWishlistPlaces("1日目: 浅草寺");
  assert.equal(line.name, "浅草寺");
  assert.equal(line.day, 1);
});

test("a day heading binds the following lines to that day", () => {
  const places = parsedWishlistPlaces("1日目\n浅草寺\n東京スカイツリー\n2日目\n明治神宮");
  assert.deepEqual(places.map((place) => [place.name, place.day]), [
    ["浅草寺", 1],
    ["東京スカイツリー", 1],
    ["明治神宮", 2],
  ]);
});

test("comma-separated places on one line become independent stops", () => {
  const places = parsedWishlistPlaces("浅草寺、東京スカイツリー、上野公園");
  assert.deepEqual(places.map((place) => place.name), ["浅草寺", "東京スカイツリー", "上野公園"]);
});

test("a pasted Japanese middle-dot and slash list becomes individual editable places", () => {
  const input = "清水寺・伏見稲荷大社・金閣寺・嵐山（渡月橋・竹林）・祇園/花見小路・二条城・天橋立（丹後）\n大阪城・道頓堀/心斎橋・USJ・新世界（通天閣）・海遊館・万博記念公園";
  assert.deepEqual(parsedWishlistPlaces(input).map((place) => place.name), [
    "清水寺",
    "伏見稲荷大社",
    "金閣寺",
    "嵐山",
    "渡月橋",
    "嵐山 竹林",
    "祇園",
    "花見小路",
    "二条城",
    "天橋立 丹後",
    "大阪城",
    "道頓堀",
    "心斎橋",
    "USJ",
    "新世界",
    "通天閣",
    "海遊館",
    "万博記念公園",
  ]);
  assert.equal(formatWishlistLines(input, "ja").split("\n").length, 18);
});

test("a single middle dot can remain part of an official place name", () => {
  assert.deepEqual(parsedWishlistPlaces("東京ミッドタウン・日比谷").map((place) => place.name), ["東京ミッドタウン・日比谷"]);
});

test("an ASCII comma keeps an English area qualifier together", () => {
  const places = parsedWishlistPlaces("Blue Bottle Coffee, Shibuya");
  assert.deepEqual(places.map((place) => place.name), ["Blue Bottle Coffee, Shibuya"]);
});

test("kanji clock times are read, including half-hours and afternoon marks", () => {
  assert.equal(parsedWishlistPlaces("チームラボプラネッツ 15時30分 予約")[0].time, "15:30");
  assert.equal(parsedWishlistPlaces("チームラボプラネッツ 15時30分 予約")[0].isReservation, true);
  assert.equal(parsedWishlistPlaces("展望台 19時半")[0].time, "19:30");
  assert.equal(parsedWishlistPlaces("ランチ 午後1時")[0].time, "13:00");
  assert.equal(parsedWishlistPlaces("待ち合わせ 9時")[0].time, "09:00");
});

test("durations like 3時間 are not mistaken for a visit time", () => {
  const [place] = parsedWishlistPlaces("箱根で3時間くらい過ごす");
  assert.equal(place.time, null);
});

test("full-width input is normalized before parsing", () => {
  const places = parsedWishlistPlaces("１日目　浅草寺　１５：３０");
  assert.equal(places[0].name, "浅草寺");
  assert.equal(places[0].day, 1);
  assert.equal(places[0].time, "15:30");
});

test("opening-hour ranges never pin a visit time", () => {
  const [place] = parsedWishlistPlaces("国立新美術館 10:00-18:00");
  assert.equal(place.time, null);
  assert.equal(place.name, "国立新美術館");
  assert.equal(parsedWishlistPlaces("温泉 9時から17時")[0].time, null);
});

test("marker words are stripped from the resolution query", () => {
  const payload = buildPlaceResolutionPayload("2日目: 東大寺ミュージアム 10:00 予約 必須", "", "ja");
  assert.deepEqual(payload.queries, ["東大寺ミュージアム"]);
  assert.doesNotMatch(JSON.stringify(payload), /10:00|予約|必須|2日目/);
});

test("marker-only and URL-only lines are flagged instead of queried", () => {
  const lines = parseWishlist("必須\nhttps://example.com/some-place");
  assert.deepEqual(lines.map((line) => line.kind), ["unparsed", "unparsed"]);
  assert.deepEqual(buildPlaceResolutionPayload("必須\nhttps://example.com/x", "", "ja").queries, []);
});

test("day sections steer the built trip's day assignment", () => {
  const plan = buildTripFromWishlist("1日目\n明治神宮\n2日目\n浅草寺\n東京スカイツリー", 2, "balanced", "ja", {
    tripStartDate: "2026-09-14",
  });
  const dayNames = plan.days.map((day) => day.stops.map(({ stop }) => stop.name));
  assert.deepEqual(dayNames[0], ["明治神宮"]);
  assert.deepEqual([...dayNames[1]].sort(), ["東京スカイツリー", "浅草寺"]);
});

test("existing dash-marker style still parses exactly as before", () => {
  const [place] = parsedWishlistPlaces("三鷹の森ジブリ美術館 — 2日目 10:00 予約 · 必須");
  assert.equal(place.name, "三鷹の森ジブリ美術館");
  assert.equal(place.day, 2);
  assert.equal(place.time, "10:00");
  assert.equal(place.isReservation, true);
  assert.equal(place.priority, "must");
});
