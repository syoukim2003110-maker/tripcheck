import assert from "node:assert/strict";
import test from "node:test";
import { fullTripDemo, getMockHotels } from "../lib/mock-trip.ts";

test("provides a complete hotel and flight scenario for the one-click demo", () => {
  assert.equal(fullTripDemo.tripDays, 4);
  assert.equal(fullTripDemo.tripStartDate, "2026-09-14");
  assert.equal(fullTripDemo.arrivalAirport, "HND");
  assert.equal(fullTripDemo.departureAirport, "NRT");
  assert.equal(fullTripDemo.hotelQuery.en, "Shinjuku Station");
  assert.match(fullTripDemo.places.en, /Day 2 10:00 booked/);
  assert.match(fullTripDemo.places.ja, /2日目 10:00 予約/);
});

test("returns mock properties in the calculated base-area order", () => {
  const hotels = getMockHotels("en", ["base-ueno", "base-shinjuku", "base-shibuya"]);

  assert.deepEqual(hotels.map((hotel) => hotel.baseId), ["base-ueno", "base-shinjuku", "base-shibuya"]);
  assert.ok(hotels.every((hotel) => hotel.nightlyPriceJpy > 0));
  assert.ok(hotels.every((hotel) => hotel.stationWalkMinutes > 0));
});
