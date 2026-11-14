import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { buildShioriPlan, clockOfDay, departureAfterStop, type ShioriInput, type ShioriPlace, type ShioriPlan, type ShioriRoute } from "../lib/shiori/plan.ts";
import { placeFromSight } from "../lib/shiori/state.ts";

/*
 * Times a traveller entered, in the booklet itself, on real cities with
 * their real station maps: when day 1 can start, when the last day has to be
 * over, and a booked time on a place. One rule is held above every other: a
 * plan that is shown never breaks one of them without saying so.
 */

const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
const networks = new Map<string, RailNetwork>();
function railOf(cityId: string) {
  if (!networks.has(cityId)) networks.set(cityId, new RailNetwork(JSON.parse(readFileSync(new URL(`../public/rail/${cityId}.json`, import.meta.url), "utf8"))));
  return networks.get(cityId)!;
}
function sightsOf(cityId: string, count: number, from = 0): ShioriPlace[] {
  const city = cities.find((entry) => entry.id === cityId)!;
  return curateSights(city.sights).slice(from, from + count).map((sight) => placeFromSight(sight, "ja"));
}
function named(cityId: string, names: string[]): ShioriPlace[] {
  const city = cities.find((entry) => entry.id === cityId)!;
  return names.map((name) => placeFromSight(city.sights.find((sight) => sight.ja === name)!, "ja"));
}
const plan = (cityId: string, input: Omit<ShioriInput, "locale">, routes?: ReadonlyMap<string, ShioriRoute | null>) => (
  buildShioriPlan({ ...input, locale: "ja" }, { rail: railOf(cityId), cities, ...(routes ? { routes } : {}) })
);
const at = (clock: string) => clockOfDay(clock)!;
const SHINJUKU = { name: "新宿のホテル", lat: 35.6909, lon: 139.7003 };
const booked = (place: ShioriPlace, day: number, time: string): ShioriPlace => ({ ...place, reserve: { day, time } });
const stopOf = (trip: ShioriPlan, id: string) => {
  for (const day of trip.days) {
    const stop = day.stops.find((entry) => entry.place.id === id);
    if (stop) return { day, stop, position: day.stops.indexOf(stop) };
  }
  return null;
};
const unplacedOf = (trip: ShioriPlan, id: string) => trip.unplaced.find((entry) => entry.placeId === id) ?? null;

/**
 * Everything a traveller entered, read off the booklet as printed — written
 * here from the rules, not with the planner's own check. Throws on the first
 * thing that is broken or left unsaid.
 */
