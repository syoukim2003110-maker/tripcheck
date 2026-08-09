import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlannerDayTimeBarModel,
  plannerDayTimeBarAriaLabel,
  type PlannerDayTimeBarDay,
  type PlannerDayTimeBarFit,
} from "../lib/planner-day-time-bar.ts";

function builtStop(input: {
  name: string;
  arrival: string;
  departure: string;
  fixedTime?: string | null;
  isReservation?: boolean;
  reservationLateMinutes?: number;
  openingStatus?: PlannerDayTimeBarDay["stops"][number]["openingStatus"];
}) {
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
    fixedTime: input.fixedTime ?? null,
    isReservation: input.isReservation ?? false,
    reservationLateMinutes: input.reservationLateMinutes ?? 0,
    openingStatus: input.openingStatus ?? "verified_open",
    crowd: null,
  } satisfies PlannerDayTimeBarDay["stops"][number];
}

function day(input: {
  startTime?: string;
  finishTime?: string;
  stops?: PlannerDayTimeBarDay["stops"];
  legMinutes?: number[];
  hotelTravelMinutes?: number | null;
  deadlineOverrunMinutes?: number;
} = {}): PlannerDayTimeBarDay {
  return {
    startTime: input.startTime ?? "09:00",
    finishTime: input.finishTime ?? "15:00",
    stops: input.stops ?? [],
    legs: (input.legMinutes ?? []).map((minutes) => ({
      comparison: { recommended: { minutes } },
    })) as PlannerDayTimeBarDay["legs"],
    hotelTravelMinutes: input.hotelTravelMinutes ?? null,
    deadlineOverrunMinutes: input.deadlineOverrunMinutes ?? 0,
  };
}

function fit(availableMinutes: number, slackMinutes: number): PlannerDayTimeBarFit {
  return { availableMinutes, slackMinutes };
}

test("builds deterministic visit, travel and slack segments that total 100 percent", () => {
  const model = buildPlannerDayTimeBarModel(day({
    stops: [
      builtStop({ name: "Museum", arrival: "09:00", departure: "10:00" }),
      builtStop({ name: "Garden", arrival: "11:00", departure: "12:00" }),
    ],
    legMinutes: [50],
    hotelTravelMinutes: 30,
  }), fit(300, 100));

  assert.equal(model.visitMinutes, 120);
  assert.equal(model.travelMinutes, 80);
  assert.equal(model.slackMinutes, 100);
  assert.equal(model.plannedMinutes, 200);
  assert.equal(model.segments.reduce((sum, segment) => sum + segment.percentage, 0), 100);
  assert.deepEqual(model.segments.map((segment) => segment.kind), ["visit", "travel", "slack"]);
  assert.equal(model.isEmpty, false);
});

test("keeps reservation and conflict markers at their clock position", () => {
  const model = buildPlannerDayTimeBarModel(day({
    startTime: "09:00",
    stops: [builtStop({
      name: "Booked tower",
      arrival: "09:30",
      departure: "10:30",
      fixedTime: "09:30",
      isReservation: true,
      openingStatus: "last_entry_conflict",
    })],
  }), fit(300, 240));

  assert.deepEqual(model.markers.map((marker) => [marker.kind, marker.positionPercentage]), [
    ["reservation", 10],
    ["conflict", 10],
  ]);
  assert.equal(model.hasConflict, true);
});

test("shows a deadline marker and an overrun without a negative slack segment", () => {
  const model = buildPlannerDayTimeBarModel(day({
    stops: [builtStop({ name: "Late stop", arrival: "09:00", departure: "10:00" })],
    legMinutes: [30],
    deadlineOverrunMinutes: 15,
  }), fit(180, -30));

  assert.equal(model.slackMinutes, 0);
  assert.equal(model.overrunMinutes, 30);
  assert.equal(model.plannedMinutes, 210);
  assert.equal(model.markers.at(-1)?.id, "deadline-conflict");
  assert.equal(model.markers.at(-1)?.positionPercentage, 100);
  assert.equal(model.hasConflict, true);
});

test("supports a visit that crosses midnight", () => {
  const model = buildPlannerDayTimeBarModel(day({
    startTime: "23:00",
    finishTime: "01:00",
    stops: [builtStop({ name: "Night market", arrival: "23:30", departure: "00:30", isReservation: true })],
  }), fit(120, 60));

  assert.equal(model.visitMinutes, 60);
  assert.equal(model.markers[0]?.positionPercentage, 25);
});

test("sanitizes invalid clocks and non-finite or negative minute values", () => {
  const invalidFit = { availableMinutes: Number.NaN, slackMinutes: Number.POSITIVE_INFINITY } as PlannerDayTimeBarFit;
  const invalidDay = day({
    startTime: "not-a-clock",
    stops: [builtStop({ name: "Unknown time", arrival: "25:99", departure: "oops", isReservation: true })],
    legMinutes: [Number.NaN, Number.NEGATIVE_INFINITY, -10],
    hotelTravelMinutes: Number.POSITIVE_INFINITY,
    deadlineOverrunMinutes: -30,
  });
  const model = buildPlannerDayTimeBarModel(invalidDay, invalidFit);

  assert.equal(model.visitMinutes, 0);
  assert.equal(model.travelMinutes, 0);
  assert.equal(model.slackMinutes, 0);
  assert.equal(model.availableMinutes, 0);
  assert.equal(model.segments.reduce((sum, segment) => sum + segment.percentage, 0), 0);
  assert.equal(Number.isFinite(model.markers[0]?.positionPercentage), true);
  assert.equal(model.markers[0]?.positionPercentage, 50);
});

test("provides localized aria labels without React or TSX runtime imports", () => {
  const testDay = day({
    stops: [builtStop({ name: "Temple", arrival: "09:00", departure: "10:00", isReservation: true })],
  });
  const testFit = fit(180, 120);
  const model = buildPlannerDayTimeBarModel(testDay, testFit);

  assert.match(plannerDayTimeBarAriaLabel(model, "en"), /Day time allocation: 1 hr visiting/);
  assert.match(plannerDayTimeBarAriaLabel(model, "en"), /1 reservation marker/);
  assert.match(plannerDayTimeBarAriaLabel(model, "ja"), /1日の時間配分。訪問1時間/);
  assert.match(plannerDayTimeBarAriaLabel(model, "ja"), /予約マーカー1件/);
  assert.doesNotMatch(plannerDayTimeBarAriaLabel(model, "en"), /NaN|Infinity/);
});
