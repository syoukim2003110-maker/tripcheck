import assert from "node:assert/strict";
import test from "node:test";

import { RailNetwork, plainStationName, type RailNetworkData } from "../lib/rail-router.ts";
import { daySearch, type SearchProblem } from "../lib/shiori/day-search.ts";
import { buildShioriPlan, type ShioriPlace, type ShioriRoute } from "../lib/shiori/plan.ts";
import { decodeTrip, encodeTrip, kindLabel, placeFromSight, togglePlace, emptyTrip, MAX_PLACES, type ShioriTrip } from "../lib/shiori/state.ts";
import { shioriStayMinutes } from "../lib/shiori/stay.ts";
import { cafeBreakFor, findCafes } from "../lib/shiori/cafes.ts";
import { curateSights, type PopularSight } from "../lib/popular-sights.ts";

/*
 * A toy city: two lines crossing at Central.
 *   Red:  West — Central — East — Far East      (along latitude 35.00)
 *   Blue: North — Central — South               (along longitude 139.02)
 * Stations are ~1.8 km apart.
 */
const toy: RailNetworkData = {
  id: "toy",
  stations: [
    ["西駅", "West", 35.0, 139.0],
    ["中央駅", "Central", 35.0, 139.02],
    ["東駅", "East", 35.0, 139.04],
    ["遠東駅", "Far East", 35.0, 139.06],
    ["北駅", "North", 35.016, 139.02],
    ["南駅", "South", 34.984, 139.02],
  ],
  lines: [["赤線", "Red Line"], ["青線", "Blue Line"]],
  edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [4, 1, 1], [1, 5, 1]],
};
const near = (latitude: number, longitude: number) => ({ latitude: latitude + 0.001, longitude });

test("a train leg says where to board, which line, and where to get off", () => {
  const network = new RailNetwork(toy);
  const journey = network.route(near(35.0, 139.0), near(35.0, 139.06));
  assert.ok(journey);
  assert.equal(journey.walkToStation, "西駅");
  assert.equal(journey.walkFromStation, "遠東駅");
  assert.deepEqual(journey.rides.map((ride) => [ride.line, ride.from, ride.to, ride.stops]), [["赤線", "西駅", "遠東駅", 3]]);
  assert.equal(journey.transfers, 0);
  // Four station points to draw the ride along.
  assert.equal(journey.rides[0].path.length, 4);
  // Walk in, wait, ride, walk out: more than the ride alone, far less than walking 5.5 km.
  assert.ok(journey.totalMinutes > journey.rides[0].minutes);
  assert.ok(journey.totalMinutes < 40);
});

test("a change of line is one transfer at the shared station", () => {
  const network = new RailNetwork(toy);
  const journey = network.route(near(35.0, 139.0), near(34.984, 139.02), "en");
  assert.ok(journey);
  assert.deepEqual(journey.rides.map((ride) => [ride.line, ride.from, ride.to]), [["Red Line", "West", "Central"], ["Blue Line", "Central", "South"]]);
  assert.equal(journey.transfers, 1);
});

test("rail is not offered when walking is as good, or when no station is near", () => {
  const network = new RailNetwork(toy);
  // 600 m apart, both beside West station.
  assert.equal(network.route(near(35.0, 139.0), { latitude: 35.004, longitude: 139.004 }), null);
  // Nowhere near the network.
  assert.equal(network.route({ latitude: 36, longitude: 140 }, near(35.0, 139.0)), null);
});

test("station names lose the operator, never a real part of the name", () => {
  assert.equal(plainStationName("東京メトロ渋谷駅"), "渋谷駅");
  assert.equal(plainStationName("東急電鉄・東京メトロ渋谷駅"), "渋谷駅");
  assert.equal(plainStationName("JR西日本京都駅"), "京都駅");
  assert.equal(plainStationName("都営地下鉄市ヶ谷駅"), "市ヶ谷駅");
  assert.equal(plainStationName("京成上野駅"), "京成上野駅");
  assert.equal(plainStationName("近鉄奈良駅"), "近鉄奈良駅");
  assert.equal(plainStationName("九龍駅 (九広鉄路英段)"), "九龍駅");
});

const place = (name: string, lat: number, lon: number, stayMinutes: number): ShioriPlace => ({ id: `p-${name}`, name, lat, lon, stayMinutes });
// Five temples in one part of Kyoto.
const kyotoFive = [
  place("清水寺", 34.9948, 135.785, 50),
  place("八坂神社", 35.0037, 135.7786, 50),
  place("建仁寺", 35.0006, 135.7736, 50),
  place("銀閣寺", 35.0267, 135.7983, 50),
  place("平安神宮", 35.016, 135.7824, 50),
];

test("a short wishlist is not stretched over every requested day", () => {
  const plan = buildShioriPlan({ places: kyotoFive, days: 3, pace: "standard", hotel: null, locale: "ja" });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.freeDays, 2);
  assert.deepEqual(plan.leftOut, []);
  const day = plan.days[0];
  assert.equal(day.stops.length, 5);
  assert.equal(day.runsLate, false);
  // The clock reads forward, and every place keeps the stay that was asked for.
  for (let index = 1; index < day.stops.length; index += 1) assert.ok(day.stops[index].arrive >= day.stops[index - 1].leave);
  assert.ok(day.stops.every((stop) => stop.stayMinutes === 50));
});

