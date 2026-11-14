import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { curateSights, type PopularDestination } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { FORECAST_FRESH_MS, fetchedStamp, forecastCentre, isForecastFresh, loadForecast, wetDaysOf, type ForecastCache } from "../lib/shiori/forecast.ts";
import { buildShioriPlan, weatherExposure, type ShioriInput, type ShioriPlace, type ShioriPlan } from "../lib/shiori/plan.ts";
import { decodeTrip, emptyTrip, encodeTrip, placeFromSight, withCity, withStartDate, type ShioriTrip } from "../lib/shiori/state.ts";
import { FORECAST_DAYS_AHEAD, dateLabel, earliestStartDate, forecastWindow, tripDate, usableStartDate } from "../lib/shiori/trip-dates.ts";
import { isWetForecast, weatherDayOrder, wetReason, type WeatherSlot } from "../lib/shiori/weather-days.ts";
import type { TripWeatherDay } from "../lib/weather.ts";
import { requestWeatherPayload } from "../lib/weather-client.ts";

/*
 * The trip's dates and its forecast. The rule these tests hold the planner
 * to: a forecast may change which calendar day a planned day falls on, and
 * nothing else — and without a forecast, nothing at all.
 */

const NOW = new Date("2026-11-14T03:00:00Z");
const place = (id: string): ShioriPlace => ({ id, name: `場所${id}`, lat: 35.68, lon: 139.76, stayMinutes: 60 });
const TRIP: ShioriTrip = { ...emptyTrip, cityId: "tokyo", cityName: "東京", places: [place("a"), place("b")], days: 2 };

/* ------------------------------------------------------------------ dates */

