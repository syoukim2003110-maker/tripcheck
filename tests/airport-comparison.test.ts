import assert from "node:assert/strict";
import test from "node:test";
import { compareAirportOptions } from "../lib/airport-comparison.ts";
import { destinationAirportComparisonGroup, destinationById } from "../lib/destinations.ts";

const japan = destinationById("japan");

test("returns only airports serving the same metropolitan base", () => {
  const cases = [
    ["japan", "HND", ["HND", "NRT"]],
    ["japan", "KIX", ["KIX", "ITM"]],
    ["korea", "ICN", ["ICN", "GMP"]],
    ["taiwan", "TSA", ["TPE", "TSA"]],
    ["thailand", "DMK", ["BKK", "DMK"]],
    ["france", "CDG", ["CDG", "ORY"]],
    ["uk", "LGW", ["LHR", "LGW"]],
  ] as const;

  for (const [destinationId, anchor, expectedCodes] of cases) {
    const codes = destinationAirportComparisonGroup(destinationById(destinationId), anchor)
      .map((airport) => airport.code);
    assert.deepEqual(codes, [...expectedCodes]);
  }
});

test("does not substitute an airport in another city for an unpaired gateway", () => {
  assert.deepEqual(destinationAirportComparisonGroup(japan, "FUK"), []);
  assert.deepEqual(destinationAirportComparisonGroup(destinationById("usa"), "JFK"), []);
  assert.deepEqual(destinationAirportComparisonGroup(destinationById("france"), "NCE"), []);
});

test("uses the destination's first metro group only when no airport is selected", () => {
  assert.deepEqual(
    destinationAirportComparisonGroup(japan).map((airport) => airport.code),
    ["HND", "NRT"],
  );
  assert.deepEqual(
    destinationAirportComparisonGroup(japan, "none").map((airport) => airport.code),
    ["HND", "NRT"],
  );
});

test("compares international arrivals by the time the traveller reaches the city", () => {
  const result = compareAirportOptions({
    destination: japan,
    direction: "arrival",
    flightKind: "international",
    options: [
      { id: "hnd", airportCode: "HND", scheduledLocalTime: "10:00" },
      { id: "nrt", airportCode: "NRT", scheduledLocalTime: "09:30" },
    ],
  });

  assert.equal(result.timeWinnerId, "hnd");
  assert.deepEqual(result.options.map((option) => [option.id, option.cityBoundaryTime, option.timeDisadvantageMinutes]), [
    ["hnd", "12:30", 0],
    ["nrt", "12:45", 15],
  ]);
});

test("compares international departures by the time the traveller leaves the city", () => {
  const result = compareAirportOptions({
    destination: japan,
    direction: "departure",
    flightKind: "international",
    options: [
      { id: "hnd", airportCode: "HND", scheduledLocalTime: "18:00" },
      { id: "nrt", airportCode: "NRT", scheduledLocalTime: "19:00" },
    ],
  });

  assert.equal(result.timeWinnerId, "nrt");
  assert.deepEqual(result.options.map((option) => [option.id, option.cityBoundaryTime, option.timeDisadvantageMinutes]), [
    ["hnd", "14:00", 75],
    ["nrt", "15:15", 0],
  ]);
});

test("uses the domestic processing assumptions", () => {
  const arrival = compareAirportOptions({
    destination: japan,
    direction: "arrival",
    flightKind: "domestic",
    options: [{ id: "arrival", airportCode: "HND", scheduledLocalTime: "10:00" }],
  }).options[0];
  const departure = compareAirportOptions({
    destination: japan,
    direction: "departure",
    flightKind: "domestic",
    options: [{ id: "departure", airportCode: "HND", scheduledLocalTime: "18:00" }],
  }).options[0];

  assert.equal(arrival?.processingMinutes, 45);
  assert.equal(arrival?.cityBoundaryTime, "11:45");
  assert.equal(departure?.processingMinutes, 90);
  assert.equal(departure?.cityBoundaryTime, "15:30");
});

test("keeps calendar rollover visible", () => {
  const arrival = compareAirportOptions({
    destination: japan,
    direction: "arrival",
    flightKind: "international",
    options: [{ id: "late", airportCode: "HND", scheduledLocalTime: "23:30" }],
  }).options[0];
  const departure = compareAirportOptions({
    destination: japan,
    direction: "departure",
    flightKind: "international",
    options: [{ id: "early", airportCode: "NRT", scheduledLocalTime: "02:00" }],
  }).options[0];

  assert.equal(arrival?.cityBoundaryTime, "02:00");
  assert.equal(arrival?.cityDayOffset, 1);
  assert.equal(departure?.cityBoundaryTime, "22:15");
  assert.equal(departure?.cityDayOffset, -1);
});

test("drops invalid airports and times without inventing a result", () => {
  const result = compareAirportOptions({
    destination: japan,
    direction: "arrival",
    flightKind: "international",
    options: [
      { id: "wrong-country", airportCode: "ZRH", scheduledLocalTime: "10:00" },
      { id: "bad-time", airportCode: "HND", scheduledLocalTime: "25:00" },
    ],
  });

  assert.equal(result.timeWinnerId, null);
  assert.deepEqual(result.options, []);
});

test("preserves input order and marks every tied option", () => {
  const result = compareAirportOptions({
    destination: japan,
    direction: "arrival",
    flightKind: "international",
    options: [
      { id: "first", airportCode: "HND", scheduledLocalTime: "10:00" },
      { id: "second", airportCode: "NRT", scheduledLocalTime: "09:15" },
    ],
  });

  assert.equal(result.timeWinnerId, "first");
  assert.deepEqual(result.options.map((option) => option.id), ["first", "second"]);
  assert.deepEqual(result.options.map((option) => option.isTimeWinner), [true, true]);
});
