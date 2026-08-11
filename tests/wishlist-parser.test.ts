import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceResolutionPayload } from "../lib/place-resolution-client.ts";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { formatWishlistLines, parsedWishlistPlaces, parseWishlist, removeWishlistPlace, setWishlistPlacePriority, updateWishlistPlaceConstraints } from "../lib/wishlist-parser.ts";

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

test("parenthesized markers set flags without polluting the place name", () => {
  const [must] = parsedWishlistPlaces("Senso-ji temple (must!)");
  assert.equal(must.name, "Senso-ji temple");
  assert.equal(must.priority, "must");

  const [ticketed] = parsedWishlistPlaces("Ghibli Museum (need tickets)");
  assert.equal(ticketed.name, "Ghibli Museum");
  assert.equal(ticketed.isReservation, true);
});

test("a written time-of-day wish becomes a scheduling hint, not part of the name", () => {
  const [sunset] = parsedWishlistPlaces("Shibuya Sky at sunset");
  assert.equal(sunset.name, "Shibuya Sky");
  assert.equal(sunset.timeOfDay, "evening");

  const [morning] = parsedWishlistPlaces("豊洲市場 朝イチ");
  assert.equal(morning.name, "豊洲市場");
  assert.equal(morning.timeOfDay, "morning");

  const [night] = parsedWishlistPlaces("渋谷スカイ 夜景");
  assert.equal(night.name, "渋谷スカイ");
  assert.equal(night.timeOfDay, "night");

  // An explicit clock time wins; the vaguer wish is not double-read.
  const [timed] = parsedWishlistPlaces("teamLab Planets 10:00");
  assert.equal(timed.time, "10:00");
  assert.equal(timed.timeOfDay, null);
});

test("the chip UI can change priority while keeping one textual source of truth", () => {
  const raw = "Day 1\nSenso-ji\nhttps://example.com/private-note\nTokyo Skytree — optional\nteamLab Planets — 15:30 booked";
  const must = setWishlistPlacePriority(raw, 0, "must", "en");
  assert.equal(parsedWishlistPlaces(must)[0].priority, "must");
  assert.match(must, /Senso-ji — must/);
  assert.match(must, /https:\/\/example\.com\/private-note/, "unparsed input survives a chip edit");

  const normal = setWishlistPlacePriority(must, 0, "normal", "en");
  assert.equal(parsedWishlistPlaces(normal)[0].priority, "normal");
  assert.doesNotMatch(normal, /Senso-ji — must/);

  const booked = setWishlistPlacePriority(raw, 2, "optional", "en");
  assert.equal(parsedWishlistPlaces(booked)[2].priority, "must", "bookings stay protected");
});

test("condition controls can edit one occurrence's booking, clock, and stay without losing private lines", () => {
  const raw = "Day 1\nMuseum\nhttps://example.com/private-note\nMuseum — optional";
  const booked = updateWishlistPlaceConstraints(raw, 1, {
    isReservation: true,
    time: "14:30",
    stayMinutes: 95,
  }, "en");
  const places = parsedWishlistPlaces(booked);

  assert.deepEqual(places[0], {
    name: "Museum",
    day: 1,
    time: null,
    timeOfDay: null,
    isReservation: false,
    priority: "normal",
    stayMinutes: null,
  });
  assert.equal(places[1].time, "14:30", "the second same-name occurrence is the only edited visit");
  assert.equal(places[1].isReservation, true);
  assert.equal(places[1].priority, "must", "a fixed booking is always protected");
  assert.equal(places[1].stayMinutes, 95);
  assert.match(booked, /https:\/\/example\.com\/private-note/);
});

test("invalid condition edits are ignored and stay durations remain in the supported range", () => {
  const raw = "Senso-ji — 09:00 — stay 45 min";
  const invalid = updateWishlistPlaceConstraints(raw, 0, { time: "25:99", stayMinutes: Number.NaN }, "en");
  assert.equal(parsedWishlistPlaces(invalid)[0].time, "09:00");
  assert.equal(parsedWishlistPlaces(invalid)[0].stayMinutes, 45);

  const bounded = updateWishlistPlaceConstraints(raw, 0, { stayMinutes: 900 }, "en");
  assert.equal(parsedWishlistPlaces(bounded)[0].stayMinutes, 480);
});

