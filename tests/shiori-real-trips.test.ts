import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { buildShioriPlan, habitOf, shioriPricing, type ShioriInput, type ShioriPlace, type ShioriPlan, type ShioriRoute } from "../lib/shiori/plan.ts";
import { placeByKind } from "./helpers/kind-stays.ts";

/*
 * The booklet on real cities with their real station maps. These are the
 * trips a reviewer broke it with; each asserts the thing a traveller would
 * have seen go wrong.
 */

const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
const networks = new Map<string, RailNetwork>();
function trip(cityId: string, count: number, days: number, extra: Partial<ShioriInput> & { more?: ShioriPlace[]; raw?: boolean } = {}) {
  const city = cities.find((entry) => entry.id === cityId)!;
  if (!networks.has(cityId)) networks.set(cityId, new RailNetwork(JSON.parse(readFileSync(new URL(`../public/rail/${cityId}.json`, import.meta.url), "utf8"))));
  // `raw` keeps the uncurated ranking the reviewer used.
  const sights = (extra.raw ? city.sights : curateSights(city.sights)).slice(0, count).map((sight) => placeByKind(sight, "ja"));
  return buildShioriPlan({ places: [...sights, ...(extra.more ?? [])], days, hotel: extra.hotel ?? null, locale: "ja", packAnyway: extra.packAnyway }, { rail: networks.get(cityId)!, cities });
}
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
/** No stop of any day starts before the one ahead of it: nothing wraps past midnight. */
function assertNoDayPastMidnight(plan: ShioriPlan) {
  for (const day of plan.days) {
    for (let index = 0; index < day.stops.length; index += 1) {
      const stop = day.stops[index];
      assert.ok(minutes(stop.leave) >= minutes(stop.arrive), `day ${day.index + 1}: ${stop.place.name} ${stop.arrive}–${stop.leave}`);
      if (index > 0) assert.ok(minutes(stop.arrive) >= minutes(day.stops[index - 1].leave), `day ${day.index + 1}: ${stop.place.name} at ${stop.arrive}`);
    }
  }
}

test("a theme-park day is not filled up with the other day's sights", () => {
  // Was: USJ until 17:00, then five more sights until 01:45, and one shrine on day 2.
  const osaka = trip("osaka", 7, 2, { raw: true });
  assertNoDayPastMidnight(osaka);
  // Seven sights with USJ do not fit two days. What is printed is two days
  // a little over — never one day into the night — and it says three fit.
  for (const day of osaka.days) assert.ok(minutes(day.stops.at(-1)!.leave) <= 19 * 60, `day ${day.index + 1} ends ${day.stops.at(-1)!.leave}`);
  assert.ok(osaka.notices.some((notice) => notice.kind === "needs-days" && notice.days === 3));
  const three = trip("osaka", 7, 3, { raw: true });
  assert.equal(three.days.some((day) => day.runsLate), false);
  assert.equal(three.days.find((day) => day.stops.some((stop) => /ユニバーサル/.test(stop.place.name)))!.stops.length, 1);
  // Seven sights with Disneyland do not fit two days, and a day would run
  // more than an hour over: Disneyland, which needs a day to itself, is left
  // out and named with the three days that hold everything.
  const tokyo = trip("tokyo", 7, 2, { raw: true });
  assertNoDayPastMidnight(tokyo);
  assert.equal(tokyo.days.some((day) => day.runsLate), false);
  assert.deepEqual(tokyo.leftOut, ["東京ディズニーランド"]);
  assert.ok(tokyo.notices.some((notice) => notice.kind === "left-out" && notice.days === 3 && notice.places.length === 1));
  // Planned anyway, what is printed is two days over, never one day into the night — and it says so.
  const packed = trip("tokyo", 7, 2, { raw: true, packAnyway: true });
  assertNoDayPastMidnight(packed);
  assert.deepEqual(packed.leftOut, []);
  for (const day of packed.days) assert.ok(minutes(day.stops.at(-1)!.leave) <= 20 * 60, `day ${day.index + 1} ends ${day.stops.at(-1)!.leave}`);
  assert.ok(packed.notices.some((notice) => notice.kind === "needs-days"));
});

test("with a hotel, a full list still gives days that end on the day they began: planned anyway with nothing left out, and by default with what does not fit named", () => {
  const hotel = { name: "新宿のホテル", lat: 35.6909, lon: 139.7003 };
  const packed = trip("tokyo", 8, 2, { raw: true, hotel, packAnyway: true });
  assertNoDayPastMidnight(packed);
  assert.equal(packed.leftOut.length, 0);
  const plan = trip("tokyo", 8, 2, { raw: true, hotel });
  assertNoDayPastMidnight(plan);
  assert.equal(plan.days.some((day) => day.runsLate), false);
  assert.deepEqual(plan.leftOut, ["東京ディズニーランド"]);
  assert.equal(plan.days.reduce((sum, day) => sum + day.stops.length, 0), 7);
});

test("the way out of and back to the hotel is a train with its stations, like any other leg", () => {
  const plan = trip("tokyo", 6, 2, { hotel: { name: "新宿のホテル", lat: 35.6909, lon: 139.7003 } });
  const hotelLegs = plan.days.flatMap((day) => [day.fromHotel, day.toHotel]).filter((leg) => leg !== null);
  assert.ok(hotelLegs.length >= 2);
  const byTrain = hotelLegs.filter((leg) => leg.rail);
  assert.ok(byTrain.length >= hotelLegs.length - 1, hotelLegs.map((leg) => `${leg.mode} ${leg.minutes}`).join(", "));
  assert.ok(byTrain.some((leg) => leg.rail!.walkToStation.includes("新宿") || leg.rail!.walkFromStation.includes("新宿")));
});

test("a chosen dinner does not turn two easy days into one eleven-hour day", () => {
  const names = ["浅草寺", "東京スカイツリー", "東京国立博物館", "明治神宮", "東京タワー"];
  const city = cities.find((entry) => entry.id === "tokyo")!;
  const sights = names.map((name) => placeByKind(city.sights.find((sight) => sight.ja === name)!, "ja"));
  const dinner: ShioriPlace = { id: "r-shibuya", name: "渋谷の店", lat: 35.6595, lon: 139.7005, stayMinutes: 90, kind: "restaurant", meal: "dinner" };
  const rail = networks.get("tokyo") ?? new RailNetwork(JSON.parse(readFileSync(new URL("../public/rail/tokyo.json", import.meta.url), "utf8")));
  const plan = buildShioriPlan({ places: [...sights, dinner], days: 2, hotel: null, locale: "ja" }, { rail, cities });
  assert.equal(plan.days.length, 2, "five sights and a dinner are two days, as the five sights alone are");
  assert.equal(plan.freeDays, 0);
  const evening = plan.days.find((day) => day.stops.some((stop) => stop.place.id === dinner.id))!;
  // Sightseeing on the dinner's day is over by 18:00; only the dinner is later.
  const lastSight = evening.stops.filter((stop) => !stop.place.meal).at(-1)!;
  assert.ok(minutes(lastSight.leave) <= 18 * 60, lastSight.leave);
  // And the neighbourhoods hold together: Senso-ji with the Skytree.
  const asakusa = plan.days.find((day) => day.stops.some((stop) => stop.place.name === "浅草寺"))!;
  assert.ok(asakusa.stops.some((stop) => stop.place.name === "東京スカイツリー"));
});