function assertKeepsEveryEnteredTime(trip: ShioriPlan, input: Omit<ShioriInput, "locale">, where: string) {
  const days = Math.max(1, Math.min(14, Math.round(input.days)));
  const start = clockOfDay(input.firstDayStart);
  const finish = clockOfDay(input.lastDayFinish);
  // Every listed place is on exactly one day, or named as not fitting — never both, never neither.
  const seen = new Map<string, number>();
  for (const day of trip.days) for (const stop of day.stops) seen.set(stop.place.id, (seen.get(stop.place.id) ?? 0) + 1);
  for (const place of input.places) {
    const placed = seen.get(place.id) ?? 0;
    const left = trip.leftOut.filter((name) => name === place.name).length;
    assert.equal(placed + left, 1, `${where}: ${place.name} is on ${placed} days and left out ${left} times`);
  }
  assert.equal(new Set(trip.days.map((day) => day.index)).size, trip.days.length, `${where}: two days share a number`);
  for (const day of trip.days) assert.ok(day.index >= 0 && day.stops.length > 0, where);
  for (const entry of trip.unplaced) {
    assert.equal(seen.has(entry.placeId), false, `${where}: ${entry.name} is both placed and set aside`);
    assert.ok(trip.leftOut.includes(entry.name), `${where}: ${entry.name} set aside but not listed`);
    // Whatever is set aside is said, by name. (A one-day trip whose start is not before its finish says so once.)
    assert.ok(
      trip.notices.some((notice) => (notice.kind === "unplaced" && notice.placeId === entry.placeId && notice.reason === entry.reason) || notice.kind === "frame-order"),
      `${where}: ${entry.name} set aside without a notice`,
    );
    // "Cannot" only where the numbers show it; "could not fit" for the rest.
    assert.equal(entry.proven, entry.reason === "reserve-day" || entry.reason === "reserve-before-start" || entry.reason === "reserve-after-finish" || entry.reason === "reserve-clash", where);
  }
  for (const place of input.places) {
    const time = clockOfDay(place.reserve?.time);
    const day = place.reserve?.day;
    const stop = stopOf(trip, place.id);
    if (time === null || typeof day !== "number" || !Number.isInteger(day) || day < 1) {
      if (stop) assert.equal(stop.stop.reserved, false, where);
      continue;
    }
    // A booked place: on its day, at exactly its time — or set aside and said so.
    const aside = unplacedOf(trip, place.id);
    assert.equal(Boolean(stop) !== Boolean(aside), true, `${where}: ${place.name} (booked day ${day} ${place.reserve!.time}) is ${stop ? "placed" : "not placed"} and ${aside ? "set aside" : "not set aside"}`);
    if (!stop) continue;
    assert.equal(stop.day.index, day - 1, `${where}: ${place.name} booked for day ${day} is on day ${stop.day.index + 1}`);
    assert.equal(stop.stop.arrive, place.reserve!.time, `${where}: ${place.name} booked for ${place.reserve!.time} is shown at ${stop.stop.arrive}`);
    assert.equal(stop.stop.arriveNextDay, false, where);
    assert.equal(stop.stop.reserved, true, where);
    assert.equal(stop.stop.mealMissed, false, `${where}: a booked table is not "missed"`);
    assert.ok(day <= days, where);
  }
  // The one thing the traveller cannot move is never the place offered for removal.
  for (const notice of trip.notices) {
    if (notice.kind === "drop") assert.equal(clockOfDay(input.places.find((place) => place.id === notice.placeId)?.reserve?.time), null, `${where}: a booked place is offered for removal`);
  }
  // A pinned place that is on the plan is on its day.
  for (const place of input.places) {
    const stop = stopOf(trip, place.id);
    if (stop && typeof place.day === "number" && place.day <= days && !place.reserve) assert.equal(stop.day.index, place.day - 1, `${where}: ${place.name} pinned to day ${place.day}`);
  }
  for (const day of trip.days) {
    // Day 1 has nothing before the time the traveller can start.
    if (start !== null && day.index === 0) {
      assert.ok(at(day.start) >= start, `${where}: day 1 starts ${day.start}, before ${input.firstDayStart}`);
      for (const stop of day.stops) assert.ok(stop.arriveNextDay || at(stop.arrive) >= start, `${where}: ${stop.place.name} at ${stop.arrive}`);
    }
    // The last day is over — back at the hotel — by the time entered.
    if (finish !== null && day.index === days - 1) {
      assert.equal(day.endsNextDay, false, where);
      assert.ok(at(day.end) <= finish, `${where}: the last day ends ${day.end}, after ${input.lastDayFinish}`);
      const last = day.stops.at(-1)!;
      assert.equal(last.leaveNextDay, false, where);
      assert.ok(at(departureAfterStop(day, day.stops.length - 1)!) + (day.toHotel?.minutes ?? 0) <= finish, `${where}: last stop ${last.leave} + ride home`);
      assert.equal(day.meals.some((meal) => meal.kind === "dinner"), false, `${where}: no dinner is suggested after the finish`);
    }
    // A day that says it has no room for a lunch hour has none — and no restaurant chosen for lunch either.
    if (day.noLunchRoom) assert.equal(day.meals.some((meal) => meal.kind === "lunch") || day.stops.some((stop) => stop.place.meal === "lunch"), false, where);
    // The clock is one clock: each arrival is the departure before it, the ride, ten minutes of slack and the wait that is printed.
    let lifted = 0;
    const lift = (clock: string) => {
      let minutes = at(clock);
      while (minutes < lifted) minutes += 1_440;
      lifted = minutes;
      return minutes;
    };
    let cursor = lift(day.start) + (day.fromHotel ? day.fromHotel.minutes + 10 : 0);
    day.stops.forEach((stop, position) => {
      assert.ok(stop.waitMinutes >= 0, where);
      const arrive = lift(stop.arrive);
      assert.equal(arrive, cursor + stop.waitMinutes, `${where}: day ${day.index + 1} ${stop.place.name} arrives ${stop.arrive}, reached ${cursor}, wait ${stop.waitMinutes}`);
      cursor = lift(departureAfterStop(day, position)!) + (day.legs[position] ? day.legs[position].minutes + 10 : 0);
    });
  }
}

function generator(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((state / 2_147_483_648) * below);
  };
}
const clockText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