test("lunch is its own hour in the day, after the stop that ends nearest midday", () => {
  const plan = buildShioriPlan({ places: kyotoFive, days: 1, pace: "standard", hotel: null, locale: "ja" });
  const day = plan.days[0];
  const lunch = day.meals.find((meal) => meal.kind === "lunch");
  assert.ok(lunch, "a five-stop day from 09:00 crosses lunchtime");
  assert.ok(lunch.start >= "11:00" && lunch.start <= "14:30", lunch.start);
  const [startHour, startMinute] = lunch.start.split(":").map(Number);
  const [endHour, endMinute] = lunch.end!.split(":").map(Number);
  assert.equal(endHour * 60 + endMinute - (startHour * 60 + startMinute), 60);
  // The next stop starts after lunch plus the travel to it.
  const next = day.stops[lunch.afterStop + 1];
  if (next) assert.ok(next.arrive >= lunch.end!);
  // One lunch a day.
  assert.equal(day.meals.filter((meal) => meal.kind === "lunch").length, 1);
});

test("too much for the days asked is planned anyway only when the traveller asks for everything, and the day then says it runs late", () => {
  const many = Array.from({ length: 9 }, (_, index) => place(`場所${index}`, 35.0 + (index % 3) * 0.02, 135.76 + Math.floor(index / 3) * 0.03, 120));
  const plan = buildShioriPlan({ places: many, days: 1, pace: "relaxed", hotel: null, locale: "ja", packAnyway: true });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.freeDays, 0);
  assert.equal(plan.days[0].runsLate, true);
  assert.equal(plan.days[0].stops.length, 9);
  assert.deepEqual(plan.leftOut, []);
  assert.deepEqual(plan.overfull, []);
});

test("too much for the days asked is planned as the set that fits: the rest is left out of the days and named, and no day runs late", () => {
  const many = Array.from({ length: 9 }, (_, index) => place(`場所${index}`, 35.0 + (index % 3) * 0.02, 135.76 + Math.floor(index / 3) * 0.03, 120));
  const plan = buildShioriPlan({ places: many, days: 1, pace: "relaxed", hotel: null, locale: "ja" });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].runsLate, false);
  assert.equal(plan.days[0].endsNextDay, false);
  const planned = plan.days[0].stops.map((stop) => stop.place.name);
  // Every place is on the day or in the list of what was left out, never both.
  assert.deepEqual([...planned, ...plan.leftOut].sort(), many.map((entry) => entry.name).sort());
  assert.deepEqual(plan.overfull.map((entry) => entry.name), plan.leftOut);
  assert.ok(plan.leftOut.length > 0 && planned.length >= 3, `${planned.length} planned, ${plan.leftOut.length} left out`);
  const notice = plan.notices.find((entry) => entry.kind === "left-out");
  assert.ok(notice && notice.kind === "left-out");
  assert.deepEqual(notice.places.map((entry) => entry.name), plan.leftOut);
  assert.equal(plan.notices.some((entry) => entry.kind === "needs-days" || entry.kind === "drop" || entry.kind === "too-much"), false);
});

test("a pinned place stays on its day, and a hotel adds the way out and back", () => {
  const pinned = kyotoFive.map((entry) => entry.name === "銀閣寺" ? { ...entry, day: 2 } : entry);
  const plan = buildShioriPlan({ places: pinned, days: 3, pace: "standard", hotel: { name: "駅前ホテル", lat: 34.9858, lon: 135.7588 }, locale: "ja" });
  // The pin says which day, not how many: five short sights are one day, and it is day 2.
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].index, 1);
  assert.equal(plan.freeDays, 2);
  assert.ok(plan.days[0].stops.some((stop) => stop.place.name === "銀閣寺"));
  assert.ok(plan.days[0].fromHotel && plan.days[0].toHotel);
  assert.equal(plan.days[0].fromHotel!.fromName, "駅前ホテル");
});

test("train legs carry the route from the bundled network", () => {
  const network = new RailNetwork(toy);
  const places = [place("西の寺", 35.001, 139.0, 60), place("遠東の塔", 35.001, 139.06, 60)];
  const plan = buildShioriPlan({ places, days: 1, pace: "standard", hotel: null, locale: "ja" }, { rail: network });
  const leg = plan.days[0].legs[0];
  assert.equal(leg.mode, "rail");
  assert.equal(leg.rail?.rides[0].line, "赤線");
  assert.equal(leg.minutes, leg.rail?.totalMinutes);
  // Place, four stations, place.
  assert.equal(leg.path.length, 6);
  assert.match(leg.mapsUrl, /travelmode=transit/);
});

test("a leg follows the streets once they are known, and the measured walk sets the clock", () => {
  const places = [place("八坂神社", 35.0037, 135.7786, 50), place("建仁寺", 35.0006, 135.7736, 50)];
  const input = { places, days: 1, pace: "standard" as const, hotel: null, locale: "ja" as const };
  const before = buildShioriPlan(input);
  const leg = before.days[0].legs[0];
  assert.equal(leg.mode, "walk");
  // Nothing looked up yet: two end points, and the leg says it has no path.
  assert.equal(leg.hasPath, false);
  assert.equal(leg.path.length, 2);
  assert.deepEqual([leg.from.latitude, leg.to.latitude].sort(), [35.0006, 35.0037]);

  const street = [leg.from, { latitude: 35.0022, longitude: 135.7786 }, { latitude: 35.0022, longitude: 135.7736 }, leg.to];
  const after = buildShioriPlan(input, { routes: new Map([[`walk|${leg.key}`, { minutes: leg.minutes + 9, path: street }]]) });
  const measured = after.days[0].legs[0];
  assert.equal(measured.key, leg.key);
  assert.equal(measured.hasPath, true);
  assert.deepEqual(measured.path, [leg.from, ...street, leg.to]);
  assert.equal(measured.minutes, leg.minutes + 9);
  // The later stop moves by what the walk really takes.
  assert.ok(after.days[0].stops[1].arrive > before.days[0].stops[1].arrive);
});

