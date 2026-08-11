import assert from "node:assert/strict";
import test from "node:test";

import {
  activityFlags,
  dayDateLabel,
  dayTabDensityLabel,
  dayTabTitle,
  durationSourceLabel,
  fillerRowLabel,
  mealSlotsAfterStop,
  transitBoardingText,
  transportModeLabel,
} from "../lib/presentation/timeline-presentation.ts";
import { ui } from "../lib/presentation/planner-copy.ts";

test("transportModeLabel honors the car preference and falls back on null", () => {
  assert.equal(transportModeLabel("taxi", "car", "ja"), ui.ja.moveCar);
  assert.equal(transportModeLabel("taxi", "auto", "ja"), ui.ja.move.taxi);
  assert.equal(transportModeLabel("walk", "car", "en"), ui.en.move.walk);
  assert.equal(transportModeLabel(null, "auto", "en"), ui.en.move.transit);
  assert.equal(transportModeLabel(null, "car", "ja"), ui.ja.moveCar);
});

test("day tab copy states density in the traveller's language", () => {
  assert.equal(dayTabDensityLabel(0, "ja"), "予定なし");
  assert.equal(dayTabDensityLabel(2, "ja"), "ゆったり");
  assert.equal(dayTabDensityLabel(5, "ja"), "5か所");
  assert.equal(dayTabDensityLabel(0, "en"), "empty");
  assert.equal(dayTabDensityLabel(1, "en"), "easy");
  assert.equal(dayTabDensityLabel(4, "en"), "4 stops");
  assert.equal(dayTabTitle(0, "ja"), "1日目");
  assert.equal(dayTabTitle(2, "en"), "Day 3");
});

test("dayDateLabel uses the calendar date only after the user set one", () => {
  const day = { date: "2026-08-15", label: "Day 2" };
  assert.equal(dayDateLabel(day, "土", true, "ja"), "2026-08-15（土）");
  assert.equal(dayDateLabel(day, "Sat", true, "en"), "2026-08-15 (Sat)");
  assert.equal(dayDateLabel(day, "Sat", false, "en"), "Day 2");
  assert.equal(dayDateLabel({ date: null, label: "Day 2" }, null, true, "ja"), "Day 2");
});

test("durationSourceLabel treats unknown and failed evidence as estimates", () => {
  assert.equal(durationSourceLabel("user_provided", "ja"), "指定");
  assert.equal(durationSourceLabel("verified", "ja"), "確認");
  assert.equal(durationSourceLabel("estimated", "ja"), "推定");
  assert.equal(durationSourceLabel("unknown", "ja"), "推定");
  assert.equal(durationSourceLabel("failed", "en"), "estimated");
  assert.equal(durationSourceLabel("verified", "en"), "confirmed");
});

test("fillerRowLabel names the slot kind", () => {
  assert.equal(fillerRowLabel("lunch", "ja"), "昼食のおすすめ");
  assert.equal(fillerRowLabel("dinner", "en"), "Dinner recommendation");
  assert.equal(fillerRowLabel("micro", "ja"), "おすすめ");
  assert.equal(fillerRowLabel(undefined, "en"), "Recommended");
});

test("activityFlags orders lateness over fixed time over must, then opening trouble", () => {
  const base = { reservationLateMinutes: 0, fixedTime: null, priority: "normal", openingStatus: "unknown" } as const;
  assert.deepEqual(activityFlags({ ...base }, "ja"), []);
  const late = activityFlags({ ...base, reservationLateMinutes: 12, fixedTime: "18:00", priority: "must" }, "ja");
  assert.equal(late.length, 1);
  assert.equal(late[0].className, "is-booked");
  assert.equal(late[0].label, ui.ja.lateShort(12));
  const fixed = activityFlags({ ...base, fixedTime: "18:00", priority: "must" }, "ja");
  assert.deepEqual(fixed, [{ className: "is-booked", label: "18:00" }]);
  const must = activityFlags({ ...base, priority: "must" }, "en");
  assert.deepEqual(must, [{ className: "is-must", label: ui.en.must }]);
  const both = activityFlags({ ...base, priority: "must", openingStatus: "conflict" }, "en");
  assert.equal(both.length, 2);
  assert.equal(both[1].label, ui.en.openingConflict);
  const lastEntry = activityFlags({ ...base, openingStatus: "last_entry_conflict" }, "ja");
  assert.deepEqual(lastEntry, [{ className: "is-booked", label: "最終入場後" }]);
});

