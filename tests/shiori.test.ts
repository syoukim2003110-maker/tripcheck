import assert from "node:assert/strict";
import test from "node:test";

import { RailNetwork, plainStationName, type RailNetworkData } from "../lib/rail-router.ts";
import { buildShioriPlan, type ShioriPlace, type ShioriRoute } from "../lib/shiori/plan.ts";
import { decodeTrip, encodeTrip, kindLabel, placeFromSight, togglePlace, emptyTrip, MAX_PLACES, type ShioriTrip } from "../lib/shiori/state.ts";
import { shioriStayMinutes } from "../lib/shiori/stay.ts";
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

test("too much for the days asked is planned anyway and says the days run late", () => {
  const many = Array.from({ length: 9 }, (_, index) => place(`場所${index}`, 35.0 + (index % 3) * 0.02, 135.76 + Math.floor(index / 3) * 0.03, 120));
  const plan = buildShioriPlan({ places: many, days: 1, pace: "relaxed", hotel: null, locale: "ja" });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.freeDays, 0);
  assert.equal(plan.days[0].runsLate, true);
});

test("a pinned place stays on its day, and a hotel adds the way out and back", () => {
  const pinned = kyotoFive.map((entry) => entry.name === "銀閣寺" ? { ...entry, day: 2 } : entry);
  const plan = buildShioriPlan({ places: pinned, days: 3, pace: "standard", hotel: { name: "駅前ホテル", lat: 34.9858, lon: 135.7588 }, locale: "ja" });
  assert.equal(plan.days.length, 2);
  assert.ok(plan.days[1].stops.some((stop) => stop.place.name === "銀閣寺"));
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
  assert.equal(decoded?.places[0].stayMinutes, 50);

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
  const plan = buildShioriPlan({ places: many, days: 1, hotel: null, locale: "ja" });
  const notice = plan.notices.find((entry) => entry.kind === "needs-days");
  assert.ok(notice && notice.kind === "needs-days");
  const longer = buildShioriPlan({ places: many, days: notice.days, hotel: null, locale: "ja" });
  assert.equal(longer.days.some((day) => day.runsLate), false);
  assert.equal(longer.notices.some((entry) => entry.kind === "needs-days" || entry.kind === "too-much"), false);
});

test("a day that runs past midnight is late, whatever the clock prints", () => {
  const many = Array.from({ length: 12 }, (_, index) => place(`長居${index}`, 35.0 + (index % 4) * 0.02, 135.76 + Math.floor(index / 4) * 0.03, 150));
  const plan = buildShioriPlan({ places: many, days: 1, hotel: null, locale: "ja" });
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
