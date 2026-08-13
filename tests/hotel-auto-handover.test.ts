import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import {
  HOTEL_REBASE_MIN_SAVED_MINUTES,
  HOTEL_REBASE_MIN_SAVED_RATIO,
  hotelRebaseIsWorthwhile,
  rankHotelCandidates,
  safestHotelCandidate,
} from "../lib/hotel-handover.ts";
import type { BuiltTripPlan } from "../lib/trip-builder.ts";

// P0-06. The automatic hotel shortlist used to be ranked on trip travel time
// alone and its winner attached straight to the plan. A hotel that saved five
// minutes and made a booked museum entry five minutes late therefore won, was
// applied silently, and — because a system handover rebases history rather
// than committing to it — never appeared in Undo. Meanwhile the traveller's
// own hotel swap ran the full confirm gate.

type FakeCandidate = { id: string; score: number };

/** A one-day plan with a booking, so lateness is expressible in a literal. */
function planWith(input: { travelMinutes: number; lateMinutes: number; airportOverrun?: number }): BuiltTripPlan {
  return {
    days: [{
      label: "Day 1",
      date: null,
      theme: "",
      stops: [{
        stop: { id: "ghibli", name: "Ghibli Museum" },
        arrival: "10:00",
        departure: "12:00",
        kind: "place",
        mealKind: null,
        priority: "normal",
        fixedTime: "10:00",
        isReservation: true,
        reservationLateMinutes: input.lateMinutes,
        openingStatus: "verified_open",
        crowd: null,
      }],
      legs: [],
      totalMinutes: 0,
      startTime: "09:00",
      requestedStartTime: "09:00",
      startAdjustedByArrival: false,
      finishTime: "18:00",
      hotelTravelMinutes: input.travelMinutes,
      hotelOutboundMinutes: input.travelMinutes,
      hotelInboundMinutes: 0,
      startBase: null,
      endBase: null,
      deadline: "20:00",
      deadlineKind: "airport",
      deadlineOverrunMinutes: input.airportOverrun ?? 0,
      reservationConflictCount: input.lateMinutes > 0 ? 1 : 0,
      openingConflictCount: 0,
      googleMapsUrl: null,
    }],
  } as unknown as BuiltTripPlan;
}

const CURRENT = planWith({ travelMinutes: 200, lateMinutes: 0 });

test("the shortest candidate loses to a safe one when it breaks a booking", () => {
  const evaluations = rankHotelCandidates<FakeCandidate>({
    currentPlan: CURRENT,
    locale: "en",
    candidates: [
      { candidate: { id: "safe-candidate", score: 1 }, plan: planWith({ travelMinutes: 165, lateMinutes: 0 }) },
      { candidate: { id: "lower-travel-candidate", score: 9 }, plan: planWith({ travelMinutes: 160, lateMinutes: 5 }) },
    ],
  });
  assert.equal(evaluations[0].candidate.id, "safe-candidate", "safety outranks five minutes of travel");
  assert.equal(safestHotelCandidate(evaluations)?.candidate.id, "safe-candidate");

  const damaging = evaluations.find((entry) => entry.candidate.id === "lower-travel-candidate")!;
  assert.equal(damaging.safe, false);
  assert.deepEqual(damaging.hardDamage.map((conflict) => conflict.kind), ["booking_late"]);
  // It stays in the shortlist: the traveller may still choose it, through the
  // dialog that a manual swap already runs.
  assert.equal(evaluations.length, 2);
});

test("auto attach checks the airport cutoff and opening hours too, not just bookings", () => {
  const missesFlight = rankHotelCandidates<FakeCandidate>({
    currentPlan: CURRENT,
    locale: "en",
    candidates: [{ candidate: { id: "far-from-airport", score: 5 }, plan: planWith({ travelMinutes: 100, lateMinutes: 0, airportOverrun: 25 }) }],
  });
  assert.equal(missesFlight[0].safe, false);
  assert.deepEqual(missesFlight[0].hardDamage.map((conflict) => conflict.kind), ["airport_cutoff"]);
  assert.equal(safestHotelCandidate(missesFlight), null, "no safe candidate means no automatic pick");

  // Opening hours run through the same detector, so a base that pushes a
  // verified window is caught by the same gate.
  const openingRaw = "Senso-ji\nteamLab Planets";
  const windows = { sensoji: { 0: [{ openMinutes: 9 * 60, closeMinutes: 11 * 60 }] } };
  const nearBase = buildTripFromWishlist(openingRaw, 1, "balanced", "en", { openingWindowsByDay: windows, defaultDayStart: "09:00" });
  const lateBase = buildTripFromWishlist(openingRaw, 1, "balanced", "en", { openingWindowsByDay: windows, defaultDayStart: "11:00" });
  const evaluated = rankHotelCandidates<FakeCandidate>({
    currentPlan: nearBase,
    locale: "en",
    candidates: [{ candidate: { id: "opens-too-late", score: 1 }, plan: lateBase }],
  });
  assert.equal(evaluated[0].safe, false);
  assert.ok(evaluated[0].hardDamage.some((conflict) => conflict.kind === "opening_closed"));
});