test("a place pinned to day 3 is printed as day 3, with the free days before it", () => {
  const city = cities.find((entry) => entry.id === "kyoto")!;
  const pick = (name: string) => placeByKind(city.sights.find((sight) => sight.ja === name)!, "ja");
  const plan = buildShioriPlan({ places: [pick("清水寺"), { ...pick("金閣寺"), day: 3 }], days: 3, hotel: null, locale: "ja" }, { cities });
  const pinned = plan.days.find((day) => day.stops.some((stop) => stop.place.name === "金閣寺"))!;
  assert.equal(pinned.index, 2);
  // The pin fixes the day, not how many are used: two temples are one day, and both days before it are free.
  assert.equal(plan.days.length, 1);
  assert.equal(plan.freeDays, 2);
});

test("an overfull day that is planned anyway keeps honest stays and says it is late, even past midnight", () => {
  const plan = trip("tokyo", 6, 1, { raw: true, packAnyway: true });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].runsLate, true);
  for (const stop of plan.days[0].stops) assert.ok(stop.stayMinutes >= 15, `${stop.place.name} stays ${stop.stayMinutes}`);
  assert.ok(plan.notices.some((notice) => notice.kind === "needs-days" || notice.kind === "drop" || notice.kind === "too-much"));
});

test("the suggested hotel area is where this plan travels least, and a far hotel is told so", () => {
  const free = trip("tokyo", 6, 2);
  assert.ok(free.stayNear);
  const city = cities.find((entry) => entry.id === "tokyo")!;
  const places = curateSights(city.sights).slice(0, 6).map((sight) => placeByKind(sight, "ja"));
  const rail = networks.get("tokyo")!;
  const travel = (plan: ShioriPlan) => plan.days.reduce((sum, day) => sum + day.travelMinutes, 0);
  const at = (lat: number, lon: number) => buildShioriPlan({ places, days: 2, hotel: { name: "h", lat, lon }, locale: "ja" }, { rail, cities });
  const suggested = at(free.stayNear.latitude, free.stayNear.longitude);
  // No listed place is a better base than the suggestion by more than a few minutes.
  for (const place of places) assert.ok(travel(suggested) <= travel(at(place.lat, place.lon)) + 15, `${place.name}: ${travel(at(place.lat, place.lon))} < ${travel(suggested)}`);
  assert.equal(suggested.notices.some((notice) => notice.kind === "hotel-far"), false);
  // Hachioji, 35 km out, is.
  const far = at(35.6556, 139.3389);
  assert.ok(far.notices.some((notice) => notice.kind === "hotel-far"));
});

test("adding the suggested hotel does not make a trip that fits run late", () => {
  const free = trip("tokyo", 9, 3);
  assert.equal(free.days.some((day) => day.runsLate), false);
  const withHotel = trip("tokyo", 9, 3, { hotel: { name: "おすすめ", lat: free.stayNear!.latitude, lon: free.stayNear!.longitude } });
  assert.equal(withHotel.days.some((day) => day.runsLate), false, withHotel.days.map((day) => `${day.start}-${day.end}`).join(" "));
  assert.equal(withHotel.leftOut.length, 0);
});

/*
 * The checks below do not trust the planner's own search. They take the
 * minutes it priced every pair at, try every order (and every split into
 * days) with a clock written out here, and compare.
 */

type Checked = { input: ShioriInput; plan: ShioriPlan; minutes: number[][]; out: number[] | null; back: number[] | null };
function planned(cityId: string, places: ShioriPlace[], days: number, hotel: ShioriInput["hotel"] = null): Checked {
  if (!networks.has(cityId)) networks.set(cityId, new RailNetwork(JSON.parse(readFileSync(new URL(`../public/rail/${cityId}.json`, import.meta.url), "utf8"))));
  const input: ShioriInput = { places, days, hotel, locale: "ja" };
  const rail = networks.get(cityId)!;
  const prices = shioriPricing(input, { rail });
  return { input, plan: buildShioriPlan(input, { rail, cities }), minutes: prices.minutes, out: prices.fromHotel, back: prices.toHotel };
}
const sightsOf = (cityId: string, names: string[]) => {
  const city = cities.find((entry) => entry.id === cityId)!;
  return names.map((name) => placeByKind(city.sights.find((sight) => sight.ja === name)!, "ja"));
};
const topOf = (cityId: string, count: number) => curateSights(cities.find((entry) => entry.id === cityId)!.sights).slice(0, count).map((sight) => placeByKind(sight, "ja"));

/** Travel of one order, hotel legs included. */
function travelOf(order: number[], trip: Checked) {
  let total = trip.out && trip.back ? trip.out[order[0]] + trip.back[order.at(-1)!] : 0;
  for (let index = 0; index + 1 < order.length; index += 1) total += trip.minutes[order[index]][order[index + 1]];
  return total;
}

/** The clock of a day in this order, or null when a chosen dinner is not last or a stay that fills the day does not open it. The booklet's rules, written out once more. */
function clockOf(order: number[], trip: Checked) {
  const places = trip.input.places;
  const run = (lunchAt: number) => {
    let cursor = trip.out ? 8 * 60 + 30 + trip.out[order[0]] + 10 : 9 * 60;
    let seated = true;
    const arrive: number[] = [];
    const leave = order.map((stop, position) => {
      const place = places[stop];
      if (place.meal) {
        const [open, lastSeat] = place.meal === "lunch" ? [11 * 60 + 30, 14 * 60] : [17 * 60 + 30, 20 * 60];
        if (Math.max(cursor, open) > lastSeat) seated = false;
        else cursor = Math.max(cursor, open);
      }
      arrive.push(cursor);
      cursor += place.stayMinutes + (position === lunchAt ? 60 : 0);
      const end = cursor;
      if (position < order.length - 1) cursor += trip.minutes[stop][order[position + 1]] + 10;
      return end;
    });
    return { arrive, leave, seated };
  };
  // A chosen dinner is last; a stay that fills the day opens it.
  const rank = (stop: number) => (places[stop].meal === "dinner" ? 2 : !places[stop].meal && places[stop].stayMinutes >= 300 ? 0 : 1);
  if (order.some((stop, position) => position > 0 && rank(stop) < rank(order[position - 1]))) return null;
  const before = run(-1);
  // Lunch is an hour after the stop that ends nearest 12:30 (11:00–14:30), unless a restaurant is the lunch.
  let lunchAt = -1;
  if (!order.some((stop) => places[stop].meal === "lunch") && !(order.length < 2 && before.leave[0] > 15 * 60)) {
    order.forEach((stop, position) => {
      const end = before.leave[position];
      if (places[stop].meal || end < 11 * 60 || end > 14 * 60 + 30) return;
      if (lunchAt < 0 || Math.abs(end - 750) < Math.abs(before.leave[lunchAt] - 750)) lunchAt = position;
    });
  }
  return lunchAt >= 0 ? run(lunchAt) : before;
}

