import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fetchAppleHotelCandidates, rerankHotelCandidates } from "../lib/apple-hotels.ts";
import { buildShioriPlan, departureAfterStop, MAX_TRIP_DAYS, type ShioriPlace } from "../lib/shiori/plan.ts";
import { decodeTrip, emptyTrip, encodeTrip, keepAside, MAX_DAYS, safePlaceId, storageStep, type ShioriTrip } from "../lib/shiori/state.ts";

const sight = (index: number, stayMinutes: number): ShioriPlace => ({
  id: `wikidata-Q${index}`, name: `Sight ${index}`, lat: 35.66 + index * 0.004, lon: 139.7 + index * 0.004, stayMinutes, kind: "museum",
});
const tripOf = (places: ShioriPlace[], days = 3): ShioriTrip => ({ ...emptyTrip, cityId: "tokyo", cityName: "Tokyo", places, days });
/** Base64url of a hand-made saved form, as an earlier build or a stranger's link could hold it. */
const wire = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

/* ---- one limit for days: what is offered can be kept ---- */

test("a 'needs more days' notice never offers a length that cannot be saved", () => {
  assert.equal(MAX_DAYS, MAX_TRIP_DAYS);
  // The trips that lost their saved copy: full-day places on a 6- and 7-day trip were told "make it 8 / 9 days".
  for (const [count, days] of [[8, 7], [9, 7], [8, 6]] as const) {
    const trip = tripOf(Array.from({ length: count }, (_, index) => sight(index, 480)), days);
    const plan = buildShioriPlan({ places: trip.places, days: trip.days, hotel: null, locale: "en" });
    for (const notice of plan.notices) {
      if (notice.kind !== "needs-days") continue;
      assert.ok(notice.days <= MAX_DAYS, `${count} places on ${days} days offered ${notice.days}`);
      assert.notEqual(decodeTrip(encodeTrip({ ...trip, days: notice.days })), null);
    }
  }
  // A shorter trip is still told what it needs.
  const short = buildShioriPlan({ places: Array.from({ length: 3 }, (_, index) => sight(index, 480)), days: 2, hotel: null, locale: "en" });
  assert.deepEqual(short.notices.filter((notice) => notice.kind === "needs-days"), [{ kind: "needs-days", days: 3 }]);
});

test("a trip saved with more days than the limit opens with its places, shortened", () => {
  const stored = wire({ v: 1, c: "tokyo", n: "Tokyo", d: 8, p: "standard", s: [["a", "A", 35.6, 139.7, 60, 8, null, null], ["b", "B", 35.61, 139.71, 60, 2, null, null]], h: null });
  const trip = decodeTrip(stored);
  assert.ok(trip);
  assert.equal(trip.days, MAX_DAYS);
  assert.deepEqual(trip.places.map((place) => [place.id, place.day]), [["a", undefined], ["b", 2]]);
  // Whatever is in memory, what is written can be read.
  assert.equal(decodeTrip(encodeTrip({ ...tripOf([sight(1, 60)]), days: 9 }))?.days, MAX_DAYS);
  assert.equal(decodeTrip(wire({ v: 1, c: null, n: "", d: 15, p: "standard", s: [], h: null })), null);
});

/* ---- one place cannot make the saved trip unreadable ---- */