test("a candidate that repairs existing damage outranks a merely faster one", () => {
  const broken = planWith({ travelMinutes: 200, lateMinutes: 20 });
  const evaluations = rankHotelCandidates<FakeCandidate>({
    currentPlan: broken,
    locale: "en",
    candidates: [
      { candidate: { id: "faster", score: 9 }, plan: planWith({ travelMinutes: 120, lateMinutes: 20 }) },
      { candidate: { id: "repairs", score: 1 }, plan: planWith({ travelMinutes: 190, lateMinutes: 0 }) },
    ],
  });
  assert.equal(evaluations[0].candidate.id, "repairs");
  assert.equal(evaluations[0].resolvedHardConflicts, 1);
});

test("an existing base is not disturbed for 59 minutes or 14.9 per cent", () => {
  const evaluate = (travelMinutes: number) => rankHotelCandidates<FakeCandidate>({
    currentPlan: planWith({ travelMinutes: 400, lateMinutes: 0 }),
    locale: "en",
    candidates: [{ candidate: { id: "slightly-better", score: 1 }, plan: planWith({ travelMinutes, lateMinutes: 0 }) }],
  })[0];

  const justUnder = evaluate(400 - (HOTEL_REBASE_MIN_SAVED_MINUTES - 1));
  assert.equal(justUnder.savedMinutes, 59);
  assert.ok(justUnder.savedRatio < HOTEL_REBASE_MIN_SAVED_RATIO, "59/400 is under the ratio threshold too");
  assert.equal(hotelRebaseIsWorthwhile(justUnder, false), false, "59 minutes is not worth moving a working base");

  const atThreshold = evaluate(400 - HOTEL_REBASE_MIN_SAVED_MINUTES);
  assert.equal(hotelRebaseIsWorthwhile(atThreshold, false), true, "an hour is");

  // The same candidate is adopted without hesitation when the base it would
  // replace is only a provisional area, which has nothing to lose.
  assert.equal(hotelRebaseIsWorthwhile(justUnder, true), true);
});

test("no candidate is ever adopted automatically when none of them is safe", () => {
  const evaluations = rankHotelCandidates<FakeCandidate>({
    currentPlan: CURRENT,
    locale: "en",
    candidates: [
      { candidate: { id: "a", score: 3 }, plan: planWith({ travelMinutes: 10, lateMinutes: 30 }) },
      { candidate: { id: "b", score: 2 }, plan: planWith({ travelMinutes: 20, lateMinutes: 5 }) },
    ],
  });
  assert.equal(safestHotelCandidate(evaluations), null);
  assert.equal(hotelRebaseIsWorthwhile(null, true), false);
  assert.equal(hotelRebaseIsWorthwhile(evaluations[0], true), false, "an unsafe candidate is never worthwhile");
});

test("ranking is stable for candidates that are equal on every axis", () => {
  const identical = (id: string) => ({ candidate: { id, score: 5 }, plan: planWith({ travelMinutes: 100, lateMinutes: 0 }) });
  const forward = rankHotelCandidates<FakeCandidate>({ currentPlan: CURRENT, locale: "en", candidates: [identical("b"), identical("a"), identical("c")] });
  const reversed = rankHotelCandidates<FakeCandidate>({ currentPlan: CURRENT, locale: "en", candidates: [identical("c"), identical("b"), identical("a")] });
  assert.deepEqual(forward.map((entry) => entry.candidate.id), ["a", "b", "c"]);
  assert.deepEqual(reversed.map((entry) => entry.candidate.id), ["a", "b", "c"]);
});

test("both automatic hotel paths run the gate, and neither ranks on travel time alone", () => {
  const buildSource = readFileSync(new URL("../app/components/planner/hooks/usePlanBuild.tsx", import.meta.url), "utf8");
  const hotelSource = readFileSync(new URL("../app/components/planner/hooks/useHotels.tsx", import.meta.url), "utf8");

  assert.match(buildSource, /rankHotelCandidates\(\{/, "the build attach must score candidates against the trip");
  assert.match(buildSource, /safestHotelCandidate\(hotelEvaluations\)/, "only a safe candidate may be adopted");
  assert.doesNotMatch(
    buildSource,
    /\.sort\(\(left, right\) => left\.travelMinutes - right\.travelMinutes/,
    "the travel-time-only ranking must be gone",
  );

  assert.match(hotelSource, /rankHotelCandidates\(\{/, "the re-search must score candidates against the trip");
  assert.match(hotelSource, /hotelRebaseIsWorthwhile\(/, "a working base needs a real reason to move");
  assert.match(hotelSource, /if \(adoption\) \{\n\s*attachPlannerBase\(/, "only an adopted candidate rebases");
  assert.doesNotMatch(
    hotelSource,
    /attachPlannerBase\(hotelAsResolvedBase\(selected,/,
    "the unconditional re-search rebase must be gone",
  );
});