/** Can a traveller keep this day in this order? */
function keepable(order: number[], trip: Checked) {
  const clock = clockOf(order, trip);
  if (!clock) return false;
  const lastSight = order.findLastIndex((stop) => trip.input.places[stop].meal !== "dinner");
  return clock.seated && (lastSight < 0 || clock.leave[lastSight] <= 18 * 60) && (lastSight === order.length - 1 || clock.leave.at(-1)! <= 21 * 60 + 30);
}

/**
 * What the hours of a day cost in this order, in minutes — the planner's
 * habits about kinds of places (HABITS in day-search.ts), written out once
 * more: a temple, a garden or a museum that ends after 17:00 costs ten and
 * half of every minute past it, thirty at most (a place of the first half of
 * the day — a palace, a large zoo, by its sight note — the same from 16:00);
 * a museum, a zoo or a castle reached before 09:30 as the first stop of a day
 * that has a shrine, a park, a street or a place of the first half of the day
 * to start with costs fifteen.
 */
function hoursCost(order: number[], trip: Checked) {
  const clock = clockOf(order, trip);
  if (!clock) return Infinity;
  const habits = order.map((stop) => habitOf(trip.input.places[stop]));
  let cost = 0;
  habits.forEach((habit, position) => {
    const daytime = habit === "ticketed" || habit === "daytime" || habit === "daytime-open";
    // (A fish market or a morning market: the same, counted from 13:00; a palace or a large zoo, from 16:00.)
    if (habit === "morning") { if (clock.leave[position] > 13 * 60) cost += Math.min(30, 10 + (clock.leave[position] - 13 * 60) / 2); }
    else if (habit === "early") { if (clock.leave[position] > 16 * 60) cost += Math.min(30, 10 + (clock.leave[position] - 16 * 60) / 2); }
    else if (daytime && clock.leave[position] > 17 * 60) cost += Math.min(30, 10 + (clock.leave[position] - 17 * 60) / 2);
  });
  if (habits[0] === "ticketed" && clock.arrive[0] < 9 * 60 + 30 && habits.slice(1).some((habit) => habit === "open" || habit === "daytime-open" || habit === "early" || habit === "morning")) cost += 15;
  return cost;
}

/** The least of travel and what the hours cost together, of any keepable order of these places. */
function leastWithHours(stops: number[], trip: Checked) {
  let least = Infinity;
  const order: number[] = [];
  const visit = () => {
    if (order.length === stops.length) {
      if (keepable(order, trip)) least = Math.min(least, travelOf(order, trip) + hoursCost(order, trip));
      return;
    }
    for (const stop of stops) {
      if (order.includes(stop)) continue;
      order.push(stop);
      visit();
      order.pop();
    }
  };
  visit();
  return least;
}

/** The least travel of any keepable order of these places, or Infinity when none is. */
function leastTravel(stops: number[], trip: Checked) {
  let least = Infinity;
  const order: number[] = [];
  const visit = () => {
    if (order.length === stops.length) {
      if (keepable(order, trip)) least = Math.min(least, travelOf(order, trip));
      return;
    }
    for (const stop of stops) {
      if (order.includes(stop)) continue;
      order.push(stop);
      visit();
      order.pop();
    }
  };
  visit();
  return least;
}

/** The least total travel of any split of the whole list into exactly `days` keepable days. */
function leastTravelOverSplits(trip: Checked, days: number) {
  const count = trip.input.places.length;
  const dayOf = new Map<number, number>();
  const best = (mask: number) => {
    if (!dayOf.has(mask)) dayOf.set(mask, leastTravel(trip.input.places.flatMap((_, index) => (mask & (1 << index) ? [index] : [])), trip));
    return dayOf.get(mask)!;
  };
  let least = Infinity;
  const groups: number[] = [];
  const place = (stop: number) => {
    if (stop === count) {
      if (groups.length !== days) return;
      const sum = groups.reduce((value, mask) => value + best(mask), 0);
      if (sum < least) least = sum;
      return;
    }
    for (let index = 0; index < groups.length; index += 1) {
      groups[index] |= 1 << stop;
      // Stays alone beyond the nine hours of a day are never keepable: not worth trying their orders.
      if (trip.input.places.reduce((sum, entry, position) => sum + (groups[index] & (1 << position) && entry.meal !== "dinner" ? entry.stayMinutes : 0), 0) <= 540) place(stop + 1);
      groups[index] ^= 1 << stop;
    }
    if (groups.length < days) {
      groups.push(1 << stop);
      place(stop + 1);
      groups.pop();
    }
  };
  place(0);
  return least;
}

const indexOf = (trip: Checked, day: ShioriPlan["days"][number]) => day.stops.map((stop) => trip.input.places.findIndex((place) => place.id === stop.place.id));
const totalTravel = (plan: ShioriPlan) => plan.days.reduce((sum, day) => sum + day.travelMinutes, 0);
const dayWith = (plan: ShioriPlan, name: string) => plan.days.find((day) => day.stops.some((stop) => stop.place.name === name))!;
const namesOn = (day: ShioriPlan["days"][number]) => day.stops.map((stop) => stop.place.name);
const KYOTO_EIGHT = ["清水寺", "金閣寺", "伏見稲荷大社", "銀閣寺", "龍安寺", "二条城", "八坂神社", "平安神宮"];
const kyotoStation = { name: "京都駅", lat: 34.9858, lon: 135.7588 };

test("within every day the order is the one with the least priced travel — or, where the hours of the day are better another way round, the one that costs least with those hours counted", () => {
  // Was: the order followed straight lines, up to a quarter of an hour a day worse than the best.
  // (Then: least travel and nothing else, which put a museum first at 08:45 beside a shrine and a temple
  // last after five beside a tower. Now a few minutes of travel are spent on the hours of the day, and only
  // as many as those hours are worth: see HABITS in day-search.ts.)
  const trips: Checked[] = [
    planned("osaka", sightsOf("osaka", ["大阪城", "四天王寺", "通天閣", "あべのハルカス"]), 1),
    planned("tokyo", topOf("tokyo", 10), 3),
    planned("tokyo", topOf("tokyo", 9), 3, { name: "上野", lat: 35.7138, lon: 139.7773 }),
    planned("kyoto", sightsOf("kyoto", KYOTO_EIGHT), 2, kyotoStation),
    planned("fukuoka", topOf("fukuoka", 12), 4),
    planned("seoul", topOf("seoul", 10), 3, { name: "明洞", lat: 37.5636, lon: 126.9827 }),
    planned("paris", topOf("paris", 6), 2),
    // A restaurant for lunch (reached while it serves) and one for dinner (last on its day).
    planned("tokyo", [...topOf("tokyo", 7), { id: "r-ginza", name: "銀座の店", lat: 35.6717, lon: 139.765, stayMinutes: 60, kind: "restaurant", meal: "lunch" }], 3, { name: "新宿", lat: 35.6909, lon: 139.7003 }),
    planned("paris", [...topOf("paris", 7), { id: "r-marais", name: "マレの店", lat: 48.8575, lon: 2.3622, stayMinutes: 90, kind: "restaurant", meal: "dinner" }], 2, { name: "オペラ", lat: 48.8706, lon: 2.3319 }),
  ];
  let reordered = 0;
  for (const trip of trips) {
    assert.equal(trip.plan.days.some((day) => day.runsLate), false);
    for (const day of trip.plan.days) {
      const order = indexOf(trip, day);
      const label = `${trip.input.places[0].name} …, day ${day.index + 1}: ${namesOn(day).join(" > ")}`;
      // The legs printed are the legs priced.
      day.legs.forEach((leg, position) => assert.equal(leg.minutes, trip.minutes[order[position]][order[position + 1]], label));
      assert.equal(day.travelMinutes, travelOf(order, trip), label);
      assert.equal(keepable(order, trip), true, label);
      // No order of the day costs less, travel and hours together …
      assert.equal(day.travelMinutes + hoursCost(order, trip), leastWithHours(order, trip), label);
      // … so it is never further from the least travel than what the hours of that order would have cost,
      // and a day whose places have nothing to say about their hours has exactly the least travel.
      const least = leastTravel(order, trip);
      assert.ok(day.travelMinutes >= least && day.travelMinutes - least <= 45, `${label}: ${day.travelMinutes} against ${least}`);
      if (order.every((stop) => habitOf(trip.input.places[stop]) === null)) assert.equal(day.travelMinutes, least, label);
      reordered += day.travelMinutes > least ? 1 : 0;
    }
  }
  assert.ok(reordered >= 1, "at least one of these days spends minutes on its hours");
});

