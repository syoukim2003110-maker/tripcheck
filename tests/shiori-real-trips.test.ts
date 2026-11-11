import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { buildShioriPlan, type ShioriInput, type ShioriPlace, type ShioriPlan } from "../lib/shiori/plan.ts";
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
