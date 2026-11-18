import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMealBrief, EMPTY_MEAL_PREFS, mealSights } from "../lib/shiori/meal-advice.ts";
import { FAR_PAST_END, buildShioriPlan, type ShioriDay, type ShioriHotel, type ShioriInput, type ShioriPlace, type ShioriPlan, type ShioriRoute } from "../lib/shiori/plan.ts";
import { decodeTrip, emptyTrip, encodeTrip, withCity, withPackAnyway, type ShioriTrip } from "../lib/shiori/state.ts";
import { placeByKind } from "./helpers/kind-stays.ts";
import { auditPlan, cities, railOf, scenarioPlaces, scenarios } from "../scripts/audit-scenarios.ts";

/*
 * A list too full for its days. The booklet a traveller first sees holds the
 * set that fits; what does not fit is left out of the days and named, with
 * the days that would hold everything. One tap plans everything anyway —
 * the days then run late and say so — and that choice is kept with the trip.
 *
 * Read here off the page alone: the clocks a day prints, the names it lists.
 */

const clock = (text: string, nextDay: boolean) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3)) + (nextDay ? 1_440 : 0);
/** A stop that closes its day and may run to 21:30: a chosen dinner, a place of the evening. */
const closes = (stop: ShioriDay["stops"][number]) => stop.place.meal === "dinner" || stop.evening === true;
/** Minutes a day runs past its ordinary end: sightseeing after 18:00, a dinner or a night market after 21:30. */
function pastEndOf(day: ShioriDay) {
  const lastSight = day.stops.findLast((stop) => !closes(stop));
  const last = day.stops.at(-1)!;
  return Math.max(0, lastSight ? clock(lastSight.leave, lastSight.leaveNextDay) - 18 * 60 : 0, closes(last) ? clock(last.leave, last.leaveNextDay) - (21 * 60 + 30) : 0);
}
const latest = (plan: ShioriPlan) => plan.days.map((day) => `${day.stops.at(-1)!.leaveNextDay ? "+" : ""}${day.stops.at(-1)!.leave}`).join(" ");
const namesOn = (plan: ShioriPlan) => plan.days.flatMap((day) => day.stops.map((stop) => stop.place.name));
const printed = (plan: ShioriPlan) => plan.days.map((day) => day.stops.map((stop) => `${stop.arrive}-${stop.leave} ${stop.place.name}`));
const both = (input: Omit<ShioriInput, "locale">, cityId: string | null) => {
  const options = { rail: cityId ? railOf(cityId) : null, cities };
  return { shown: buildShioriPlan({ ...input, locale: "ja" }, options), packed: buildShioriPlan({ ...input, locale: "ja", packAnyway: true }, options) };
};