test("a walk the streets make far longer stops being a walk", () => {
  // 1.1 km apart on the map, an hour and a half on foot (a hill in between).
  const places = [place("麓の寺", 35.0, 135.76, 50), place("山の上", 35.01, 135.76, 50)];
  const input = { places, days: 1, pace: "standard" as const, hotel: null, locale: "ja" as const };
  const leg = buildShioriPlan(input).days[0].legs[0];
  assert.equal(leg.mode, "walk");
  const after = buildShioriPlan(input, { routes: new Map([[`walk|${leg.key}`, { minutes: 90, path: [leg.from, leg.to] }]]) });
  assert.notEqual(after.days[0].legs[0].mode, "walk");
  // The road path for the new mode has not been looked up; an answer of "no
  // route" leaves the straight line and keeps saying so.
  const unknown = buildShioriPlan(input, { routes: new Map([[`walk|${leg.key}`, { minutes: 90, path: [leg.from, leg.to] }], [`drive|${leg.key}`, null]]) });
  assert.equal(unknown.days[0].legs[0].hasPath, false);
  assert.equal(unknown.days[0].legs[0].noPath, true);
  // Before the lookup it is neither: the map waits rather than draw a guess.
  assert.equal(after.days[0].legs[0].noPath, false);
  // A road path without a usable duration draws the leg and leaves the clock alone.
  const road = [{ latitude: 35.0, longitude: 135.761 }, { latitude: 35.01, longitude: 135.761 }];
  const drawn = buildShioriPlan(input, { routes: new Map([[`walk|${leg.key}`, { minutes: 90, path: [leg.from, leg.to] }], [`drive|${leg.key}`, { minutes: null, path: road }]]) });
  assert.equal(drawn.days[0].legs[0].hasPath, true);
  assert.equal(drawn.days[0].legs[0].minutes, after.days[0].legs[0].minutes);
  // The line reaches both pins and follows the road in between.
  assert.deepEqual(drawn.days[0].legs[0].path, [leg.from, ...road, leg.to]);
});

test("measured streets change a leg's clock and mode, never the days or the order", () => {
  const input = { places: kyotoFive, days: 2, pace: "relaxed" as const, hotel: null, locale: "ja" as const };
  const before = buildShioriPlan(input);
  const order = (plan: typeof before) => plan.days.map((day) => day.stops.map((stop) => stop.place.name));
  // Every walk turns out to be an hour: an engine free to reshuffle would.
  const routes = new Map<string, ShioriRoute>(before.days.flatMap((day) => day.legs.map((leg): [string, ShioriRoute] => [`walk|${leg.key}`, { minutes: 60, path: [leg.from, leg.to] }])));
  const after = buildShioriPlan(input, { routes });
  assert.deepEqual(order(after), order(before));
  assert.ok(after.days.some((day) => day.legs.some((leg, index) => leg.minutes !== before.days[day.index].legs[index].minutes || leg.mode !== before.days[day.index].legs[index].mode)));
});

test("a hotel somewhere else is another leg, so its street path is never reused", () => {
  const hotelA = { name: "A", lat: 34.9858, lon: 135.7588 };
  const hotelB = { name: "B", lat: 35.0116, lon: 135.7681 };
  const keyOf = (hotel: typeof hotelA) => buildShioriPlan({ places: kyotoFive, days: 1, pace: "standard", hotel, locale: "ja" }).days[0].fromHotel!.key;
  assert.notEqual(keyOf(hotelA), keyOf(hotelB));
  assert.equal(keyOf(hotelA), keyOf({ ...hotelA }));
});

test("an empty list is an empty booklet, not an error", () => {
  const plan = buildShioriPlan({ places: [], days: 3, pace: "standard", hotel: null, locale: "ja" });
  assert.deepEqual(plan.days, []);
  assert.equal(plan.freeDays, 3);
});

test("a trip survives the share link, and a tampered link opens nothing", () => {
  const sight = { q: "Q221716", ja: "清水寺", en: "Kiyomizu-dera", lat: 34.9948, lon: 135.785, kind: "buddhist temple", img: "Kiyomizu-dera in Kyoto.jpg" };
  let trip: ShioriTrip = { ...emptyTrip, cityId: "kyoto", cityName: "京都", days: 2 };
  trip = togglePlace(trip, placeFromSight(sight, "ja"));
  trip = togglePlace(trip, { id: "maps-abc", name: "町家カフェ", lat: 35.0, lon: 135.77, stayMinutes: 45, day: 2 });
  trip = { ...trip, hotel: { name: "駅前ホテル", lat: 34.9858, lon: 135.7588 } };
  const decoded = decodeTrip(encodeTrip(trip));
  assert.deepEqual(decoded, { ...trip, places: trip.places.map((entry) => ({ ...entry, lat: Number(entry.lat.toFixed(5)), lon: Number(entry.lon.toFixed(5)) })) });
  // (清水寺: the usual stay of the sight notes, an hour and a half.)
  assert.equal(decoded?.places[0].stayMinutes, 90);

  assert.equal(decodeTrip("not-base64!"), null);
  const tamper = (change: (wire: Record<string, unknown>) => void) => {
    const wire = JSON.parse(Buffer.from(encodeTrip(trip), "base64url").toString("utf8")) as Record<string, unknown>;
    change(wire);
    return decodeTrip(Buffer.from(JSON.stringify(wire)).toString("base64url"));
  };
  assert.equal(tamper((wire) => { wire.d = 99; }), null);
  assert.equal(tamper((wire) => { (wire.s as unknown[][])[0][2] = 999; }), null);
  assert.equal(tamper((wire) => { wire.s = Array.from({ length: MAX_PLACES + 1 }, (_, index) => [`x${index}`, "x", 1, 1, 60, null, null, null]); }), null);
  // A photo "file name" that is really a path or URL is dropped, not followed.
  assert.equal(tamper((wire) => { (wire.s as unknown[][])[0][7] = "../../evil.png"; })?.places[0].img, undefined);
  assert.equal(tamper((wire) => { (wire.s as unknown[][])[0][7] = "https://evil.example/x.png"; })?.places[0].img, undefined);
});