test("Kyoto from a hotel: Yasaka Shrine goes with Kiyomizu-dera next door, and no split of the eight travels less", () => {
  // Was: Yasaka Shrine on the Kinkaku-ji day, 35 minutes more travel than the best two days.
  const trip = planned("kyoto", sightsOf("kyoto", KYOTO_EIGHT), 2, kyotoStation);
  const east = dayWith(trip.plan, "清水寺");
  assert.ok(namesOn(east).includes("八坂神社"), namesOn(east).join(" > "));
  assert.equal(namesOn(east).includes("金閣寺"), false);
  assert.ok(namesOn(dayWith(trip.plan, "金閣寺")).includes("龍安寺"));
  assert.equal(totalTravel(trip.plan), leastTravelOverSplits(trip, 2));
  // Asked for three days, it is the same two days and a free one: a third day from the hotel only adds rides.
  const three = planned("kyoto", sightsOf("kyoto", KYOTO_EIGHT), 3, kyotoStation);
  assert.equal(three.plan.days.length, 2);
  assert.equal(three.plan.freeDays, 1);
  assert.equal(totalTravel(three.plan), totalTravel(trip.plan));
  assert.ok(leastTravelOverSplits(three, 3) > totalTravel(three.plan) - 30);
});

test("Fukuoka: the tower stays in the city, Dazaifu is a day of its own, and no split travels less", () => {
  // Was: Fukuoka Tower on the Dazaifu day, 22 minutes more travel than the best two days.
  const two = planned("fukuoka", topOf("fukuoka", 8), 2);
  const dazaifu = dayWith(two.plan, "太宰府天満宮");
  assert.deepEqual([...namesOn(dazaifu)].sort(), ["九州国立博物館", "太宰府天満宮", "水城"].sort());
  assert.ok(namesOn(dayWith(two.plan, "福岡タワー")).includes("福岡城"));
  assert.equal(two.plan.days.length, 2);
  // No split travels less — but for a taxi: the plan goes by train where the
  // taxi would save seven minutes (a taxi counts a quarter of an hour dearer).
  const taxis = (plan: ShioriPlan) => plan.days.flatMap((day) => day.legs).filter((leg) => leg.mode === "taxi").length;
  assert.equal(taxis(two.plan), 0);
  assert.ok(totalTravel(two.plan) <= leastTravelOverSplits(two, 2) + 15, `${totalTravel(two.plan)} against ${leastTravelOverSplits(two, 2)}`);
  // Those two days have five stops on one of them, still sightseeing after
  // 17:00. Asked for three days, the city is two half days: nobody is packed,
  // and the trip travels less.
  const trip = planned("fukuoka", topOf("fukuoka", 8), 3);
  assert.equal(two.plan.days.some((day) => day.load === "tight"), true);
  assert.equal(trip.plan.days.length, 3);
  assert.equal(trip.plan.freeDays, 0);
  assert.equal(trip.plan.days.some((day) => day.load === "tight"), false);
  assert.deepEqual([...namesOn(dayWith(trip.plan, "太宰府天満宮"))].sort(), ["九州国立博物館", "太宰府天満宮", "水城"].sort());
  assert.ok(namesOn(dayWith(trip.plan, "福岡タワー")).includes("福岡城"));
  assert.ok(totalTravel(trip.plan) < totalTravel(two.plan));
  // (A split with a lone short visit on a day would save a quarter of an hour more; that is not a day.)
  assert.equal(trip.plan.days.every((day) => day.stops.length >= 2), true);
  // From a hotel at Hakata the third day would save no travel — so it stays free.
  // (It cost travel while the way out to Dazaifu was priced as a taxi; by train the best three days travel exactly as much as these two.)
  const hakata = planned("fukuoka", topOf("fukuoka", 8), 3, { name: "博多駅", lat: 33.5897, lon: 130.4207 });
  assert.equal(hakata.plan.days.length, 2);
  assert.ok(leastTravelOverSplits(hakata, 3) >= totalTravel(hakata.plan));
});

test("a restaurant for dinner does not pull a sight away from its neighbour", () => {
  // Senso-ji and the Skytree are a walk apart; Meiji Shrine is next to the Shibuya dinner.
  const places = [...sightsOf("tokyo", ["浅草寺", "東京スカイツリー", "東京国立博物館", "明治神宮", "東京タワー"]), { id: "r-shibuya", name: "渋谷の店", lat: 35.6595, lon: 139.7005, stayMinutes: 90, kind: "restaurant", meal: "dinner" as const }];
  const trip = planned("tokyo", places, 2);
  assert.ok(namesOn(dayWith(trip.plan, "浅草寺")).includes("東京スカイツリー"));
  assert.equal(namesOn(dayWith(trip.plan, "渋谷の店")).at(-1), "渋谷の店");
  assert.ok(namesOn(dayWith(trip.plan, "渋谷の店")).includes("明治神宮"));
});

