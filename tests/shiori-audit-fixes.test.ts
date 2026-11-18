import assert from "node:assert/strict";
import test from "node:test";

import { cafeBreakFor } from "../lib/shiori/cafes.ts";
import { buildMealBrief, EMPTY_MEAL_PREFS, mealSights, mealSlotKey, mealStopKind, openMealSlots } from "../lib/shiori/meal-advice.ts";
import { DAY_FILLING_STAY, dayClock, daySearch, type SearchProblem } from "../lib/shiori/day-search.ts";
import { readdirSync, readFileSync } from "node:fs";

import { isBoatLineName } from "../lib/rail-router.ts";
import { buildShioriPlan, departureAfterStop, dinnerHourAt, dinnerSlot, hardToReach, legWord, nobodySleepsAt, type ShioriDay } from "../lib/shiori/plan.ts";
import { placeFromSight } from "../lib/shiori/state.ts";
import { shioriStayMinutes } from "../lib/shiori/stay.ts";
import { auditPlan, cities, railOf, scenarioPlaces, scenarios } from "../scripts/audit-scenarios.ts";

/*
 * Faults a reader found in the 63 trips of the plan audit
 * (scripts/audit-plans.ts). Each test builds the very trip that showed the
 * fault and asserts what a traveller would have seen go wrong.
 */

const stopNamed = (id: string, name: RegExp) => {
  const { plan } = auditPlan(id);
  const stop = plan.days.flatMap((day) => day.stops).find((entry) => name.test(entry.place.name));
  assert.ok(stop, `${id} has no stop ${name}`);
  return stop;
};

test("a food hall, a small fairground or a children's museum is a visit of a couple of hours, not a seven-hour theme-park day", () => {
  // Were all 420 minutes: one stop ate a day and pushed the rest into the night.
  assert.equal(stopNamed("yokohama-1", /ラーメン博物館/).stayMinutes, 150);
  assert.equal(stopNamed("yokohama-2", /コスモワールド/).stayMinutes, 150);
  assert.equal(stopNamed("hiroshima-3", /マリーナホップ/).stayMinutes, 150);
  assert.equal(stopNamed("kobe-3", /アンパンマン/).stayMinutes, 150);
  assert.equal(stopNamed("paris-3", /アクリマタシオン/).stayMinutes, 150);
  // Two days of Yokohama no longer run until ten at night because of them. (Eight sights and a lunch hour on
  // both days: back at the hotel a little after seven on one of them, and the plan says the list wants a third day.)
  const { plan } = auditPlan("yokohama-2");
  for (const day of plan.days) assert.ok(!day.endsNextDay && day.end <= "19:30", plan.days.map((entry) => `${entry.start}–${entry.end}`).join(" "));
  // A park that is a day out keeps its day.
  assert.equal(stopNamed("nikko-3", /江戸村/).stayMinutes, 360);
});

test("every bundled sight of an amusement or theme-park kind has the stay its size calls for, and none gets a long one by its category alone", () => {
  const expected: Record<string, number> = {
    // The whole day.
    "東京ディズニーランド": 480,
    "東京ディズニーシー": 480,
    "香港ディズニーランド": 480,
    "ユニバーサル・スタジオ・ジャパン": 480,
    "ユニバーサル・スタジオ・シンガポール": 480,
    "ユニバーサル・スタジオ・ハリウッド": 480,
    // Most of a day.
    "香港海洋公園": 360,
    "ロッテワールド": 360,
    "日光江戸村": 360,
    // Half a day: a ride park or a water park.
    "チボリ公園": 240,
    "グローナルンド遊園地": 240,
    "八木山ベニーランド": 240,
    "Dam Sen Cultural Park": 240,
    "ワイルド・ワディ・ウォーター・パーク": 240,
    "Wild Wild Wet": 240,
    // A couple of hours: what the category alone gives.
    "神戸アンパンマンこどもミュージアム&モール": 150,
    "仙台アンパンマンこどもミュージアム&モール": 150,
    "新横浜ラーメン博物館": 150,
    "よこはまコスモワールド": 150,
    "GUNDAM FACTORY YOKOHAMA": 150,
    "名古屋港シートレインランド": 150,
    "あま市七宝焼アートヴィレッジ": 150,
    "マリーナホップ": 150,
    "美浜タウンリゾート・アメリカンビレッジ": 150,
    "マカオ・フィッシャーマンズ・ワーフ": 150,
    "ハウパーヴィラ": 150,
    "アクリマタシオン庭園": 150,
    "ドバイランド": 150,
    // A building of food stalls.
    "お好み村": 75,
  };
  const found = new Map<string, number>();
  for (const city of cities) {
    for (const sight of city.sights) {
      if (/amusement|theme park/i.test(sight.kind ?? "")) found.set(sight.ja, shioriStayMinutes(sight.kind, `${sight.ja} ${sight.en}`));
    }
  }
  // A sight added to the list later fails here until someone has decided its size.
  assert.deepEqual(Object.fromEntries([...found].sort()), Object.fromEntries(Object.entries(expected).sort()));
  assert.equal(shioriStayMinutes("amusement park", "どこかの遊園地"), 150);
  assert.equal(shioriStayMinutes("theme park", "富士急ハイランド"), 420);
});

test("the way back to a Taipei hotel is not a ride on a line that does not run there", () => {
  // Was: 台北捷運環状線 松山駅→永春駅 (1 stop, 3 min), then 23 minutes on foot.
  const { plan } = auditPlan("taipei-2");
  const rides = plan.days.flatMap((day) => [day.fromHotel, ...day.legs, day.toHotel]).flatMap((leg) => leg?.rail?.rides ?? []);
  assert.ok(rides.length > 0);
  for (const ride of rides.filter((entry) => entry.line === "台北捷運環状線")) assert.ok(!/松山|永春/.test(`${ride.from}${ride.to}`), `${ride.from}→${ride.to}`);
});

test("the area to stay is not a far-out place that wins by putting the trip on fewer, fuller days", () => {
  // Was: 高山寺, a mountain temple ten kilometres out. From there the list
  // went on two packed days (337 minutes moving); from 本能寺 in the centre
  // on three easy ones (343). Fewer days are fewer ways out and back, and
  // the least total alone decided.
  // (Those figures were with the long legs printed as taxis. By train and
  // bus the list takes three days from anywhere: two of them packed from
  // 高山寺, one from 京都御所 in the centre — which is the answer now.)
  const { scenario, plan } = auditPlan("kyoto-3");
  assert.equal(plan.stayNear?.nearName, "京都御所");
  const from = (name: string) => {
    const base = scenarioPlaces(scenario).find((place) => place.name === name)!;
    return buildShioriPlan({ places: scenarioPlaces(scenario), days: scenario.days, hotel: { name: "h", lat: base.lat, lon: base.lon }, locale: "ja" }, { rail: railOf("kyoto"), cities });
  };
  const packed = (name: string) => from(name).days.filter((day) => day.load === "tight").length;
  assert.equal(packed("京都御所"), 1);
  assert.ok(packed("高山寺") > packed("京都御所"));
  // Top eight of Kyoto: not 伏見稲荷大社 at the southern edge for five minutes' difference, nor 延暦寺 on its mountain.
  // (清水寺 while 延暦寺 was a taxi ride away; 銀閣寺, on the side of town the way up the mountain starts from, now that it is not.)
  assert.equal(auditPlan("kyoto-2").plan.stayNear?.nearName, "銀閣寺");
  // Tokyo: not the Skytree in the east for one minute over two days.
  assert.equal(auditPlan("tokyo-2").plan.stayNear?.nearName, "皇居");
});

test("a summit, a volcano, an island or a forest is never the area to stay while the list holds a place with beds near it", () => {
  // Was: 箱根山, the volcano itself. (Gora: 彫刻の森 while the far legs were taxis, the cable car beside it now that they are a bus.)
  assert.equal(auditPlan("hakone-2").plan.stayNear?.nearName, "小田急箱根鋼索線");
  for (const kind of ["volcano", "stratovolcano", "mountain", "mountain range", "mountain pass", "island", "island group", "forest park", "waterfall", "canyon", "cave"]) assert.equal(nobodySleepsAt(kind), true, kind);
  for (const kind of [undefined, "buddhist temple", "artificial island", "hill castle", "cave church", "volcano observatory", "theme park", "beach", "urban park", "observation tower"]) assert.equal(nobodySleepsAt(kind), false, String(kind));
  // In every trip of the audit.
  for (const scenario of scenarios) {
    const { plan } = auditPlan(scenario.id);
    const places = scenarioPlaces(scenario);
    if (!plan.stayNear?.nearName || places.every((place) => nobodySleepsAt(place.kind))) continue;
    const named = places.find((place) => place.name === plan.stayNear!.nearName)!;
    assert.equal(nobodySleepsAt(named.kind), false, `${scenario.id}: ${named.name} [${named.kind}]`);
  }
  // A list of nothing but mountains still gets an answer: one of them.
  const kyoto = cities.find((city) => city.id === "kyoto")!;
  const peaks = kyoto.sights.filter((sight) => sight.kind === "mountain").slice(0, 2);
  assert.equal(peaks.length, 2);
  const plan = buildShioriPlan({ places: peaks.map((sight, index) => ({ id: `m${index}`, name: sight.ja, lat: sight.lat, lon: sight.lon, stayMinutes: 120, kind: sight.kind })), days: 1, hotel: null, locale: "ja" }, { cities });
  assert.ok(peaks.some((sight) => sight.ja === plan.stayNear?.nearName));
});