/** Everything that must hold of any trip nobody entered a time for, whatever is on its list. */
function assertFitsOrSaysSo(input: Omit<ShioriInput, "locale">, cityId: string | null, shown: ShioriPlan, packed: ShioriPlan, where: string) {
  // Every place is on exactly one day or in the list of what was left out: never both, never neither.
  const onDays = namesOn(shown);
  assert.deepEqual([...onDays, ...shown.leftOut].sort(), input.places.map((place) => place.name).sort(), `${where}: every place once`);
  assert.deepEqual(shown.overfull.map((entry) => entry.name).sort(), [...shown.leftOut].sort(), `${where}: what is left out is named`);
  assert.deepEqual(shown.unplaced, [], where);
  // No day with something beside its first place runs more than an hour past its end …
  for (const day of shown.days) {
    if (day.stops.length > 1) assert.ok(pastEndOf(day) <= FAR_PAST_END, `${where}: day ${day.index + 1} ends ${latest(shown)}`);
    assert.equal(day.stops.some((stop) => shown.leftOut.includes(stop.place.name)), false, where);
  }
  // … and where a place was left out for it, no such day runs late at all.
  if (shown.leftOut.length > 0) {
    for (const day of shown.days) if (day.stops.length > 1) assert.equal(day.runsLate, false, `${where}: day ${day.index + 1} of ${latest(shown)} still runs late`);
    const notice = shown.notices.filter((entry) => entry.kind === "left-out");
    assert.equal(notice.length, 1, where);
    assert.ok(notice[0].kind === "left-out");
    assert.deepEqual(notice[0].places, shown.overfull, where);
    // "This many days hold everything" is said only of a plan that was made, and that plan holds everything.
    if (notice[0].days !== null) {
      assert.ok(notice[0].days > input.days && notice[0].days <= 7, where);
      // (Priced as the plan the notice came from: with the city's rail network.)
      const longer = buildShioriPlan({ ...input, days: notice[0].days, locale: "ja" }, { rail: cityId ? railOf(cityId) : null, cities });
      assert.deepEqual([longer.leftOut, longer.days.some((day) => day.runsLate)], [[], false], `${where}: ${notice[0].days} days`);
    }
    assert.equal(shown.notices.some((entry) => entry.kind === "needs-days" || entry.kind === "drop" || entry.kind === "too-much" || entry.kind === "packed-anyway"), false, where);
    // Something is always planned.
    assert.ok(shown.days.length > 0 && onDays.length > 0, where);
  } else {
    assert.equal(shown.notices.some((entry) => entry.kind === "left-out"), false, where);
  }
  // Planned anyway, every place is on a day, as it always was.
  assert.deepEqual([packed.leftOut, packed.overfull, packed.unplaced], [[], [], []], where);
  assert.deepEqual(namesOn(packed).sort(), input.places.map((place) => place.name).sort(), where);
  assert.equal(packed.notices.some((entry) => entry.kind === "left-out"), false, where);
  const farPast = packed.days.some((day) => day.stops.length > 1 && pastEndOf(day) > FAR_PAST_END);
  if (shown.leftOut.length > 0) {
    // A place is left out only of a trip that would otherwise run far past its end, and the way back is offered.
    assert.ok(farPast, `${where}: left out ${shown.leftOut.join(", ")} of a trip that ends ${latest(packed)}`);
    const back = packed.notices.find((entry) => entry.kind === "packed-anyway");
    assert.ok(back && back.kind === "packed-anyway", where);
    assert.deepEqual(back.places, shown.overfull, where);
  } else {
    // Nothing left out: the booklet is the same booklet either way.
    assert.deepEqual(printed(shown), printed(packed), where);
    assert.deepEqual(shown.notices, packed.notices, where);
  }
}

/* ------------------------------------------------------- the trips of the audit */

