import assert from "node:assert/strict";
import test from "node:test";

import { cafeBreakFor } from "../lib/shiori/cafes.ts";
import { buildMealBrief, EMPTY_MEAL_PREFS, mealSights, mealSlotKey, openMealSlots } from "../lib/shiori/meal-advice.ts";
import { DAY_FILLING_STAY, dayClock, daySearch, type SearchProblem } from "../lib/shiori/day-search.ts";
import { buildShioriPlan, departureAfterStop, dinnerHourAt, dinnerSlot, nobodySleepsAt, type ShioriDay } from "../lib/shiori/plan.ts";
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
  // goes on two packed days (337 minutes moving); from 本能寺 in the centre
  // on three easy ones (343). Fewer days are fewer ways out and back, and
  // the least total alone decided.
  const { scenario, plan } = auditPlan("kyoto-3");
  assert.equal(plan.stayNear?.nearName, "本能寺");
  const from = (name: string) => {
    const base = scenarioPlaces(scenario).find((place) => place.name === name)!;
    return buildShioriPlan({ places: scenarioPlaces(scenario), days: scenario.days, hotel: { name: "h", lat: base.lat, lon: base.lon }, locale: "ja" }, { rail: railOf("kyoto"), cities });
  };
  const packed = (name: string) => from(name).days.filter((day) => day.load === "tight").length;
  assert.equal(packed("本能寺"), 0);
  assert.ok(packed("高山寺") > 0);
  // Top eight of Kyoto: not 伏見稲荷大社 at the southern edge for five minutes' difference, nor 延暦寺 on its mountain.
  assert.equal(auditPlan("kyoto-2").plan.stayNear?.nearName, "清水寺");
  // Tokyo: not the Skytree in the east for one minute over two days.
  assert.equal(auditPlan("tokyo-2").plan.stayNear?.nearName, "皇居");
});

test("a summit, a volcano, an island or a forest is never the area to stay while the list holds a place with beds near it", () => {
  // Was: 箱根山, the volcano itself. (彫刻の森 at Gora, since every day from every candidate has its lunch hour.)
  assert.equal(auditPlan("hakone-2").plan.stayNear?.nearName, "箱根 彫刻の森美術館");
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
  const fukuoka = dayEndingAt("fukuoka-2", /^水城$/);
  const earthwork = dinnerOf(fukuoka.day)!;
  assert.equal(earthwork.meal.atHotel, true);
  assert.equal(earthwork.meal.nearName, fukuoka.scenario.hotel!.name);
  assert.deepEqual(earthwork.meal.near, { latitude: fukuoka.scenario.hotel!.lat, longitude: fukuoka.scenario.hotel!.lon });
  assert.equal(earthwork.meal.start, "17:30");
  assert.ok(earthwork.start >= minutesOfClock(fukuoka.day.end), "not before the ride back has reached the hotel");
  assert.notEqual(fukuoka.day.cafe?.afterStop, fukuoka.day.stops.length - 1, "no coffee an hour before that dinner");
  // Were: (dinner 16:30 near 兵庫県立美術館) (café break 16:30, after) and (dinner 16:36 near 国立中央博物館) (café break 16:36, after).
  for (const [id, name] of [["kobe-2", /兵庫県立美術館/], ["seoul-2", /国立中央博物館/]] as const) {
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

test("where the dinner is: near the last sight as a rule, near the hotel after an early end or a place with no table around it, at its true time on a day that runs late", () => {
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
  // Over at 17:10, twenty minutes before dinner: near the temple, at 17:30.
  assert.deepEqual(slot(17 * 60 + 10, temple, hotel), at(17 * 60 + 30, false));
  // Still sightseeing at 20:10, or past midnight: the true time, near the last sight.
  assert.deepEqual(slot(20 * 60 + 10, temple, hotel), at(20 * 60 + 10, false));
  assert.deepEqual(slot(24 * 60 + 44, temple, null), at(24 * 60 + 44, false));
  // A forest park has no table beside it at any hour: back near the hotel, once there.
  assert.deepEqual(slot(17 * 60 + 20, forest, hotel), at(18 * 60, true));
  assert.deepEqual(slot(19 * 60, forest, hotel), at(19 * 60 + 40, true));
  // A town's own park and a park of rides have tables around them.
  for (const kind of ["urban park", "theme park", "amusement park", "artificial island", undefined]) assert.deepEqual(slot(17 * 60 + 20, { ...forest, kind: kind as string }, hotel), at(17 * 60 + 30, false), String(kind));
  for (const kind of ["mountain", "volcano", "waterfall", "island", "beach", "ruins", "archaeological site", "national park", "park", "castle ruin in japan"]) assert.equal(slot(17 * 60 + 20, { ...forest, kind }, hotel).atHotel, true, kind);
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
  const { scenario, plan, day } = dayEndingAt("fukuoka-2", /^水城$/);
  const dinner = dinnerOf(day)!.meal;
  const asked = openMealSlots(plan).find((entry) => entry.slot === `d${day.index + 1}-dinner`)!;
  assert.equal(asked.meal, dinner);
  assert.equal(asked.key, mealSlotKey(day.index, dinner));
  assert.equal(asked.key, `d${day.index + 1}-dinner|17:30|${scenario.hotel!.lat.toFixed(4)},${scenario.hotel!.lon.toFixed(4)}`);
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
  const island = dayWith("hiroshima-2", /^厳島$/);
  const lunch = lunchOf(island.day)!;
  assert.deepEqual([lunch.during, lunch.afterStop, lunch.start, lunch.end, lunch.nearName], [true, island.index, "12:30", "13:30", "厳島"]);
  // Three hours of the island and the hour at a table: four hours there, and the visit is still called three.
  assert.equal(island.stop.stayMinutes, 180);
  assert.equal(minutesOfClock(island.stop.leave) - minutesOfClock(island.stop.arrive), 240);
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
  const island = dayWith("hiroshima-2", /^厳島$/);
  const plan = auditPlan("hiroshima-2").plan;
  const booked = { days: plan.days.map((day) => day.index !== island.day.index ? day : { ...day, stops: day.stops.map((stop, index) => index === island.index + 1 ? { ...stop, reserved: true } : stop) }) };
  const brief = buildMealBrief({ plan: booked, sights: mealSights(cities), city: null, prefs: EMPTY_MEAL_PREFS });
  const slot = brief?.slots.find((entry) => entry.slot === `d${island.day.index + 1}-lunch`);
  assert.ok(slot, "the lunch during the visit is asked about");
  assert.equal(slot.time, "12:30");
  // 12:30 to the booked 厳島神社, less the ride and the two hours and nine minutes of island after the lunch: the lunch hour and the ten minutes of slack.
  const next = island.day.stops[island.index + 1];
  assert.equal(slot.minutesUntilNext, minutesOfClock(next.arrive) - island.day.legs[island.index].minutes - minutesOfClock("12:30") - (minutesOfClock(island.stop.leave) - minutesOfClock("13:30")));
  assert.equal(slot.minutesUntilNext, 70);
});

test("a theme park that fills the day is entered at opening on a day too full to keep, and the rest follows it: not Disneyland from 10:53 after the Skytree", () => {
  // Were: 09:08–10:08 東京スカイツリー, 10:53–18:53 東京ディズニーランド; and 09:20–11:20 海遊館, 11:51–19:51 ユニバーサル・スタジオ・ジャパン.
  for (const [id, park, then] of [["tokyo-2", /東京ディズニーランド/, "東京スカイツリー"], ["osaka-2", /ユニバーサル/, "海遊館"], ["osaka-1", /ユニバーサル/, null]] as const) {
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
