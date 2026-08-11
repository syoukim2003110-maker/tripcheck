import assert from "node:assert/strict";
import test from "node:test";
import { tripScopeWarnings } from "../lib/trip-scope.ts";

// A fixed instant keeps the DST-dependent offset comparison deterministic.
const reference = new Date("2026-08-12T00:00:00Z");
const stop = (countryCode?: string) => ({ countryCode });

test("stays silent for a single-country trip", () => {
  assert.deepEqual(tripScopeWarnings([stop("JP"), stop("JP"), stop()], [], reference), []);
});

test("stays silent with no stops and no evidence", () => {
  assert.deepEqual(tripScopeWarnings([], undefined, reference), []);
});

test("warns about a border when stops resolve into two countries", () => {
  // Japan and Korea share a UTC offset, so only the border warning fires.
  assert.deepEqual(tripScopeWarnings([stop("JP"), stop("KR")], [], reference), [
    { kind: "border", countryCodes: ["JP", "KR"] },
  ]);
});

test("warns about a border for countries outside the destination catalogue", () => {
  assert.deepEqual(tripScopeWarnings([stop("BR"), stop("AR")], [], reference), [
    { kind: "border", countryCodes: ["AR", "BR"] },
  ]);
});

test("treats countries grouped into one destination profile as one territory", () => {
  // A Rome trip that includes the Vatican is not a border crossing: the
  // destination model declares IT+VA+SM one coverage profile.
  assert.deepEqual(tripScopeWarnings([stop("IT"), stop("VA")], [], reference), []);
});

test("adds a time-zone warning only when destination clocks actually differ", () => {
  assert.deepEqual(tripScopeWarnings([stop("JP"), stop("FR")], [], reference), [
    { kind: "border", countryCodes: ["FR", "JP"] },
    { kind: "timezone", timeZones: ["Asia/Tokyo", "Europe/Paris"] },
  ]);
  // Paris and Rome are distinct IANA zones on the same clock: border only.
  assert.deepEqual(tripScopeWarnings([stop("FR"), stop("IT")], [], reference), [
    { kind: "border", countryCodes: ["FR", "IT"] },
  ]);
});

test("warns when live transit evidence contains a ferry ride", () => {
  assert.deepEqual(
    tripScopeWarnings([stop("JP")], [{ vehicleType: "HEAVY_RAIL" }, { vehicleType: "FERRY" }], reference),
    [{ kind: "ferry" }],
  );
});

test("ignores non-ferry vehicles, unknown vehicles and missing evidence", () => {
  assert.deepEqual(tripScopeWarnings([stop("JP")], [{ vehicleType: "HEAVY_RAIL" }, { vehicleType: null }], reference), []);
  assert.deepEqual(tripScopeWarnings([stop("JP")], null, reference), []);
});

test("normalizes malformed country codes instead of warning on them", () => {
  assert.deepEqual(tripScopeWarnings([stop(" jp "), stop("JP"), stop("JPN"), stop("")], [], reference), []);
});