test("an over-long name is shortened when saved, never the reason a trip is lost", () => {
  const long = "居酒屋".repeat(100);
  // 119 letters then emoji: a cut at 120 code units would split the first emoji in two.
  const emoji = `${"a".repeat(119)}${"🍜".repeat(10)}`;
  const exact = "b".repeat(120);
  const trip: ShioriTrip = {
    ...tripOf([
      { ...sight(1, 60), name: long },
      { ...sight(2, 60), name: emoji },
      { ...sight(3, 60), name: exact },
      { ...sight(4, 60), kind: "k".repeat(81) },
      { ...sight(5, 60), name: `  ${"c".repeat(118)}  x` },
    ]),
    hotel: { name: "H".repeat(300), lat: 35.6, lon: 139.7 },
  };
  const read = decodeTrip(encodeTrip(trip));
  assert.ok(read);
  assert.equal(read.places.length, 5);
  assert.ok(read.places.every((place) => place.name.length > 0 && place.name.length <= 120));
  assert.equal(read.places[0].name, long.slice(0, 120));
  assert.equal(read.places[1].name, "a".repeat(119));
  assert.equal(read.places[2].name, exact);
  assert.equal(read.places[3].kind, undefined);
  assert.equal(read.hotel?.name, "H".repeat(120));
  // Saving what was read changes nothing more.
  assert.equal(encodeTrip(read), encodeTrip(trip));
});

test("an id from outside is put in the form the saved trip accepts", () => {
  const id = safePlaceId(`hotpepper-J00/1+2=3 ${"x".repeat(200)}`);
  assert.match(id, /^[\w.:,@-]{1,160}$/);
  assert.equal(safePlaceId("hotpepper-J001234567"), "hotpepper-J001234567");
  assert.equal(safePlaceId("apple-35.12345,139.12345"), "apple-35.12345,139.12345");
  assert.equal(decodeTrip(encodeTrip(tripOf([sight(1, 60), { ...sight(2, 60), id }])))?.places.length, 2);
});

/* ---- the stored trip follows the trip in hand, but a fresh home screen wipes nothing ---- */

test("removing the last place clears the stored trip; arriving on the home screen does not", () => {
  const full = tripOf([sight(1, 60)]);
  assert.equal(storageStep(emptyTrip, false), "none");
  assert.equal(storageStep(full, false), "write");
  assert.equal(storageStep(full, true), "write");
  assert.equal(storageStep({ ...full, places: [] }, true), "clear");
  // Once cleared, an empty trip has nothing more to clear.
  assert.equal(storageStep({ ...full, places: [] }, false), "none");
});

test("a trip that is about to be replaced is kept aside as the previous one", () => {
  const saved = tripOf([sight(1, 60), sight(2, 60)]);
  const current = { ...tripOf([sight(3, 60)]), cityId: "kyoto", cityName: "Kyoto" };
  const fresh = { ...emptyTrip, cityId: "osaka", cityName: "Osaka" };
  // A returning traveller picks a city instead of "continue": the saved trip must survive the first tap.
  assert.equal(keepAside(emptyTrip, saved, fresh), saved);
  // Another city with a trip in hand keeps that one, not the page-load copy.
  assert.equal(keepAside(current, saved, fresh), current);
  // Opening the previous trip swaps: the current one becomes the previous.
  assert.equal(keepAside(current, null, saved), current);
  assert.equal(keepAside(emptyTrip, current, saved), current);
  // Nothing to lose: nothing held, or the same trip again.
  assert.equal(keepAside(emptyTrip, null, fresh), null);
  assert.equal(keepAside(current, null, current), null);
  assert.equal(keepAside(emptyTrip, saved, decodeTrip(encodeTrip(saved))!), null);
});

/* ---- the way back to the hotel leaves when lunch ends ---- */

test("a leg after a suggested lunch leaves when lunch ends, the hotel leg included", () => {
  const hotel = { name: "Hotel", lat: 35.668, lon: 139.705 };
  const plan = buildShioriPlan({ places: [sight(1, 180)], days: 1, hotel, locale: "en" });
  const day = plan.days[0];
  const last = day.stops.length - 1;
  const lunch = day.meals.find((meal) => meal.afterStop === last && meal.kind === "lunch");
  assert.ok(lunch?.end, "the day ends with a lunch hour");
  assert.ok(day.toHotel);
  assert.equal(departureAfterStop(day, last), lunch.end);
  assert.notEqual(lunch.end, day.stops[last].leave);
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  // The card's "13:05–13:30" must end when the day does.
  assert.equal(minutes(departureAfterStop(day, last)!) + day.toHotel.minutes, minutes(day.end));

  const stops = [{ leave: "10:00" }, { leave: "12:05" }, { leave: "15:00" }] as never;
  const meals = [{ kind: "lunch", start: "12:05", end: "13:05", afterStop: 1 }, { kind: "dinner", start: "18:30", end: null, afterStop: 2 }] as never;
  assert.equal(departureAfterStop({ stops, meals }, 0), "10:00");
  assert.equal(departureAfterStop({ stops, meals }, 1), "13:05");
  // A dinner slot is not on the clock: the leg leaves when the stop ends.
  assert.equal(departureAfterStop({ stops, meals }, 2), "15:00");
});

