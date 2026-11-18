import assert from "node:assert/strict";
import test from "node:test";

import { cafeBreakFor } from "../lib/shiori/cafes.ts";
import { mealSlotKey, openMealSlots } from "../lib/shiori/meal-advice.ts";
import { buildShioriPlan, dinnerHourAt, dinnerSlot, nobodySleepsAt, type ShioriDay } from "../lib/shiori/plan.ts";
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
  // Two days of Yokohama no longer run until ten at night because of them.
  const { plan } = auditPlan("yokohama-2");
  assert.equal(plan.days.some((day) => day.runsLate), false, plan.days.map((day) => `${day.start}–${day.end}`).join(" "));
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
  // Was: 箱根山, the volcano itself.
  assert.equal(auditPlan("hakone-2").plan.stayNear?.nearName, "箱根神社");
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
  // Were: (dinner 16:30 near 兵庫県立美術館) (café break 16:30, after) and (dinner 17:00 near 広島市郷土資料館) (café break 17:00, after).
  for (const [id, name] of [["kobe-2", /兵庫県立美術館/], ["hiroshima-3", /広島市郷土資料館/]] as const) {
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