test("a trip without a date encodes exactly as before, and one with a date reads back", () => {
  const undated = encodeTrip(TRIP);
  assert.equal(JSON.parse(Buffer.from(undated.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).t, undefined);
  assert.deepEqual(decodeTrip(undated, NOW), TRIP);
  assert.equal("startDate" in decodeTrip(undated, NOW)!, false);
  const dated = { ...TRIP, startDate: "2026-11-20" };
  assert.deepEqual(decodeTrip(encodeTrip(dated), NOW), dated);
});

test("a link made before dates existed still opens", () => {
  // The saved form as an older build wrote it: no date field at all.
  const old = Buffer.from(JSON.stringify({ v: 1, c: "tokyo", n: "東京", d: 3, p: "standard", s: [["wikidata-Q1", "浅草寺", 35.7148, 139.7967, 50, null, "temple", null]], h: null }), "utf8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const trip = decodeTrip(old, NOW);
  assert.equal(trip?.places[0].name, "浅草寺");
  assert.equal(trip?.days, 3);
  assert.equal(trip?.startDate, undefined);
});

test("a bad or long-past date is dropped and the trip still opens", () => {
  const wire = (date: unknown) => Buffer.from(JSON.stringify({ v: 1, c: "tokyo", n: "東京", d: 2, p: "standard", s: [["a", "場所a", 35.68, 139.76, 60, null, null, null, null]], h: null, t: date }), "utf8").toString("base64");
  for (const bad of ["2026-11-11", "2026-02-30", "tomorrow", 20261120, "2031-01-01", ""]) {
    const trip = decodeTrip(wire(bad), NOW);
    assert.equal(trip?.places.length, 1, String(bad));
    assert.equal(trip?.startDate, undefined, String(bad));
  }
  // Two days gone is a trip under way: it keeps its date.
  assert.equal(decodeTrip(wire("2026-11-12"), NOW)?.startDate, "2026-11-12");
  assert.equal(earliestStartDate(NOW), "2026-11-12");
  assert.equal(usableStartDate("2026-11-12", NOW), "2026-11-12");
  assert.equal(usableStartDate("2026-11-11", NOW), null);
});

test("the date field: a usable date is taken, an empty field clears it, a half-typed one changes nothing", () => {
  const dated = withStartDate(TRIP, "2026-11-20", NOW);
  assert.equal(dated.startDate, "2026-11-20");
  assert.equal(withStartDate(dated, "0002-11-20", NOW), dated);
  assert.equal(withStartDate(dated, "2020-01-01", NOW), dated);
  assert.deepEqual(withStartDate(dated, "", NOW), TRIP);
  // Another city is another list, but the same days away.
  assert.equal(withCity(dated, { id: "kyoto", ja: "京都", en: "Kyoto" } as PopularDestination, "ja").startDate, "2026-11-20");
  assert.equal("startDate" in withCity(TRIP, { id: "kyoto", ja: "京都", en: "Kyoto" } as PopularDestination, "ja"), false);
});

test("each day of the trip has its date and weekday", () => {
  assert.equal(tripDate("2026-11-29", 2), "2026-12-01");
  assert.equal(dateLabel("2026-11-20", "ja"), "11/20（金）");
  assert.equal(dateLabel("2026-11-20", "en"), "Fri 20 Nov");
  assert.equal(dateLabel("nope", "ja"), "");
});

test("the forecast horizon: days within 14 days are asked about, later ones say when", () => {
  // Today is 14 Nov: the forecast is asked for up to 28 Nov.
  const near = forecastWindow("2026-11-20", 3, NOW);
  assert.deepEqual(near.within.map((day) => day.date), ["2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.equal(near.later, null);
  const straddling = forecastWindow("2026-11-27", 4, NOW);
  assert.deepEqual(straddling.within, [{ index: 0, date: "2026-11-27" }, { index: 1, date: "2026-11-28" }]);
  // 29 Nov enters the horizon on 15 Nov: that day less fourteen.
  assert.deepEqual(straddling.later, { index: 2, date: "2026-11-29", availableOn: "2026-11-15" });
  const far = forecastWindow("2027-01-10", 2, NOW);
  assert.deepEqual(far.within, []);
  assert.deepEqual(far.later, { index: 0, date: "2027-01-10", availableOn: "2026-12-27" });
  // The same trip asked about on that day is inside the horizon.
  assert.equal(forecastWindow("2027-01-10", 2, new Date("2026-12-27T00:00:00Z")).within[0].date, "2027-01-10");
  assert.deepEqual(forecastWindow("2027-01-10", 2, new Date("2026-12-26T23:59:59Z")).within, []);
  // A trip under way: days already more than two days gone are not asked about.
  assert.deepEqual(forecastWindow("2026-11-12", 3, new Date("2026-11-15T12:00:00Z")).within.map((day) => day.index), [1, 2]);
  assert.deepEqual(forecastWindow("not a date", 3, NOW), { within: [], later: null });
});

/* --------------------------------------------------------- day assignment */

const slot = (outdoorMinutes: number, wet: boolean | null, fixed = false): WeatherSlot => ({ outdoorMinutes, wet, fixed });

test("a wet day counts by rain chance or by kind", () => {
  assert.equal(isWetForecast({ kind: "cloudy", precipitationPercent: 60 }), true);
  assert.equal(isWetForecast({ kind: "cloudy", precipitationPercent: 59 }), false);
  assert.equal(isWetForecast({ kind: "rain", precipitationPercent: null }), true);
  assert.equal(isWetForecast({ kind: "snow", precipitationPercent: 10 }), true);
  assert.equal(isWetForecast({ kind: "storm", precipitationPercent: 0 }), true);
  assert.equal(isWetForecast({ kind: "fog", precipitationPercent: null }), false);
});

test("the day with the least outdoors goes on the wet day, and the others stay", () => {
  const result = weatherDayOrder([slot(200, false), slot(240, true), slot(0, false)]);
  assert.deepEqual(result.order, [0, 2, 1]);
  assert.deepEqual(result.wetSlotsChanged, [1]);
  assert.equal(result.savedMinutes, 240);
});

test("a day the traveller pinned stays where it is, even in the rain", () => {
  // The outdoor day is pinned to the wet date: it stays, and nothing else gains by moving.
  assert.equal(weatherDayOrder([slot(0, false), slot(300, true, true), slot(100, false)]).changed, false);
  // A pinned dry day is not available to trade with.
  const result = weatherDayOrder([slot(0, false, true), slot(300, true), slot(100, false)]);
  assert.deepEqual(result.order, [0, 2, 1]);
});

test("less than an hour saved is not worth renumbering, and ties keep the order", () => {
  assert.equal(weatherDayOrder([slot(120, true), slot(61, false)]).changed, false);
  assert.deepEqual(weatherDayOrder([slot(120, true), slot(60, false)]).order, [1, 0]);
  assert.equal(weatherDayOrder([slot(90, true), slot(90, false), slot(90, false)]).changed, false);
  // Two equally indoor days: the one already on the wet date stays there.
  assert.deepEqual(weatherDayOrder([slot(200, false), slot(0, true), slot(0, false)]).order, [0, 1, 2]);
});

test("all wet, all dry or no forecast: nothing moves", () => {
  assert.equal(weatherDayOrder([slot(300, true), slot(0, true)]).changed, false);
  assert.equal(weatherDayOrder([slot(300, false), slot(0, false)]).changed, false);
  assert.equal(weatherDayOrder([slot(300, null), slot(0, null)]).changed, false);
  assert.equal(weatherDayOrder([]).changed, false);
  // A day without a forecast is not assumed dry: nothing is moved onto it.
  assert.equal(weatherDayOrder([slot(300, true), slot(0, null)]).changed, false);
});

test("two wet days take the two most indoor days with the fewest moves", () => {
  const result = weatherDayOrder([slot(300, true), slot(0, true), slot(30, false), slot(200, false)]);
  assert.deepEqual(result.order, [2, 1, 0, 3]);
  assert.deepEqual(result.wetSlotsChanged, [0]);
});

/* --------------------------------------------------------------- the plan */

const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
const networks = new Map<string, RailNetwork>();
/** `sure`: only sights whose kind says whether they are out of doors — the days the forecast is allowed to move. */
function realTrip(cityId: string, count: number, days: number, extra: Partial<ShioriInput> = {}, sure = false) {
  const city = cities.find((entry) => entry.id === cityId)!;
  if (!networks.has(cityId)) networks.set(cityId, new RailNetwork(JSON.parse(readFileSync(new URL(`../public/rail/${cityId}.json`, import.meta.url), "utf8"))));
  const places = curateSights(city.sights).map((sight) => placeFromSight(sight, "ja")).filter((entry) => !sure || weatherExposure(entry) !== "unknown").slice(0, count);
  const input: ShioriInput = { places, days, hotel: null, locale: "ja", ...extra };
  return { input, plan: (more: Partial<ShioriInput> = {}) => buildShioriPlan({ ...input, ...more }, { rail: networks.get(cityId)!, cities }) };
}
const HOTEL = { name: "新宿のホテル", lat: 35.6909, lon: 139.7003 };
const TRIPS = [
  () => realTrip("tokyo", 10, 3),
  () => realTrip("tokyo", 6, 2, { hotel: HOTEL }),
  () => realTrip("kyoto", 9, 3),
  () => realTrip("osaka", 8, 3),
  () => realTrip("paris", 9, 3),
  () => realTrip("tokyo", 10, 3, {}, true),
  () => realTrip("kyoto", 9, 3, {}, true),
  () => realTrip("paris", 9, 3, {}, true),
];
const weatherNotices = (plan: ShioriPlan) => plan.notices.filter((notice) => notice.kind === "weather-order");
/** A day without the two things that say which day it is. */
const body = (day: ShioriPlan["days"][number]) => JSON.stringify({ ...day, index: 0, engineDay: 0 });

test("without a forecast the plan is exactly the plan there has always been", () => {
  for (const make of TRIPS) {
    const trip = make();
    const plain = JSON.stringify(trip.plan());
    assert.equal(JSON.stringify(trip.plan({ wetDays: null })), plain);
    // A forecast with no day known, or with every day dry, changes nothing either.
    assert.equal(JSON.stringify(trip.plan({ wetDays: trip.input.places.map(() => null) })), plain);
    assert.equal(JSON.stringify(trip.plan({ wetDays: [false, false, false] })), plain);
    // Asked again after a forecast was used, the undated plan is still served unchanged.
    trip.plan({ wetDays: [false, true, true] });
    assert.equal(JSON.stringify(trip.plan()), plain);
  }
});

test("with a forecast the days are the same days; only their numbers differ, and the plan says so exactly then", () => {
  let moved = 0;
  for (const make of TRIPS) {
    const trip = make();
    const plain = trip.plan();
    const count = plain.days.length;
    for (let pattern = 1; pattern < 2 ** count - 1; pattern += 1) {
      const wetDays = Array.from({ length: count }, (_, index) => Boolean(pattern & (1 << index)));
      const plan = trip.plan({ wetDays });
      // The same groups in the same order with the same legs, clocks, lunch and hotel rides.
      assert.deepEqual(plan.days.map(body).sort(), plain.days.map(body).sort());
      assert.deepEqual(plan.days.map((day) => day.index), plain.days.map((day) => day.index));
      assert.equal(plan.days.reduce((sum, day) => sum + day.travelMinutes, 0), plain.days.reduce((sum, day) => sum + day.travelMinutes, 0));
      // Around the days: free days, ideas, what was left out and where to stay are as they were
      // (the stay area lists one point per day, so those come in the days' new order).
      const around = (whole: ShioriPlan) => ({
        ...whole, days: [], notices: [],
        stayNear: whole.stayNear && { ...whole.stayNear, routePoints: whole.stayNear.routePoints.map((point) => `${point.latitude},${point.longitude}`).sort() },
      });
      assert.deepEqual(around(plan), around(plain));
      const changed = plan.days.some((day, index) => body(day) !== body(plain.days[index]));
      assert.equal(weatherNotices(plan).length, changed ? 1 : 0, JSON.stringify(wetDays));
      // Every other notice is as it was.
      assert.deepEqual(plan.notices.filter((notice) => notice.kind !== "weather-order"), plain.notices);
      if (changed) {
        moved += 1;
        const [notice] = weatherNotices(plan) as Array<{ kind: "weather-order"; days: number[] }>;
        // The days it names are wet, and now hold another group than before.
        for (const day of notice.days) {
          assert.equal(wetDays[day - 1], true);
          assert.notEqual(body(plan.days[day - 1]), body(plain.days[day - 1]));
        }
      }
    }
  }
  assert.ok(moved >= 4, `only ${moved} forecasts changed a plan`);
});

test("Tokyo in the rain: the theme-park day leaves the wet date", () => {
  const trip = realTrip("tokyo", 10, 3, {}, true);
  const plain = trip.plan();
  const park = plain.days.findIndex((day) => day.stops.some((stop) => /ディズニー/.test(stop.place.name)));
  assert.ok(park >= 0);
  const plan = trip.plan({ wetDays: plain.days.map((_, index) => index === park) });
  assert.equal(plan.days[park].stops.some((stop) => /ディズニー/.test(stop.place.name)), false);
  assert.deepEqual(weatherNotices(plan), [{ kind: "weather-order", days: [park + 1] }]);
});

test("a place pinned to a day keeps its day whatever the forecast", () => {
  const trip = realTrip("tokyo", 10, 3, {}, true);
  const plain = trip.plan();
  const park = plain.days.findIndex((day) => day.stops.some((stop) => /ディズニー/.test(stop.place.name)));
  const pinned = { places: trip.input.places.map((entry) => (/ディズニー/.test(entry.name) ? { ...entry, day: park + 1 } : entry)) };
  const before = trip.plan(pinned);
  const plan = trip.plan({ ...pinned, wetDays: plain.days.map((_, index) => index === park) });
  assert.equal(plan.days.find((day) => day.stops.some((stop) => /ディズニー/.test(stop.place.name)))!.index, park);
  assert.equal(JSON.stringify(plan), JSON.stringify(before));
});

/* ------------------------------------------------------------ the request */

const answerDay = (index: number, date: string, more: Partial<TripWeatherDay> = {}): TripWeatherDay => ({
  index, date, code: 3, kind: "cloudy", temperatureMaxC: 16, temperatureMinC: 9, precipitationPercent: 20, ...more,
});

test("the forecast is asked for the city's rounded centre, once, and kept for the visit", async () => {
  const centre = forecastCentre({ lat: 35.689487, lon: 139.691711 }, [])!;
  assert.deepEqual(centre, { latitude: 35.69, longitude: 139.69 });
  // Without a city: the middle of the places, as coarsely.
  assert.deepEqual(forecastCentre(null, [{ lat: 35.71, lon: 139.8 }, { lat: 35.65, lon: 139.74 }]), { latitude: 35.68, longitude: 139.77 });
  assert.equal(forecastCentre(null, []), null);

  const cache: ForecastCache = new Map();
  const asked: unknown[] = [];
  const request = async (payload: { days: Array<{ index: number; date: string }> }) => {
    asked.push(payload);
    return Object.fromEntries(payload.days.map((day) => [day.index, answerDay(day.index, day.date, day.index === 1 ? { kind: "rain", code: 63, precipitationPercent: 80 } : {})]));
  };
  const days = forecastWindow("2026-11-20", 2, NOW).within;
  const first = await loadForecast(centre, days, cache, request, () => NOW);
  assert.deepEqual(asked, [{ days: [{ index: 0, date: "2026-11-20", latitude: 35.69, longitude: 139.69 }, { index: 1, date: "2026-11-21", latitude: 35.69, longitude: 139.69 }] }]);
  assert.equal(first.failed, false);
  assert.equal(first.byIndex[1].kind, "rain");
  assert.equal(first.byIndex[0].fetchedAt, NOW.toISOString());
  assert.deepEqual(wetDaysOf(first.byIndex, 3), [false, true, null]);
  // The same days again: nothing is asked.
  await loadForecast(centre, days, cache, request, () => NOW);
  assert.equal(asked.length, 1);
  // A trip moved one day later asks only about the one new date, and the
  // known date answers for its new day number.
  const shifted = await loadForecast(centre, forecastWindow("2026-11-21", 2, NOW).within, cache, request, () => NOW);
  assert.deepEqual((asked[1] as { days: Array<{ date: string }> }).days.map((day) => day.date), ["2026-11-22"]);
  assert.equal(shifted.byIndex[0].kind, "rain");
  // No days inside the horizon: no request at all.
  const none = await loadForecast(centre, [], cache, request, () => NOW);
  assert.deepEqual(none, { byIndex: {}, failed: false });
  assert.equal(asked.length, 2);
  assert.equal(wetDaysOf({}, 3), null);
});

test("a forecast that does not arrive is a quiet failure, and an answer for another date is not used", async () => {
  const centre = { latitude: 35.69, longitude: 139.69 };
  const days = [{ index: 0, date: "2026-11-20" }];
  assert.deepEqual(await loadForecast(centre, days, new Map(), async () => ({})), { byIndex: {}, failed: true });
  assert.deepEqual(await loadForecast(centre, days, new Map(), async () => { throw new Error("offline"); }), { byIndex: {}, failed: true });
  assert.deepEqual(await loadForecast(centre, days, new Map(), async () => ({ 0: answerDay(0, "2026-11-19") })), { byIndex: {}, failed: true });
});

test("on the static site the browser asks Open-Meteo itself, and reads its answer", async () => {
  const realFetch = globalThis.fetch;
  const hosting = process.env.NEXT_PUBLIC_TRIPCHECK_STATIC_HOSTING;
  process.env.NEXT_PUBLIC_TRIPCHECK_STATIC_HOSTING = "1";
  // Dates inside the real horizon: the transport checks them against the real clock.
  const today = new Date();
  const start = tripDate(today.toISOString().slice(0, 10), 1)!;
  const days = forecastWindow(start, 2, today).within;
  const urls: string[] = [];
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ daily: {
        time: days.map((day) => day.date),
        weather_code: [1, 63],
        temperature_2m_max: [17.4, 12.6],
        temperature_2m_min: [9.2, 8.1],
        precipitation_probability_max: [10, 85],
      } });
    }) as typeof fetch;
    const answer = await loadForecast({ latitude: 35.69, longitude: 139.69 }, days, new Map());
    assert.equal(urls.length, 1);
    const url = new URL(urls[0]);
    assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
    // A rounded coordinate and the dates: nothing else about the trip.
    assert.deepEqual([...url.searchParams.keys()].sort(), ["daily", "end_date", "latitude", "longitude", "start_date", "timezone"]);
    assert.equal(url.searchParams.get("latitude"), "35.69");
    assert.equal(url.searchParams.get("longitude"), "139.69");
    assert.equal(url.searchParams.get("start_date"), days[0].date);
    assert.equal(url.searchParams.get("end_date"), days[1].date);
    assert.equal(answer.failed, false);
    assert.deepEqual(
      [answer.byIndex[0], answer.byIndex[1]].map((day) => [day.kind, day.temperatureMaxC, day.temperatureMinC, day.precipitationPercent]),
      [["partly", 17, 9, 10], ["rain", 13, 8, 85]],
    );
    assert.deepEqual(wetDaysOf(answer.byIndex, 2), [false, true]);

    // The provider is down, or unreachable: no forecast, no error.
    globalThis.fetch = (async () => new Response("no", { status: 503 })) as typeof fetch;
    assert.deepEqual(await loadForecast({ latitude: 35.69, longitude: 139.69 }, days, new Map()), { byIndex: {}, failed: true });
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    assert.deepEqual(await requestWeatherPayload({ days: days.map((day) => ({ ...day, latitude: 35.69, longitude: 139.69 })) }), {});
    assert.deepEqual(await loadForecast({ latitude: 35.69, longitude: 139.69 }, days, new Map()), { byIndex: {}, failed: true });
  } finally {
    globalThis.fetch = realFetch;
    if (hosting === undefined) delete process.env.NEXT_PUBLIC_TRIPCHECK_STATIC_HOSTING;
    else process.env.NEXT_PUBLIC_TRIPCHECK_STATIC_HOSTING = hosting;
  }
});