const minutesOfClock = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
/** A day's open dinner, with its start in minutes since the day's own midnight. */
const dinnerOf = (day: ShioriDay) => {
  const meal = day.meals.find((entry) => entry.kind === "dinner");
  return meal ? { meal, start: minutesOfClock(meal.start) + (meal.nextDay ? 1_440 : 0) } : null;
};
const dayEndingAt = (id: string, name: RegExp) => {
  const { scenario, plan } = auditPlan(id);
  const day = plan.days.find((entry) => name.test(entry.stops.at(-1)!.place.name));
  assert.ok(day, `${id} has no day that ends at ${name}`);
  return { scenario, plan, day };
};

test("the open dinner of a day is at dinner time and where one would eat: back near the hotel after a last sight that ends in mid-afternoon, not at 16:38 beside an earthwork", () => {
  // Was: (dinner 16:38 near 水城) (café break 16:38, after) — the minute the last sight ended, beside it, twice.
  // (That day ended at the earthwork while Dazaifu was reached by taxi. By train it ends at the museum in
  // Dazaifu at 16:40 and is back at the hotel at 17:46: the dinner is then, not at 17:30 on the train.)
  const fukuoka = dayEndingAt("fukuoka-2", /^九州国立博物館$/);
  const earthwork = dinnerOf(fukuoka.day)!;
  assert.equal(earthwork.meal.atHotel, true);
  assert.equal(earthwork.meal.nearName, fukuoka.scenario.hotel!.name);
  assert.deepEqual(earthwork.meal.near, { latitude: fukuoka.scenario.hotel!.lat, longitude: fukuoka.scenario.hotel!.lon });
  assert.equal(fukuoka.day.stops.at(-1)!.leave, "16:40");
  assert.equal(earthwork.meal.start, "17:46");
  assert.ok(earthwork.start >= minutesOfClock(fukuoka.day.end), "not before the ride back has reached the hotel");
  assert.notEqual(fukuoka.day.cafe?.afterStop, fukuoka.day.stops.length - 1, "no coffee an hour before that dinner");
  // Were: (dinner 16:30 near 兵庫県立美術館) (café break 16:30, after) and (dinner 16:36 near 国立中央博物館) (café break 16:36, after).
  // (Those days end elsewhere now that their long legs are not taxis: at 忉利天上寺 at 16:38 and at 青瓦台 at 16:56.)
  for (const [id, name] of [["kobe-2", /忉利天上寺/], ["seoul-2", /青瓦台/]] as const) {
    const { day } = dayEndingAt(id, name);
    const dinner = dinnerOf(day)!;
    assert.equal(dinner.meal.atHotel, true, id);
    assert.ok(dinner.start >= 17 * 60 + 30 && dinner.start >= minutesOfClock(day.end), `${id}: ${dinner.meal.start}`);
    assert.notEqual(day.cafe?.afterStop, day.stops.length - 1, id);
  }
  // Paris and Rome sit down later than Japan: not 16:48 near the Louvre, not 16:52 near the Colosseum.
  for (const id of ["paris-1", "paris-2", "paris-3", "rome-1", "rome-2", "rome-3"]) {
    for (const day of auditPlan(id).plan.days) {
      const dinner = dinnerOf(day);
      if (dinner) assert.ok(dinner.start >= 19 * 60 + 30, `${id} day ${day.index + 1}: ${dinner.meal.start}`);
    }
  }
});

test("in every trip of the audit a dinner is never before the dinner hour, never before the traveller can be there, and never the minute of a coffee break", () => {
  let slots = 0;
  let hotelSlots = 0;
  for (const scenario of scenarios) {
    const { plan } = auditPlan(scenario.id);
    for (const day of plan.days) {
      const dinner = dinnerOf(day);
      if (!dinner) continue;
      slots += 1;
      const where = `${scenario.id} day ${day.index + 1}: dinner ${dinner.meal.start} near ${dinner.meal.nearName}`;
      const last = day.stops.at(-1)!;
      const lastLeave = minutesOfClock(last.leave) + (last.leaveNextDay ? 1_440 : 0);
      const hour = dinnerHourAt(last.place);
      assert.equal(dinner.meal.afterStop, day.stops.length - 1, where);
      assert.ok(dinner.start >= hour, where);
      assert.ok(dinner.start >= lastLeave, where);
      if (dinner.meal.atHotel) {
        hotelSlots += 1;
        assert.ok(day.toHotel && scenario.hotel, where);
        assert.deepEqual(dinner.meal.near, { latitude: scenario.hotel!.lat, longitude: scenario.hotel!.lon }, where);
        assert.equal(dinner.start, Math.max(hour, lastLeave + day.toHotel!.minutes), where);
      } else {
        assert.deepEqual(dinner.meal.near, { latitude: last.place.lat, longitude: last.place.lon }, where);
        // A day that is still out at the dinner hour eats when its last sight is over: the true time, not a nicer one.
        assert.equal(dinner.start, Math.max(hour, lastLeave), where);
        if (scenario.hotel) assert.ok(hour - lastLeave < 30, `${where}: a wait of half an hour or more is spent going back`);
      }
      if (day.cafe) {
        assert.notEqual(day.cafe.time, dinner.meal.start, where);
        if (day.cafe.afterStop === day.stops.length - 1) assert.ok(dinner.start - minutesOfClock(day.cafe.time) >= 90, `${where}, café ${day.cafe.time}`);
      }
    }
  }
  assert.ok(slots >= 50 && hotelSlots >= 20, `${slots} dinners, ${hotelSlots} near the hotel`);
});

test("where the dinner is: near the last sight on a day still out at the dinner hour or without a hotel, near the hotel after a sight that is over before the hour (were it by five minutes: the ride back leaves then) or a place with no table around it, at its true time on a day that runs late", () => {
  const hotel = { name: "宿", lat: 35.01, lon: 135.76, rideBack: 40 };
  const temple = { name: "寺", lat: 35.0, lon: 135.78, kind: "buddhist temple" };
  const forest = { name: "森", lat: 35.1, lon: 135.7, kind: "forest park" };
  const at = (start: number, atHotel: boolean) => ({ start, atHotel });
  const slot = (lastLeave: number, lastPlace: typeof temple, base: typeof hotel | null) => {
    const found = dinnerSlot({ lastLeave, lastPlace, hotel: base });
    assert.equal(found.nearName, found.atHotel ? hotel.name : lastPlace.name);
    return at(found.start, found.atHotel);
  };
  // Japan sits down from 17:30 (lib/destinations.ts).
  assert.equal(dinnerHourAt(temple), 17 * 60 + 30);
  // Over at 16:38: back to the hotel (there at 17:18), dinner from 17:30.
  assert.deepEqual(slot(16 * 60 + 38, temple, hotel), at(17 * 60 + 30, true));
  // The ride back is longer than the wait: dinner when the hotel is reached.
  assert.deepEqual(slot(17 * 60, temple, { ...hotel, rideBack: 55 }), at(17 * 60 + 55, true));
  // Over at 17:10 or at 17:25, before the dinner hour: the booklet rides back at that minute, so the dinner is
  // near the hotel once there. (Was: near the temple at 17:30, under a ride that had left at 17:10.)
  assert.deepEqual(slot(17 * 60 + 10, temple, hotel), at(17 * 60 + 50, true));
  assert.deepEqual(slot(17 * 60 + 25, temple, hotel), at(18 * 60 + 5, true));
  // Over at the dinner hour or after it: near the temple, the minute it is left.
  assert.deepEqual(slot(17 * 60 + 30, temple, hotel), at(17 * 60 + 30, false));
  // Without a hotel nothing rides away: near the temple at the dinner hour.
  assert.deepEqual(slot(17 * 60 + 10, temple, null), at(17 * 60 + 30, false));
  // Still sightseeing at 20:10, or past midnight: the true time, near the last sight.
  assert.deepEqual(slot(20 * 60 + 10, temple, hotel), at(20 * 60 + 10, false));
  assert.deepEqual(slot(24 * 60 + 44, temple, null), at(24 * 60 + 44, false));
  // A forest park has no table beside it at any hour: back near the hotel, once there.
  assert.deepEqual(slot(17 * 60 + 20, forest, hotel), at(18 * 60, true));
  assert.deepEqual(slot(19 * 60, forest, hotel), at(19 * 60 + 40, true));
  // A town's own park and a park of rides have tables around them.
  for (const kind of ["urban park", "theme park", "amusement park", "artificial island", undefined]) assert.deepEqual(slot(17 * 60 + 40, { ...forest, kind: kind as string }, hotel), at(17 * 60 + 40, false), String(kind));
  for (const kind of ["mountain", "volcano", "waterfall", "island", "beach", "ruins", "archaeological site", "national park", "park", "castle ruin in japan"]) assert.equal(slot(17 * 60 + 40, { ...forest, kind }, hotel).atHotel, true, kind);
  // Without a hotel the plan knows no other place: near the last sight, at the dinner hour.
  assert.deepEqual(slot(16 * 60 + 38, forest, null), at(17 * 60 + 30, false));
  // No coffee within an hour and a half of that dinner after the same stop; one in mid-afternoon stays.
  const stop = (leave: string, arrive: string) => ({ place: { id: leave, name: leave, lat: 35, lon: 135.7, stayMinutes: 60 }, arrive, leave, stayMinutes: 60, waitMinutes: 0, mealMissed: false, arriveNextDay: false, leaveNextDay: false, reserved: false });
  const stops = [stop("10:00", "09:00"), stop("15:00", "14:00"), stop("16:40", "15:40")];
  const dinner = (start: string, afterStop = 2) => [{ kind: "dinner" as const, afterStop, start, end: null, near: { latitude: 35, longitude: 135.7 }, nearName: "x" }];
  assert.equal(cafeBreakFor({ stops, legs: [], meals: dinner("17:30") })?.afterStop, 1);
  assert.equal(cafeBreakFor({ stops: [stops[0], stops[2]], legs: [], meals: dinner("17:30", 1) }), null);
  assert.equal(cafeBreakFor({ stops: [stops[0], stops[2]], legs: [], meals: dinner("19:30", 1) })?.afterStop, 1);
});