test("no plan that is shown breaks a time the traveller entered: 260 trips on real cities", () => {
  // Tokyo, Kyoto and Osaka; one to five days; with and without a hotel;
  // restaurants, pins, up to four bookings — some clashing on purpose, some
  // on a day the trip does not have —, a start, a finish, a forecast, and
  // street paths measured longer than estimated.
  // (More rounds, from another seed: SHIORI_FRAME_ROUNDS=5000 SHIORI_FRAME_SEED=7 node --test …)
  const rounds = Number(process.env.SHIORI_FRAME_ROUNDS ?? 260);
  const random = generator(Number(process.env.SHIORI_FRAME_SEED ?? 20_261_115));
  const tally = { booked: 0, kept: 0, aside: new Map<string, number>(), started: 0, finished: 0, measured: 0, wet: 0 };
  for (let round = 0; round < rounds; round += 1) {
    const cityId = ["tokyo", "kyoto", "osaka"][random(3)];
    const days = 1 + random(round % 9 === 0 ? 5 : 3);
    const count = 2 + random(round % 13 === 0 ? 11 : 7) + Number(process.env.SHIORI_FRAME_PLACES ?? 0);
    const places: ShioriPlace[] = sightsOf(cityId, count, random(12));
    const centre = places[0];
    if (random(4) === 0) places.push({ id: `lunch-${round}`, name: `昼の店${round}`, lat: centre.lat + (random(30) - 15) / 1_000, lon: centre.lon + (random(30) - 15) / 1_000, stayMinutes: 60, kind: "restaurant", meal: "lunch" });
    if (random(4) === 0) places.push({ id: `dinner-${round}`, name: `夜の店${round}`, lat: centre.lat + (random(30) - 15) / 1_000, lon: centre.lon + (random(30) - 15) / 1_000, stayMinutes: 90, kind: "restaurant", meal: "dinner" });
    for (let index = 0; index < places.length; index += 1) if (random(9) === 0) places[index] = { ...places[index], day: 1 + random(days) };
    const bookings = random(5);
    for (let booking = 0; booking < bookings; booking += 1) {
      const index = random(places.length);
      const meal = places[index].meal;
      // Mostly at a sensible hour for what it is; sometimes anything; sometimes a day too far.
      const time = random(5) === 0 ? 420 + 15 * random(60) : meal === "lunch" ? 690 + 15 * random(9) : meal === "dinner" ? 1_050 + 15 * random(9) : 540 + 30 * random(18);
      places[index] = booked(places[index], random(10) === 0 ? days + 1 + random(2) : 1 + random(days), clockText(time));
    }
    // Two bookings a quarter of an hour apart on one day: one of them has to go.
    if (random(8) === 0 && places.length >= 2) {
      places[0] = booked(places[0], 1, "13:00");
      places[1] = booked(places[1], 1, "13:15");
    }
    const input: Omit<ShioriInput, "locale"> = {
      places,
      days,
      hotel: random(3) === 0 ? { name: "ホテル", lat: centre.lat + (random(40) - 20) / 1_000, lon: centre.lon + (random(40) - 20) / 1_000 } : null,
      ...(random(2) === 0 ? { firstDayStart: clockText(540 + 30 * random(21)) } : {}),
      ...(random(2) === 0 ? { lastDayFinish: clockText(660 + 30 * random(20)) } : {}),
      ...(random(3) === 0 ? { wetDays: Array.from({ length: days }, () => [true, false, null][random(3)]) } : {}),
    };
    const where = `round ${round} (${cityId}, ${count} places, ${days} days${input.firstDayStart ? `, from ${input.firstDayStart}` : ""}${input.lastDayFinish ? `, until ${input.lastDayFinish}` : ""})`;
    const trip = plan(cityId, input);
    assertKeepsEveryEnteredTime(trip, input, where);
    // The same trip gives the same plan.
    assert.deepEqual(plan(cityId, input), trip, where);
    for (const place of places) {
      if (!place.reserve) continue;
      tally.booked += 1;
      const aside = unplacedOf(trip, place.id);
      if (aside) tally.aside.set(aside.reason, (tally.aside.get(aside.reason) ?? 0) + 1);
      else tally.kept += 1;
    }
    for (const entry of trip.unplaced) if (entry.reason === "no-room") tally.aside.set(`no-room/${entry.edge}`, (tally.aside.get(`no-room/${entry.edge}`) ?? 0) + 1);
    if (input.firstDayStart && trip.days.some((day) => day.index === 0)) tally.started += 1;
    if (input.lastDayFinish && trip.days.some((day) => day.index === days - 1)) tally.finished += 1;
    if (input.wetDays && trip.notices.some((notice) => notice.kind === "weather-order")) tally.wet += 1;
    // Street paths come back a moment later, some much longer than the
    // estimate. The booklet corrects its clocks — and still breaks nothing.
    if (round % 3 === 0) {
      const routes = new Map<string, ShioriRoute | null>();
      for (const day of trip.days) {
        for (const leg of [...day.legs, day.fromHotel, day.toHotel]) {
          if (!leg || leg.rail || random(2) === 0) continue;
          routes.set(`${leg.mode === "walk" ? "walk" : "drive"}|${leg.key}`, { minutes: Math.max(1, Math.round(leg.minutes * (0.6 + random(30) / 10))), path: [leg.from, leg.to] });
        }
      }
      if (routes.size > 0) {
        tally.measured += 1;
        assertKeepsEveryEnteredTime(plan(cityId, input, routes), input, `${where}, measured paths`);
      }
    }
  }
  // The rounds are not all of one kind: bookings kept and bookings set aside for each reason that can be proven.
  const summary = `${tally.booked} bookings, ${tally.kept} kept, set aside: ${[...tally.aside].map(([reason, times]) => `${reason} ${times}`).join(", ")}; day 1 with a start ${tally.started}, last day with a finish ${tally.finished}, measured ${tally.measured}, moved by weather ${tally.wet}`;
  if (process.env.SHIORI_FRAME_ROUNDS) console.log(summary);
  assert.ok(tally.kept > rounds / 2, summary);
  for (const reason of ["reserve-day", "reserve-clash", "reserve-before-start", "reserve-after-finish", "no-room/finish"]) assert.ok((tally.aside.get(reason) ?? 0) > 0, `${reason}: ${summary}`);
  assert.ok(tally.started > rounds / 5 && tally.finished > rounds / 8 && tally.measured > rounds / 8, summary);
});