/* ------------------------------------------------- what the reviewer found */

test("a place of unknown kind is not counted as indoors: its day is never moved onto the wet date", () => {
  assert.equal(weatherExposure({ kind: "park" }), "outdoor");
  assert.equal(weatherExposure({ kind: "art museum" }), "indoor");
  // Both: under a roof. A table to eat or drink at: under a roof.
  assert.equal(weatherExposure({ kind: "museum in a park" }), "indoor");
  assert.equal(weatherExposure({ kind: "cafe" }), "indoor");
  assert.equal(weatherExposure({ kind: "Café" }), "indoor");
  assert.equal(weatherExposure({ kind: "market", meal: "lunch" }), "indoor");
  assert.equal(weatherExposure({ kind: "restaurant" }), "indoor");
  // Typed by name, or a kind that says neither.
  assert.equal(weatherExposure({}), "unknown");
  // Kinds whose weather is plain, among the cities' best-known sights.
  assert.equal(weatherExposure({ kind: "observation tower" }), "indoor");
  assert.equal(weatherExposure({ kind: "minor basilica" }), "indoor");
  assert.equal(weatherExposure({ kind: "catholic cathedral" }), "indoor");
  assert.equal(weatherExposure({ kind: "archaeological site" }), "outdoor");
  assert.equal(weatherExposure({ kind: "fortress" }), "outdoor");
  assert.equal(weatherExposure({ kind: "historic district" }), "outdoor");
  // Kinds that could go either way stay unknown, and their day stays put.
  assert.equal(weatherExposure({ kind: "stadium" }), "unknown");
  assert.equal(weatherExposure({ kind: "onsen" }), "unknown");
  assert.equal(weatherExposure({ kind: "cave" }), "unknown");
  assert.equal(weatherExposure({ kind: "bell tower" }), "unknown");

  // Two days far apart: a garden day in the north, and in the south a day
  // whose places are either museums or typed by name.
  const north = (id: string, kind?: string): ShioriPlace => ({ id, name: id, lat: 35.75 + Number(id.slice(-1)) * 0.002, lon: 139.72, stayMinutes: 120, ...(kind ? { kind } : {}) });
  const south = (id: string, kind?: string): ShioriPlace => ({ id, name: id, lat: 35.60 + Number(id.slice(-1)) * 0.002, lon: 139.74, stayMinutes: 120, ...(kind ? { kind } : {}) });
  const gardens = [north("g1", "garden"), north("g2", "park"), north("g3", "shinto shrine")];
  const plan = (others: ShioriPlace[], wetDays: boolean[] | null) => buildShioriPlan({ places: [...gardens, ...others], days: 2, hotel: null, locale: "ja", wetDays }, { cities });
  const dayOf = (whole: ShioriPlan, id: string) => whole.days.find((day) => day.stops.some((stop) => stop.place.id === id))!.index;

  const museums = [south("m1", "museum"), south("m2", "art museum"), south("m3", "aquarium")];
  const plain = plan(museums, null);
  assert.equal(plain.days.length, 2);
  const gardenDay = dayOf(plain, "g1");
  assert.notEqual(dayOf(plain, "m1"), gardenDay);
  const wetOnGardens = [0, 1].map((index) => index === gardenDay);
  // Known to be indoors: the museum day takes the wet date, and the plan says so.
  const swapped = plan(museums, wetOnGardens);
  assert.equal(dayOf(swapped, "m1"), gardenDay);
  assert.equal(swapped.notices.filter((notice) => notice.kind === "weather-order").length, 1);

  // The same day with one place typed by name: nothing is known about it, so
  // nothing moves and nothing is claimed.
  const typed = [south("m1", "museum"), south("m2", "art museum"), south("t3")];
  const before = plan(typed, null);
  const after = plan(typed, [0, 1].map((index) => index === dayOf(before, "g1")));
  assert.equal(dayOf(after, "g1"), dayOf(before, "g1"));
  assert.equal(JSON.stringify(after), JSON.stringify(before));
  // A lunch place and a café on that day are known to be under a roof: it moves again.
  const tables = [south("m1", "museum"), { ...south("r2", "restaurant"), meal: "lunch" as const }, south("c3", "cafe")];
  const lunchPlain = plan(tables, null);
  const lunchWet = plan(tables, [0, 1].map((index) => index === dayOf(lunchPlain, "g1")));
  assert.notEqual(dayOf(lunchWet, "g1"), dayOf(lunchPlain, "g1"));
});