test("the meal advisor is asked about the dinner where and when the booklet prints it", () => {
  const { scenario, plan, day } = dayEndingAt("fukuoka-2", /^九州国立博物館$/);
  const dinner = dinnerOf(day)!.meal;
  const asked = openMealSlots(plan).find((entry) => entry.slot === `d${day.index + 1}-dinner`)!;
  assert.equal(asked.meal, dinner);
  assert.equal(asked.key, mealSlotKey(day.index, dinner));
  assert.equal(asked.key, `d${day.index + 1}-dinner|17:46|${scenario.hotel!.lat.toFixed(4)},${scenario.hotel!.lon.toFixed(4)}`);
});

const dayWith = (id: string, name: RegExp) => {
  const { plan } = auditPlan(id);
  const day = plan.days.find((entry) => entry.stops.some((stop) => name.test(stop.place.name)));
  assert.ok(day, `${id} has no stop ${name}`);
  return { day, index: day.stops.findIndex((stop) => name.test(stop.place.name)), stop: day.stops.find((stop) => name.test(stop.place.name))! };
};
const lunchOf = (day: ShioriDay) => day.meals.find((meal) => meal.kind === "lunch") ?? null;

test("a day whose one long visit runs across lunchtime has its lunch during that visit, with the hour added to the visit: not a day from 09:09 to 16:09 with no lunch at all", () => {
  // Was: 09:09–10:39 広島市現代美術館, 11:39–14:39 厳島, 15:19–16:09 厳島神社 — no stop ends between 11:30 and 14:00, so no lunch.
  // (The island was reached by a taxi drawn across the sea then. By train and ferry its day has another shape,
  // with a stop that ends at lunchtime; the visit across lunchtime of the audit is now the children's museum of kobe-3.)
  assert.ok(lunchOf(dayWith("hiroshima-2", /^厳島$/).day), "the day of the island has a lunch");
  const island = dayWith("kobe-3", /アンパンマン/);
  const lunch = lunchOf(island.day)!;
  assert.deepEqual([lunch.during, lunch.afterStop, lunch.start, lunch.end, lunch.nearName], [true, island.index, "12:30", "13:30", island.stop.place.name]);
  // Two and a half hours of the museum and the hour at a table: three and a half hours there, and the visit is still called two and a half.
  assert.deepEqual([island.stop.arrive, island.stop.leave], ["11:54", "15:24"]);
  assert.equal(island.stop.stayMinutes, 150);
  assert.equal(minutesOfClock(island.stop.leave) - minutesOfClock(island.stop.arrive), 210);
  // What follows leaves when the visit is over, not when the lunch is.
  assert.equal(departureAfterStop(island.day, island.index), island.stop.leave);
  const next = island.day.stops[island.index + 1];
  assert.equal(minutesOfClock(next.arrive), minutesOfClock(island.stop.leave) + island.day.legs[island.index].minutes + 10);
  // The days of the audit that had no lunch: a zoo from 11:51 to 14:21 (osaka-3), a seaside park from 11:45 to 14:15 (fukuoka-3), a zoo from 11:37 to 14:07 (sapporo-3).
  for (const [id, name] of [["osaka-3", /天王寺動物園/], ["fukuoka-3", /海の中道海浜公園/], ["sapporo-3", /円山動物園/], ["yokohama-2", /野毛山動物園/], ["taipei-1", /台北市立動物園/]] as const) {
    assert.ok(lunchOf(dayWith(id, name).day), `${id}: the day of ${name} has a lunch`);
  }
});

test("a theme park that fills the day has its lunch listed during the visit and no hour added: its hours already hold it", () => {
  for (const [id, name, stay] of [["tokyo-2", /東京ディズニーランド/, 480], ["osaka-1", /ユニバーサル/, 480], ["nikko-3", /江戸村/, 360]] as const) {
    const park = dayWith(id, name);
    const lunch = lunchOf(park.day)!;
    assert.deepEqual([lunch.during, lunch.afterStop, lunch.nearName], [true, park.index, park.stop.place.name], id);
    assert.equal(park.stop.stayMinutes, stay, id);
    assert.equal((minutesOfClock(park.stop.leave) - minutesOfClock(park.stop.arrive) + 1_440) % 1_440, stay, `${id}: ${park.stop.arrive}–${park.stop.leave}`);
    assert.ok(minutesOfClock(lunch.start) >= Math.max(12 * 60 + 30, minutesOfClock(park.stop.arrive)) && minutesOfClock(lunch.start) <= 13 * 60, `${id}: ${lunch.start}`);
  }
});

test("in every trip of the audit a day that is out from the morning into the afternoon has a lunch, a lunch during a visit lies inside it, and every visit is printed as long as it is", () => {
  let during = 0;
  for (const scenario of scenarios) {
    const { plan } = auditPlan(scenario.id);
    for (const day of plan.days) {
      const where = `${scenario.id} day ${day.index + 1}`;
      const last = day.stops.at(-1)!;
      const out = minutesOfClock(day.stops[0].arrive) <= 12 * 60 && (last.leaveNextDay || minutesOfClock(last.leave) >= 13 * 60 + 30);
      const lunches = day.meals.filter((meal) => meal.kind === "lunch");
      assert.ok(lunches.length <= 1, where);
      if (out) assert.equal(lunches.length, 1, `${where}: ${day.stops.map((stop) => `${stop.arrive}–${stop.leave} ${stop.place.name}`).join(", ")}`);
      for (const stop of day.stops) assert.equal(stop.stayMinutes, stop.place.stayMinutes, `${where}: ${stop.place.name}`);
      const lunch = lunches[0];
      if (!lunch?.during) continue;
      during += 1;
      const stop = day.stops[lunch.afterStop];
      const [arrive, leave, start, end] = [stop.arrive, stop.leave, lunch.start, lunch.end!].map(minutesOfClock);
      assert.ok(!stop.arriveNextDay && !stop.leaveNextDay && !lunch.nextDay, where);
      assert.equal(start, Math.max(arrive, 12 * 60 + 30), where);
      assert.ok(start <= 13 * 60 && end === start + 60 && end <= leave, `${where}: lunch ${lunch.start}–${lunch.end} in ${stop.arrive}–${stop.leave}`);
      assert.ok(leave > 14 * 60, where);
      // The hour is in the day: added to a visit, held already by a stay that fills the day.
      assert.equal(leave - arrive, stop.stayMinutes + (stop.stayMinutes >= DAY_FILLING_STAY ? 0 : 60), where);
      // A coffee after such a visit is not "straight after lunch".
      if (day.cafe?.afterStop === lunch.afterStop) assert.ok(minutesOfClock(day.cafe.time) - end >= 75, where);
    }
  }
  assert.ok(during >= 4, `${during} lunches during a visit`);
});