test("calendar-date headings preserve real gaps in an existing itinerary", () => {
  const places = parsedWishlistPlaces(`2026-09-14
Senso-ji
2026-09-16
Tokyo Skytree
Sep 18: Shibuya Sky`);

  assert.deepEqual(places.map(({ name, day }) => ({ name, day })), [
    { name: "Senso-ji", day: 1 },
    { name: "Tokyo Skytree", day: 3 },
    { name: "Shibuya Sky", day: 5 },
  ]);
  assert.match(formatWishlistLines(`2026-09-14
Senso-ji
2026-09-16
Tokyo Skytree
Sep 18: Shibuya Sky`, "en"), /^Day 1\nSenso-ji\nDay 3\nTokyo Skytree\nDay 5\nShibuya Sky$/);
});

test("month-name headings preserve calendar gaps across a year boundary", () => {
  const places = parsedWishlistPlaces(`Dec 30
Senso-ji
Jan 2
Tokyo Skytree`);

  assert.deepEqual(places.map(({ name, day }) => ({ name, day })), [
    { name: "Senso-ji", day: 1 },
    { name: "Tokyo Skytree", day: 4 },
  ]);
});

test("a system recommendation can be pinned to its evaluated meal or gap time", () => {
  const [place] = parsedWishlistPlaces("TripCheck recommendation lunch 1 — optional — 11:30");
  assert.equal(place?.time, "11:30");
  assert.equal(place?.priority, "optional");
  assert.equal(place?.isReservation, false);
});

// v1.1 TC-020: removing one occurrence must not launder any OTHER line — day
// headings, annotations, URLs, marker spellings and spacing all stay
// byte-identical. Only the removed place's own line changes.

test("removing one place keeps every other line byte-identical, including day headers and annotations", () => {
  const raw = "1日目\n浅草寺 9:00\nチームラボプラネッツ 15:30 予約\nhttps://example.com/notes\n\n2日目\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば";
  const next = removeWishlistPlace(raw, 0, "ja");
  assert.equal(next, "1日目\nチームラボプラネッツ 15:30 予約\nhttps://example.com/notes\n\n2日目\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば");
  assert.deepEqual(parsedWishlistPlaces(next).map(({ name, day, priority }) => ({ name, day, priority })), [
    { name: "チームラボプラネッツ", day: 1, priority: "must" },
    { name: "三鷹の森ジブリ美術館", day: 2, priority: "must" },
    { name: "渋谷スカイ", day: 2, priority: "optional" },
  ]);
});

test("removing the last place of a section keeps the section heading verbatim", () => {
  const raw = "Day 1\nSenso-ji 9:00\nGhibli Museum must\nShibuya Sky optional";
  const next = removeWishlistPlace(raw, 1, "en");
  assert.equal(next, "Day 1\nSenso-ji 9:00\nShibuya Sky optional");
});

test("removing one occurrence from a multi-place line keeps the line's other places and markers", () => {
  const raw = "銀閣寺・金閣寺・清水寺 必須\n伏見稲荷大社";
  const next = removeWishlistPlace(raw, 1, "ja");
  assert.equal(next, "銀閣寺 — 必須\n清水寺 — 必須\n伏見稲荷大社");
  assert.deepEqual(parsedWishlistPlaces(next).map(({ name, priority }) => ({ name, priority })), [
    { name: "銀閣寺", priority: "must" },
    { name: "清水寺", priority: "must" },
    { name: "伏見稲荷大社", priority: "normal" },
  ]);
});

test("removing from a multi-place line that carries its own day re-emits that day", () => {
  const raw = "1日目\n浅草寺\n2日目 銀閣寺・金閣寺・清水寺";
  const next = removeWishlistPlace(raw, 2, "ja");
  assert.equal(next, "1日目\n浅草寺\n2日目\n銀閣寺\n清水寺");
  assert.deepEqual(parsedWishlistPlaces(next).map(({ name, day }) => ({ name, day })), [
    { name: "浅草寺", day: 1 },
    { name: "銀閣寺", day: 2 },
    { name: "清水寺", day: 2 },
  ]);
});

test("an out-of-range removal index leaves the input untouched", () => {
  const raw = "Senso-ji\nGhibli Museum";
  assert.equal(removeWishlistPlace(raw, 2, "en"), raw);
  assert.equal(removeWishlistPlace(raw, -1, "en"), raw);
  assert.equal(removeWishlistPlace(raw, 0.5, "en"), raw);
});
