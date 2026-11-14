import assert from "node:assert/strict";
import test from "node:test";

import { buildShioriPlan, type ShioriPlace } from "../lib/shiori/plan.ts";

/*
 * How many of the days asked for a list is spread over. A spare day is for
 * a list that does not fit, or for a day that would be packed; it is not a
 * reason to split a list that fits one unhurried day.
 */

const hotel = { name: "Hotel", lat: 35.5, lon: 139.61 };
const place = (id: string, lat: number, lon: number, stayMinutes: number): ShioriPlace => ({ id, name: id, lat, lon, stayMinutes });
const travel = (plan: ReturnType<typeof buildShioriPlan>) => plan.days.reduce((sum, day) => sum + day.travelMinutes, 0);

test("a list that fits one unhurried day stays on one day when two are allowed", () => {
  // Four places near each other, an hour from the hotel; one is a four-hour
  // stay. The shortest order runs late, another order fits — and that one
  // is printed, so it is the one the day count has to be judged on.
  const places = [
    place("A", 35.69517, 139.76418, 15),
    place("B", 35.69095, 139.7865, 90),
    place("C", 35.70635, 139.78045, 30),
    place("D", 35.69293, 139.75834, 240),
  ];
  const one = buildShioriPlan({ places, days: 1, hotel, locale: "en" });
  assert.equal(one.days.length, 1);
  assert.equal(one.days[0].runsLate, false);
  assert.equal(one.days[0].load, "normal");

  const two = buildShioriPlan({ places, days: 2, hotel, locale: "en" });
  assert.equal(two.days.length, 1, "the second day is left free, not filled with a second trip from the hotel");
  assert.equal(two.freeDays, 1);
  assert.equal(travel(two), travel(one));
  assert.deepEqual(two.days[0].stops.map((stop) => stop.place.id), one.days[0].stops.map((stop) => stop.place.id));
});

test("a list that does not fit one day in any order still takes the second day", () => {
  const places = [
    place("A", 35.69517, 139.76418, 240),
    place("B", 35.69095, 139.7865, 240),
    place("C", 35.70635, 139.78045, 240),
    place("D", 35.69293, 139.75834, 240),
  ];
  const two = buildShioriPlan({ places, days: 2, hotel, locale: "en" });
  assert.equal(two.days.length, 2);
  assert.equal(two.freeDays, 0);
});