const LEFT_OUT: Record<string, { before: string; after: string; out: string[]; days: number }> = {
  // id: the latest stop of each day planned anyway → as first shown, what is left out, the days that hold everything.
  // (With the usual stays of the sight notes — the Louvre four hours, the Statue of Liberty three, 箱根山 four —
  // nineteen of the 63 trips have more than their days hold; with the stays by kind it was seven.)
  "tokyo-1": { before: "20:13", after: "16:58", out: ["東京国立博物館"], days: 2 },
  "tokyo-2": { before: "20:25 21:01", after: "16:46 16:34", out: ["東京ディズニーランド"], days: 3 },
  "kyoto-1": { before: "19:05", after: "16:25", out: ["伏見稲荷大社"], days: 2 },
  "osaka-1": { before: "+01:54", after: "13:59", out: ["ユニバーサル・スタジオ・ジャパン", "海遊館"], days: 3 },
  "osaka-2": { before: "18:49 20:29", after: "16:01 16:04", out: ["ユニバーサル・スタジオ・ジャパン"], days: 3 },
  "fukuoka-1": { before: "19:10", after: "16:52", out: ["九州国立博物館"], days: 2 },
  "hakone-1": { before: "22:05", after: "17:40", out: ["箱根山"], days: 2 },
  "hakone-2": { before: "19:06 19:24", after: "17:53 16:07", out: ["箱根山"], days: 3 },
  "nikko-1": { before: "22:52", after: "16:32", out: ["華厳滝", "東武ワールドスクウェア"], days: 2 },
  "nikko-2": { before: "18:19 19:12", after: "17:57 15:49", out: ["日光の社寺"], days: 3 },
  "nikko-3": { before: "19:23 19:43 21:10", after: "17:50 17:25 17:53", out: ["女峰山"], days: 4 },
  "paris-1": { before: "22:12", after: "17:47", out: ["ルーヴル美術館"], days: 2 },
  "london-1": { before: "21:33", after: "18:02", out: ["ロンドン塔"], days: 2 },
  "london-2": { before: "19:29 19:04", after: "17:57 17:12", out: ["ロンドン塔"], days: 3 },
  "newyork-1": { before: "+00:25", after: "17:07", out: ["自由の女神像", "アメリカ自然史博物館"], days: 2 },
  "seoul-1": { before: "20:18", after: "17:34", out: ["景福宮"], days: 2 },
  "seoul-2": { before: "18:47 19:16", after: "16:46 17:54", out: ["オリンピック公園"], days: 3 },
  "taipei-1": { before: "+00:32", after: "19:30", out: ["台北市立動物園"], days: 2 },
  // (Its day closes at カオサン通り, a street its sight note keeps for the evening: 17:30–18:30, not called late.)
  "bangkok-1": { before: "21:59", after: "18:30", out: ["チャトチャック・ウィークエンド・マーケット"], days: 2 },
};

test("the audit's lists too full for their days are shown as the set that fits: USJ is not followed by four sights until 00:44, and what is left out is named with the days that hold it", () => {
  for (const [id, expected] of Object.entries(LEFT_OUT)) {
    const shown = auditPlan(id).plan;
    const packed = auditPlan(id, { packAnyway: true }).plan;
    assert.equal(latest(packed), expected.before, `${id} planned anyway`);
    assert.equal(latest(shown), expected.after, id);
    assert.deepEqual(shown.leftOut, expected.out, id);
    assert.equal(shown.days.some((day) => day.runsLate || day.endsNextDay), false, id);
    assert.deepEqual(shown.notices.filter((notice) => notice.kind === "left-out"), [{ kind: "left-out", places: shown.overfull, days: expected.days }], id);
    assert.deepEqual(shown.overfull.map((entry) => entry.name), expected.out, id);
    // Nothing is taken off the traveller's list: the place is only not on a day.
    assert.equal(namesOn(shown).length + shown.leftOut.length, auditPlan(id).scenario.sights.length, id);
    // The days that are said to hold everything do.
    const scenario = auditPlan(id).scenario;
    const longer = buildShioriPlan({ places: scenarioPlaces(scenario), days: expected.days, hotel: scenario.hotel, locale: "ja" }, { rail: railOf(scenario.city.id), cities });
    assert.deepEqual([longer.leftOut, longer.days.some((day) => day.runsLate)], [[], false], id);
  }
});

test("a day that runs less than an hour over keeps everything and says it runs late, as before; a day that closes at its night market ends inside its evening", () => {
  // The ordinary end is 18:00 for sightseeing; a place of the evening may run to 21:30.
  for (const [id, ends] of [["nara-1", "18:29"], ["yokohama-1", "18:43"], ["kobe-1", "18:16"], ["paris-2", "18:56 17:58"], ["newyork-2", "18:32 18:44"]] as const) {
    const shown = auditPlan(id).plan;
    assert.equal(latest(shown), ends, id);
    assert.deepEqual([shown.leftOut, shown.overfull], [[], []], id);
    assert.ok(shown.days.some((day) => day.runsLate), id);
    for (const day of shown.days) assert.ok(pastEndOf(day) <= FAR_PAST_END, `${id}: ${pastEndOf(day)} minutes over`);
    assert.ok(shown.notices.some((notice) => notice.kind === "needs-days"), id);
    assert.deepEqual(printed(shown), printed(auditPlan(id, { packAnyway: true }).plan), id);
  }
  // 台北 day 1 (as first shown, without the zoo its day has no room for): the day closes at the night market inside its own evening.
  const taipei = auditPlan("taipei-1").plan.days[0];
  assert.equal(taipei.stops.at(-1)!.evening, true);
  assert.ok(clock(taipei.stops.at(-1)!.leave, false) <= 21 * 60 + 30);
});