test("tapping a chosen place removes it, and the list stops at the limit", () => {
  const a = place("A", 35, 135, 60);
  assert.deepEqual(togglePlace(togglePlace(emptyTrip, a), a).places, []);
  let trip = emptyTrip;
  for (let index = 0; index < MAX_PLACES + 3; index += 1) trip = togglePlace(trip, place(`P${index}`, 35, 135, 60));
  assert.equal(trip.places.length, MAX_PLACES);
});

test("stay and label follow the kind of place", () => {
  assert.equal(shioriStayMinutes("buddhist temple", "清水寺"), 50);
  assert.equal(shioriStayMinutes("art museum", "Louvre"), 90);
  assert.equal(shioriStayMinutes("amusement park", "東京ディズニーランド"), 480);
  assert.equal(shioriStayMinutes(undefined, "なにか"), 75);
  assert.equal(kindLabel("shinto shrine", "ja"), "神社");
  assert.equal(kindLabel("observation tower", "en"), "Viewpoint");
  assert.equal(kindLabel(undefined, "ja"), "観光スポット");
});

/* ------------------------------------------------ the traveller's own picks */

const clockOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

test("a restaurant chosen for lunch is that day's lunch, eaten at lunchtime", () => {
  const soba: ShioriPlace = { id: "r-soba", name: "祇園のそば屋", lat: 35.0035, lon: 135.7755, stayMinutes: 60, kind: "restaurant", meal: "lunch" };
  const plan = buildShioriPlan({ places: [...kyotoFive, soba], days: 1, hotel: null, locale: "ja" });
  const day = plan.days.find((entry) => entry.stops.some((stop) => stop.place.id === soba.id))!;
  const stop = day.stops.find((entry) => entry.place.id === soba.id)!;
  assert.ok(clockOf(stop.arrive) >= 11 * 60 + 30 && clockOf(stop.arrive) <= 14 * 60, stop.arrive);
  assert.equal(stop.mealMissed, false);
  // No second, invented lunch on the day that already has the chosen one.
  assert.equal(day.meals.filter((meal) => meal.kind === "lunch").length, 0);
});

test("a restaurant chosen for dinner ends its day, which may run into the evening", () => {
  const izakaya: ShioriPlace = { id: "r-izakaya", name: "先斗町の居酒屋", lat: 35.0052, lon: 135.7709, stayMinutes: 90, kind: "restaurant", meal: "dinner" };
  const plan = buildShioriPlan({ places: [...kyotoFive, izakaya], days: 2, hotel: null, locale: "ja" });
  const day = plan.days.find((entry) => entry.stops.some((stop) => stop.place.id === izakaya.id))!;
  assert.equal(day.stops.at(-1)!.place.id, izakaya.id);
  assert.ok(clockOf(day.stops.at(-1)!.arrive) >= 17 * 60 + 30);
  assert.equal(day.runsLate, false);
  assert.equal(day.meals.some((meal) => meal.kind === "dinner"), false);
  assert.deepEqual(plan.notices, []);
});

test("too much for the days says how many days it takes, and the plan with that many fits", () => {
  const many = Array.from({ length: 9 }, (_, index) => place(`場所${index}`, 35.0 + (index % 3) * 0.02, 135.76 + Math.floor(index / 3) * 0.03, 120));
  // Planned as the set that fits, or with everything in: the days that hold the whole list are the same.
  for (const packAnyway of [false, true]) {
    const plan = buildShioriPlan({ places: many, days: 1, hotel: null, locale: "ja", packAnyway });
    const notice = plan.notices.find((entry) => entry.kind === (packAnyway ? "needs-days" : "left-out"));
    assert.ok(notice && (notice.kind === "needs-days" || notice.kind === "left-out") && notice.days !== null);
    const longer = buildShioriPlan({ places: many, days: notice.days, hotel: null, locale: "ja", packAnyway });
    assert.equal(longer.days.some((day) => day.runsLate), false);
    assert.deepEqual(longer.leftOut, []);
    assert.equal(longer.notices.some((entry) => entry.kind === "needs-days" || entry.kind === "too-much" || entry.kind === "left-out"), false);
  }
});