test("the lunch hour of a visit across lunchtime is on the clock the search and the booklet share: begun by 13:00, not over by 14:00, nobody's booking, not a stay that fills the day", () => {
  const at = (clock: string) => minutesOfClock(clock);
  // 09:00–10:30, a ride of fifty minutes and ten of slack, 11:30–14:00 … 14:01: no stop ends at lunchtime.
  const zoo = dayClock([90, 151, 60], [null, null, null], [50, 20], at("09:00"));
  assert.deepEqual([zoo.lunchAt, zoo.arrive[1], zoo.leave[1], zoo.arrive[2]], [1, at("11:30"), at("15:01"), at("15:31")]);
  // A stop that ends at lunchtime has the lunch after it, as ever: nothing is during a visit then.
  const usual = dayClock([90, 150, 60], [null, null, null], [50, 20], at("09:00"));
  assert.deepEqual([usual.lunchAt, usual.leave[1]], [1, at("15:00")]);
  const morning = dayClock([150, 240], [null, null], [20], at("09:00"));
  assert.deepEqual([morning.lunchAt, morning.leave[0], morning.leave[1]], [0, at("12:30"), at("17:00")]);
  // Begun at 13:00: lunch on arrival. Begun at 13:10: an afternoon visit, no hour.
  assert.equal(dayClock([120], [null], [], at("13:00")).lunchAt, 0);
  assert.equal(dayClock([120], [null], [], at("13:10")).lunchAt, -1);
  // Over by 11:20, or a restaurant chosen for lunch: no hour.
  assert.equal(dayClock([60, 60], [null, null], [10], at("09:00")).lunchAt, -1);
  assert.equal(dayClock([90, 60, 200], [null, "lunch", null], [10, 10], at("09:00")).lunchAt, -1);
  // A stay that fills the day gets none (five hours: its eating is in it); one minute less does.
  assert.deepEqual([dayClock([300], [null], [], at("09:30")).lunchAt, dayClock([300], [null], [], at("09:30")).leave[0]], [-1, at("14:30")]);
  assert.deepEqual([dayClock([299], [null], [], at("09:30")).lunchAt, dayClock([299], [null], [], at("09:30")).leave[0]], [0, at("15:29")]);
  // A booked visit is not lengthened: its hours are the traveller's own.
  const booked = dayClock([60, 200], [null, null], [20], at("09:00"), { fixed: [null, at("11:00")] });
  assert.deepEqual([booked.lunchAt, booked.leave[1], booked.noLunchRoom], [-1, at("14:20"), false]);
  assert.equal(dayClock([60, 200], [null, null], [20], at("09:00"), { fixed: [null, null] }).lunchAt, 1);
  // With a finish entered the hour is taken only when the day still ends in time; else the day says it has no room for lunch.
  const roomy = dayClock([60, 180], [null, null], [20], at("09:30"), { close: at("16:00") });
  assert.deepEqual([roomy.lunchAt, roomy.leave[1], roomy.hardOver, roomy.noLunchRoom], [1, at("15:00"), 0, false]);
  const tight = dayClock([60, 180], [null, null], [20], at("09:30"), { close: at("14:30") });
  assert.deepEqual([tight.lunchAt, tight.leave[1], tight.hardOver, tight.noLunchRoom], [-1, at("14:00"), 0, true]);
});

test("a day whose long ride runs across lunchtime has its lunch before setting off: not a day out from 10:05 to 16:31 with no lunch at all", () => {
  const at = (clock: string) => minutesOfClock(clock);
  // Was (once a long leg is a bus and not a taxi): 10:05–11:20 華厳滝, 13:05–15:05 鬼怒川温泉, 15:31–16:31 東武ワールドスクウェア — no stop ends
  // between 11:30 and 14:00 and no visit runs across it, so no lunch.
  const falls = dayClock([75, 120, 60], [null, null, null], [95, 16], at("10:05"));
  assert.deepEqual([falls.lunchAt, falls.leave[0], falls.arrive[1], falls.noLunchRoom], [0, at("12:20"), at("14:05"), false]);
  // Left before half past ten, nobody eats lunch yet: that day has none.
  assert.equal(dayClock([75, 120], [null, null], [170], at("09:00")).lunchAt, -1);
  // The ride is what runs across lunchtime, not a wait at a restaurant's door in the evening.
  assert.equal(dayClock([105, 60], [null, "dinner"], [20], at("09:07")).lunchAt, -1);
  // A stop that ends at lunchtime, or a visit that runs across it, comes first, as ever.
  assert.equal(dayClock([75, 30, 120], [null, null, null], [20, 95], at("10:05")).lunchAt, 1);
  assert.equal(dayClock([75, 150], [null, null], [80], at("10:05")).lunchAt, 1);
  // A booking the hour would make late is kept: the day says it has no room for lunch.
  const booked = dayClock([75, 120], [null, null], [95], at("10:05"), { fixed: [null, at("13:30")] });
  assert.deepEqual([booked.lunchAt, booked.arrive[1], booked.late, booked.noLunchRoom], [-1, at("13:30"), 0, true]);
  // In a plan: two hours at a place from nine, then a ride of well over two hours.
  const place = (id: string, lat: number, lon: number) => ({ id, name: id, lat, lon, stayMinutes: 120 });
  const plan = buildShioriPlan({ places: [place("near", 35.0, 135.0), place("far", 35.9, 135.0)], days: 1, hotel: null, locale: "ja" });
  const [day] = plan.days;
  assert.equal(day.stops.length, 2);
  assert.ok(day.legs[0].minutes >= 110, `${day.legs[0].minutes} minutes`);
  const lunch = day.meals.find((meal) => meal.kind === "lunch")!;
  assert.deepEqual([lunch.afterStop, lunch.start, lunch.end, lunch.during ?? false, lunch.nearName], [0, "11:00", "12:00", false, day.stops[0].place.name]);
  assert.deepEqual([day.stops[0].arrive, day.stops[0].leave, day.stops[0].stayMinutes], ["09:00", "11:00", 120]);
  assert.equal(minutesOfClock(day.stops[1].arrive), at("12:00") + day.legs[0].minutes + 10);
});

test("the meal advisor is told how long a lunch during a visit has before a booked stop: what is left of the visit is not free time", () => {
  const island = dayWith("kobe-3", /アンパンマン/);
  const plan = auditPlan("kobe-3").plan;
  const booked = { days: plan.days.map((day) => day.index !== island.day.index ? day : { ...day, stops: day.stops.map((stop, index) => index === island.index + 1 ? { ...stop, reserved: true } : stop) }) };
  const brief = buildMealBrief({ plan: booked, sights: mealSights(cities), city: null, prefs: EMPTY_MEAL_PREFS });
  const slot = brief?.slots.find((entry) => entry.slot === `d${island.day.index + 1}-lunch`);
  assert.ok(slot, "the lunch during the visit is asked about");
  assert.equal(slot.time, "12:30");
  // 12:30 to the booked 湊川神社, less the ride and the hour and fifty-four minutes of museum after the lunch: the lunch hour and the ten minutes of slack.
  const next = island.day.stops[island.index + 1];
  assert.equal(slot.minutesUntilNext, minutesOfClock(next.arrive) - island.day.legs[island.index].minutes - minutesOfClock("12:30") - (minutesOfClock(island.stop.leave) - minutesOfClock("13:30")));
  assert.equal(slot.minutesUntilNext, 70);
});

test("a theme park that fills the day is entered at opening on a day too full to keep, and the rest follows it: not Disneyland from 10:53 after the Skytree", () => {
  // Were: 09:08–10:08 東京スカイツリー, 10:53–18:53 東京ディズニーランド; and 09:20–11:20 海遊館, 11:51–19:51 ユニバーサル・スタジオ・ジャパン.
  // (The Skytree shared the park's day while the two were 35 minutes apart by taxi; by train the museum at Ueno does.)
  for (const [id, park, then] of [["tokyo-2", /東京ディズニーランド/, "東京国立博物館"], ["osaka-2", /ユニバーサル/, "海遊館"], ["osaka-1", /ユニバーサル/, null]] as const) {
    const found = dayWith(id, park);
    assert.equal(found.index, 0, `${id}: ${found.day.stops.map((stop) => `${stop.arrive} ${stop.place.name}`).join(", ")}`);
    assert.ok(found.stop.arrive <= "09:30", `${id}: in at ${found.stop.arrive}`);
    assert.equal(found.stop.stayMinutes, 480, id);
    if (then) assert.deepEqual(found.day.stops.map((stop) => stop.place.name), [found.stop.place.name, then], id);
  }
  // In every trip of the audit: a stay that fills the day is anywhere but first only on a day that is kept that way.
  for (const scenario of scenarios) {
    for (const day of auditPlan(scenario.id).plan.days) {
      const late = day.stops.findIndex((stop, index) => index > 0 && !stop.place.meal && stop.stayMinutes >= DAY_FILLING_STAY && day.stops.slice(0, index).some((before) => before.stayMinutes < DAY_FILLING_STAY));
      if (late >= 0) assert.equal(day.runsLate, false, `${scenario.id} day ${day.index + 1}: ${day.stops[late].place.name} from ${day.stops[late].arrive}`);
    }
  }
});

test("the stay that fills the day gives way only to an order that can be kept or that keeps a chosen meal, never to ten minutes on a day that runs late either way", () => {
  const stop = (stay: number, meal: "lunch" | null = null) => ({ stay, meal, day: null });
  const order = (problem: SearchProblem) => {
    const day = daySearch(problem).choose(1).days[0];
    return { order: day.order, arrive: day.arrive, leave: day.leave, missed: day.missed };
  };
  // A park of eight hours forty minutes from the hotel and a tower ten minutes from it, thirty-five apart. Tower first
  // is over ten minutes sooner; either way the day runs past 18:00. The park is entered at 09:20, not at 10:35.
  const full = order({ stops: [stop(480), stop(60)], minutes: [[0, 35], [35, 0]], km: [[0, 9], [9, 0]], hotel: { out: [40, 10], back: [40, 10], km: [9, 3] } });
  assert.deepEqual([full.order, full.arrive[0], full.leave[1]], [[0, 1], 9 * 60 + 20, 19 * 60 + 5]);
  // A six-hour park and a two-hour sight that fit the day only with the sight first (over at 18:00 sharp): the day that can be kept is the day.
  const fits = order({ stops: [stop(360), stop(120)], minutes: [[0, 30], [30, 0]], km: [[0, 5], [5, 0]], hotel: { out: [50, 40], back: [50, 10], km: [9, 3] } });
  assert.deepEqual([fits.order, fits.leave[1]], [[1, 0], 18 * 60]);
  // A five-hour stay, a restaurant chosen for lunch and a long sight: no order is over by 18:00, but with the stay first
  // the restaurant is reached after its kitchen has closed. The order that eats the chosen lunch is the day.
  const meal = order({ stops: [stop(300), stop(60, "lunch"), stop(200)], minutes: [[0, 30, 10], [30, 0, 10], [10, 10, 0]], km: [[0, 5, 2], [5, 0, 2], [2, 2, 0]], hotel: null });
  assert.deepEqual([meal.order, meal.missed], [[2, 1, 0], 0]);
});