test("only a list that cannot fit its days and is planned anyway runs past midnight, and then every clock after midnight says so", () => {
  const fitting = [
    planned("tokyo", topOf("tokyo", 10), 3),
    planned("tokyo", topOf("tokyo", 12), 4, { name: "新宿", lat: 35.6909, lon: 139.7003 }),
    planned("osaka", topOf("osaka", 8), 3),
    planned("kyoto", sightsOf("kyoto", KYOTO_EIGHT), 2, kyotoStation),
    planned("nara", topOf("nara", 12), 3),
    planned("fukuoka", topOf("fukuoka", 8), 3),
    planned("seoul", topOf("seoul", 12), 4),
    planned("paris", topOf("paris", 12), 4),
  ];
  for (const { plan } of fitting) {
    assert.equal(plan.days.some((day) => day.runsLate), false);
    for (const day of plan.days) {
      assert.equal(day.endsNextDay, false, `${day.title} ends ${day.end}`);
      for (const stop of day.stops) assert.equal(stop.arriveNextDay || stop.leaveNextDay, false, `${stop.place.name} ${stop.arrive}–${stop.leave}`);
    }
  }
  // Six sights with Disneyland in one day cannot be kept. By default the day
  // holds what fits and ends on its own date …
  const fitted = trip("tokyo", 6, 1, { raw: true });
  assert.equal(fitted.days[0].runsLate || fitted.days[0].endsNextDay, false);
  assert.equal(fitted.days[0].stops.some((stop) => stop.arriveNextDay || stop.leaveNextDay), false);
  assert.deepEqual(fitted.leftOut, ["東京国立博物館", "東京ディズニーランド"]);
  // … and when the traveller asks for everything the day is printed
  // anyway, says it is late, and marks what falls on the next calendar day.
  const overfull = trip("tokyo", 6, 1, { raw: true, packAnyway: true });
  const day = overfull.days[0];
  assert.equal(day.runsLate, true);
  assert.equal(day.endsNextDay, true);
  const firstAfterMidnight = day.stops.findIndex((stop) => stop.leaveNextDay);
  assert.ok(firstAfterMidnight >= 0);
  day.stops.forEach((stop, index) => {
    assert.equal(stop.leaveNextDay, index >= firstAfterMidnight, `${stop.place.name} leaves ${stop.leave}`);
    assert.equal(stop.arriveNextDay, index > firstAfterMidnight || (index === firstAfterMidnight && minutes(stop.arrive) < 9 * 60), `${stop.place.name} arrives ${stop.arrive}`);
  });
  assert.ok(overfull.notices.some((notice) => notice.kind === "needs-days" || notice.kind === "drop" || notice.kind === "too-much"));
});

/*
 * The audit of the day search (commit 4b8543d). Each test is the trip an
 * auditor broke the planner with, and asserts what the traveller should
 * have seen.
 */

const railOf = (cityId: string) => new RailNetwork(JSON.parse(readFileSync(new URL(`../public/rail/${cityId}.json`, import.meta.url), "utf8")));
/** A plan on a station map nothing has been looked up on yet. */
const cold = (cityId: string, input: ShioriInput) => buildShioriPlan(input, { rail: railOf(cityId), cities });
const sightsEn = (cityId: string, names: string[]) => {
  const city = cities.find((entry) => entry.id === cityId)!;
  return names.map((name) => placeByKind(city.sights.find((sight) => sight.en === name)!, "en"));
};
const rawOf = (cityId: string, count: number) => cities.find((entry) => entry.id === cityId)!.sights.slice(0, count).map((sight) => placeByKind(sight, "ja"));
const restaurant = (id: string, meal: "lunch" | "dinner", lat: number, lon: number): ShioriPlace => ({ id, name: id, lat, lon, stayMinutes: meal === "lunch" ? 60 : 90, kind: "restaurant", meal });
/** The restaurants the regression auditor placed around a city's sights. */
const auditRestaurants = (cityId: string, count: number, kinds: Array<"lunch" | "dinner">) => {
  const sights = cities.find((entry) => entry.id === cityId)!.sights;
  return Array.from({ length: count }, (_, index) => {
    const near = sights[(index * 7 + 20) % sights.length];
    return restaurant(`rest-${cityId}-${index}`, kinds[index % kinds.length], near.lat + 0.004 * ((index % 3) - 1), near.lon + 0.005 * (((index + 1) % 3) - 1));
  });
};
const taxiLegs = (plan: ShioriPlan) => plan.days.flatMap((day) => [day.fromHotel, ...day.legs, day.toHotel]).filter((leg) => leg?.mode === "taxi").length;
const lastSightLeaves = (day: ShioriPlan["days"][number]) => minutes(day.stops.findLast((stop) => stop.place.meal !== "dinner")!.leave);
const loneShortDays = (plan: ShioriPlan) => plan.days.filter((day) => day.stops.length === 1 && !day.stops[0].place.meal && day.stops[0].place.stayMinutes < 240).length;

/** Every minute of a printed day is on the page: start, ride, ten minutes of slack, wait, stay, lunch. */
function assertHonestClock(plan: ShioriPlan) {
  for (const day of plan.days) {
    day.stops.forEach((stop, index) => {
      const label = `day ${day.index + 1}, ${stop.place.name}: starts ${day.start}, arrives ${stop.arrive}, waits ${stop.waitMinutes}`;
      const lunchBefore = day.meals.some((meal) => meal.kind === "lunch" && meal.afterStop === index - 1);
      const reached = index === 0
        ? minutes(day.start) + (day.fromHotel ? day.fromHotel.minutes + 10 : 0)
        : minutes(day.stops[index - 1].leave) + (lunchBefore ? 60 : 0) + day.legs[index - 1].minutes + 10;
      assert.equal(minutes(stop.arrive), reached + stop.waitMinutes, label);
      // Only a restaurant is waited for, and never at the start of the day: the day starts later instead.
      if (!stop.place.meal || index === 0) assert.equal(stop.waitMinutes, 0, label);
    });
  }
}

const tokyoNamed = (names: string[]) => sightsOf("tokyo", names);
const asakusaLunch = restaurant("浅草のランチ", "lunch", 35.7128, 139.795);

test("a day with a lunch restaurant sees a sight first when that costs no more travel", () => {
  // Was: the day opened at the restaurant at 11:30 — an empty morning — because ten minutes of slack counted as waiting.
  const places = [...tokyoNamed(["浅草寺", "東京スカイツリー"]), asakusaLunch];
  const plan = cold("tokyo", { places, days: 1, hotel: null, locale: "ja" });
  const day = plan.days[0];
  assert.equal(day.start, "09:00");
  assert.equal(day.stops[0].place.meal, undefined, namesOn(day).join(" > "));
  assert.equal(day.stops.at(-1)!.place.id, asakusaLunch.id);
  assert.ok(minutes(day.stops.at(-1)!.arrive) >= 11 * 60 + 30 && minutes(day.end) <= 13 * 60, `${day.stops.at(-1)!.arrive}–${day.end}`);
  assert.equal(totalTravel(plan), 29);
  assertHonestClock(plan);
  // From a hotel in Ueno the same: was 08:30 at the door, a 25-minute ride, and 11:30 at the first stop.
  const fromHotel = cold("tokyo", { places, days: 1, hotel: { name: "上野のホテル", lat: 35.7126, lon: 139.78 }, locale: "ja" });
  assert.equal(fromHotel.days[0].stops[0].place.meal, undefined);
  assertHonestClock(fromHotel);
  // Paris, four sights and a lunch restaurant on two days: was one five-stop day, the other day free.
  const paris = cold("paris", { places: [...topOf("paris", 4), ...auditRestaurants("paris", 1, ["lunch"])], days: 2, hotel: null, locale: "ja" });
  assert.equal(paris.days.length, 2);
  assert.equal(totalTravel(paris), 48);
  assert.equal(paris.days.some((entry) => entry.stops.length > 1 && entry.stops[0].place.meal), false);
  assertHonestClock(paris);
});