/* ------------------------------------------------------------ worked trips */

test("a booked lunch is that day's lunch at its time, and the morning is planned around it", () => {
  const sights = named("tokyo", ["浅草寺", "東京スカイツリー", "東京国立博物館", "明治神宮", "東京タワー"]);
  const lunch: ShioriPlace = { id: "r-ginza", name: "銀座の店", lat: 35.6717, lon: 139.765, stayMinutes: 60, kind: "restaurant", meal: "lunch", reserve: { day: 2, time: "13:00" } };
  const input = { places: [...sights, lunch], days: 2, hotel: SHINJUKU };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "booked lunch");
  const found = stopOf(trip, lunch.id)!;
  assert.deepEqual([found.day.index, found.stop.arrive, found.stop.leave, found.stop.reserved], [1, "13:00", "14:00", true]);
  // No second lunch hour on that day; the other day has its own.
  assert.equal(found.day.meals.some((meal) => meal.kind === "lunch"), false);
  assert.equal(trip.days.find((day) => day.index === 0)!.meals.some((meal) => meal.kind === "lunch"), true);
  assert.deepEqual(trip.unplaced, []);
  // Nothing else on the plan is marked as a booking.
  assert.equal(trip.days.flatMap((day) => day.stops).filter((stop) => stop.reserved).length, 1);
});

test("a day that has no room for a lunch hour beside its times says so, and is not a conflict", () => {
  const sights = named("tokyo", ["浅草寺", "東京スカイツリー", "東京国立博物館", "明治神宮", "東京タワー", "皇居"]);
  sights[4] = booked(sights[4], 2, "10:30");
  const lunch: ShioriPlace = { id: "r-ginza", name: "銀座の店", lat: 35.6717, lon: 139.765, stayMinutes: 60, kind: "restaurant", meal: "lunch", reserve: { day: 1, time: "13:00" } };
  const input = { places: [...sights, lunch], days: 2, hotel: SHINJUKU, firstDayStart: "10:30", lastDayFinish: "16:00" };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "no lunch room");
  assert.deepEqual(trip.unplaced, []);
  const last = trip.days.find((day) => day.index === 1)!;
  // Three visits between the 10:30 booking and the way back by 16:00: an hour for lunch would carry the day past its finish.
  assert.equal(last.noLunchRoom, true);
  assert.equal(last.meals.some((meal) => meal.kind === "lunch"), false);
  assert.ok(at(last.end) <= at("16:00"));
  // The day with the booked lunch has its lunch and says nothing.
  assert.equal(trip.days.find((day) => day.index === 0)!.noLunchRoom, false);
  // With the finish an hour and a half later the lunch hour is back.
  const later = plan("tokyo", { ...input, lastDayFinish: "17:30" });
  const relaxed = later.days.find((day) => day.index === 1)!;
  assert.deepEqual([relaxed.noLunchRoom, relaxed.meals.some((meal) => meal.kind === "lunch")], [false, true]);
});

test("the time the traveller can start on day 1 and the finish of the last day are both kept, hotel rides included", () => {
  const input = { places: sightsOf("kyoto", 9), days: 3, hotel: { name: "京都駅のホテル", lat: 34.9858, lon: 135.7588 }, firstDayStart: "13:30", lastDayFinish: "12:00" };
  const trip = plan("kyoto", input);
  assertKeepsEveryEnteredTime(trip, input, "kyoto");
  const first = trip.days.find((day) => day.index === 0)!;
  const last = trip.days.find((day) => day.index === 2)!;
  assert.ok(first && last, "both ends of the trip are used");
  assert.ok(at(first.start) >= at("13:30"));
  assert.ok(at(last.end) <= at("12:00"));
  // The afternoon and the morning are used for what fits them, not left empty.
  assert.ok(first.stops.length >= 2 && last.stops.length >= 1);
  assert.equal(trip.days.some((day) => day.runsLate), false);
  // The middle day is an ordinary day.
  const middle = trip.days.find((day) => day.index === 1)!;
  assert.equal(middle.start, "08:30");
  assert.equal(trip.leftOut.length, 0);
  // An earlier time than the usual start pulls nothing forward: the day begins as it always does.
  const early = plan("kyoto", { ...input, firstDayStart: "06:00", lastDayFinish: null });
  assert.equal(early.days.find((day) => day.index === 0)!.start, "08:30");
});