const sightOf = (cityId: string, name: string) => placeFromSight(cities.find((city) => city.id === cityId)!.sights.find((sight) => sight.ja === name)!, "ja");
const allLegs = (plan: ReturnType<typeof auditPlan>["plan"]) => plan.days.flatMap((day) => [day.fromHotel, ...day.legs, day.toHotel]).flatMap((leg) => (leg ? [leg] : []));
const straightKm = (leg: { from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number } }) => Math.hypot(
  (leg.from.latitude - leg.to.latitude) * 111,
  (leg.from.longitude - leg.to.longitude) * 111 * Math.cos((leg.from.latitude * Math.PI) / 180),
);

test("beyond a short hop a leg is the train, not a taxi: the bundled journey where there is one, public transport with the way unknown where there is none", () => {
  // Was: ↓ taxi 35 min between the Skytree and Disneyland, while the bundled network has the journey.
  const pair = (cityId: string, from: string, to: string) => buildShioriPlan({ places: [sightOf(cityId, from), sightOf(cityId, to)], days: 1, hotel: null, locale: "ja" }, { rail: railOf(cityId), cities });
  const tokyo = pair("tokyo", "東京スカイツリー", "東京ディズニーランド").days[0];
  const ride = tokyo.legs[0];
  assert.equal(ride.mode, "rail");
  assert.equal(ride.minutes, ride.rail!.totalMinutes);
  assert.ok(ride.rail!.rides.some((entry) => entry.line === "京葉線"), ride.rail!.rides.map((entry) => entry.line).join(" + "));
  assert.ok(ride.minutes > 60, "the train's own estimate, not the taxi's 35 minutes");
  // Was: ↓ taxi 45 min 筥崎宮 > 九州国立博物館 (rail: four lines, 96 minutes).
  const dazaifu = pair("fukuoka", "筥崎宮", "九州国立博物館").days[0].legs[0];
  assert.equal(dazaifu.mode, "rail");
  assert.ok(dazaifu.rail!.rides.some((entry) => entry.line === "西鉄太宰府線"));
  // Was: ↓ taxi 40 min from a hotel in Greenwich to Hyde Park (rail 66).
  const london = auditPlan("london-3");
  const hyde = buildShioriPlan({ places: [sightOf("london", "ハイド・パーク")], days: 1, hotel: london.scenario.hotel, locale: "ja" }, { rail: railOf("london"), cities }).days[0];
  assert.deepEqual([hyde.fromHotel!.mode, hyde.toHotel!.mode], ["rail", "rail"]);
  // No train in the data for the way up to the lake at Nikko (nine kilometres): a bus the planner does not
  // know, printed as public transport and an estimate — 65 minutes, not a taxi of 35.
  const nikko = pair("nikko", "日光東照宮", "華厳滝").days[0].legs[0];
  assert.deepEqual([nikko.mode, nikko.rail, nikko.minutes], ["transit", null, 65]);
  // Past ten kilometres such a leg is not a city bus all the way: twenty kilometres are 95 minutes, not 125.
  const far = pair("nikko", "東武ワールドスクウェア", "華厳滝").days[0].legs[0];
  assert.deepEqual([far.mode, far.minutes], ["transit", 95]);
  // A measured drive does not bring the taxi back, on a leg with a train or without.
  for (const [plan, leg] of [[pair("tokyo", "東京スカイツリー", "東京ディズニーランド"), ride], [pair("nikko", "日光東照宮", "華厳滝"), nikko]] as const) {
    const input = { places: plan.days[0].stops.map((stop) => stop.place), days: 1, hotel: null, locale: "ja" as const };
    const cityId = leg === ride ? "tokyo" : "nikko";
    const measured = buildShioriPlan(input, { rail: railOf(cityId), cities, routes: new Map([[`drive|${leg.key}`, { minutes: 22, path: [leg.from, leg.to] }]]) });
    assert.deepEqual([measured.days[0].legs[0].mode, measured.days[0].legs[0].minutes], [leg.mode, leg.minutes], cityId);
  }
  // Nor on a leg the engine itself gave to the train: 東京タワー to the Skytree, eight kilometres, with a road measured at ten minutes.
  const tower = pair("tokyo", "東京タワー", "東京スカイツリー");
  const towerLeg = tower.days[0].legs[0];
  assert.equal(towerLeg.mode, "rail");
  const quickRoad = buildShioriPlan({ places: tower.days[0].stops.map((stop) => stop.place), days: 1, hotel: null, locale: "ja" }, { rail: railOf("tokyo"), cities, routes: new Map([[`drive|${towerLeg.key}`, { minutes: 10, path: [towerLeg.from, towerLeg.to] }]]) });
  assert.deepEqual([quickRoad.days[0].legs[0].mode, quickRoad.days[0].legs[0].minutes], ["rail", towerLeg.minutes]);
  // A short hop is still a taxi where the engine says so, and where a car is how one gets about its choice stands: Bali.
  const bali = buildShioriPlan({ places: [{ id: "ubud", name: "Ubud", lat: -8.5069, lon: 115.2625, stayMinutes: 60 }, { id: "lot", name: "Tanah Lot", lat: -8.6212, lon: 115.0868, stayMinutes: 60 }], days: 1, hotel: null, locale: "en" }, { cities });
  assert.equal(bali.days[0].legs[0].mode, "taxi");
});

test("in every trip of the audit a taxi is a hop of four kilometres at most: 128 taxi rides, 106 of them of 35 minutes or more, are two or three short ones", () => {
  let taxis = 0;
  let unknown = 0;
  for (const scenario of scenarios) {
    for (const leg of allLegs(auditPlan(scenario.id).plan)) {
      if (leg.mode === "transit") {
        unknown += 1;
        // Public transport with no line known is never dressed as a train: no journey, and the estimate chip's mode.
        assert.equal(leg.rail, null, scenario.id);
      }
      if (leg.mode !== "taxi") continue;
      taxis += 1;
      assert.ok(straightKm(leg) <= 4.05 && leg.minutes <= 25, `${scenario.id}: taxi ${leg.minutes} min over ${straightKm(leg).toFixed(1)} km, ${leg.fromName} > ${leg.toName}`);
    }
  }
  assert.ok(taxis <= 3, `${taxis} taxi rides`);
  assert.ok(unknown > 0);
  // The same pair goes the same way on every day: london-3 leaves its Greenwich hotel by train each morning.
  for (const day of auditPlan("london-3").plan.days) assert.notEqual(day.fromHotel?.mode, "taxi");
});