test("a forecast is fresh for three hours, then asked for again; an expired one that cannot be renewed is not shown", async () => {
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60 * 1000);
  assert.equal(FORECAST_FRESH_MS, 3 * 60 * 60 * 1000);
  assert.equal(isForecastFresh(NOW.toISOString(), at(0)), true);
  assert.equal(isForecastFresh(NOW.toISOString(), at(179)), true);
  assert.equal(isForecastFresh(NOW.toISOString(), at(180)), false);
  assert.equal(isForecastFresh("", at(0)), false);

  const centre = { latitude: 35.69, longitude: 139.69 };
  const days = [{ index: 0, date: "2026-11-20" }, { index: 1, date: "2026-11-21" }];
  const cache: ForecastCache = new Map();
  let asked = 0;
  let online = true;
  const request = async (payload: { days: Array<{ index: number; date: string }> }) => {
    asked += 1;
    if (!online) throw new Error("offline");
    return Object.fromEntries(payload.days.map((day) => [day.index, answerDay(day.index, day.date)]));
  };
  await loadForecast(centre, days, cache, request, () => at(0));
  await loadForecast(centre, days, cache, request, () => at(179));
  assert.equal(asked, 1);
  // Three hours on: both days are asked for again, in one request, and carry the new time.
  const renewed = await loadForecast(centre, days, cache, request, () => at(180));
  assert.equal(asked, 2);
  assert.equal(renewed.byIndex[0].fetchedAt, at(180).toISOString());
  assert.equal(renewed.byIndex[1].fetchedAt, at(180).toISOString());
  // Expired again and the provider is away: the old answer is not passed off as current.
  online = false;
  assert.deepEqual(await loadForecast(centre, days, cache, request, () => at(400)), { byIndex: {}, failed: true });
});