test("a booking on a day the trip does not have is never moved: it is named, with the way out", () => {
  const places = sightsOf("tokyo", 4);
  places[1] = booked(places[1], 4, "10:00");
  const input = { places, days: 2, hotel: null };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "day beyond");
  assert.deepEqual(unplacedOf(trip, places[1].id), { placeId: places[1].id, name: places[1].name, day: 4, reason: "reserve-day", days: 2, proven: true });
  assert.equal(stopOf(trip, places[1].id), null);
  // Four days hold it — and that is offered only because the four-day plan was made and fits.
  assert.deepEqual(trip.notices.filter((notice) => notice.kind === "needs-days"), [{ kind: "needs-days", days: 4 }]);
  const four = plan("tokyo", { ...input, days: 4 });
  assert.deepEqual([stopOf(four, places[1].id)!.day.index, stopOf(four, places[1].id)!.stop.arrive], [3, "10:00"]);
  assert.deepEqual(four.unplaced, []);
  // It is not "too much for the days", and no other place is offered for removal.
  assert.equal(trip.notices.some((notice) => notice.kind === "too-much" || notice.kind === "drop"), false);
});

test("a booking the traveller cannot reach in time says the earliest arrival there is", () => {
  const places = sightsOf("tokyo", 3);
  places[0] = booked(places[0], 1, "10:00");
  // No hotel: the earliest is the time entered itself.
  const input = { places, days: 2, hotel: null, firstDayStart: "11:30" };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "before start");
  assert.deepEqual(unplacedOf(trip, places[0].id), { placeId: places[0].id, name: places[0].name, day: 1, reason: "reserve-before-start", time: "10:00", earliest: "11:30", proven: true });
  // From a hotel the ride there, and ten minutes, come on top.
  const withHotel = plan("tokyo", { ...input, hotel: SHINJUKU });
  const entry = unplacedOf(withHotel, places[0].id)!;
  assert.equal(entry.reason, "reserve-before-start");
  const kept = plan("tokyo", { ...input, hotel: SHINJUKU, firstDayStart: null });
  const ride = stopOf(kept, places[0].id)!.day.fromHotel!.minutes;
  assert.equal(entry.reason === "reserve-before-start" && entry.earliest, clockText(at("11:30") + ride + 10));
  // On day 2 the same booking is no problem, and neither is a start it can be reached from.
  const dayTwo = { ...input, places: [booked(places[0], 2, "10:00"), places[1], places[2]] };
  assert.deepEqual(plan("tokyo", dayTwo).unplaced, []);
  assert.deepEqual(plan("tokyo", { ...input, firstDayStart: "10:00" }).unplaced, []);
  // More days do not cure it, so none are offered.
  assert.equal(trip.notices.some((notice) => notice.kind === "needs-days" || notice.kind === "too-much"), false);
});

test("a booking that runs past the last day's finish says when it would be over", () => {
  const places = sightsOf("tokyo", 3);
  places[2] = booked({ ...places[2], stayMinutes: 90 }, 2, "14:00");
  const input = { places, days: 2, hotel: null, lastDayFinish: "15:00" };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "after finish");
  assert.deepEqual(unplacedOf(trip, places[2].id), { placeId: places[2].id, name: places[2].name, day: 2, reason: "reserve-after-finish", time: "14:00", ends: "15:30", finish: "15:00", proven: true });
  // Until 15:30 it fits, to the minute.
  const fits = plan("tokyo", { ...input, lastDayFinish: "15:30" });
  assert.deepEqual(fits.unplaced, []);
  assert.equal(stopOf(fits, places[2].id)!.stop.leave, "15:30");
});