test("mealSlotsAfterStop attaches each slot to the latest stop reached by its time", () => {
  const stops = [{ arrival: "09:00" }, { arrival: "12:30" }, { arrival: "16:00" }];
  const slots = [
    { id: "dinner-1", kind: "dinner", displayTime: "19:00" },
    { id: "lunch-1", kind: "lunch", displayTime: "12:45" },
    { id: "odd", kind: "lunch", displayTime: "n/a" },
  ] as never[];
  assert.deepEqual(mealSlotsAfterStop(slots, stops, 0).map((slot) => (slot as { id: string }).id), []);
  assert.deepEqual(mealSlotsAfterStop(slots, stops, 1).map((slot) => (slot as { id: string }).id), ["lunch-1"]);
  assert.deepEqual(mealSlotsAfterStop(slots, stops, 2).map((slot) => (slot as { id: string }).id), ["odd", "dinner-1"]);
});

test("mealSlotsAfterStop puts lunch before dinner at the same clock time", () => {
  const stops = [{ arrival: "09:00" }];
  const slots = [
    { id: "d", kind: "dinner", displayTime: "12:00" },
    { id: "l", kind: "lunch", displayTime: "12:00" },
  ] as never[];
  assert.deepEqual(mealSlotsAfterStop(slots, stops, 0).map((slot) => (slot as { id: string }).id), ["l", "d"]);
});

test("transitBoardingText assembles a boarding line and stays null without steps", () => {
  assert.equal(transitBoardingText(undefined, "ja"), null);
  assert.equal(transitBoardingText({ steps: [], walkToStopMinutes: null, walkFromStopMinutes: null }, "ja"), null);
  const boarding = {
    steps: [{
      lineName: "S-Bahn 3",
      shortName: "S3",
      headsign: "Luzern",
      departureStop: "Zürich HB",
      departureTime: "09:15",
      arrivalStop: "Luzern",
      stopCount: 5,
    }],
    walkToStopMinutes: 4,
    walkFromStopMinutes: 3,
  } as never;
  const ja = transitBoardingText(boarding, "ja");
  assert.ok(ja?.includes("徒歩約4分 →"));
  assert.ok(ja?.includes("Zürich HB 09:15発"));
  assert.ok(ja?.includes("S3・Luzern行き"));
  assert.ok(ja?.includes("→ Luzern(5駅)"));
  assert.ok(ja?.includes("→ 徒歩約3分"));
  const en = transitBoardingText(boarding, "en");
  assert.ok(en?.includes("~4 min walk →"));
  assert.ok(en?.includes("Zürich HB dep 09:15"));
  assert.ok(en?.includes("S3 toward Luzern"));
  assert.ok(en?.includes("→ Luzern (5 stops)"));
  assert.ok(en?.includes("→ ~3 min walk"));
});

test("transitBoardingText counts extra connections instead of stop counts", () => {
  const boarding = {
    steps: [
      { lineName: "Line A", shortName: null, headsign: null, departureStop: "Start", departureTime: null, arrivalStop: "Mid", stopCount: 3 },
      { lineName: "Line B", shortName: null, headsign: null, departureStop: "Mid", departureTime: null, arrivalStop: "End", stopCount: 2 },
    ],
    walkToStopMinutes: null,
    walkFromStopMinutes: null,
  } as never;
  const en = transitBoardingText(boarding, "en");
  assert.ok(en?.includes("+1 connection"));
  assert.ok(en?.includes("→ End"));
  assert.ok(!en?.includes("stops)"));
  const ja = transitBoardingText(boarding, "ja");
  assert.ok(ja?.includes("乗継ぎ1本"));
});