test("a day that runs past midnight is late, whatever the clock prints", () => {
  const many = Array.from({ length: 12 }, (_, index) => place(`長居${index}`, 35.0 + (index % 4) * 0.02, 135.76 + Math.floor(index / 4) * 0.03, 150));
  // (Only a list planned anyway gets there.)
  const plan = buildShioriPlan({ places: many, days: 1, hotel: null, locale: "ja", packAnyway: true });
  assert.equal(plan.days[0].runsLate, true);
});

test("a hotel far from everything is called out with what a closer one saves", () => {
  const far = buildShioriPlan({ places: kyotoFive, days: 2, hotel: { name: "大阪のホテル", lat: 34.7025, lon: 135.4959 }, locale: "ja" });
  const notice = far.notices.find((entry) => entry.kind === "hotel-far");
  assert.ok(notice && notice.kind === "hotel-far");
  assert.ok(notice.oneWayMinutes >= 30 && notice.savedMinutes > 0);
  const near = buildShioriPlan({ places: kyotoFive, days: 2, hotel: { name: "祇園のホテル", lat: 35.0037, lon: 135.778 }, locale: "ja" });
  assert.equal(near.notices.some((entry) => entry.kind === "hotel-far"), false);
});

test("a dinner across the region is priced: the detour, and the way back to the hotel", () => {
  const kobe: ShioriPlace = { id: "r-kobe", name: "神戸のステーキ", lat: 34.6913, lon: 135.1956, stayMinutes: 90, kind: "restaurant", meal: "dinner" };
  const plan = buildShioriPlan({ places: [...kyotoFive, kobe], days: 2, hotel: { name: "祇園のホテル", lat: 35.0037, lon: 135.778 }, locale: "ja" });
  const kinds = plan.notices.map((entry) => entry.kind);
  assert.ok(kinds.includes("meal-detour"), JSON.stringify(plan.notices));
  assert.ok(kinds.includes("meal-hotel"), JSON.stringify(plan.notices));
});

test("a chosen restaurant survives the share link as the meal it is", () => {
  const trip: ShioriTrip = { ...emptyTrip, places: [{ id: "r-1", name: "店", lat: 35, lon: 135, stayMinutes: 90, kind: "restaurant", meal: "dinner" }] };
  assert.equal(decodeTrip(encodeTrip(trip))?.places[0].meal, "dinner");
  // A link written before restaurants existed still opens.
  const legacy = encodeTrip({ ...emptyTrip, places: [{ id: "wikidata-Q1", name: "寺", lat: 35, lon: 135, stayMinutes: 50 }] });
  assert.equal(decodeTrip(legacy)?.places[0].meal, undefined);
});

test("places that are near each other end up on the same day", () => {
  // Two neighbourhoods 9 km apart, two long visits in each: two days.
  const east = [place("東の寺", 35.0, 135.8, 180), place("東の庭", 35.003, 135.802, 180)];
  const west = [place("西の城", 35.02, 135.7, 180), place("西の塔", 35.022, 135.703, 180)];
  // Listed interleaved, so the grouping cannot come from the input order.
  const plan = buildShioriPlan({ places: [east[0], west[0], east[1], west[1]], days: 2, hotel: null, locale: "ja" });
  assert.equal(plan.days.length, 2);
  for (const day of plan.days) {
    const sides = new Set(day.stops.map((stop) => stop.place.name[0]));
    assert.equal(sides.size, 1, day.stops.map((stop) => stop.place.name).join(","));
  }
});

test("the picker drops what cannot be visited and the same spot under two names", () => {
  const sight = (q: string, ja: string, en: string, lat: number, lon: number, kind: string): PopularSight => ({ q, ja, en, lat, lon, kind });
  const kept = curateSights([
    sight("Q1", "大阪城", "Osaka Castle", 34.6873, 135.5262, "castle"),
    sight("Q2", "大阪城公園", "Osaka Castle Park", 34.6875, 135.5263, "park"),
    sight("Q3", "石山本願寺", "Ishiyama Hongan-ji", 34.6874, 135.5261, "former buddhist temple"),
    sight("Q4", "元", "Yuan dynasty", 39.9, 116.4, "dynasty"),
    sight("Q5", "サン・マルコ寺院", "St Mark's Basilica", 45.4345, 12.3397, "basilica"),
    sight("Q6", "鐘楼", "St Mark's Campanile", 45.434, 12.339, "bell tower"),
    sight("Q7", "イタリア、フィレンツェにある美術館", "Gallerie dell'Accademia", 45.431, 12.328, "art museum"),
  ]);
  assert.deepEqual(kept.map((entry) => entry.q), ["Q1", "Q5", "Q6", "Q7"]);
  assert.equal(kept.at(-1)!.ja, "Gallerie dell'Accademia");
});

test("a station on another line is reachable when the nearest ones all share one line", () => {
  // Four tram stops beside the start, all on one line that goes nowhere
  // useful; the metro is the fifth-nearest station.
  const network = new RailNetwork({
    id: "toy2",
    stations: [
      ["路面1", "Tram 1", 35.0005, 139.0], ["路面2", "Tram 2", 35.001, 139.0], ["路面3", "Tram 3", 35.0015, 139.0], ["路面4", "Tram 4", 35.002, 139.0],
      ["地下鉄 西", "Metro West", 35.004, 139.0], ["地下鉄 東", "Metro East", 35.004, 139.08],
    ],
    lines: [["路面線", "Tram"], ["地下鉄線", "Metro"]],
    edges: [[0, 1, 0], [1, 2, 0], [2, 3, 0], [4, 5, 1]],
  });
  const journey = network.route({ latitude: 35.0, longitude: 139.0 }, { latitude: 35.004, longitude: 139.081 });
  assert.ok(journey);
  assert.equal(journey.rides[0].line, "地下鉄線");
});