test("a crossing by boat is never beaten by a taxi or a walk drawn over the water: Miyajima is reached by the ferry the network has", () => {
  // Were: ↓ taxi 45 min 広島平和記念資料館 > 厳島神社 and ↓ taxi 45 min 厳島神社 > the hotel in town, straight across the strait.
  for (const id of ["hiroshima-1", "hiroshima-2"]) {
    const { plan } = auditPlan(id);
    const day = plan.days.find((entry) => entry.stops.some((stop) => stop.place.name === "厳島神社"))!;
    const index = day.stops.findIndex((stop) => stop.place.name === "厳島神社");
    const into = index === 0 ? day.fromHotel! : day.legs[index - 1];
    assert.equal(into.mode, "rail", id);
    const ferry = into.rail!.rides.at(-1)!;
    assert.deepEqual([ferry.boat, ferry.from, ferry.to], [true, "宮島口駅", "宮島桟橋"], id);
    assert.ok(/フェリー|汽船|航路/.test(ferry.line ?? ""), ferry.line ?? "");
    assert.ok(into.rail!.rides.slice(0, -1).every((ride) => ride.boat === undefined), "a train is not a boat");
  }
  // From the pier on the mainland the shrine is 2.4 km in a straight line — across the water. Whatever a
  // road or a footpath is measured at, the leg is the ferry.
  const pier = { id: "pier", name: "宮島口", lat: 34.3118, lon: 132.3028, stayMinutes: 30 };
  const input = { places: [pier, sightOf("hiroshima", "厳島神社")], days: 1, hotel: null, locale: "ja" as const };
  const crossing = buildShioriPlan(input, { rail: railOf("hiroshima"), cities }).days[0];
  const leg = crossing.legs[0];
  assert.deepEqual([leg.mode, leg.rail?.rides.length, leg.rail?.rides[0].boat], ["rail", 1, true]);
  for (const routes of [
    new Map([[`walk|${leg.key}`, { minutes: 9, path: [leg.from, leg.to] }]]),
    new Map([[`drive|${leg.key}`, { minutes: 4, path: [leg.from, leg.to] }]]),
    new Map([[`walk|${leg.key}`, { minutes: 9, path: [leg.from, leg.to] }], [`drive|${leg.key}`, { minutes: 4, path: [leg.from, leg.to] }]]),
  ]) {
    const measured = buildShioriPlan(input, { rail: railOf("hiroshima"), cities, routes }).days[0].legs[0];
    assert.deepEqual([measured.mode, measured.minutes], ["rail", leg.minutes]);
  }
  // Which bundled lines are boats is read off their names; this is all of them. A regenerated network
  // with a boat under another kind of name must be added to isBoatLineName, not pass unnoticed here.
  const boats: Record<string, string[]> = {};
  for (const file of readdirSync(new URL("../public/rail/", import.meta.url)).sort()) {
    const network = JSON.parse(readFileSync(new URL(`../public/rail/${file}`, import.meta.url), "utf8")) as { id: string; lines: Array<[string, string]> };
    const found = network.lines.filter(([ja, en]) => isBoatLineName(ja, en)).map(([ja]) => ja).sort();
    if (found.length > 0) boats[network.id] = found;
  }
  assert.deepEqual(boats, {
    hiroshima: ["JR西日本宮島フェリー", "宮島松大汽船", "宮島航路"],
    london: ["ウーリッジ・フェリー"],
    newyork: ["スタテン島フェリー"],
    sanfrancisco: ["Alameda Seaplane–San Francisco ferry", "Harbor Bay–San Francisco ferry", "Oakland/Alameda–San Francisco ferry", "Oakland/Alameda–South San Francisco ferry", "Richmond–San Francisco ferry", "Sausalito–San Francisco ferry", "Tiburon–San Francisco ferry", "Treasure Island–San Francisco ferry", "Vallejo–San Francisco ferry", "水上バス"],
  });
  for (const [ja, en] of [["箱根ロープウェイ", "Hakone Ropeway"], ["ロンドン・ケーブルカー", "London cable car"], ["Riverside Line", "Riverside Line"], ["山陽本線", "San'yō Main Line"]]) assert.equal(isBoatLineName(ja, en), false, ja);
});

test("an island or a summit is never reached by a taxi, and the way up to a summit is not printed as a level walk: public transport, the way unknown", () => {
  for (const [kind, name, reach] of [
    ["island", "厳島", "island"], ["heritage site", "リバティ島", "island"], ["island", "Ellis Island", "island"], ["historical cultural heritage site", "コッカトゥー島 (ニューサウスウェールズ州)", "island"], ["neighborhood", "Alcatraz Island", null],
    ["artificial island", "パーム・ジュメイラ", null], ["neighborhood", "出島", null], ["japanese castle", "広島", null], ["island group", "オランゴ環礁", null],
    ["mountain", "弥山", "summit"], ["stratovolcano", "女峰山", "summit"], ["volcano", "箱根山", "summit"], ["mountain pass", "ハイヴァン峠", null], ["mountain range", "五行山", null],
    ["volcano observatory", "火山観測所", null], ["hill", "カンピドリオ", null], ["hill castle", "中城城", null], ["volcanic crater lake", "芦ノ湖", null], [undefined, "東京タワー", null],
  ] as const) assert.equal(hardToReach({ kind, name }), reach, `${name} [${kind}]`);

  // Were: ↓ taxi 50 min 広島市現代美術館 > 厳島, ↓ taxi 41 min a hotel > リバティ島, ↓ taxi 21 min ウォール街 > 自由の女神像,
  // ↓ walk 21 min a hotel > 弥山 (535 m up), ↓ taxi 45 min 鬼怒楯岩大吊橋 > 女峰山 (2,483 m).
  let checked = 0;
  for (const scenario of scenarios) {
    const { plan } = auditPlan(scenario.id);
    for (const day of plan.days) {
      const ends = [null, ...day.stops.map((stop) => stop.place), null];
      const legs = [day.fromHotel, ...day.legs, day.toHotel];
      legs.forEach((leg, index) => {
        if (!leg) return;
        const reach = [ends[index], ends[index + 1]].map((place) => (place ? hardToReach(place) : null));
        if (!reach.some(Boolean)) return;
        checked += 1;
        const where = `${scenario.id}: ${leg.mode} ${leg.minutes} min ${leg.fromName} > ${leg.toName}`;
        assert.notEqual(leg.mode, "taxi", where);
        if (reach.includes("summit") && leg.mode === "walk") assert.ok(straightKm(leg) <= 0.9, where);
      });
    }
  }
  assert.ok(checked >= 15, `${checked} legs to or from an island or a summit`);
  // The statue stands on Liberty Island: 3.5 km from Wall Street and 2 km from the Battery, a hop a taxi would
  // be the plan for anywhere else. The planner has no ferry for it; it says public transport, way unknown.
  const statue = sightOf("newyork", "自由の女神像");
  assert.equal(hardToReach(statue), null, "nothing in its own kind or name says so");
  for (const from of [sightOf("newyork", "ウォール街"), { id: "battery", name: "Battery Park", lat: 40.7033, lon: -74.017, stayMinutes: 30 }]) {
    const day = buildShioriPlan({ places: [from, statue], days: 1, hotel: null, locale: "ja" }, { rail: railOf("newyork"), cities }).days[0];
    assert.deepEqual([day.legs[0].mode, day.legs[0].rail], ["transit", null], from.name);
  }
  // The way from the temple at its foot up 弥山: not ↓ walk 24 min. And the climb measured at an hour and a half does not call a taxi.
  const misen = { places: [sightOf("hiroshima", "大聖院"), sightOf("hiroshima", "弥山")], days: 1, hotel: null, locale: "ja" as const };
  const up = buildShioriPlan(misen, { rail: railOf("hiroshima"), cities }).days[0].legs[0];
  assert.deepEqual([up.mode, up.rail], ["transit", null]);
  const climbed = buildShioriPlan(misen, { rail: railOf("hiroshima"), cities, routes: new Map([[`walk|${up.key}`, { minutes: 90, path: [up.from, up.to] }]]) }).days[0].legs[0];
  assert.equal(climbed.mode, "transit");
  // A summit a few minutes from the next sight is still a walk: 天保山 is 4.5 m high.
  const near = buildShioriPlan({ places: [{ id: "a", name: "a", lat: 35.0, lon: 135.0, stayMinutes: 30 }, { id: "b", name: "b", lat: 35.004, lon: 135.0, stayMinutes: 30, kind: "mountain" }], days: 1, hotel: null, locale: "ja" }).days[0].legs[0];
  assert.equal(near.mode, "walk");
});

/*
 * Faults three reviewers found in the fixes above.
 */

test("a tower, a shop or a hotel that carries a park's name is not planned as the park: 釜山ロッテタウンタワー (Busan Lotte World Tower) is an hour, not six that fill the day", () => {
  const busan = cities.find((city) => city.id === "busan");
  const tower = busan?.sights.find((sight) => sight.ja === "釜山ロッテタウンタワー");
  assert.ok(busan && tower);
  assert.equal(placeFromSight(tower, "ja").stayMinutes, 60);
  assert.equal(placeFromSight(tower, "en").stayMinutes, 60);
  // The day it is on is an ordinary one: it does not open the day at 09:00 for six hours.
  const places = [...busan.sights.slice(0, 3).filter((sight) => sight.q !== tower.q), tower].map((sight) => placeFromSight(sight, "ja"));
  const plan = buildShioriPlan({ places, days: 1, hotel: null, locale: "ja" }, { rail: railOf("busan"), cities });
  const stop = plan.days.flatMap((day) => day.stops).find((entry) => entry.place.name === "釜山ロッテタウンタワー");
  assert.ok(stop && stop.stayMinutes === 60, JSON.stringify(stop));
  assert.ok(!plan.days.some((day) => day.meals.some((meal) => meal.during)));
  // No bundled sight that is not a park of rides has a stay that fills the day.
  for (const city of cities) {
    for (const sight of city.sights) {
      const stay = shioriStayMinutes(sight.kind, `${sight.ja} ${sight.en}`);
      if (stay >= DAY_FILLING_STAY) assert.match(sight.kind ?? "", /amusement|theme park/, `${sight.ja} [${sight.kind}] ${stay}`);
    }
  }
  // The same for a name the traveller types.
  assert.equal(shioriStayMinutes("skyscraper", "ロッテワールドタワー"), 60);
  assert.equal(shioriStayMinutes(undefined, "ディズニーストア 渋谷"), 75);
  assert.equal(shioriStayMinutes(undefined, "ユニバーサルシティ駅"), 75);
  assert.equal(shioriStayMinutes("concert hall", "ウォルト・ディズニー・コンサートホール"), 75);
  assert.equal(shioriStayMinutes("zoo", "マニラオーシャンパーク"), 150);
  // The parks themselves keep their day.
  assert.equal(shioriStayMinutes("amusement park", "ロッテワールド Lotte World"), 360);
  assert.equal(shioriStayMinutes(undefined, "東京ディズニーランド"), 480);
  assert.equal(shioriStayMinutes("animal theme park", "香港海洋公園 Ocean Park Hong Kong"), 360);
});