test("a day that must open with a restaurant starts when the traveller has to leave, with no wait hidden in it", () => {
  // Was: start 08:30, a 48-minute train, first stop 17:30, no wait shown.
  const asakusa = { name: "浅草のホテル", lat: 35.7118, lon: 139.7966 };
  const dinner = restaurant("渋谷の焼肉", "dinner", 35.6595, 139.7005);
  const evening = cold("tokyo", { places: [dinner], days: 1, hotel: asakusa, locale: "ja" });
  assert.equal(evening.days[0].stops[0].arrive, "17:30");
  assert.equal(minutes(evening.days[0].start), 17 * 60 + 30 - evening.days[0].fromHotel!.minutes - 10);
  assertHonestClock(evening);
  const lunch = cold("tokyo", { places: [restaurant("築地の寿司屋", "lunch", 35.6655, 139.7707), ...tokyoNamed(["東京タワー"])], days: 1, hotel: asakusa, locale: "ja" });
  assertHonestClock(lunch);
  assert.equal(lunch.days[0].stops.some((stop) => stop.mealMissed), false);
  // A museum that takes five hours and a lunch next door: the day does open with the restaurant, at 11:30.
  const museum = { ...tokyoNamed(["東京国立博物館"])[0], stayMinutes: 300 };
  const ueno = restaurant("上野のランチ", "lunch", 35.7107, 139.7745);
  for (const days of [1, 2]) {
    // Was: the museum 09:00–14:00, the restaurant reached at 14:26 and missed, with a notice that no day can reach it.
    const plan = cold("tokyo", { places: [museum, ueno], days, hotel: null, locale: "ja" });
    assert.equal(plan.days.some((day) => day.stops.some((stop) => stop.mealMissed)), false, `${days} day(s)`);
    assert.equal(plan.notices.some((notice) => notice.kind === "meal-time"), false);
    assert.equal(plan.days.some((day) => day.runsLate), false);
    assertHonestClock(plan);
  }
  const withPark = cold("tokyo", { places: [museum, ...tokyoNamed(["上野公園"]), ueno], days: 1, hotel: null, locale: "ja" });
  assert.equal(withPark.days[0].stops.some((stop) => stop.mealMissed) || withPark.days[0].runsLate, false);
  assert.equal(withPark.days[0].stops[0].place.name, "上野公園");
});

test("restaurants on the list keep planning inside its time budget", () => {
  const timed = (cityId: string, input: ShioriInput) => {
    const rail = railOf(cityId);
    const started = performance.now();
    const plan = buildShioriPlan(input, { rail, cities });
    return { plan, ms: performance.now() - started };
  };
  // Was 2.5 s: ten sights, a lunch and a dinner, from a hotel.
  const tokyo = rawOf("tokyo", 13);
  const lunch = restaurant("L", "lunch", tokyo[2].lat + 0.003, tokyo[2].lon + 0.002);
  const dinner = restaurant("D", "dinner", tokyo[5].lat - 0.002, tokyo[5].lon + 0.003);
  const hotel = { name: "H", lat: cities.find((entry) => entry.id === "tokyo")!.lat + 0.01, lon: cities.find((entry) => entry.id === "tokyo")!.lon - 0.01 };
  const ten = timed("tokyo", { places: [...tokyo.slice(0, 8), lunch, dinner], days: 2, hotel, locale: "ja" });
  assert.ok(ten.ms <= 700, `10 places: ${Math.round(ten.ms)} ms`);
  // Was 15–25 s: thirteen sights, a lunch and a dinner on three days, from a hotel.
  const fifteen = timed("tokyo", { places: [...tokyo, lunch, dinner], days: 3, hotel, locale: "ja" });
  assert.ok(fifteen.ms <= 3500, `15 places: ${Math.round(fifteen.ms)} ms`);
  // Was 13 s: thirteen London sights and a lunch restaurant 200 m from the first, five days, King's Cross.
  const london = sightsEn("london", ["London Museum", "London Eye", "British Museum", "Tate Britain", "National Portrait Gallery", "Big Ben", "Hyde Park", "St James's Palace", "Imperial War Museum London", "Petrie Museum of Egyptian Archaeology", "St Paul's Cathedral", "Sherlock Holmes Museum", "Queen's House"]);
  const fourteen = timed("london", { places: [...london, restaurant("Lunch", "lunch", london[0].lat + 0.0018, london[0].lon)], days: 5, hotel: { name: "King's Cross", lat: 51.5308, lon: -0.1238 }, locale: "en" });
  assert.ok(fourteen.ms <= 3500, `14 places: ${Math.round(fourteen.ms)} ms`);
  assert.equal(fourteen.plan.days.some((day) => day.runsLate), false);
  // Was 25–35 s: ten Kyoto sights, three lunches and three dinners on three days.
  const kyoto = timed("kyoto", { places: [...rawOf("kyoto", 10), ...auditRestaurants("kyoto", 6, ["lunch", "dinner"])], days: 3, hotel: kyotoStation, locale: "ja" });
  assert.ok(kyoto.ms <= 3500, `16 places, 6 restaurants: ${Math.round(kyoto.ms)} ms`);
  // And each day has one lunch and one dinner of them.
  for (const day of kyoto.plan.days) {
    assert.equal(day.stops.filter((stop) => stop.place.meal === "lunch").length, 1, namesOn(day).join(" > "));
    assert.equal(day.stops.filter((stop) => stop.place.meal === "dinner").length, 1, namesOn(day).join(" > "));
  }
  assertHonestClock(kyoto.plan);
  // Eight restaurants among twenty-four places.
  const many = timed("paris", { places: [...rawOf("paris", 16), ...auditRestaurants("paris", 8, ["dinner", "lunch", "dinner"])], days: 4, hotel: null, locale: "ja" });
  assert.ok(many.ms <= 3500, `24 places, 8 restaurants: ${Math.round(many.ms)} ms`);
});

test("two restaurants for the same meal are on different days while a requested day can take one", () => {
  // Was: two lunches back to back on one day (11:30 and 13:33), two requested days free.
  const lunches = cold("tokyo", { places: [...tokyoNamed(["浅草寺", "明治神宮"]), asakusaLunch, restaurant("原宿のランチ", "lunch", 35.6702, 139.7027)], days: 3, hotel: null, locale: "ja" });
  for (const day of lunches.days) assert.ok(day.stops.filter((stop) => stop.place.meal === "lunch").length <= 1, namesOn(day).join(" > "));
  assert.equal(lunches.days.length, 2);
  // Was: dinner at 17:30 and a second dinner at 19:30 the same evening.
  const dinners = cold("tokyo", { places: [...tokyoNamed(["浅草寺", "東京タワー"]), restaurant("銀座のディナー", "dinner", 35.6717, 139.765), restaurant("新橋のディナー", "dinner", 35.6664, 139.7583)], days: 3, hotel: null, locale: "ja" });
  for (const day of dinners.days) assert.ok(day.stops.filter((stop) => stop.place.meal === "dinner").length <= 1, namesOn(day).join(" > "));
  // With one day asked for there is nowhere else to put it.
  const oneDay = cold("tokyo", { places: [...tokyoNamed(["浅草寺", "明治神宮"]), asakusaLunch, restaurant("原宿のランチ", "lunch", 35.6702, 139.7027)], days: 1, hotel: null, locale: "ja" });
  assert.equal(oneDay.days.length, 1);
  assert.equal(oneDay.leftOut.length, 0);
});

