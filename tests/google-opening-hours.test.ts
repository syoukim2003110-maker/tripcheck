import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGoogleOpeningAt, googleOpeningWindowsForDate } from "../lib/google-opening-hours.ts";

const mondayLunchHours = [{
  open: { day: 1, hour: 11, minute: 30 },
  close: { day: 1, hour: 15, minute: 0 },
}, {
  open: { day: 1, hour: 17, minute: 0 },
  close: { day: 1, hour: 22, minute: 0 },
}];

test("uses structured regular periods and treats closing time as closed", () => {
  assert.deepEqual(evaluateGoogleOpeningAt({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: mondayLunchHours,
  }, { date: "2026-07-20", time: "11:30" }), {
    status: "open",
    reason: "within_regular_period",
  });
  assert.equal(evaluateGoogleOpeningAt({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: mondayLunchHours,
  }, { date: "2026-07-20", time: "15:00" }).status, "closed");
  assert.equal(evaluateGoogleOpeningAt({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: mondayLunchHours,
  }, { date: "2026-07-21", time: "12:00" }).status, "closed");
});

test("handles overnight periods that cross the weekly boundary", () => {
  const hours = [{
    open: { day: 6, hour: 22, minute: 0 },
    close: { day: 0, hour: 2, minute: 0 },
  }];
  assert.equal(evaluateGoogleOpeningAt({ regularOpeningPeriods: hours }, {
    date: "2026-07-25",
    time: "23:30",
  }).status, "open");
  assert.equal(evaluateGoogleOpeningAt({ regularOpeningPeriods: hours }, {
    date: "2026-07-26",
    time: "01:59",
  }).status, "open");
  assert.equal(evaluateGoogleOpeningAt({ regularOpeningPeriods: hours }, {
    date: "2026-07-26",
    time: "02:00",
  }).status, "closed");
});

test("recognizes Google's canonical always-open period", () => {
  assert.deepEqual(evaluateGoogleOpeningAt({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: [{ open: { day: 0, hour: 0, minute: 0 } }],
  }, { date: "2026-07-22", time: "03:45" }), {
    status: "open",
    reason: "always_open",
  });
});

test("business closure overrides an otherwise open weekly period", () => {
  const regularOpeningPeriods = [{
    open: { day: 1, hour: 0, minute: 0 },
    close: { day: 2, hour: 0, minute: 0 },
  }];
  assert.deepEqual(evaluateGoogleOpeningAt({
    businessStatus: "CLOSED_TEMPORARILY",
    regularOpeningPeriods,
  }, { date: "2026-07-20", time: "12:00" }), {
    status: "closed",
    reason: "closed_temporarily",
  });
  assert.equal(evaluateGoogleOpeningAt({
    businessStatus: "CLOSED_PERMANENTLY",
    regularOpeningPeriods,
  }, { date: "2026-07-20", time: "12:00" }).status, "closed");
});

test("returns unknown instead of inventing an answer from missing or malformed data", () => {
  assert.deepEqual(evaluateGoogleOpeningAt({ businessStatus: "OPERATIONAL" }, {
    date: "2026-07-20",
    time: "12:00",
  }), { status: "unknown", reason: "missing_schedule" });
  assert.equal(evaluateGoogleOpeningAt({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: [{ open: { day: 8, hour: 9, minute: 0 } }],
  }, { date: "2026-07-20", time: "12:00" }).reason, "invalid_schedule");
  assert.equal(evaluateGoogleOpeningAt({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: mondayLunchHours,
  }, { date: "2026-02-30", time: "12:00" }).reason, "invalid_local_datetime");
  assert.equal(evaluateGoogleOpeningAt({
    businessStatus: "FUTURE_PROVIDER_VALUE",
    regularOpeningPeriods: mondayLunchHours,
  }, { date: "2026-07-20", time: "12:00" }).reason, "unknown_business_status");
});

test("distinguishes an explicitly never-open schedule from missing hours", () => {
  assert.deepEqual(evaluateGoogleOpeningAt({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: [],
  }, { date: "2026-07-20", time: "12:00" }), {
    status: "closed",
    reason: "no_regular_open_periods",
  });
});

test("returns split and overnight windows for one local travel date", () => {
  assert.deepEqual(googleOpeningWindowsForDate({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: mondayLunchHours,
  }, "2026-07-20"), [
    { openMinutes: 690, closeMinutes: 900 },
    { openMinutes: 1020, closeMinutes: 1320 },
  ]);
  assert.deepEqual(googleOpeningWindowsForDate({
    businessStatus: "OPERATIONAL",
    regularOpeningPeriods: [{
      open: { day: 6, hour: 22, minute: 0 },
      close: { day: 0, hour: 2, minute: 0 },
    }],
  }, "2026-07-26"), [{ openMinutes: 0, closeMinutes: 120 }]);
});

test("keeps missing hours unknown while explicit closure returns no windows", () => {
  assert.equal(googleOpeningWindowsForDate({ businessStatus: "OPERATIONAL" }, "2026-07-20"), null);
  assert.deepEqual(googleOpeningWindowsForDate({
    businessStatus: "CLOSED_TEMPORARILY",
    regularOpeningPeriods: mondayLunchHours,
  }, "2026-07-20"), []);
});