test("the area to stay is not a place far out that costs hours more of riding to spare one packed day: 国立中正文化中心, not 関渡宮 at the edge of Taipei", () => {
  // Packed days were counted before any number of minutes. Each pair: the
  // place now named, the far-out place that was, and the trip planned for
  // real from both.
  const cases: Array<[string, string, string]> = [
    ["taipei-3", "国立中正文化中心", "関渡宮"],
    ["naha-2", "守礼門", "中城城"],
    ["sapporo-3", "円山公園", "新琴似神社"],
  ];
  for (const [id, named, farOut] of cases) {
    const { scenario, plan } = auditPlan(id);
    assert.equal(plan.stayNear?.nearName, named, id);
    const moving = (name: string) => {
      const base = scenarioPlaces(scenario).find((place) => place.name === name)!;
      const from = buildShioriPlan({ places: scenarioPlaces(scenario), days: scenario.days, hotel: { name: "h", lat: base.lat, lon: base.lon }, locale: "ja" }, { rail: railOf(scenario.city.id), cities });
      return from.days.reduce((sum, day) => sum + day.travelMinutes, 0);
    };
    assert.ok(moving(named) + 60 <= moving(farOut), `${id}: ${named} ${moving(named)}, ${farOut} ${moving(farOut)}`);
  }
  // The hotel on the volcanoes north of Taipei, 80 to 90 minutes each way, is said to be far.
  const taipei = auditPlan("taipei-3").plan.notices.find((notice) => notice.kind === "hotel-far");
  assert.ok(taipei && taipei.kind === "hotel-far" && taipei.oneWayMinutes >= 60 && taipei.savedMinutes >= 120, JSON.stringify(taipei));
  // A hotel in the middle of Naha is not told that a castle ruin 15 km out is a better base.
  assert.equal(auditPlan("naha-2").plan.notices.some((notice) => notice.kind === "hotel-far"), false);
});

test("a hotel that squeezes the trip onto fewer, packed days is said to be far, with the packed days it costs: Nara from the edge, two packed days and one left empty", () => {
  const { scenario, plan } = auditPlan("nara-3");
  // What the traveller sees from that hotel …
  assert.equal(plan.days.filter((day) => day.load === "tight").length, 2);
  assert.equal(plan.freeDays, 1);
  // … and what is now said about it. (The minutes alone, 29 over two days, said nothing.)
  const notice = plan.notices.find((entry) => entry.kind === "hotel-far");
  assert.ok(notice && notice.kind === "hotel-far", JSON.stringify(plan.notices));
  assert.equal(notice.calmerDays, 2);
  assert.ok(notice.savedMinutes >= 20);
  // It is true of the plan the traveller would get from the area named: no packed day, and less moving.
  const base = plan.stayNear!;
  const there = buildShioriPlan({ places: scenarioPlaces(scenario), days: scenario.days, hotel: { name: "h", lat: base.latitude, lon: base.longitude }, locale: "ja" }, { rail: railOf("nara"), cities });
  assert.equal(there.days.filter((day) => day.load === "tight").length, 0);
  const moving = (days: readonly ShioriDay[]) => days.reduce((sum, day) => sum + day.travelMinutes, 0);
  assert.ok(moving(there.days) < moving(plan.days));
  // A central hotel is not called far for one packed day and twenty minutes (Kyoto's top eight from the centre).
  assert.equal(auditPlan("kyoto-2").plan.notices.some((entry) => entry.kind === "hotel-far"), false);
  // Wherever packed days are said, the area named has that many fewer in the plan made from it.
  for (const entry of scenarios) {
    const audit = auditPlan(entry.id).plan;
    const far = audit.notices.find((item) => item.kind === "hotel-far");
    if (!far || far.kind !== "hotel-far" || !far.calmerDays) continue;
    const near = audit.stayNear!;
    const from = buildShioriPlan({ places: scenarioPlaces(entry), days: entry.days, hotel: { name: "h", lat: near.latitude, lon: near.longitude }, locale: "ja" }, { rail: railOf(entry.city.id), cities });
    const packed = (days: readonly ShioriDay[]) => days.filter((day) => day.load === "tight").length;
    assert.ok(packed(audit.days) - packed(from.days) >= far.calmerDays, `${entry.id}: ${packed(audit.days)} → ${packed(from.days)}, said ${far.calmerDays}`);
  }
});

test("a walk to a quarter named after a hill is a walk, and the way up a hill beside the last sight is not called a train or a bus: 嵐山 from 天龍寺, 若草山 from 春日大社", () => {
  // Was: 天龍寺 > 嵐山 ↓ transit 25 min (a walk of 17), printed as 電車・バス with eight minutes added.
  // 嵐山 is the quarter at the foot of the hill, whatever the catalogue calls it.
  assert.equal(hardToReach(sightOf("kyoto", "嵐山")), null);
  assert.equal(hardToReach({ kind: "mountain", name: "Arashiyama" }), null);
  const arashiyama = buildShioriPlan({ places: [sightOf("kyoto", "天龍寺"), sightOf("kyoto", "嵐山")], days: 1, hotel: null, locale: "ja" }, { rail: railOf("kyoto"), cities }).days[0].legs[0];
  assert.equal(arashiyama.mode, "walk");
  assert.equal(arashiyama.climb, undefined);
  // 若草山 is a hill of 342 m twenty minutes of level walking from 春日大社: not a level walk, and no bus either.
  // The leg is an estimate with the way unknown, and says it is the way up or down a hill.
  for (const pair of [["若草山", "春日大社"], ["春日大社", "若草山"]]) {
    const leg = buildShioriPlan({ places: pair.map((name) => sightOf("nara", name)), days: 1, hotel: null, locale: "ja" }, { rail: railOf("nara"), cities }).days[0].legs[0];
    assert.deepEqual([leg.mode, leg.rail, leg.climb], ["transit", null, true], pair.join(" > "));
  }
  const misen = buildShioriPlan({ places: [sightOf("hiroshima", "大聖院"), sightOf("hiroshima", "弥山")], days: 1, hotel: null, locale: "ja" }, { rail: railOf("hiroshima"), cities }).days[0].legs[0];
  assert.equal(misen.climb, true);
  // Only such a leg carries the mark: never a walk, a train, a taxi, or a ride across town to the foot of a mountain.
  let marked = 0;
  for (const scenario of scenarios) {
    for (const day of auditPlan(scenario.id).plan.days) {
      const ends = [null, ...day.stops.map((stop) => stop.place), null];
      [day.fromHotel, ...day.legs, day.toHotel].forEach((leg, index) => {
        if (!leg?.climb) return;
        marked += 1;
        const where = `${scenario.id}: ${leg.mode} ${leg.minutes} min ${leg.fromName} > ${leg.toName}`;
        assert.deepEqual([leg.mode, leg.rail], ["transit", null], where);
        assert.ok([ends[index], ends[index + 1]].some((place) => place && hardToReach(place) === "summit"), where);
        assert.ok(straightKm(leg) <= 2.5, where);
      });
    }
  }
  assert.ok(marked >= 1, `${marked} legs up or down a hill in the audit`);
});

test("a dinner near the last sight never starts after the booklet has left that sight for the hotel: not 'dinner 17:30 near 天王寺動物園' under a train that left at 17:25", () => {
  // Were: osaka-3 day 2, left 17:25, (dinner 17:30 near 天王寺動物園), back at the hotel 18:41;
  // hakone-3 day 1, left 17:12, dinner 17:30 near the shrine, back 18:42.
  for (const id of ["osaka-3", "hakone-3"]) {
    for (const day of auditPlan(id).plan.days) {
      const dinner = dinnerOf(day);
      const last = day.stops.at(-1)!;
      if (!dinner || last.leave >= "17:30") continue;
      assert.equal(dinner.meal.atHotel, true, `${id} day ${day.index + 1}`);
      assert.equal(dinner.meal.start, day.end, `${id} day ${day.index + 1}: when the ride back is over`);
    }
  }
  const zoo = dayEndingAt("osaka-3", /天王寺動物園/);
  assert.deepEqual([zoo.day.stops.at(-1)!.leave, dinnerOf(zoo.day)!.meal.start, dinnerOf(zoo.day)!.meal.atHotel], ["17:25", zoo.day.end, true]);
  // In every trip of the audit: with a ride back to a hotel, a dinner near the last sight begins the minute the
  // sight is left (the minute the ride is printed from), and a dinner near the hotel not before the ride is over.
  let near = 0;
  for (const scenario of scenarios) {
    for (const day of auditPlan(scenario.id).plan.days) {
      const dinner = dinnerOf(day);
      if (!dinner || !day.toHotel) continue;
      const last = day.stops.at(-1)!;
      const lastLeave = minutesOfClock(last.leave) + (last.leaveNextDay ? 1_440 : 0);
      const where = `${scenario.id} day ${day.index + 1}: left ${last.leave}, dinner ${dinner.meal.start} near ${dinner.meal.nearName}`;
      if (dinner.meal.atHotel) assert.ok(dinner.start >= lastLeave + day.toHotel.minutes, where);
      else {
        near += 1;
        assert.equal(dinner.start, lastLeave, where);
      }
    }
  }
  assert.ok(near >= 5, `${near} dinners near the last sight on days with a hotel`);
});