test("a pin says which day a place is on, never how many days are used", () => {
  // Was: four short sights, one pinned to day 3, became three days — two of them a single 50-minute visit.
  const four = tokyoNamed(["浅草寺", "東京スカイツリー", "上野公園", "東京国立博物館"]);
  const free = cold("tokyo", { places: four, days: 3, hotel: null, locale: "ja" });
  assert.equal(free.days.length, 1);
  for (const [days, pinnedTo] of [[3, 3], [5, 5], [3, 2]]) {
    const plan = cold("tokyo", { places: four.map((place) => (place.name === "東京国立博物館" ? { ...place, day: pinnedTo } : place)), days, hotel: null, locale: "ja" });
    assert.equal(plan.days.length, 1, `pinned to day ${pinnedTo} of ${days}`);
    assert.equal(plan.days[0].index, pinnedTo - 1);
    assert.equal(plan.days[0].stops.length, 4);
    assert.equal(plan.freeDays, days - 1);
    assert.equal(totalTravel(plan), totalTravel(free));
  }
  // Was: Arashiyama pinned to day 5 forced all five days, two of them a single short sight, 33 minutes more travel.
  const kyoto = sightsEn("kyoto", ["Kyoto Tower", "Daitoku-ji Temple", "Tenryū-ji Temple", "Nijō Castle", "Saihō-ji Temple", "Enryaku-ji Temple", "Kyoto Imperial Palace", "Arashiyama", "Sanjūsangen-dō Temple", "Kōzan-ji Temple"]);
  const station = { name: "Kyoto Station", lat: 34.9858, lon: 135.7588 };
  const unpinned = cold("kyoto", { places: kyoto, days: 5, hotel: station, locale: "en" });
  const pinned = cold("kyoto", { places: kyoto.map((place) => (place.name === "Arashiyama" ? { ...place, day: 5 } : place)), days: 5, hotel: station, locale: "en" });
  assert.equal(dayWith(pinned, "Arashiyama").index, 4);
  assert.equal(pinned.days.length, unpinned.days.length);
  assert.equal(totalTravel(pinned), totalTravel(unpinned));
  assert.equal(loneShortDays(pinned), 0);
  assert.equal(loneShortDays(unpinned), 0);
});

test("a far hotel does not spread the list one short sight a day", () => {
  // Was: five Tokyo sights from Yokohama on five days, one sight each, 610 minutes of travel, every day labelled packed.
  const five = tokyoNamed(["浅草寺", "東京スカイツリー", "明治神宮", "東京タワー", "東京国立博物館"]);
  const yokohama = { name: "横浜駅", lat: 35.4658, lon: 139.6223 };
  const two = cold("tokyo", { places: five, days: 2, hotel: yokohama, locale: "ja" });
  for (const days of [3, 5]) {
    const plan = cold("tokyo", { places: five, days, hotel: yokohama, locale: "ja" });
    assert.equal(plan.days.length, 2, `${days} days asked`);
    assert.equal(plan.freeDays, days - 2);
    assert.equal(totalTravel(plan), totalTravel(two));
    assert.equal(loneShortDays(plan), 0);
    // The rides to and from the hotel do not make a day packed.
    assert.equal(plan.days.some((day) => day.load === "tight"), false);
  }
  // A single visit is never a packed day, however far the hotel.
  const one = cold("tokyo", { places: five.slice(0, 1), days: 1, hotel: yokohama, locale: "ja" });
  assert.notEqual(one.days[0].load, "tight");
  // Was: eleven Hiroshima sights and a lunch from Saijo on four days, two of them a single museum with two hours of taxi.
  const hiroshima = sightsEn("hiroshima", ["Hiroshima Museum of Art", "JMSDF Kure Museum", "Hijiyama Shrine", "Assumption of Mary Cathedral, Hiroshima", "Aioi Bridge", "Kokuzen-ji Temple", "Hiroshima Botanical Garden", "Hiroshima City Museum of Contemporary Art", "Daigan-ji Temple", "Hiroshima Peace Memorial Museum", "Hiroshima Peace Memorial"]);
  const saijo = cold("hiroshima", { places: [...hiroshima, restaurant("Lunch near Hiroshima City Museum of Contemporary Art", "lunch", 34.38655102213577, 132.4711518541997)], days: 4, hotel: { name: "Saijo", lat: 34.431, lon: 132.743 }, locale: "en" });
  assert.equal(saijo.days.length, 3);
  assert.equal(saijo.freeDays, 1);
  assert.equal(loneShortDays(saijo), 0);
  assert.equal(saijo.days.some((day) => day.runsLate), false);
});

test("a requested day is used when the days in use are packed and it relieves them cheaply", () => {
  // Was: five Nara sights and a lunch on ONE day of six stops until 17:39, the second requested day free.
  const nara = sightsEn("nara", ["Tōshōdai-ji Temple", "Futai-ji Temple", "Zutō", "Jōruri-ji Temple", "Shōsōin"]);
  const plan = cold("nara", { places: [...nara, restaurant("Lunch near Tōshōdai-ji Temple", "lunch", 34.67538071975103, 135.78584107949158)], days: 2, hotel: { name: "Kintetsu Nara", lat: 34.6841, lon: 135.8278 }, locale: "en" });
  assert.equal(plan.days.length, 2);
  assert.equal(plan.days.some((day) => day.load === "tight"), false);
  for (const day of plan.days) assert.ok(day.stops.length <= 4 && lastSightLeaves(day) <= 17 * 60, `${day.stops.length} stops until ${day.end}`);
  // Was (lists of 17 and more stopped at the first count that was not late): twenty London sights on five of seven days.
  const london = cold("london", { places: rawOf("london", 20), days: 7, hotel: null, locale: "ja" });
  assert.equal(london.days.length, 6);
  for (const day of london.days) assert.ok(lastSightLeaves(day) <= 17 * 60, `day ${day.index + 1} until ${day.end}`);
  assert.ok(totalTravel(london) <= 200, `${totalTravel(london)}`);
  // Eighteen Paris sights from a hotel at Opéra, six days asked: was four days sightseeing until 18:00, two free.
  const paris = cold("paris", { places: [...cities.find((entry) => entry.id === "paris")!.sights].reverse().slice(0, 18).map((sight) => placeByKind(sight, "ja")), days: 6, hotel: { name: "Opéra", lat: 48.8706, lon: 2.3319 }, locale: "ja" });
  assert.equal(paris.days.length, 5);
  for (const day of paris.days) assert.ok(lastSightLeaves(day) <= 17 * 60, `day ${day.index + 1} until ${day.end}`);
});

test("a theme-park day is charged for its length on the real clock, lunch included", () => {
  // Was: Olympic Park taken off the Lotte World day next door, 15 minutes more travel and a second taxi.
  const plan = cold("seoul", { places: rawOf("seoul", 10), days: 3, hotel: null, locale: "ja" });
  assert.ok(namesOn(dayWith(plan, "ロッテワールド")).includes("オリンピック公園"), namesOn(dayWith(plan, "ロッテワールド")).join(" > "));
  // (126 minutes while one of its legs was a taxi of forty minutes; that leg is a train now.)
  assert.equal(totalTravel(plan), 147);
  assert.equal(taxiLegs(plan), 0);
  assert.equal(plan.days.some((day) => day.runsLate), false);
});