test("of two bookings that cannot both be kept the one higher in the list stays, and the notice gives the numbers", () => {
  const [tower, skytree, museum] = named("tokyo", ["東京タワー", "東京スカイツリー", "東京国立博物館"]);
  const places = [booked({ ...skytree, stayMinutes: 60 }, 1, "10:00"), booked(tower, 1, "10:30"), museum];
  const input = { places, days: 2, hotel: null };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "clash");
  const entry = unplacedOf(trip, tower.id)!;
  assert.equal(entry.reason, "reserve-clash");
  assert.equal(stopOf(trip, skytree.id)!.stop.arrive, "10:00");
  if (entry.reason === "reserve-clash") {
    assert.deepEqual([entry.withId, entry.withTime, entry.earlierId, entry.proven], [skytree.id, "10:00", skytree.id, true]);
    // Out of the Skytree at 11:00, the ride as priced, ten minutes: that is when the Tower can be reached.
    const alone = plan("tokyo", { places: [{ ...skytree, stayMinutes: 60, day: 1 }, { ...tower, day: 1 }], days: 1, hotel: null });
    const ride = alone.days[0].legs.find((leg) => leg.fromName === skytree.name)?.minutes ?? alone.days[0].legs[0].minutes;
    assert.equal(alone.days[0].stops[0].place.id === skytree.id ? entry.freeAt : null, alone.days[0].stops[0].place.id === skytree.id ? clockText(at("11:00") + ride + 10) : null);
  }
  // Listed the other way round, the Tower stays and the Skytree is named — it is first on the clock, so the Tower is reached too late from it.
  const swapped = plan("tokyo", { ...input, places: [places[1], places[0], museum] });
  const other = unplacedOf(swapped, skytree.id)!;
  assert.equal(other.reason, "reserve-clash");
  assert.equal(other.reason === "reserve-clash" && other.earlierId, skytree.id);
  assert.equal(stopOf(swapped, tower.id)!.stop.arrive, "10:30");
  // With enough time between them both are kept.
  const apart = plan("tokyo", { ...input, places: [places[0], booked(tower, 1, "13:00"), museum] });
  assert.deepEqual(apart.unplaced, []);
  // A clash is not "too much for the days": no day count and no other place cures it.
  assert.equal(trip.notices.some((notice) => notice.kind === "too-much" || notice.kind === "needs-days" || notice.kind === "drop"), false);
});

test("what does not fit before the finish is set aside — as little as possible, and never a booked place", () => {
  const sights = named("tokyo", ["東京タワー", "靖国神社", "皇居", "東京国立博物館", "東京スカイツリー"]);
  const lunch: ShioriPlace = { id: "r-ginza", name: "銀座の店", lat: 35.6717, lon: 139.765, stayMinutes: 60, kind: "restaurant", meal: "lunch", reserve: { day: 1, time: "13:00" } };
  const input = { places: [...sights, lunch], days: 1, hotel: SHINJUKU, firstDayStart: "10:30", lastDayFinish: "16:00" };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "one day");
  assert.equal(stopOf(trip, lunch.id)!.stop.arrive, "13:00");
  assert.ok(trip.unplaced.length >= 2 && trip.unplaced.every((entry) => entry.reason === "no-room" && entry.edge === "finish" && entry.proven === false));
  assert.equal(trip.unplaced.some((entry) => entry.placeId === lunch.id), false);
  // None of the places set aside fits on top of what is shown: each is tried.
  for (const entry of trip.unplaced) {
    const withIt = plan("tokyo", { ...input, places: input.places.filter((place) => place.id === entry.placeId || stopOf(trip, place.id)) });
    assert.ok(withIt.unplaced.length > 0, `${entry.name} would have fitted`);
  }
  // More days hold the list; that is offered because that plan was made.
  const more = trip.notices.find((notice) => notice.kind === "needs-days");
  assert.ok(more && more.kind === "needs-days");
  const longer = plan("tokyo", { ...input, days: more.days });
  assert.deepEqual([longer.unplaced, longer.leftOut], [[], []]);
  assertKeepsEveryEnteredTime(longer, { ...input, days: more.days }, "more days");
});

test("a place pinned beside a booking that leaves it no room is set aside; the booking is not", () => {
  // The museum pinned to day 1 with a three-hour stay; a booking at 10:00 on
  // the far side of town and the day over by 12:30.
  const [museum, skytree, tower] = named("tokyo", ["東京国立博物館", "東京スカイツリー", "東京タワー"]);
  const input = { places: [{ ...museum, stayMinutes: 180, day: 1 }, booked(tower, 1, "10:00"), skytree], days: 2, hotel: null, lastDayFinish: "19:00", firstDayStart: "09:30" };
  const tight = plan("tokyo", { ...input, days: 1, lastDayFinish: "12:30" });
  assertKeepsEveryEnteredTime(tight, { ...input, days: 1, lastDayFinish: "12:30" }, "pinned");
  assert.equal(stopOf(tight, tower.id)!.stop.arrive, "10:00");
  assert.equal(unplacedOf(tight, museum.id)?.reason, "no-room");
  // It is the drop that is suggested, or more days: never the booked place.
  assert.equal(tight.notices.some((notice) => notice.kind === "drop" && notice.placeId === tower.id), false);
});

test("a one-day trip that may not start before it has to end plans nothing and says which two times collide", () => {
  const input = { places: sightsOf("osaka", 3), days: 1, hotel: null, firstDayStart: "15:00", lastDayFinish: "14:00" };
  const trip = plan("osaka", input);
  assert.deepEqual(trip.days, []);
  assert.deepEqual(trip.notices, [{ kind: "frame-order", start: "15:00", finish: "14:00" }]);
  assert.deepEqual([...trip.leftOut].sort(), input.places.map((place) => place.name).sort());
  assert.equal(trip.unplaced.length, 3);
  // On two days the same two times are no contradiction.
  const two = plan("osaka", { ...input, days: 2 });
  assertKeepsEveryEnteredTime(two, { ...input, days: 2 }, "two days");
  assert.ok(two.days.length > 0);
});

