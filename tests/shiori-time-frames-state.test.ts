import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { buildShioriPlan, type ShioriPlace } from "../lib/shiori/plan.ts";
import { decodeTrip, emptyTrip, encodeTrip, placeFromSight, withCity, withFirstDayStart, withLastDayFinish, withReservation, type ShioriTrip } from "../lib/shiori/state.ts";

/*
 * Times a traveller entered, as the trip keeps them: in localStorage and in
 * a share link. A trip without any is saved exactly as it always was; one
 * with them reads back whole; and a link from somewhere else can lose a bad
 * time but never the trip — and never has a time repaired into another.
 */

const NOW = new Date("2026-11-14T03:00:00Z");
const spot = (id: string): ShioriPlace => ({ id, name: `場所${id}`, lat: 35.68, lon: 139.76, stayMinutes: 60 });
const TRIP: ShioriTrip = { ...emptyTrip, cityId: "tokyo", cityName: "東京", places: [spot("a"), spot("b")], days: 3 };
const wireOf = (encoded: string) => JSON.parse(Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
const encodeWire = (wire: unknown) => Buffer.from(JSON.stringify(wire), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("a trip with nothing entered encodes to exactly the text it always did", () => {
  // The saved form of this trip as the build before time frames wrote it.
  assert.equal(
    encodeTrip(TRIP),
    "eyJ2IjoxLCJjIjoidG9reW8iLCJuIjoi5p2x5LqsIiwiZCI6MywicCI6InN0YW5kYXJkIiwicyI6W1siYSIsIuWgtOaJgGEiLDM1LjY4LDEzOS43Niw2MCxudWxsLG51bGwsbnVsbCxudWxsXSxbImIiLCLloLTmiYBiIiwzNS42OCwxMzkuNzYsNjAsbnVsbCxudWxsLG51bGwsbnVsbF1dLCJoIjpudWxsfQ",
  );
  const wire = wireOf(encodeTrip(TRIP));
  assert.equal("w" in wire, false);
  assert.equal(wire.s.every((entry: unknown[]) => entry.length === 9), true);
  assert.deepEqual(decodeTrip(encodeTrip(TRIP), NOW), TRIP);
});

test("a start, a finish and a booking are saved and read back, in the link as in storage", () => {
  let trip = withFirstDayStart(TRIP, "13:00");
  trip = withLastDayFinish(trip, "15:30");
  trip = withReservation(trip, "b", { day: 2, time: "12:15" });
  assert.deepEqual([trip.firstDayStart, trip.lastDayFinish, trip.places[1].reserve, trip.places[1].day], ["13:00", "15:30", { day: 2, time: "12:15" }, 2]);
  const back = decodeTrip(encodeTrip(trip), NOW);
  assert.deepEqual(back, trip);
  const wire = wireOf(encodeTrip(trip));
  assert.deepEqual(wire.w, [780, 930]);
  assert.deepEqual([wire.s[0].length, wire.s[1].length, wire.s[1][9], wire.s[1][5]], [9, 10, [2, 735], 2]);
  // Only one of the two.
  assert.deepEqual(wireOf(encodeTrip(withFirstDayStart(TRIP, "07:05"))).w, [425, null]);
  assert.deepEqual(decodeTrip(encodeTrip(withLastDayFinish(TRIP, "23:59")), NOW), { ...TRIP, lastDayFinish: "23:59" });
  // The time fields: empty clears, half-typed changes nothing.
  assert.deepEqual(withFirstDayStart(trip, ""), (() => { const { firstDayStart: _gone, ...rest } = trip; void _gone; return rest; })());
  assert.equal(withFirstDayStart(trip, "1"), trip);
  assert.equal(withLastDayFinish(trip, "24:00"), trip);
  assert.equal("lastDayFinish" in withLastDayFinish(trip, ""), false);
  // Clearing a booking leaves the place on its day; half a booking is not taken.
  const cleared = withReservation(trip, "b", null);
  assert.deepEqual([cleared.places[1].reserve, cleared.places[1].day], [undefined, 2]);
  assert.equal("reserve" in cleared.places[1], false);
  for (const bad of [{ day: 0, time: "10:00" }, { day: 8, time: "10:00" }, { day: 1.5, time: "10:00" }, { day: 1, time: "10" }, { day: 1, time: "24:00" }, { day: 1, time: "" }]) {
    assert.equal(withReservation(TRIP, "a", bad), TRIP, JSON.stringify(bad));
  }
  // A new city is a new trip; the hours the traveller arrives and leaves are theirs and carry over.
  const city = { id: "kyoto", ja: "京都", en: "Kyoto" } as Parameters<typeof withCity>[1];
  const moved = withCity(trip, city, "ja");
  assert.deepEqual([moved.firstDayStart, moved.lastDayFinish, moved.places.length], ["13:00", "15:30", 0]);
});

test("a link from before times could be entered still opens, unchanged", () => {
  const old = encodeWire({ v: 1, c: "tokyo", n: "東京", d: 3, p: "standard", s: [["wikidata-Q1", "浅草寺", 35.7148, 139.7967, 50, 2, "temple", null], ["r1", "店", 35.7, 139.7, 60, null, "restaurant", null, "lunch"]], h: null });
  const trip = decodeTrip(old, NOW)!;
  assert.deepEqual(trip.places.map((place) => [place.name, place.day, place.meal, place.reserve]), [["浅草寺", 2, undefined, undefined], ["店", undefined, "lunch", undefined]]);
  assert.equal("firstDayStart" in trip || "lastDayFinish" in trip, false);
  assert.equal(encodeTrip(trip), encodeWire({ v: 1, c: "tokyo", n: "東京", d: 3, p: "standard", s: [["wikidata-Q1", "浅草寺", 35.7148, 139.7967, 50, 2, "temple", null, null], ["r1", "店", 35.7, 139.7, 60, null, "restaurant", null, "lunch"]], h: null }));
});

test("a link someone tampered with loses the bad time, never the trip — and a bad time is never repaired into another", () => {
  const wire = (reserve: unknown, w?: unknown) => encodeWire({
    v: 1, c: "tokyo", n: "東京", d: 3, p: "standard",
    s: [["a", "場所a", 35.68, 139.76, 60, 2, null, null, null, reserve], ["b", "場所b", 35.68, 139.76, 60, null, null, null, null]],
    h: null,
    ...(w === undefined ? {} : { w }),
  });
  for (const bad of [
    "13:00", 780, null, {}, [], [2], [2, 780, 1], [0, 780], [8, 780], [-1, 780], [2.5, 780], [2, -1], [2, 1_440], [2, 780.5], ["2", 780], [2, "780"], [2, null], [null, 780],
    [Number.MAX_SAFE_INTEGER, 780], [[2], 780], [2, [780]], { day: 2, time: "13:00" }, [true, 780], [2, true],
  ]) {
    const trip = decodeTrip(wire(bad), NOW);
    assert.ok(trip, `${JSON.stringify(bad)}: the trip still opens`);
    assert.equal(trip.places.length, 2, JSON.stringify(bad));
    // The place is kept, on the day it was on, without a booking.
    assert.deepEqual([trip.places[0].reserve, trip.places[0].day], [undefined, 2], JSON.stringify(bad));
  }
  // A good one beside a bad pin: the booking's day is the place's day.
  assert.deepEqual(decodeTrip(wire([3, 600]), NOW)!.places[0], { ...spot("a"), day: 3, reserve: { day: 3, time: "10:00" } });
  for (const bad of ["13:00", 780, {}, [], [780], [780, 900, 1], [-1, 900], [780, 1_440], [780.5, 900], ["780", 900], [780, "900"], [true, null], [[780], null], { 0: 780, 1: 900 }]) {
    const trip = decodeTrip(wire([2, 780], bad), NOW);
    assert.ok(trip, `${JSON.stringify(bad)}: the trip still opens`);
    // Neither is read: a start is not taken from a pair whose finish is nonsense.
    assert.equal("firstDayStart" in trip || "lastDayFinish" in trip, false, JSON.stringify(bad));
    assert.deepEqual(trip.places[0].reserve, { day: 2, time: "13:00" });
  }
  assert.deepEqual([decodeTrip(wire(undefined, [null, 900]), NOW)!.firstDayStart, decodeTrip(wire(undefined, [null, 900]), NOW)!.lastDayFinish], [undefined, "15:00"]);
  assert.deepEqual(decodeTrip(wire(undefined, [0, 1_439]), NOW)!.firstDayStart, "00:00");
  assert.equal("firstDayStart" in decodeTrip(wire(undefined, [null, null]), NOW)!, false);
});

test("a booking beyond the trip's days is kept as entered — at decode and when the days shrink — and the plan says it does not fit", () => {
  // Booked for day 5; the trip is then cut to three days.
  const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
  const rail = new RailNetwork(JSON.parse(readFileSync(new URL("../public/rail/tokyo.json", import.meta.url), "utf8")));
  const places = curateSights(cities.find((entry) => entry.id === "tokyo")!.sights).slice(0, 4).map((sight) => placeFromSight(sight, "ja"));
  let trip: ShioriTrip = { ...emptyTrip, cityId: "tokyo", cityName: "東京", places, days: 5 };
  trip = withReservation(trip, places[1].id, { day: 5, time: "11:00" });
  trip = { ...trip, days: 3 };
  const back = decodeTrip(encodeTrip(trip), NOW)!;
  assert.deepEqual([back.days, back.places[1].reserve, back.places[1].day], [3, { day: 5, time: "11:00" }, 5]);
  const shown = buildShioriPlan({ places: back.places, days: back.days, hotel: back.hotel, locale: "ja" }, { rail, cities });
  assert.equal(shown.days.some((day) => day.stops.some((stop) => stop.place.id === places[1].id)), false);
  assert.deepEqual(shown.unplaced, [{ placeId: places[1].id, name: places[1].name, day: 5, reason: "reserve-day", days: 3, proven: true }]);
  // The other three places are planned as if it were not there.
  assert.equal(shown.days.flatMap((day) => day.stops).length, 3);
  // A day the picker cannot show (8) is not a booking at all.
  assert.equal(withReservation(trip, places[0].id, { day: 8, time: "11:00" }), trip);
});