test("in all 63 trips of the audit no day with more than one place ends more than an hour past its end, every place is on a day or named as left out, and planned anyway nothing is left out", () => {
  const changed: string[] = [];
  for (const scenario of scenarios) {
    const input = { places: scenarioPlaces(scenario), days: scenario.days, hotel: scenario.hotel };
    const shown = auditPlan(scenario.id).plan;
    const packed = auditPlan(scenario.id, { packAnyway: true }).plan;
    assertFitsOrSaysSo(input, scenario.city.id, shown, packed, scenario.id);
    if (shown.leftOut.length > 0) changed.push(scenario.id);
  }
  assert.deepEqual(changed.sort(), Object.keys(LEFT_OUT).sort());
});

/* ------------------------------------------------------------- random trips */

/** A repeatable draw. */
function draws(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function randomTrip(next: () => number, most: number) {
  const city = cities[Math.floor(next() * cities.length)];
  const pool = [...city.sights];
  const count = Math.min(pool.length, 2 + Math.floor(next() * (most - 1)));
  const places = Array.from({ length: count }, () => placeByKind(pool.splice(Math.floor(next() * pool.length), 1)[0], "ja"));
  const days = 1 + Math.floor(next() * 3);
  const roll = next();
  const hotel: ShioriHotel | null = roll < 0.5 ? null : roll < 0.8 ? { name: "中心部のホテル", lat: city.lat, lon: city.lon } : { name: "外れのホテル", lat: places[0].lat + 0.05, lon: places[0].lon + 0.05 };
  return { cityId: city.id, input: { places, days, hotel } };
}

test("in 240 random trips the same holds: no day far past its end, every place once, and the plan with everything in is the old one", () => {
  const next = draws(20_261_118);
  let thinned = 0;
  for (let round = 0; round < 240; round += 1) {
    const { cityId, input } = randomTrip(next, 10);
    const { shown, packed } = both(input, cityId);
    assertFitsOrSaysSo(input, cityId, shown, packed, `#${round} ${cityId} ${input.places.length} places ${input.days} days`);
    if (shown.leftOut.length > 0) thinned += 1;
  }
  assert.ok(thinned >= 40, `${thinned} of 240 trips had a place left out`);
});

test("as few places as can be are left out: on short lists no smaller set, planned as a list of its own, gives days that are kept", () => {
  const next = draws(4_711);
  let checked = 0;
  for (let round = 0; round < 400 && checked < 30; round += 1) {
    const { cityId, input } = randomTrip(next, 7);
    const options = { rail: railOf(cityId), cities };
    const shown = buildShioriPlan({ ...input, locale: "ja" }, options);
    if (shown.leftOut.length === 0) continue;
    checked += 1;
    const where = `#${round} ${cityId}: ${shown.leftOut.join(", ")} left out of ${input.places.length} on ${input.days} day(s)`;
    // The oracle: every way of leaving out one place fewer, each planned afresh as the shorter list it is.
    const fewer = shown.leftOut.length - 1;
    const sets: number[][] = [[]];
    for (let size = 0; size < fewer; size += 1) {
      for (const set of sets.splice(0)) for (let index = (set.at(-1) ?? -1) + 1; index < input.places.length; index += 1) sets.push([...set, index]);
    }
    for (const set of sets) {
      const rest = buildShioriPlan({ ...input, places: input.places.filter((_, index) => !set.includes(index)), locale: "ja", packAnyway: true }, options);
      assert.ok(rest.days.some((day) => day.stops.length > 1 && day.runsLate), `${where}; but without ${set.map((index) => input.places[index].name).join(", ") || "nothing"} it ends ${latest(rest)}`);
    }
    // And the booklet shown is the booklet of the places it keeps.
    const kept = buildShioriPlan({ ...input, places: input.places.filter((place) => !shown.leftOut.includes(place.name)), locale: "ja", packAnyway: true }, options);
    assert.deepEqual(printed(shown), printed(kept), where);
  }
  assert.equal(checked, 30);
});

/* ------------------------------------------------- which place is left out */

const spot = (name: string, lat: number, lon: number, stayMinutes: number, extra: Partial<ShioriPlace> = {}): ShioriPlace => ({ id: `p-${encodeURIComponent(name).replace(/%/g, "")}`, name, lat, lon, stayMinutes, ...extra });
/** Six two-hour sights a few hundred metres apart: more than one day holds. */
const six = (extra: (index: number) => Partial<ShioriPlace> = () => ({})) => Array.from({ length: 6 }, (_, index) => spot(`場所${index + 1}`, 35.0 + index * 0.002, 135.76, 120, extra(index)));
const plan = (places: ShioriPlace[], days = 1, more: Partial<ShioriInput> = {}) => buildShioriPlan({ places, days, hotel: null, locale: "ja", ...more }, { cities: [] });

test("the place that costs the most to include is the one left out: the one far from the rest, the long stay that crowds out several others, and of equals the one lower in the list", () => {
  // Four sights of an hour and a half in one neighbourhood and one an hour's ride away: the far one goes, wherever it is in the list.
  for (const at of [0, 2, 4]) {
    const near = Array.from({ length: 4 }, (_, index) => spot(`近く${index + 1}`, 35.0 + index * 0.003, 135.76, 95));
    assert.deepEqual(plan(near).leftOut, []);
    const places = [...near.slice(0, at), spot("遠く", 35.0, 136.2, 95), ...near.slice(at)];
    assert.deepEqual(plan(places).leftOut, ["遠く"], `far place listed at ${at}`);
  }
  // A day out of eight hours and four sights: the four fit a day, the day out and any of them do not.
  const park = [spot("一日がかり", 35.0, 135.76, 480, { kind: "theme park" }), ...Array.from({ length: 4 }, (_, index) => spot(`名所${index + 1}`, 35.003 + index * 0.003, 135.76, 75))];
  assert.deepEqual(plan(park).leftOut, ["一日がかり"]);
  assert.deepEqual(plan([...park.slice(1), park[0]]).leftOut, ["一日がかり"]);
  // Six alike, of which a day holds three: the three listed last are the ones.
  const alike = six();
  const shown = plan(alike);
  assert.equal(shown.days[0].runsLate, false);
  assert.deepEqual(shown.leftOut, ["場所4", "場所5", "場所6"]);
});

test("never left out: a restaurant or a shop the traveller chose, a place with an entered time, a place the traveller put on a day", () => {
  const stays = (shown: ShioriPlan, name: string, why: string) => {
    assert.ok(namesOn(shown).includes(name), `${why}: ${name} is on a day`);
    assert.equal(shown.leftOut.includes(name), false, why);
    assert.ok(shown.leftOut.length > 0, `${why}: something else is left out`);
  };
  // Each of the six in turn, so that it is never the place's position that saves it.
  for (let index = 0; index < 6; index += 1) {
    const name = `場所${index + 1}`;
    stays(plan(six((at) => (at === index ? { stayMinutes: 60, kind: "restaurant", meal: "lunch" } : {}))), name, "a restaurant chosen for lunch");
    stays(plan(six((at) => (at === index ? { stayMinutes: 90, kind: "restaurant", meal: "dinner" } : {}))), name, "a restaurant chosen for dinner");
    stays(plan(six((at) => (at === index ? { day: 1 } : {}))), name, "a place put on day 1");
    const booked = plan(six((at) => (at === index ? { day: 1, reserve: { day: 1, time: "14:00" } } : {})));
    stays(booked, name, "a place with a time");
    assert.equal(booked.days[0].stops.find((stop) => stop.place.name === name)!.arrive, "14:00");
    assert.equal(booked.days[0].runsLate, false);
  }
  const shop = six();
  shop[5] = { ...shop[5], id: "hotpepper-J000000001" };
  stays(plan(shop), "場所6", "a shop from the shop guide");
  // Put on a day one by one, each place comes back; with all of them put there nothing is left out, and the day says it runs late.
  const all = plan(six(() => ({ day: 1 })));
  assert.deepEqual([all.leftOut, all.days[0].stops.length, all.days[0].runsLate], [[], 6, true]);
  assert.equal(all.notices.some((notice) => notice.kind === "left-out" || notice.kind === "packed-anyway"), false);
});

test("a place that is more than a day on its own is not left out for it: it keeps its day, which says it runs late, and what was beside it is left out", () => {
  const long = spot("十時間の場所", 35.0, 135.76, 600);
  const alone = plan([long]);
  assert.deepEqual([alone.leftOut, alone.days[0].stops.length, alone.days[0].runsLate], [[], 1, true]);
  const beside = plan([spot("となり", 35.002, 135.76, 60), long]);
  assert.deepEqual(beside.leftOut, ["となり"]);
  assert.deepEqual([namesOn(beside), beside.days[0].runsLate], [["十時間の場所"], true]);
  // With a second day both are planned.
  assert.deepEqual(plan([spot("となり", 35.002, 135.76, 60), long], 2).leftOut, []);
});

test("a list that no week holds says so instead of naming a number of days", () => {
  const shown = plan(Array.from({ length: 24 }, (_, index) => spot(`大きな場所${index + 1}`, 35.0 + (index % 6) * 0.004, 135.76 + Math.floor(index / 6) * 0.004, 240)), 7);
  assert.ok(shown.leftOut.length >= 3);
  assert.equal(shown.days.some((day) => day.runsLate), false);
  assert.deepEqual(shown.notices.filter((notice) => notice.kind === "left-out").map((notice) => (notice.kind === "left-out" ? notice.days : 0)), [null]);
});

test("with a time entered the same holds: the booked place stays, the entered times are kept, and what the days cannot hold by evening is left out and named", () => {
  const tokyo = cities.find((city) => city.id === "tokyo")!;
  const places = tokyo.sights.slice(0, 7).map((sight) => placeByKind(sight, "ja"));
  const bookedId = places[1].id;
  const input = { places: places.map((place) => (place.id === bookedId ? { ...place, day: 1, reserve: { day: 1, time: "15:00" } } : place)), days: 2, hotel: null, firstDayStart: "10:00" };
  const { shown, packed } = both(input, "tokyo");
  for (const trip of [shown, packed]) {
    const stop = trip.days.flatMap((day) => day.stops).find((entry) => entry.place.id === bookedId)!;
    assert.deepEqual([stop.arrive, stop.reserved], ["15:00", true]);
    assert.ok(clock(trip.days[0].stops[0].arrive, false) >= 10 * 60);
    assert.deepEqual([...namesOn(trip), ...trip.leftOut].sort(), places.map((place) => place.name).sort());
  }
  assert.ok(shown.overfull.length > 0 && shown.days.every((day) => !day.runsLate), `${shown.leftOut.join(", ")} / ${latest(shown)}`);
  assert.deepEqual(shown.notices.filter((notice) => notice.kind === "left-out").map((notice) => (notice.kind === "left-out" ? notice.places : [])), [shown.overfull]);
  assert.deepEqual(packed.overfull, []);
  assert.ok(packed.days.some((day) => day.runsLate));
  assert.ok(packed.notices.some((notice) => notice.kind === "packed-anyway"));
});

test("a street path measured later corrects a clock and never throws a place out of the booklet on screen, or brings one back", () => {
  const { scenario, plan: first } = auditPlan("hakone-1");
  const input = { places: scenarioPlaces(scenario), days: scenario.days, hotel: scenario.hotel, locale: "ja" as const };
  const legs = first.days.flatMap((day) => day.legs).filter((leg) => leg.mode !== "rail");
  assert.ok(legs.length > 0);
  for (const factor of [0.3, 4]) {
    const routes = new Map<string, ShioriRoute>();
    for (const leg of legs) for (const how of ["walk", "drive"]) routes.set(`${how}|${leg.key}`, { minutes: Math.round(leg.minutes * factor), path: [leg.from, leg.to] });
    const measured = buildShioriPlan(input, { rail: railOf("hakone"), cities, routes });
    assert.deepEqual(measured.leftOut, first.leftOut, `legs × ${factor}`);
    assert.deepEqual(measured.days.map((day) => day.stops.map((stop) => stop.place.name)), first.days.map((day) => day.stops.map((stop) => stop.place.name)));
  }
});

test("a list too full for its day is planned in the time any list is, and planning it again when a street path arrives costs next to nothing", () => {
  // Was 1.3 s, and a quarter of a second again for every street path that arrived: ten Kyoto sights for one day.
  const kyoto = cities.find((entry) => entry.id === "kyoto")!;
  const places = kyoto.sights.slice(0, 10).map((sight) => placeByKind(sight, "ja"));
  const options = { rail: railOf("kyoto"), cities };
  const routes = new Map<string, ShioriRoute | null>();
  const timed = () => {
    const started = performance.now();
    const plan = buildShioriPlan({ places, days: 1, hotel: null, locale: "ja" }, { ...options, routes: new Map(routes) });
    return { plan, ms: performance.now() - started };
  };
  const first = timed();
  assert.equal(first.plan.leftOut.length, 5);
  assert.ok(first.ms <= 700, `first plan: ${Math.round(first.ms)} ms`);
  const leg = first.plan.days[0].legs.find((entry) => entry.mode !== "rail")!;
  routes.set(`walk|${leg.key}`, { minutes: leg.minutes, path: [leg.from, leg.to] });
  const again = timed();
  assert.deepEqual(again.plan.leftOut, first.plan.leftOut);
  assert.ok(again.ms <= 120, `planned again: ${Math.round(again.ms)} ms`);
});

test("what is left out of the days is on no day's map, in no day's print and not in the outline the meal advisor is sent", () => {
  const shown = auditPlan("tokyo-2").plan;
  assert.deepEqual(shown.leftOut, ["東京ディズニーランド"]);
  // The map and the print are drawn from the days alone …
  const source = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  assert.match(source, /<ShioriMap\s+days=\{plan\.days\}/);
  for (const day of shown.days) {
    assert.equal(day.stops.some((stop) => /ディズニー/.test(stop.place.name)), false);
    for (const leg of [day.fromHotel, ...day.legs, day.toHotel]) if (leg) assert.equal(/ディズニー/.test(`${leg.fromName}${leg.toName}`), false);
    assert.equal(day.meals.some((meal) => /ディズニー/.test(meal.nearName)), false);
    assert.equal(/ディズニー/.test(day.title), false);
  }
  // … the area to stay is judged on the places that are planned …
  assert.notEqual(shown.stayNear?.nearName, "東京ディズニーランド");
  // … and the advisor's outline walks the days.
  const brief = buildMealBrief({ plan: shown, sights: mealSights(cities), city: "東京", prefs: EMPTY_MEAL_PREFS })!;
  assert.ok(brief);
  assert.equal(JSON.stringify(brief).includes("ディズニー"), false);
  assert.equal(brief.days.reduce((sum, day) => sum + day.stops.length, 0), 7);
});

/* ------------------------------------------------ the choice, kept with the trip */

const tripOf = (more: Partial<ShioriTrip> = {}): ShioriTrip => ({ ...emptyTrip, cityId: "tokyo", cityName: "東京", places: six(), days: 1, ...more });
const wireOf = (encoded: string) => JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;

test("'everything in anyway' is kept in the saved trip and in a shared link; a trip without it — every older one — is planned as the set that fits", () => {
  const plain = tripOf();
  const chosen = withPackAnyway(plain, true);
  assert.equal(chosen.packAnyway, true);
  // Written only when chosen: every other trip encodes exactly as it always did.
  assert.equal("a" in wireOf(encodeTrip(plain)), false);
  assert.equal(wireOf(encodeTrip(chosen)).a, 1);
  assert.deepEqual({ ...wireOf(encodeTrip(chosen)), a: undefined }, { ...wireOf(encodeTrip(plain)), a: undefined });
  // It comes back from a link, and an old link opens as it did, without it.
  assert.equal(decodeTrip(encodeTrip(chosen))?.packAnyway, true);
  const old = decodeTrip(encodeTrip(plain))!;
  assert.equal("packAnyway" in old, false);
  assert.deepEqual(old, plain);
  // Taken back, it is gone from the trip and from its link.
  const back = withPackAnyway(chosen, false);
  assert.equal("packAnyway" in back, false);
  assert.equal(encodeTrip(back), encodeTrip(plain));
  assert.deepEqual(withPackAnyway(plain, false), plain);
  // Anything but the mark that is written is not the choice: the trip opens with the default.
  for (const mark of [0, 2, true, "1", null, [1]]) {
    const edited = Buffer.from(JSON.stringify({ ...wireOf(encodeTrip(plain)), a: mark }), "utf8").toString("base64url");
    const opened = decodeTrip(edited);
    assert.ok(opened, `a: ${JSON.stringify(mark)} still opens`);
    assert.equal("packAnyway" in opened, false, `a: ${JSON.stringify(mark)}`);
  }
  // A new destination is a new trip: the choice does not follow it there.
  assert.equal("packAnyway" in withCity(chosen, cities.find((city) => city.id === "kyoto")!, "ja"), false);
  // And the plan made from the trip follows it.
  const planOf = (trip: ShioriTrip) => buildShioriPlan({ places: trip.places, days: trip.days, hotel: trip.hotel, locale: "ja", packAnyway: trip.packAnyway === true }, { cities: [] });
  assert.ok(planOf(decodeTrip(encodeTrip(plain))!).leftOut.length > 0);
  const everything = planOf(decodeTrip(encodeTrip(chosen))!);
  assert.deepEqual([everything.leftOut, everything.days[0].stops.length, everything.days[0].runsLate], [[], 6, true]);
});

test("the page says which places did not fit and how many days hold them, in both languages, with one button for the days and one to put everything in — and nothing about when a place opens", () => {
  const source = readFileSync(new URL("../app/shiori/ShioriApp.tsx", import.meta.url), "utf8");
  for (const key of ["noticeLeftOut", "noticePackAnyway", "noticePackedAnyway", "noticePackedAnywayAction", "leftOutRoom"]) {
    const lines = source.split("\n").filter((line) => line.startsWith(`    ${key}: `));
    assert.equal(lines.length, 2, `${key} in Japanese and in English`);
    // A habit of the planner is never worded as the hours of a place.
    for (const line of lines) assert.equal(/営業|開館|閉館|閉園|開園|閉ま|\bopens?\b|\bcloses?\b|\bclosed\b|opening hours/i.test(line), false, line);
  }
  // The trip state is what the buttons change, and the plan is made from it.
  assert.match(source, /withPackAnyway\(current, true\)/);
  assert.match(source, /withPackAnyway\(current, false\)/);
  assert.match(source, /packAnyway: trip\.packAnyway === true/);
  // The places are named in the notice, and the days offered are the days the plan found.
  assert.match(source, /t\.noticeLeftOut\(notice\.places\.map\(\(place\) => place\.name\), trip\.days, days\)/);
  // Nothing is deleted from the trip by either button.
  const view = source.slice(source.indexOf('case "left-out":'), source.indexOf('case "hotel-far":'));
  assert.equal(/places: current\.places\.filter/.test(view), false);
});
