import assert from "node:assert/strict";
import test from "node:test";

import {
  activityFlags,
  dayDateLabel,
  dayHeaderSummary,
  dayTabDensityLabel,
  dayTabTitle,
  durationSourceLabel,
  fillerRowLabel,
  mealSlotsAfterStop,
  transitBoardingText,
  transportModeLabel,
} from "../lib/presentation/timeline-presentation.ts";
import { tripStatsLine } from "../lib/presentation/trip-presentation.ts";
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

// Copy Deck plan.day.summary / TC-032: the day header carries exactly two
// numbers — stop count and buffer — in the deck's exact form.
test("dayHeaderSummary renders the deck's two-number day line", () => {
  assert.equal(dayHeaderSummary({ stopCount: 4, slackMinutes: 90 }, "ja"), "4か所・余裕1時間30分");
  assert.equal(dayHeaderSummary({ stopCount: 4, slackMinutes: 90 }, "en"), "4 stops · 1h 30m buffer");
  // en says "buffer", never "Spare".
  assert.match(dayHeaderSummary({ stopCount: 3, slackMinutes: 45 }, "en"), /buffer$/);
  assert.doesNotMatch(dayHeaderSummary({ stopCount: 3, slackMinutes: 45 }, "en"), /spare/i);
  assert.equal(dayHeaderSummary({ stopCount: 1, slackMinutes: 60 }, "en"), "1 stop · 1h buffer");
});

test("dayHeaderSummary drops the buffer claim without positive slack or stops", () => {
  // Fully packed day (or fit unknown): the count stands alone — no fake 0m buffer.
  assert.equal(dayHeaderSummary({ stopCount: 4, slackMinutes: 0 }, "ja"), "4か所");
  assert.equal(dayHeaderSummary({ stopCount: 4, slackMinutes: -30 }, "en"), "4 stops");
  // An empty day never advertises buffer even though the whole window is free.
  assert.equal(dayHeaderSummary({ stopCount: 0, slackMinutes: 600 }, "ja"), "0か所");
  assert.equal(dayHeaderSummary({ stopCount: 0, slackMinutes: 600 }, "en"), "0 stops");
});

// Copy Deck plan.stats / TC-029: one compact trip totals line, deck form.
test("tripStatsLine renders places, travel and buffer in the deck's form", () => {
  const totals = { placeCount: 8, travelMinutes: 520, bufferMinutes: 250 };
  assert.equal(tripStatsLine(totals, "ja"), "8か所・移動8時間40分・余裕4時間10分");
  assert.equal(tripStatsLine(totals, "en"), "8 places · 8h 40m travel · 4h 10m buffer");
  assert.equal(
    tripStatsLine({ placeCount: 1, travelMinutes: 0, bufferMinutes: 0 }, "en"),
    "1 place · 0m travel · 0m buffer",
  );
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

test("tripStatsLine states whole spare days in place of the buffer figure", () => {
  // A four-day trip whose places fit in two reported 「余裕26時間40分」 and
  // nothing else. It is the same spare time either way; when it amounts to
  // whole days the day count is the honest resolution, and swapping rather
  // than appending is what keeps this one line.
  const totals = { placeCount: 10, travelMinutes: 520, bufferMinutes: 1600 };
  assert.equal(tripStatsLine({ ...totals, spareDays: 2 }, "ja"), "10か所・移動8時間40分・2日分の空き");
  assert.equal(tripStatsLine({ ...totals, spareDays: 2 }, "en"), "10 places · 8h 40m travel · 2 days spare");
  assert.equal(tripStatsLine({ ...totals, spareDays: 1 }, "en"), "10 places · 8h 40m travel · 1 day spare");
  // The swapped line is never longer than the buffer form it replaces, which
  // is the property the first-viewport contract depends on.
  for (const locale of ["ja", "en"] as const) {
    assert.ok(
      tripStatsLine({ ...totals, spareDays: 2 }, locale).length <= tripStatsLine(totals, locale).length,
      `${locale}: the spare-days line grew the stats line`,
    );
  }
});

test("tripStatsLine claims no spare days when the assessment withheld a conclusion", () => {
  // `spareDays` is null while a place is unresolved or the trip does not fit,
  // and 0 when the trip needs every day it has. Neither may become a
  // confident emptiness claim, and the three-clause deck form must be
  // byte-identical to the line without the field at all.
  const totals = { placeCount: 8, travelMinutes: 520, bufferMinutes: 250 };
  const deckForm = { ja: "8か所・移動8時間40分・余裕4時間10分", en: "8 places · 8h 40m travel · 4h 10m buffer" };
  for (const spareDays of [null, undefined, 0] as const) {
    assert.equal(tripStatsLine({ ...totals, spareDays }, "ja"), deckForm.ja, `ja leaked a clause for ${spareDays}`);
    assert.equal(tripStatsLine({ ...totals, spareDays }, "en"), deckForm.en, `en leaked a clause for ${spareDays}`);
  }
});
