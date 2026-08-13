import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGapMinutes,
  detectGapsFromBuiltDay,
  detectItineraryGaps,
  primaryItineraryGap,
  type GapDetectionDay,
} from "../lib/gap-detection.ts";
import type { BuiltPlanDay } from "../lib/trip-builder.ts";
import type { TripFitDay } from "../lib/trip-scenarios.ts";

test("classifies the exact 29/30/59/60/119/120 minute band boundaries", () => {
  assert.equal(classifyGapMinutes(29), "BELOW_MINIMUM");
  assert.equal(classifyGapMinutes(30), "SHORT_30_TO_59");
  assert.equal(classifyGapMinutes(59), "SHORT_30_TO_59");
  assert.equal(classifyGapMinutes(60), "MEDIUM_60_TO_119");
  assert.equal(classifyGapMinutes(119), "MEDIUM_60_TO_119");
  // The spec band table splits at 120: exactly 120 minutes is the long band.
  assert.equal(classifyGapMinutes(120), "LONG_120_PLUS");
  assert.equal(classifyGapMinutes(121), "LONG_120_PLUS");
});

function betweenGap(minutes: number) {
  const secondStart = 10 * 60 + 10 + minutes;
  const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return detectItineraryGaps({
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: clock(secondStart + 30),
    availableMinutes: secondStart + 30 - 9 * 60,
    startCoordinate: null,
    endCoordinate: null,
    returnTravelMinutes: 0,
    anchors: [
      { id: "a", startAt: "09:00", endAt: "10:00", coordinate: { latitude: 35, longitude: 139 }, travelFromPreviousMinutes: 0 },
      { id: "b", startAt: clock(secondStart), endAt: clock(secondStart + 30), coordinate: { latitude: 35.01, longitude: 139.01 }, travelFromPreviousMinutes: 10 },
    ],
  }).filter((gap) => gap.kind === "BETWEEN_ANCHORS");
}

test("detects 30-minute-plus gaps and assigns deterministic suggestion bands", () => {
  assert.equal(betweenGap(29).length, 0, "the 0-29 no-recommendation rule holds");
  assert.equal(betweenGap(30)[0].sizeBand, "SHORT_30_TO_59");
  assert.deepEqual(betweenGap(30)[0].suggestionKinds, ["CAFE", "BAKERY", "PARK", "LOOKOUT"]);
  assert.equal(betweenGap(59)[0].sizeBand, "SHORT_30_TO_59");
  assert.equal(betweenGap(60)[0].sizeBand, "MEDIUM_60_TO_119");
  assert.deepEqual(betweenGap(60)[0].suggestionKinds, ["SMALL_FACILITY", "WALK", "CAFE_AND_WALK"]);
  assert.equal(betweenGap(119)[0].sizeBand, "MEDIUM_60_TO_119");
  // 120+ opens the normal tourist-spot categories (通常観光スポットも候補).
  assert.equal(betweenGap(120)[0].sizeBand, "LONG_120_PLUS");
  assert.equal(betweenGap(120)[0].availableMinutes, 120);
  assert.deepEqual(betweenGap(120)[0].suggestionKinds, ["ATTRACTION", "SMALL_FACILITY", "WALK", "CAFE_AND_WALK"]);
  assert.equal(betweenGap(121)[0].sizeBand, "LONG_120_PLUS", "long gaps now produce recommendations too");
});

test("labels before-first, between-anchor and before-hotel-return gaps", () => {
  const input: GapDetectionDay = {
    dayIndex: 2,
    startAt: "09:00",
    usableUntil: "14:10",
    availableMinutes: 310,
    startCoordinate: { latitude: 35, longitude: 139 },
    endCoordinate: { latitude: 35.03, longitude: 139.03 },
    returnTravelMinutes: 20,
    anchors: [
      { id: "a", startAt: "09:40", endAt: "10:10", coordinate: { latitude: 35.01, longitude: 139.01 }, travelFromPreviousMinutes: 10 },
      { id: "b", startAt: "11:20", endAt: "12:20", coordinate: { latitude: 35.02, longitude: 139.02 }, travelFromPreviousMinutes: 10 },
    ],
  };
  const gaps = detectItineraryGaps(input);
  assert.deepEqual(gaps.map((gap) => [gap.kind, gap.availableMinutes]), [
    ["BEFORE_FIRST_ANCHOR", 30],
    ["BETWEEN_ANCHORS", 60],
    ["BEFORE_HOTEL_RETURN", 90],
  ]);
  assert.deepEqual(gaps[1].routeSegment, {
    from: { latitude: 35.01, longitude: 139.01 },
    to: { latitude: 35.02, longitude: 139.02 },
  });
});

