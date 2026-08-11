import assert from "node:assert/strict";
import test from "node:test";
import type { PlannerDayTimeBarDay } from "../lib/planner-day-time-bar.ts";
import { buildDayPresentation, dayPresentationFallbackCopy } from "../lib/day-presentation.ts";

function builtStop(input: { name: string; arrival: string; departure: string }) {
  return {
    stop: {
      id: input.name,
      name: input.name,
      area: "Test area",
      latitude: 0,
      longitude: 0,
      sourceUrl: "",
      verifiedAt: "",
      confidence: "low",
      planningDurationMinutes: 60,
      isAnchor: true,
    },
    arrival: input.arrival,
    departure: input.departure,
    kind: "place",
    mealKind: null,
    priority: "normal",
    fixedTime: null,
    isReservation: false,
    reservationLateMinutes: 0,
    openingStatus: "verified_open",
    crowd: null,
  } satisfies PlannerDayTimeBarDay["stops"][number];
}

function day(input: {
  startTime?: string;
  finishTime?: string;
  stops?: PlannerDayTimeBarDay["stops"];
  legMinutes?: number[];
} = {}): PlannerDayTimeBarDay {
  return {
    startTime: input.startTime ?? "09:00",
    finishTime: input.finishTime ?? "17:30",
    stops: input.stops ?? [],
    legs: (input.legMinutes ?? []).map((minutes) => ({
      comparison: { recommended: { minutes } },
    })) as PlannerDayTimeBarDay["legs"],
    hotelTravelMinutes: null,
    deadlineOverrunMinutes: 0,
  };
}

test("a coherent day is valid and reuses the shared time-bar numbers", () => {
  const presentation = buildDayPresentation(
    day({
      stops: [
        builtStop({ name: "A", arrival: "09:00", departure: "10:30" }),
        builtStop({ name: "B", arrival: "11:00", departure: "12:30" }),
      ],
      legMinutes: [30],
    }),
    { availableMinutes: 510, slackMinutes: 300 },
    { dayIndex: 0 },
  );
  assert.equal(presentation.consistency, "valid");
  assert.equal(presentation.diagnosticId, null);
  assert.equal(presentation.startClock, "09:00");
  assert.equal(presentation.endClock, "17:30");
  assert.equal(presentation.finalTimelineClock, "12:30");
  assert.equal(presentation.visitMinutes, 180);
  assert.equal(presentation.usedMinutes, presentation.visitMinutes + presentation.travelMinutes);
  assert.equal(presentation.slackMinutes, 300);
});

test("SHOT-P0-01: a 09:00–09:00 header over real visits is reported invalid", () => {
  const presentation = buildDayPresentation(
    day({
      startTime: "09:00",
      finishTime: "09:00",
      stops: [builtStop({ name: "A", arrival: "09:00", departure: "10:30" })],
    }),
    { availableMinutes: 690, slackMinutes: 0 },
    { dayIndex: 1 },
  );
  assert.equal(presentation.consistency, "invalid");
  assert.ok(presentation.issues.includes("zero_span_with_stops"));
  assert.match(presentation.diagnosticId ?? "", /^TC-TIME-D2-/);
  const copy = dayPresentationFallbackCopy(presentation, "ja");
  assert.match(copy.body, /診断ID/);
  assert.match(copy.body, /TC-TIME-D2/);
});

test("used minutes above the available window without overrun is invalid", () => {
  const presentation = buildDayPresentation(
    day({
      stops: [builtStop({ name: "A", arrival: "09:00", departure: "20:30" })],
    }),
    // 11.5h used inside a 6h window while still claiming zero overrun.
    { availableMinutes: 360, slackMinutes: 0 },
  );
  assert.equal(presentation.consistency, "invalid");
  assert.ok(presentation.issues.includes("used_exceeds_available_without_overrun"));
});

test("a timeline that keeps running after the advertised day end is invalid", () => {
  const presentation = buildDayPresentation(
    day({
      finishTime: "17:30",
      stops: [
        builtStop({ name: "A", arrival: "16:00", departure: "17:00" }),
        builtStop({ name: "B", arrival: "17:30", departure: "19:45" }),
      ],
    }),
    { availableMinutes: 510, slackMinutes: 60 },
  );
  assert.equal(presentation.consistency, "invalid");
  assert.ok(presentation.issues.includes("timeline_ends_after_header"));
});

test("an empty day and an overrun day both stay valid presentations", () => {
  const empty = buildDayPresentation(day({ startTime: "09:00", finishTime: "09:00" }), null);
  assert.equal(empty.consistency, "valid");
  assert.equal(empty.isEmpty, true);

  const overrun = buildDayPresentation(
    day({ stops: [builtStop({ name: "A", arrival: "09:00", departure: "20:30" })] }),
    { availableMinutes: 360, slackMinutes: -330 },
  );
  assert.equal(overrun.consistency, "valid");
  assert.ok(overrun.overrunMinutes > 0);
});
