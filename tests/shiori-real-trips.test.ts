import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { buildShioriPlan, shioriPricing, type ShioriInput, type ShioriPlace, type ShioriPlan } from "../lib/shiori/plan.ts";
import { placeFromSight } from "../lib/shiori/state.ts";

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
  const sights = (extra.raw ? city.sights : curateSights(city.sights)).slice(0, count).map((sight) => placeFromSight(sight, "ja"));
  return buildShioriPlan({ places: [...sights, ...(extra.more ?? [])], days, hotel: extra.hotel ?? null, locale: "ja" }, { rail: networks.get(cityId)!, cities });
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
  const tokyo = trip("tokyo", 7, 2, { raw: true });
  assertNoDayPastMidnight(tokyo);
  // Seven sights with Disneyland do not fit two days; what is printed is
  // two days a little over, never one day into the night — and it says so.
  for (const day of tokyo.days) assert.ok(minutes(day.stops.at(-1)!.leave) <= 20 * 60, `day ${day.index + 1} ends ${day.stops.at(-1)!.leave}`);
  assert.ok(tokyo.notices.some((notice) => notice.kind === "needs-days"));
});

test("with a hotel, a full list still gives days that end on the day they began", () => {
  const plan = trip("tokyo", 8, 2, { raw: true, hotel: { name: "新宿のホテル", lat: 35.6909, lon: 139.7003 } });
  assertNoDayPastMidnight(plan);
  assert.equal(plan.leftOut.length, 0);
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
  const sights = names.map((name) => placeFromSight(city.sights.find((sight) => sight.ja === name)!, "ja"));
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

test("a place pinned to day 3 is printed as day 3, with the free day before it", () => {
  const city = cities.find((entry) => entry.id === "kyoto")!;
  const pick = (name: string) => placeFromSight(city.sights.find((sight) => sight.ja === name)!, "ja");
  const plan = buildShioriPlan({ places: [pick("清水寺"), { ...pick("金閣寺"), day: 3 }], days: 3, hotel: null, locale: "ja" }, { cities });
  const pinned = plan.days.find((day) => day.stops.some((stop) => stop.place.name === "金閣寺"))!;
  assert.equal(pinned.index, 2);
  assert.equal(plan.freeDays, 1);
});

test("an overfull day keeps honest stays and says it is late, even past midnight", () => {
  const plan = trip("tokyo", 6, 1, { raw: true });
  assert.equal(plan.days.length, 1);
  assert.equal(plan.days[0].runsLate, true);
  for (const stop of plan.days[0].stops) assert.ok(stop.stayMinutes >= 15, `${stop.place.name} stays ${stop.stayMinutes}`);
  assert.ok(plan.notices.some((notice) => notice.kind === "needs-days" || notice.kind === "drop" || notice.kind === "too-much"));
});

test("the suggested hotel area is where this plan travels least, and a far hotel is told so", () => {
  const free = trip("tokyo", 6, 2);
  assert.ok(free.stayNear);
  const city = cities.find((entry) => entry.id === "tokyo")!;
  const places = curateSights(city.sights).slice(0, 6).map((sight) => placeFromSight(sight, "ja"));
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
  return names.map((name) => placeFromSight(city.sights.find((sight) => sight.ja === name)!, "ja"));
};
const topOf = (cityId: string, count: number) => curateSights(cities.find((entry) => entry.id === cityId)!.sights).slice(0, count).map((sight) => placeFromSight(sight, "ja"));

/** Travel of one order, hotel legs included. */
function travelOf(order: number[], trip: Checked) {
  let total = trip.out && trip.back ? trip.out[order[0]] + trip.back[order.at(-1)!] : 0;
  for (let index = 0; index + 1 < order.length; index += 1) total += trip.minutes[order[index]][order[index + 1]];
  return total;
}

/** Can a traveller keep this day in this order? The booklet's rules, written out once more. */
function keepable(order: number[], trip: Checked) {
  const places = trip.input.places;
  const run = (lunchAt: number) => {
    let cursor = trip.out ? 8 * 60 + 30 + trip.out[order[0]] + 10 : 9 * 60;
    let seated = true;
    const leave = order.map((stop, position) => {
      const place = places[stop];
      if (place.meal) {
        const [open, lastSeat] = place.meal === "lunch" ? [11 * 60 + 30, 14 * 60] : [17 * 60 + 30, 20 * 60];
        if (Math.max(cursor, open) > lastSeat) seated = false;
        else cursor = Math.max(cursor, open);
      }
      cursor += place.stayMinutes + (position === lunchAt ? 60 : 0);
      const end = cursor;
      if (position < order.length - 1) cursor += trip.minutes[stop][order[position + 1]] + 10;
      return end;
    });
    return { leave, seated };
  };
  // A chosen dinner is last; a stay that fills the day opens it.
  const rank = (stop: number) => (places[stop].meal === "dinner" ? 2 : !places[stop].meal && places[stop].stayMinutes >= 300 ? 0 : 1);
  if (order.some((stop, position) => position > 0 && rank(stop) < rank(order[position - 1]))) return false;
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
  const { leave, seated } = lunchAt >= 0 ? run(lunchAt) : before;
  const lastSight = order.findLastIndex((stop) => places[stop].meal !== "dinner");
  return seated && (lastSight < 0 || leave[lastSight] <= 18 * 60) && (lastSight === order.length - 1 || leave.at(-1)! <= 21 * 60 + 30);
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

test("within every day the order is the one with the least priced travel", () => {
  // Was: the order followed straight lines, up to a quarter of an hour a day worse than the best.
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
  for (const trip of trips) {
    assert.equal(trip.plan.days.some((day) => day.runsLate), false);
    for (const day of trip.plan.days) {
      const order = indexOf(trip, day);
      const label = `${trip.input.places[0].name} …, day ${day.index + 1}: ${namesOn(day).join(" > ")}`;
      // The legs printed are the legs priced.
      day.legs.forEach((leg, position) => assert.equal(leg.minutes, trip.minutes[order[position]][order[position + 1]], label));
      assert.equal(day.travelMinutes, travelOf(order, trip), label);
      assert.equal(keepable(order, trip), true, label);
      assert.equal(day.travelMinutes, leastTravel(order, trip), label);
    }
  }
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
  const trip = planned("fukuoka", topOf("fukuoka", 8), 3);
  const dazaifu = dayWith(trip.plan, "太宰府天満宮");
  assert.deepEqual([...namesOn(dazaifu)].sort(), ["九州国立博物館", "太宰府天満宮", "水城"].sort());
  assert.ok(namesOn(dayWith(trip.plan, "福岡タワー")).includes("福岡城"));
  assert.equal(trip.plan.days.length, 2);
  assert.equal(trip.plan.days.some((day) => day.load === "tight"), false);
  assert.equal(totalTravel(trip.plan), leastTravelOverSplits(trip, 2));
  // From a hotel at Hakata the third day would cost travel, not save it — so it stays free.
  const hakata = planned("fukuoka", topOf("fukuoka", 8), 3, { name: "博多駅", lat: 33.5897, lon: 130.4207 });
  assert.equal(hakata.plan.days.length, 2);
  assert.ok(leastTravelOverSplits(hakata, 3) > totalTravel(hakata.plan));
});

test("a restaurant for dinner does not pull a sight away from its neighbour", () => {
  // Senso-ji and the Skytree are a walk apart; Meiji Shrine is next to the Shibuya dinner.
  const places = [...sightsOf("tokyo", ["浅草寺", "東京スカイツリー", "東京国立博物館", "明治神宮", "東京タワー"]), { id: "r-shibuya", name: "渋谷の店", lat: 35.6595, lon: 139.7005, stayMinutes: 90, kind: "restaurant", meal: "dinner" as const }];
  const trip = planned("tokyo", places, 2);
  assert.ok(namesOn(dayWith(trip.plan, "浅草寺")).includes("東京スカイツリー"));
  assert.equal(namesOn(dayWith(trip.plan, "渋谷の店")).at(-1), "渋谷の店");
  assert.ok(namesOn(dayWith(trip.plan, "渋谷の店")).includes("明治神宮"));
});

test("only a list that cannot fit its days runs past midnight, and then every clock after midnight says so", () => {
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
  // Six sights with Disneyland in one day cannot be kept: the day is printed
  // anyway, says it is late, and marks what falls on the next calendar day.
  const overfull = trip("tokyo", 6, 1, { raw: true });
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