test("a long day gets one coffee break in mid-afternoon, never right after lunch", () => {
  const sights = [
    place("朝の寺", 35.0, 135.78, 120), place("昼前の庭", 35.004, 135.781, 90),
    place("午後の城", 35.012, 135.776, 90), place("夕方の塔", 35.018, 135.772, 60),
  ];
  const day = buildShioriPlan({ places: sights, days: 1, hotel: null, locale: "ja" }).days[0];
  assert.ok(day.cafe, "a 09:00–16:00 day has room for a break");
  assert.equal(cafeBreakFor(day)?.afterStop, day.cafe.afterStop);
  // The day's summary adds up: every leg counted once, on foot never more than in all.
  assert.equal(day.travelMinutes, day.legs.reduce((sum, leg) => sum + leg.minutes, 0));
  assert.ok(day.walkMinutes <= day.travelMinutes);
  assert.ok(["easy", "normal", "tight"].includes(day.load));
  const leave = clockOf(day.cafe.time);
  assert.ok(leave >= 13 * 60 + 30 && leave <= 17 * 60, day.cafe.time);
  const lunch = day.meals.find((meal) => meal.kind === "lunch");
  assert.ok(!lunch || lunch.afterStop !== day.cafe.afterStop);
  // A morning-only day does not.
  const short = buildShioriPlan({ places: sights.slice(0, 2), days: 1, hotel: null, locale: "ja" }).days[0];
  assert.equal(short.cafe, null);
});

test("cafés are ordered by how little they take the traveller off the way", async () => {
  const from = { latitude: 35.0, longitude: 135.0 };
  const to = { latitude: 35.0, longitude: 135.01 };
  const brk = { afterStop: 0, time: "15:00", reason: "on-the-way" as const, from, fromName: "A", to, toName: "B", search: { latitude: 35.0, longitude: 135.005 } };
  const asked: number[] = [];
  const client = {
    search: async (options: { withinMeters: number; poiCategories: readonly string[] }) => {
      asked.push(options.withinMeters);
      assert.deepEqual(options.poiCategories, ["Cafe", "Bakery"]);
      return [
        { id: "far", name: "遠回りの店", latitude: 35.004, longitude: 135.005, formattedAddress: "", poiCategory: "Cafe" },
        { id: "on", name: "道沿いの店", latitude: 35.0001, longitude: 135.006, formattedAddress: "", poiCategory: "Bakery" },
        { id: "on", name: "道沿いの店", latitude: 35.0001, longitude: 135.006, formattedAddress: "", poiCategory: "Bakery" },
        { id: "mid", name: "少し入った店", latitude: 35.0012, longitude: 135.004, formattedAddress: "", poiCategory: "Cafe" },
      ];
    },
  };
  const picks = await findCafes(brk, client, "ja");
  assert.deepEqual(picks.map((pick) => pick.name), ["道沿いの店", "少し入った店", "遠回りの店"]);
  assert.equal(picks[0].detourMinutes, 0);
  assert.equal(picks[0].kind, "bakery");
  assert.ok(picks[2].detourMinutes >= 5);
  assert.deepEqual(asked, [500]);
  // Before a train ride the same cafés are ordered by the walk from the place just left.
  const after = await findCafes({ ...brk, reason: "after", to: { latitude: 35.0, longitude: 135.05 }, search: from }, client, "ja");
  assert.deepEqual(after.map((pick) => pick.name), ["少し入った店", "道沿いの店", "遠回りの店"]);
});

/*
 * The search over days and orders, on tables of minutes written by hand.
 */

/** A table where every pair of different stops costs `minutes(from, to)`. */
function table(count: number, minutes: (from: number, to: number) => number) {
  return Array.from({ length: count }, (_, from) => Array.from({ length: count }, (_, to) => (from === to ? 0 : minutes(from, to))));
}