test("a path measured much longer than estimated never shows a booking late: the stop in front gives way", () => {
  // Two neighbours in Ueno a few minutes' walk apart; the second is booked
  // for the minute the estimated walk gets there.
  const pair = named("tokyo", ["国立西洋美術館", "上野動物園"]).map((place) => ({ ...place, day: 1 }));
  const base = { places: pair, days: 1, hotel: null };
  const loose = plan("tokyo", base);
  const [front, behind] = loose.days[0].stops.map((stop) => stop.place);
  const leg = loose.days[0].legs[0];
  assert.equal(leg.mode, "walk");
  const time = loose.days[0].stops[1].arrive;
  const input = { ...base, places: pair.map((place) => (place.id === behind.id ? booked(place, 1, time) : place)) };
  const estimated = plan("tokyo", input);
  assertKeepsEveryEnteredTime(estimated, input, "estimated");
  assert.deepEqual(estimated.unplaced, []);
  assert.deepEqual([stopOf(estimated, behind.id)!.position, stopOf(estimated, behind.id)!.stop.arrive, stopOf(estimated, behind.id)!.stop.waitMinutes], [1, time, 0]);
  // The street path comes back an hour longer, on foot and by road.
  const longer = { minutes: leg.minutes + 60, path: [leg.from, leg.to] };
  const measured = plan("tokyo", input, new Map([[`walk|${leg.key}`, longer], [`drive|${leg.key}`, longer]]));
  assertKeepsEveryEnteredTime(measured, input, "measured");
  // The booking is shown at its time and nowhere else; the place in front,
  // which can no longer be seen first, is named as not fitting. Nothing is shown late.
  assert.equal(stopOf(measured, behind.id)!.stop.arrive, time);
  assert.equal(stopOf(measured, front.id), null);
  assert.deepEqual(unplacedOf(measured, front.id), { placeId: front.id, name: front.name, reason: "no-room", day: 1, edge: "reserve", proven: false });
  // A path that is no longer than estimated changes nothing.
  const same = plan("tokyo", input, new Map([[`walk|${leg.key}`, { minutes: leg.minutes, path: [leg.from, leg.to] }]]));
  assert.deepEqual(same.unplaced, []);
});

test("a booked hour is not held to the planner's own evening: a night visit is not 'running late'", () => {
  const places = sightsOf("tokyo", 3);
  places[2] = booked({ ...places[2], stayMinutes: 60 }, 1, "20:00");
  const input = { places, days: 1, hotel: null };
  const trip = plan("tokyo", input);
  assertKeepsEveryEnteredTime(trip, input, "night");
  const night = stopOf(trip, places[2].id)!;
  assert.equal(night.stop.arrive, "20:00");
  assert.equal(night.day.runsLate, false);
  // The long gap before it is printed as free time, not hidden in the clock.
  assert.ok(night.stop.waitMinutes > 60);
  assert.equal(trip.notices.some((notice) => notice.kind === "too-much" || notice.kind === "needs-days"), false);
});

test("a booking before the usual start opens that day early, from the hotel too", () => {
  const places = sightsOf("kyoto", 8);
  places[0] = booked(places[0], 2, "07:00");
  const input = { places, days: 2, hotel: { name: "京都駅のホテル", lat: 34.9858, lon: 135.7588 } };
  const trip = plan("kyoto", input);
  assertKeepsEveryEnteredTime(trip, input, "sunrise");
  const early = stopOf(trip, places[0].id)!;
  assert.deepEqual([early.day.index, early.position, early.stop.arrive, early.stop.waitMinutes], [1, 0, "07:00", 0]);
  assert.equal(at(early.day.start), at("07:00") - early.day.fromHotel!.minutes - 10);
  // The other day starts as it always does.
  assert.equal(trip.days.find((day) => day.index === 0)!.start, "08:30");
});

/* ------------------------------------------------------------------ weather */