test("a crossing by boat is headed 船 / Ferry, not 電車 / Train, and a train with a ferry after it says both", () => {
  // Was: hotel at 宮島口, one place 厳島神社: 「電車 約22分」 with 1駅 on the ticket, for the JR ferry alone.
  const pier = { name: "宮島口の宿", lat: 34.3117, lon: 132.303 };
  for (const locale of ["ja", "en"] as const) {
    const shrine = placeFromSight(cities.find((city) => city.id === "hiroshima")!.sights.find((sight) => sight.ja === "厳島神社")!, locale);
    const day = buildShioriPlan({ places: [shrine], days: 1, hotel: pier, locale }, { rail: railOf("hiroshima"), cities }).days[0];
    for (const leg of [day.fromHotel!, day.toHotel!]) {
      assert.equal(leg.mode, "rail");
      assert.ok(leg.rail!.rides.every((ride) => ride.boat), JSON.stringify(leg.rail!.rides));
      assert.equal(legWord(leg), "ferry");
    }
  }
  // From the city the same crossing follows a train: both are said.
  const mixed = allLegs(auditPlan("hiroshima-1").plan).filter((leg) => leg.rail?.rides.some((ride) => ride.boat));
  assert.ok(mixed.length >= 1);
  for (const leg of mixed) assert.equal(legWord(leg), leg.rail!.rides.every((ride) => ride.boat) ? "ferry" : "train-ferry");
  // Every other leg keeps its word.
  const words = new Set(scenarios.flatMap((scenario) => allLegs(auditPlan(scenario.id).plan).map((leg) => `${leg.mode}:${legWord(leg)}`)));
  for (const word of words) assert.match(word, /^(walk:walk|taxi:taxi|rail:train|rail:ferry|rail:train-ferry|transit:transit|transit:climb)$/);
  assert.ok(words.has("rail:train") && words.has("walk:walk") && words.has("transit:transit"));
  // The page has a word for each of them in both languages, and a boat ride is not counted in stations.
  const source = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  for (const key of ["ferry", "railFerry", "rideBoat", "climb"]) assert.equal(source.match(new RegExp(`^    ${key}: "`, "gm"))?.length, 2, key);
  assert.match(source, /ride\.boat \? t\.rideBoat : t\.rideStops\(ride\.stops\)/);
  assert.match(source, /\}\[legWord\(leg\)\]/);
});

test("a stop that holds a lunch hour says so beside its stay, and a lunch eaten on arrival is not called 'during your visit': 11:54–15:24 is 2 h 30 and a lunch", () => {
  // Was: kobe-3, 11:54–15:24 神戸アンパンマンこどもミュージアム&モール ・ 滞在 2時間30分 — a range an hour longer than the stay beside it.
  const { plan } = auditPlan("kobe-3");
  const museum = plan.days.flatMap((day) => day.stops).find((stop) => /アンパンマン/.test(stop.place.name))!;
  assert.deepEqual([museum.arrive, museum.leave, museum.stayMinutes, museum.lunchMinutes], ["11:54", "15:24", 150, 60]);
  // Was: sapporo-3, 12:35–15:05 北海道博物館 with (lunch 12:35–13:35 北海道博物館の見学の途中で): the lunch begins on arrival.
  const sapporo = auditPlan("sapporo-3").plan.days.find((day) => day.stops.some((stop) => stop.place.name === "北海道博物館"))!;
  const at = sapporo.stops.findIndex((stop) => stop.place.name === "北海道博物館");
  const lunch = sapporo.meals.find((meal) => meal.kind === "lunch" && meal.afterStop === at)!;
  assert.equal(lunch.during, true);
  assert.equal(lunch.start, sapporo.stops[at].arrive);
  assert.equal(lunch.onArrival, true);
  // In every trip of the audit: the printed times of a stop are its stay plus the lunch it says it holds, nothing
  // else; a lunch that adds its hour is listed under that stop; "on arrival" is said exactly when the lunch begins
  // the minute of arrival.
  let held = 0;
  let onArrival = 0;
  for (const scenario of scenarios) {
    for (const day of auditPlan(scenario.id).plan.days) {
      day.stops.forEach((stop, index) => {
        const where = `${scenario.id} day ${day.index + 1}: ${stop.arrive}–${stop.leave} ${stop.place.name}`;
        const span = minutesOfClock(stop.leave) + (stop.leaveNextDay ? 1_440 : 0) - minutesOfClock(stop.arrive) - (stop.arriveNextDay ? 1_440 : 0);
        assert.equal(span, stop.stayMinutes + (stop.lunchMinutes ?? 0), where);
        const during = day.meals.find((meal) => meal.afterStop === index && meal.during);
        if (stop.lunchMinutes) {
          held += 1;
          assert.ok(during, where);
        }
        if (during) {
          assert.equal(during.onArrival === true, during.start === stop.arrive, where);
          if (during.onArrival) onArrival += 1;
        } else assert.equal(day.meals.some((meal) => meal.afterStop === index && meal.onArrival), false, where);
      });
    }
  }
  assert.ok(held >= 3 && onArrival >= 1, `${held} stops with a lunch hour in them, ${onArrival} lunches on arrival`);
  // The page says both, in both languages, on the card and on the map's peek.
  const source = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  for (const key of ["mealOnArrival", "stayWithLunch"]) assert.equal(source.match(new RegExp(`^    ${key}: \\(`, "gm"))?.length, 2, key);
  assert.equal(source.match(/stayText\(stop\.stayMinutes, stop\.lunchMinutes\)/g)?.length, 2);
  assert.match(source, /meal\.onArrival \? t\.mealOnArrival\(meal\.nearName\) : t\.mealDuring\(meal\.nearName\)/);
});

test("the meal advisor is told what the meal really follows: a dinner back near the hotel comes after the hotel, not after a sight an hour's ride away; a lunch during a visit has that visit on both sides", () => {
  const sights = mealSights(cities);
  const briefOf = (id: string) => {
    const { plan } = auditPlan(id);
    const brief = buildMealBrief({ plan, sights, city: null, prefs: EMPTY_MEAL_PREFS });
    // (The advisor is offered where the shop guide has shops: a trip outside Japan has no open slot to ask about.)
    assert.equal(brief === null, openMealSlots(plan).length === 0, id);
    return { plan, slot: (dayIndex: number, meal: "lunch" | "dinner") => brief!.slots.find((entry) => entry.slot === `d${dayIndex + 1}-${meal}`)! };
  };
  // Was: fukuoka-2, dinner 17:46 near the hotel sent as { afterKind: "sight", beforeKind: "hotel" } while the last
  // sight is over at 16:40, 66 minutes of riding away.
  const fukuoka = briefOf("fukuoka-2");
  const { day } = dayEndingAt("fukuoka-2", /^九州国立博物館$/);
  assert.equal(dinnerOf(day)!.meal.atHotel, true);
  assert.deepEqual([fukuoka.slot(day.index, "dinner").time, fukuoka.slot(day.index, "dinner").afterKind, fukuoka.slot(day.index, "dinner").beforeKind], ["17:46", "hotel", null]);
  // Was: kobe-3, lunch 12:30 inside a visit from 11:54 sent as following that visit.
  const kobe = briefOf("kobe-3");
  const museumDay = kobe.plan.days.find((entry) => entry.stops.some((stop) => /アンパンマン/.test(stop.place.name)))!;
  const inside = kobe.slot(museumDay.index, "lunch");
  assert.deepEqual([inside.time, inside.afterKind, inside.beforeKind], ["12:30", "sight", "sight"]);
  // In every trip of the audit, by the three shapes a meal has.
  let hotel = 0;
  let during = 0;
  for (const scenario of scenarios) {
    const { plan, slot } = briefOf(scenario.id);
    for (const entry of openMealSlots(plan)) {
      const sent = slot(entry.day.index, entry.meal.kind);
      const where = `${scenario.id} ${entry.slot}`;
      const under = entry.day.stops[entry.meal.afterStop];
      const kind = (stop: typeof under | undefined) => (stop ? mealStopKind(stop.place, sights) : null);
      if (entry.meal.atHotel) {
        hotel += 1;
        assert.deepEqual([sent.afterKind, sent.beforeKind], ["hotel", null], where);
      } else if (entry.meal.during) {
        during += 1;
        assert.equal(sent.beforeKind, kind(under), where);
        assert.equal(sent.afterKind, entry.meal.onArrival ? (entry.meal.afterStop > 0 ? kind(entry.day.stops[entry.meal.afterStop - 1]) : entry.day.fromHotel ? "hotel" : null) : kind(under), where);
      } else {
        const next = entry.day.stops[entry.meal.afterStop + 1];
        assert.deepEqual([sent.afterKind, sent.beforeKind], [kind(under), next ? kind(next) : entry.day.toHotel ? "hotel" : null], where);
      }
    }
  }
  assert.ok(hotel >= 15 && during >= 5, `${hotel} dinners near the hotel, ${during} lunches during a visit`);
});