/* ---- hotels are ranked against the days as they are now ---- */

test("hotels already found are ranked again for moved days without another search", async () => {
  let searches = 0;
  const client = {
    async search() {
      searches += 1;
      return [
        { id: "west", name: "West Hotel", latitude: 35.0, longitude: 135.0, formattedAddress: "", poiCategory: "Hotel" },
        { id: "east", name: "East Hotel", latitude: 35.0, longitude: 135.02, formattedAddress: "", poiCategory: "Hotel" },
      ];
    },
  };
  const request = (routePoints: Array<{ latitude: number; longitude: number }>) => ({
    latitude: 35.0, longitude: 135.01, radiusMeters: 5_000, languageCode: "en", regionCode: "JP", area: "trip", routePoints,
  }) as never;
  const west = [{ latitude: 35.0, longitude: 134.99 }];
  const east = [{ latitude: 35.0, longitude: 135.03 }, { latitude: 35.0, longitude: 135.04 }];
  const first = await fetchAppleHotelCandidates(request(west), client);
  assert.deepEqual(first.map((hotel) => hotel.name), ["West Hotel", "East Hotel"]);
  const before = searches;
  const again = rerankHotelCandidates(first, east);
  assert.equal(searches, before);
  assert.deepEqual(again.map((hotel) => hotel.name), ["East Hotel", "West Hotel"]);
  // Exactly what a fresh search with today's days would print.
  const fresh = await fetchAppleHotelCandidates(request(east), client);
  assert.deepEqual(
    again.map((hotel) => [hotel.name, hotel.routeAverageDistanceMeters, hotel.routeWorstDistanceMeters, hotel.routeBurdenMeters, hotel.score]),
    fresh.map((hotel) => [hotel.name, hotel.routeAverageDistanceMeters, hotel.routeWorstDistanceMeters, hotel.routeBurdenMeters, hotel.score]),
  );
  // The first answer is not rewritten in place: it is the pool the next re-plan ranks from.
  assert.deepEqual(first.map((hotel) => hotel.name), ["West Hotel", "East Hotel"]);
});

/* ---- what of a restaurant listing is kept ---- */

test("a restaurant added from the listing is kept as a stop only: name, position, id", () => {
  // What the meal picker writes for a shop the traveller chose.
  const stop: ShioriPlace = { id: safePlaceId("hotpepper-J001234567"), name: "焼鳥 とり吉 渋谷店", lat: 35.65912, lon: 139.70056, stayMinutes: 60, kind: "restaurant", meal: "lunch", day: 2 };
  const listing = { ...stop, photo: "https://imgfp.hotp.jp/x.jpg", budget: "3001～4000円", genre: "焼鳥", catch: "名物", open: "17:00～23:00", url: "https://www.hotpepper.jp/strJ001234567/" };
  const read = decodeTrip(encodeTrip(tripOf([listing])));
  assert.deepEqual(read?.places, [stop]);
  // The listing itself is never written anywhere by the client.
  const source = readFileSync(new URL("../lib/hotpepper-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  // The written policy says what is kept and where.
  const privacy = readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
  assert.match(privacy, /A restaurant you choose to add to your trip becomes one of its stops/);
  assert.match(privacy, /kept with the trip in your browser and are part of any link to the trip you share/);
});