test("the forecast never moves a day that holds a booking, day 1 with a start or the last day with a finish", () => {
  const park = named("tokyo", ["代々木公園", "新宿御苑", "明治神宮"]);
  const indoors = named("tokyo", ["東京国立博物館", "国立西洋美術館", "国立科学博物館"]);
  const base = { places: [...park, ...indoors], days: 2, hotel: null };
  const plain = plan("tokyo", base);
  assert.equal(plain.days.length, 2);
  const onDay = (trip: ShioriPlan, id: string) => stopOf(trip, id)!.day.index;
  const parkDay = onDay(plain, park[0].id);
  assert.notEqual(onDay(plain, indoors[0].id), parkDay, "the parks and the museums are on different days");
  const wetDays = [0, 1].map((index) => index === parkDay);
  // Without anything entered, rain on the park day moves the museums onto it.
  const moved = plan("tokyo", { ...base, wetDays });
  assert.deepEqual(moved.notices.filter((notice) => notice.kind === "weather-order"), [{ kind: "weather-order", days: [parkDay + 1] }]);
  assert.notEqual(onDay(moved, park[0].id), parkDay);
  // A booking on a park: its day stays the day it was booked for, rain or not.
  const withBooking = { ...base, places: base.places.map((place) => (place.id === park[0].id ? booked(place, parkDay + 1, "10:00") : place)), wetDays };
  const held = plan("tokyo", withBooking);
  assertKeepsEveryEnteredTime(held, withBooking, "weather booking");
  assert.equal(onDay(held, park[0].id), parkDay);
  assert.equal(stopOf(held, park[0].id)!.stop.arrive, "10:00");
  assert.equal(held.notices.some((notice) => notice.kind === "weather-order"), false);
  // A start on day 1: day 1 was planned for the afternoon and stays day 1.
  for (const frame of [{ firstDayStart: "13:00" }, { lastDayFinish: "14:00" }]) {
    const input = { ...base, ...frame };
    const dry = plan("tokyo", input);
    for (const wet of [[true, false], [false, true]]) {
      const rainy = plan("tokyo", { ...input, wetDays: wet });
      assertKeepsEveryEnteredTime(rainy, { ...input, wetDays: wet }, `weather ${JSON.stringify(frame)}`);
      // Two days, one of them fixed: nothing can trade places.
      assert.deepEqual(rainy.days.map((day) => [day.index, day.stops.map((stop) => stop.place.id)]), dry.days.map((day) => [day.index, day.stops.map((stop) => stop.place.id)]));
      assert.equal(rainy.notices.some((notice) => notice.kind === "weather-order"), false);
    }
  }
  // Three days with a start on day 1: days 2 and 3 may still trade, day 1 never does.
  const three = { places: [...park, ...indoors, ...named("tokyo", ["浅草寺", "東京タワー"])], days: 3, hotel: null, firstDayStart: "14:00" };
  const dry = plan("tokyo", three);
  for (const wet of [[true, false, false], [false, true, false], [false, false, true], [true, true, false]]) {
    const rainy = plan("tokyo", { ...three, wetDays: wet });
    assertKeepsEveryEnteredTime(rainy, { ...three, wetDays: wet }, "weather three");
    const first = (trip: ShioriPlan) => trip.days.find((day) => day.index === 0)?.stops.map((stop) => stop.place.id);
    assert.deepEqual(first(rainy), first(dry), `wet ${wet}`);
    for (const notice of rainy.notices) if (notice.kind === "weather-order") assert.equal(notice.days.includes(1), false);
  }
});

/* ------------------------------------------------- nothing entered, nothing changed */

test("with no time entered the plan is the plan there has always been", () => {
  for (const [cityId, count, days, hotel] of [["tokyo", 8, 2, SHINJUKU], ["kyoto", 9, 3, null], ["osaka", 7, 2, null], ["tokyo", 12, 3, null]] as const) {
    const input = { places: sightsOf(cityId, count), days, hotel };
    const plain = plan(cityId, input);
    // Empty fields and a booking that is no booking are nothing entered.
    assert.deepEqual(plan(cityId, { ...input, firstDayStart: null, lastDayFinish: null }), plain);
    assert.deepEqual(plan(cityId, { ...input, firstDayStart: "", lastDayFinish: "25:00" }), plain);
    assert.deepEqual(plan(cityId, { ...input, places: input.places.map((place, index) => (index === 0 ? { ...place, reserve: { day: 1, time: "9:00" } } : place)) }).days.map((day) => day.stops.map((stop) => [stop.place.id, stop.arrive])), plain.days.map((day) => day.stops.map((stop) => [stop.place.id, stop.arrive])));
    assert.deepEqual(plain.unplaced, []);
    for (const day of plain.days) {
      assert.equal(day.noLunchRoom, false);
      for (const stop of day.stops) assert.equal(stop.reserved, false);
    }
  }
});

test("a twelve-place, three-day trip with a start, a finish and two bookings is planned in good time", () => {
  const places = sightsOf("tokyo", 12);
  const plain = plan("tokyo", { places, days: 3, hotel: null });
  const picks = [plain.days[0].stops.at(-1)!, plain.days[1].stops[1] ?? plain.days[1].stops[0]];
  const input = {
    places: places.map((place) => (place.id === picks[0].place.id ? booked(place, 1, "15:00") : place.id === picks[1].place.id ? booked(place, 2, "11:00") : place)),
    days: 3,
    hotel: null,
    firstDayStart: "10:30",
    lastDayFinish: "16:00",
  };
  const started = performance.now();
  const trip = plan("tokyo", input);
  const took = performance.now() - started;
  assertKeepsEveryEnteredTime(trip, input, "twelve places");
  // (Measured at about 0.3 s on the machine this was written on; the same trip with nothing entered takes about 0.27 s.)
  assert.ok(took < 2_500, `took ${Math.round(took)} ms`);
});