test("a list a few minutes over says which one place to leave out", () => {
  // Was: over by minutes on two days, any single removal fits, and no such advice.
  const input: ShioriInput = { places: rawOf("tokyo", 16), days: 4, hotel: { name: "新宿", lat: 35.6909, lon: 139.7003 }, locale: "ja" };
  const rail = railOf("tokyo");
  const started = performance.now();
  const plan = buildShioriPlan(input, { rail, cities });
  assert.ok(performance.now() - started <= 3500);
  assert.equal(plan.days.some((day) => day.runsLate), true);
  const drop = plan.notices.find((notice) => notice.kind === "drop");
  assert.ok(drop && drop.kind === "drop", JSON.stringify(plan.notices.map((notice) => notice.kind)));
  const without = buildShioriPlan({ ...input, places: input.places.filter((place) => place.id !== drop.placeId) }, { rail, cities });
  assert.equal(without.days.some((day) => day.runsLate), false);
  assert.equal(without.leftOut.length, 0);
});

test("a taxi pairing is chosen when it really saves time, not for a few minutes", () => {
  // Was: seventeen Kyoto sights from the station on seven taxi rides (three before the rewrite) to save 37 minutes.
  const plan = cold("kyoto", { places: rawOf("kyoto", 17), days: 5, hotel: kyotoStation, locale: "ja" });
  assert.ok(taxiLegs(plan) <= 3, `${taxiLegs(plan)} taxi rides`);
  assert.equal(plan.days.some((day) => day.runsLate), false);
  // The printed minutes are the priced ones: the surcharge is in the search only.
  const prices = shioriPricing({ places: rawOf("kyoto", 17), days: 5, hotel: kyotoStation, locale: "ja" }, { rail: railOf("kyoto") });
  for (const day of plan.days) {
    const order = day.stops.map((stop) => rawOf("kyoto", 17).findIndex((place) => place.id === stop.place.id));
    day.legs.forEach((leg, position) => assert.equal(leg.minutes, prices.minutes[order[position]][order[position + 1]]));
  }
});

test("the lunch row is at lunchtime, also after the streets have been measured", () => {
  const input: ShioriInput = { places: topOf("tokyo", 10), days: 3, hotel: null, locale: "ja" };
  const rail = railOf("tokyo");
  const before = buildShioriPlan(input, { rail, cities });
  const lunchRows = (plan: ShioriPlan) => plan.days.flatMap((day) => day.meals.filter((meal) => meal.kind === "lunch").map((meal) => minutes(meal.start)));
  for (const start of lunchRows(before)) assert.ok(start >= 11 * 60 + 30 && start <= 14 * 60, `lunch at ${start}`);
  // Was: every walk and drive measured 2.5 times longer left lunch rows at 14:04–15:31, placed on the estimated clock.
  const routes = new Map<string, ShioriRoute>(before.days.flatMap((day) => day.legs.filter((leg) => leg.mode !== "rail").map((leg): [string, ShioriRoute] => [`${leg.mode === "walk" ? "walk" : "drive"}|${leg.key}`, { minutes: Math.round(leg.minutes * 2.5), path: [leg.from, leg.to] }])));
  const after = buildShioriPlan(input, { rail, cities, routes });
  assert.deepEqual(after.days.map((day) => namesOn(day)), before.days.map((day) => namesOn(day)));
  assert.ok(after.days.some((day, index) => day.end !== before.days[index].end), "the measured minutes moved the clock");
  for (const start of lunchRows(after)) assert.ok(start >= 11 * 60 + 30 && start <= 14 * 60, `lunch at ${Math.floor(start / 60)}:${start % 60} after measuring`);
  assertHonestClock(after);
});

test("a renamed hotel or place is printed under its new name, and a slot after midnight says so", () => {
  // Was: the plan remembered for the same coordinates came back with the old names on its legs.
  const rail = railOf("kyoto");
  const places = sightsOf("kyoto", KYOTO_EIGHT);
  const first = buildShioriPlan({ places, days: 2, hotel: kyotoStation, locale: "ja" }, { rail, cities });
  assert.equal(first.days[0].fromHotel!.fromName, "京都駅");
  const renamed = buildShioriPlan({ places: places.map((place, index) => (index === 0 ? { ...place, name: "清水寺（改名）" } : place)), days: 2, hotel: { ...kyotoStation, name: "改名したホテル" }, locale: "ja" }, { rail, cities });
  assert.equal(renamed.days[0].fromHotel!.fromName, "改名したホテル");
  const legs = renamed.days.flatMap((day) => [day.fromHotel, ...day.legs, day.toHotel]).filter((leg) => leg !== null);
  assert.equal(legs.some((leg) => leg.fromName === "清水寺" || leg.toName === "清水寺" || leg.fromName === "京都駅" || leg.toName === "京都駅"), false);
  assert.ok(legs.some((leg) => leg.fromName === "清水寺（改名）" || leg.toName === "清水寺（改名）"));
  // Six sights with Disneyland on one day, planned anyway, run past midnight: the dinner slot after the last stop is on the next calendar day, and says so.
  const overfull = trip("tokyo", 6, 1, { raw: true, packAnyway: true });
  const dinnerSlot = overfull.days[0].meals.find((meal) => meal.kind === "dinner")!;
  assert.equal(overfull.days[0].stops.at(-1)!.leaveNextDay, true);
  assert.equal(dinnerSlot.nextDay, true);
  for (const plan of [first, renamed]) assert.equal(plan.days.some((day) => day.meals.some((meal) => meal.nextDay)), false);
});

test("the suggested area is a listed place whose days are no more packed than from any other, and within five minutes a day of the least door-to-door travel", () => {
  // Was: on lists up to twelve places only the six best by a quick measure were planned, and 12–16 minutes were lost.
  // Then: the least travel alone decided, and a place far out won by putting the list on fewer, fuller days.
  const city = cities.find((entry) => entry.id === "nagoya")!;
  const places = curateSights(city.sights).slice(0, 9).map((sight) => placeByKind(sight, "ja"));
  const rail = railOf("nagoya");
  const free = buildShioriPlan({ places, days: 2, hotel: null, locale: "ja" }, { rail, cities });
  assert.ok(free.stayNear?.nearName);
  const at = (place: { lat: number; lon: number }) => buildShioriPlan({ places, days: 2, hotel: { name: "h", lat: place.lat, lon: place.lon }, locale: "ja" }, { rail, cities });
  const measure = (plan: ShioriPlan) => [plan.days.filter((day) => day.runsLate).length, plan.days.filter((day) => day.load === "tight").length, totalTravel(plan), plan.days.length] as const;
  const suggested = measure(at({ lat: free.stayNear.latitude, lon: free.stayNear.longitude }));
  for (const place of places) {
    const here = measure(at(place));
    const noWorse = suggested[0] < here[0] || (suggested[0] === here[0] && (suggested[1] < here[1] || (suggested[1] === here[1] && suggested[2] <= here[2] + 5 * suggested[3])));
    assert.ok(noWorse, `${place.name}: ${here.join("/")} against ${suggested.join("/")} at ${free.stayNear.nearName}`);
  }
});