test("the order of a day is the cheapest of all orders, whatever is fixed in it, and a day-filling stay still opens a day that no order keeps", () => {
  // Random small days — with and without a hotel, a lunch restaurant, a
  // dinner, a day-filling stay — against every order tried one by one.
  let state = 7;
  const random = (below: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((state / 2_147_483_648) * below);
  };
  for (let round = 0; round < 300; round += 1) {
    const count = 2 + random(5);
    const stops: SearchProblem["stops"] = Array.from({ length: count }, () => ({ stay: 30 + 15 * random(5), meal: null, day: null }));
    if (random(3) === 0) stops[random(count)] = { stay: 60, meal: "lunch", day: null };
    if (random(3) === 0) stops[count - 1] = { stay: 90, meal: "dinner", day: null };
    if (random(6) === 0) stops[0] = { stay: 300, meal: null, day: null };
    const minutes = table(count, () => 5 + random(50));
    const problem: SearchProblem = {
      stops,
      minutes,
      km: table(count, () => 1 + random(9)),
      hotel: random(2) === 0 ? { out: stops.map(() => 5 + random(40)), back: stops.map(() => 5 + random(40)), km: stops.map(() => 3) } : null,
    };
    const search = daySearch(problem);
    const found = search.solveDay(stops.map((_, index) => index));
    // What an order costs, written out again: the rides, half the real wait
    // at a lunch restaurant's door (the ten minutes of slack after a ride
    // are not waiting; the morning lost when the day opens with it is), and
    // far more for a day that cannot be kept.
    const costOf = (day: ReturnType<typeof search.describe>) => {
      let waiting = 0;
      day.order.forEach((stop, position) => {
        if (stops[stop].meal !== "lunch") return;
        const reached = position > 0
          ? day.leave[position - 1] + minutes[day.order[position - 1]][stop] + 10
          : problem.hotel ? 8 * 60 + 30 + problem.hotel.out[stop] + 10 : 9 * 60;
        waiting += Math.max(0, day.arrive[position] - reached);
      });
      return day.travel + waiting / 2 + (day.overrun > 0 ? 500 + day.overrun * 10 + (day.overrun * day.overrun) / 6 : 0) + day.missed * 1000;
    };
    // A dinner is last. A day-filling stay is first — also on a day no order
    // keeps; another order is the day's only when it can be kept, or misses
    // fewer chosen meals.
    const rank = (stop: number, opens: boolean) => (stops[stop].meal === "dinner" ? 2 : opens && !stops[stop].meal && stops[stop].stay >= 300 ? 0 : 1);
    const leastOf = (opens: boolean) => {
      let least = Infinity;
      let kept = false;
      let missed = 0;
      const order: number[] = [];
      const visit = () => {
        if (order.length === count) {
          const day = search.describe([...order]);
          if (costOf(day) < least) {
            least = costOf(day);
            kept = day.overrun === 0 && day.missed === 0;
            missed = day.missed;
          }
          return;
        }
        for (let stop = 0; stop < count; stop += 1) {
          if (order.includes(stop) || (order.length > 0 && rank(stop, opens) < rank(order.at(-1)!, opens))) continue;
          order.push(stop);
          visit();
          order.pop();
        }
      };
      visit();
      return { least, kept, missed };
    };
    const opened = leastOf(true);
    const free = opened.kept ? opened : leastOf(false);
    const least = free.kept || free.missed < opened.missed ? free.least : opened.least;
    // (Costed on the usual clock: the printed day may start later, so as not to wait at a door.)
    const cost = costOf(search.describe(found.order));
    assert.ok(Math.abs(cost - least) < 1e-6, `round ${round}: found ${cost}, best ${least}, order ${found.order.join(">")}`);
    assert.deepEqual([...found.order].sort(), stops.map((_, index) => index));
  }
});

test("a restaurant chosen for lunch is reached while it serves, even when a shorter route passes it at ten", () => {
  // Restaurant — A — B — C in a row, two hours at each sight. The shortest
  // route starts at the restaurant (and so starts the day at 11:30, with no
  // room left for three sights); the plan sees a sight first and sits down
  // at lunchtime.
  const stops: SearchProblem["stops"] = [
    { stay: 120, meal: null, day: null },
    { stay: 60, meal: "lunch", day: null },
    { stay: 120, meal: null, day: null },
    { stay: 120, meal: null, day: null },
  ];
  const line = [1, 0, 2, 3];
  const problem: SearchProblem = { stops, minutes: table(4, (from, to) => 10 * Math.abs(line[from] - line[to])), km: table(4, (from, to) => Math.abs(line[from] - line[to])), hotel: null };
  const search = daySearch(problem);
  const day = search.solveDay([0, 1, 2, 3]);
  const lunch = day.order.indexOf(1);
  assert.equal(day.missed, 0);
  assert.equal(day.overrun, 0);
  assert.ok(day.arrive[lunch] >= 11 * 60 + 30 && day.arrive[lunch] <= 14 * 60, `seated at ${day.arrive[lunch]}`);
  assert.ok(lunch >= 1, day.order.join(">"));
  // The shortest route of all would have run past 18:00.
  assert.ok(search.describe([1, 0, 2, 3]).travel < day.travel);
  assert.ok(search.describe([1, 0, 2, 3]).overrun > 0);
});

test("when two splits cost the same minutes, the days are the neighbourhoods", () => {
  // Four places at the corners of a long rectangle; every ride is priced
  // 30 minutes (as a bus rounds them). Only the map tells the pairs apart.
  const at = [[0, 0], [0, 1], [8, 0], [8, 1]];
  const km = table(4, (from, to) => Math.hypot(at[from][0] - at[to][0], at[from][1] - at[to][1]));
  const problem: SearchProblem = { stops: at.map(() => ({ stay: 200, meal: null, day: null })), minutes: table(4, () => 30), km, hotel: null };
  const trip = daySearch(problem).choose(2);
  assert.deepEqual(trip.days.map((day) => [...day.order].sort()), [[0, 1], [2, 3]]);
  // And within a day, of two equally fast orders the one that does not double back.
  const row: SearchProblem = { stops: [0, 1, 2, 3].map(() => ({ stay: 30, meal: null, day: null })), minutes: table(4, () => 20), km: table(4, (from, to) => Math.abs(from - to)), hotel: null };
  const day = daySearch(row).solveDay([0, 1, 2, 3]);
  assert.ok(day.order.join("") === "0123" || day.order.join("") === "3210", day.order.join(">"));
});