test("the fetched label carries the date as well as the time, in the reader's own clock", () => {
  const local = new Date(2026, 10, 14, 9, 12);
  assert.equal(fetchedStamp(local.toISOString(), "ja"), "11/14 09:12");
  assert.equal(fetchedStamp(local.toISOString(), "en"), "Nov 14, 09:12");
  assert.equal(fetchedStamp("never", "ja"), "");
});

test("a wet day is called what its forecast says, and only rain is called rain", () => {
  assert.equal(wetReason({ kind: "rain" }), "rain");
  assert.equal(wetReason({ kind: "snow" }), "snow");
  assert.equal(wetReason({ kind: "storm" }), "storm");
  // Wet only by its chance of precipitation.
  assert.equal(isWetForecast({ kind: "cloudy", precipitationPercent: 60 }), true);
  assert.equal(wetReason({ kind: "cloudy" }), "chance");
  assert.equal(wetReason({ kind: "fog" }), "chance");
});

test("the forecast window stops a day short of the provider's range, whatever the hour and wherever the trip", () => {
  assert.equal(FORECAST_DAYS_AHEAD, 14);
  // One second into 14 Nov UTC it is still 13 Nov in Honolulu, whose
  // forecast reaches 13 + 15 = 28 Nov: that is the last date asked for.
  for (const now of [new Date("2026-11-14T00:00:01Z"), new Date("2026-11-14T23:59:59Z")]) {
    const window = forecastWindow("2026-11-26", 5, now);
    assert.deepEqual(window.within.map((day) => day.date), ["2026-11-26", "2026-11-27", "2026-11-28"]);
    // The first day left out, and the day its forecast begins: that day less the same fourteen.
    assert.deepEqual(window.later, { index: 3, date: "2026-11-29", availableOn: "2026-11-15" });
    // On that day it is indeed inside the window.
    assert.equal(forecastWindow("2026-11-26", 5, new Date("2026-11-15T00:00:00Z")).within.at(-1)!.date, "2026-11-29");
  }
});