test("produces the same gap ids and ordering across 100 runs", () => {
  const input: GapDetectionDay = {
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: "13:00",
    availableMinutes: 240,
    startCoordinate: null,
    endCoordinate: null,
    returnTravelMinutes: 0,
    anchors: [
      { id: "a", startAt: "09:30", endAt: "10:00", coordinate: { latitude: 35, longitude: 139 }, travelFromPreviousMinutes: 0 },
      { id: "b", startAt: "11:10", endAt: "12:30", coordinate: { latitude: 35.01, longitude: 139.01 }, travelFromPreviousMinutes: 10 },
    ],
  };
  const signatures = new Set(Array.from({ length: 100 }, () => JSON.stringify(detectItineraryGaps(input))));
  assert.equal(signatures.size, 1);
});

test("preserves chronological insertion order across midnight", () => {
  const gaps = detectItineraryGaps({
    dayIndex: 0,
    startAt: "23:00",
    usableUntil: "02:00",
    availableMinutes: 180,
    startCoordinate: null,
    endCoordinate: null,
    returnTravelMinutes: 0,
    anchors: [
      { id: "late", startAt: "23:30", endAt: "23:45", coordinate: { latitude: 35, longitude: 139 }, travelFromPreviousMinutes: 0 },
      { id: "after-midnight", startAt: "00:15", endAt: "00:30", coordinate: { latitude: 35.01, longitude: 139.01 }, travelFromPreviousMinutes: 0 },
    ],
  });

  assert.deepEqual(gaps.map((gap) => gap.startAt), ["23:00", "23:45", "00:30"]);
});

test("adapts BuiltPlanDay and TripFitDay without owning planner logic", () => {
  const stop = (id: string, latitude: number) => ({
    id,
    name: id,
    area: "test",
    latitude,
    longitude: 139,
    sourceUrl: "https://example.com",
    verifiedAt: "2026-08-09",
    confidence: "medium" as const,
    planningDurationMinutes: 30,
    isAnchor: false,
  });
  const first = stop("a", 35);
  const second = stop("b", 35.01);
  const day = {
    startTime: "09:00",
    startBase: null,
    endBase: null,
    hotelOutboundMinutes: null,
    hotelInboundMinutes: 0,
    stops: [
      { stop: first, arrival: "09:00", departure: "10:00" },
      { stop: second, arrival: "11:00", departure: "12:00" },
    ],
    legs: [{ comparison: { recommended: { mode: "transit", minutes: 20 } } }],
  } as BuiltPlanDay;
  const fit = { dayIndex: 0, usableUntil: "12:00", availableMinutes: 180 } as TripFitDay;
  const gaps = detectGapsFromBuiltDay(day, fit, { transferBufferMinutes: 10 });
  assert.deepEqual(gaps.map((gap) => [gap.kind, gap.availableMinutes]), [["BETWEEN_ANCHORS", 30]]);
});

test("the day surfaces the gap worth filling, not the first one in visit order", () => {
  // A 35-minute wait before the first stop and a six-hour hole after the last
  // one. Picking by position offered a cafe for the 35 minutes and said
  // nothing about the afternoon.
  const gaps = detectItineraryGaps({
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: "21:30",
    availableMinutes: 750,
    startCoordinate: { latitude: 35.68, longitude: 139.7 },
    endCoordinate: { latitude: 35.68, longitude: 139.7 },
    returnTravelMinutes: 20,
    anchors: [
      { id: "a", startAt: "09:35", endAt: "11:00", coordinate: { latitude: 35.7, longitude: 139.8 }, travelFromPreviousMinutes: 0 },
      { id: "b", startAt: "11:30", endAt: "14:40", coordinate: { latitude: 35.71, longitude: 139.81 }, travelFromPreviousMinutes: 20 },
    ],
  });

  assert.deepEqual(
    gaps.map((gap) => [gap.kind, gap.availableMinutes]),
    [["BEFORE_FIRST_ANCHOR", 35], ["BEFORE_HOTEL_RETURN", 390]],
  );
  assert.equal(gaps[0].availableMinutes, 35, "the first gap in visit order is the small one");
  assert.equal(primaryItineraryGap(gaps)?.availableMinutes, 390);
  assert.equal(primaryItineraryGap(gaps)?.kind, "BEFORE_HOTEL_RETURN");
});

test("the primary gap is stable: equal sizes keep visit order, no gaps means none", () => {
  const gap = (id: string, availableMinutes: number) => ({ id, availableMinutes }) as ReturnType<typeof detectItineraryGaps>[number];
  assert.equal(primaryItineraryGap([]), null);
  // A tie must not depend on iteration accidents: the earlier gap wins, so a
  // rebuild of the same day surfaces the same gap.
  assert.equal(primaryItineraryGap([gap("early", 60), gap("late", 60)])?.id, "early");
  assert.equal(primaryItineraryGap([gap("only", 45)])?.id, "only");
});