test("a spare day is used when it saves real travel, and left free when it does not", () => {
  // Three pairs of sights around a hotel, ten minutes from it. Between two
  // pairs the only way is a 100-minute ride.
  const pair = (stop: number) => Math.floor(stop / 2);
  const stops: SearchProblem["stops"] = Array.from({ length: 6 }, () => ({ stay: 100, meal: null, day: null }));
  const apart = (cross: number): SearchProblem => ({
    stops,
    minutes: table(6, (from, to) => (pair(from) === pair(to) ? 5 : cross)),
    km: table(6, (from, to) => (pair(from) === pair(to) ? 1 : 5)),
    hotel: { out: stops.map(() => 10), back: stops.map(() => 10), km: stops.map(() => 3) },
  });
  // Two days fit and neither is packed, but one of them crosses over; with a third day nobody does.
  const far = daySearch(apart(100));
  assert.equal(far.choose(2).days.length, 2);
  const three = far.choose(3);
  assert.equal(three.days.length, 3);
  assert.deepEqual(three.days.map((day) => [...day.order].sort()), [[0, 1], [2, 3], [4, 5]]);
  // Where crossing over costs no more than going back to the hotel and out again, a third day saves nothing.
  assert.equal(daySearch(apart(20)).choose(3).days.length, 2);
  // And a day with one short visit on it is never the day gained.
  const lone: SearchProblem = { ...apart(100), stops: stops.slice(0, 5), minutes: apart(100).minutes.slice(0, 5).map((row) => row.slice(0, 5)), km: apart(100).km.slice(0, 5).map((row) => row.slice(0, 5)), hotel: { out: [10, 10, 10, 10, 10], back: [10, 10, 10, 10, 10], km: [3, 3, 3, 3, 3] } };
  assert.equal(daySearch(lone).choose(3).days.length, 2);
});

test("a list too long to try every split is still split as well as one short enough to", () => {
  // The same lists searched both ways: every split costed, and the
  // neighbourhood search used beyond twelve places.
  let state = 99;
  const random = (below: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((state / 2_147_483_648) * below);
  };
  for (let round = 0; round < 12; round += 1) {
    const count = 8 + random(3);
    const at = Array.from({ length: count }, () => [random(12), random(12)]);
    const km = table(count, (from, to) => Math.hypot(at[from][0] - at[to][0], at[from][1] - at[to][1]));
    const problem: SearchProblem = {
      stops: at.map(() => ({ stay: 45 + 15 * random(6), meal: null, day: null })),
      minutes: km.map((row) => row.map((distance) => (distance === 0 ? 0 : Math.ceil((12 + distance * 5.5) / 5) * 5))),
      km,
      hotel: round % 2 === 0 ? { out: at.map(([x, y]) => 10 + 5 * Math.round(Math.hypot(x - 6, y - 6))), back: at.map(([x, y]) => 10 + 5 * Math.round(Math.hypot(x - 6, y - 6))), km: at.map(([x, y]) => Math.hypot(x - 6, y - 6)) } : null,
    };
    const cost = (trip: ReturnType<ReturnType<typeof daySearch>["choose"]>) => trip.days.reduce((sum, day) => sum + day.cost, 0);
    const exact = daySearch(problem).choose(3, { quick: true });
    const searched = daySearch(problem, { exactSplits: 0 }).choose(3, { quick: true });
    assert.equal(searched.days.length, exact.days.length, `round ${round}`);
    assert.ok(cost(searched) <= cost(exact) + 5, `round ${round}: ${cost(searched)} against ${cost(exact)}`);
  }
});

test("a taxi counts a quarter of an hour dearer in the search, and its printed minutes stay what they are", () => {
  // A — B ten minutes on foot, B — C thirty by train; A — C only by taxi.
  const stops: SearchProblem["stops"] = [0, 1, 2].map(() => ({ stay: 60, meal: null, day: null }));
  const day = (taxiMinutes: number) => {
    const minutes = [[0, 10, taxiMinutes], [10, 0, 30], [taxiMinutes, 30, 0]];
    const taxi = [[false, false, true], [false, false, false], [true, false, false]];
    return daySearch({ stops, minutes, km: table(3, () => 1), taxi, hotel: null }).solveDay([0, 1, 2]);
  };
  // The taxi would save eight minutes (B, A, taxi to C: 32 against 40): not worth a taxi.
  const train = day(22);
  assert.equal(train.order[1], 1, train.order.join(">"));
  assert.equal(train.travel, 40);
  // Where it saves twenty, it is taken — and the day's travel is the 20 minutes ridden, not 35.
  const cab = day(10);
  assert.equal(cab.order[1], 0, cab.order.join(">"));
  assert.equal(cab.travel, 20);
});

test("a day that opens with a restaurant starts when its door opens, and the wait before a second one is said", () => {
  // Lunch restaurant, then a five-hour visit that cannot come first (the kitchen would be closed), then dinner.
  const stops: SearchProblem["stops"] = [{ stay: 300, meal: null, day: null }, { stay: 60, meal: "lunch", day: null }, { stay: 90, meal: "dinner", day: null }];
  const search = daySearch({ stops, minutes: table(3, () => 10), km: table(3, () => 1), hotel: { out: [20, 20, 20], back: [20, 20, 20], km: [2, 2, 2] } });
  const day = search.solveDay([0, 1, 2]);
  assert.deepEqual(day.order, [1, 0, 2]);
  assert.equal(day.missed, 0);
  assert.equal(day.overrun, 0);
  // Leave the hotel at 11:00 for a 20-minute ride and the ten minutes of slack: seated at 11:30.
  assert.equal(day.start, 11 * 60);
  assert.equal(day.arrive[0], 11 * 60 + 30);
  // The long visit ends 17:50; dinner is ten minutes away and already serving: no wait anywhere.
  assert.equal(day.arrive[2], day.leave[1] + 10 + 10);
});
