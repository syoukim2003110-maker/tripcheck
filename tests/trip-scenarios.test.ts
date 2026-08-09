import assert from "node:assert/strict";
import test from "node:test";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import { assessTripFit, generateTripCounterfactuals } from "../lib/trip-scenarios.ts";

const eightPlaces = `Ghibli Museum
Shibuya Sky
Senso-ji
Tokyo Skytree
teamLab Planets
Tsukiji Outer Market
Meiji Jingu
Akihabara`;

function unevenDurationFixture() {
  const definitions = [
    { id: "long-a", name: "Long A", latitude: 35, longitude: 139, minutes: 420 },
    { id: "long-b", name: "Long B", latitude: 35.0001, longitude: 139.0001, minutes: 420 },
    { id: "short-c", name: "Short C", latitude: 35, longitude: 140, minutes: 30 },
    { id: "short-d", name: "Short D", latitude: 35.0001, longitude: 140.0001, minutes: 30 },
  ];
  return {
    raw: definitions.map(({ name }) => name).join("\n"),
    context: {
      tripStartDate: "2026-09-01",
      defaultDayStart: "09:00",
      dayEndTarget: "22:00",
      transferBufferMinutes: 0 as const,
      resolvedStops: definitions.map(({ id, name, latitude, longitude, minutes }, inputIndex) => ({
        id,
        input: name,
        inputIndex,
        name,
        area: "Test",
        address: `${name} address`,
        latitude,
        longitude,
        sourceUrl: `https://example.com/${id}`,
        verifiedAt: "2026-08-09T00:00:00Z",
        confidence: "medium" as const,
        planningDurationMinutes: minutes,
        isAnchor: false,
      })),
    },
  };
}

test("finds the minimum trip length with the deterministic planner", () => {
  const context = {};
  const current = buildTripFromWishlist(eightPlaces, 1, "balanced", "en", context);
  const fit = assessTripFit(eightPlaces, 1, "balanced", "en", context, current);

  assert.equal(fit.minimumDays, 2);
  assert.equal(fit.additionalDaysNeeded, 1);
  assert.equal(fit.status, "needs_change");
});

test("minimum-days search reassigns uneven stays and binds assumptions to the feasible candidate", () => {
  const fixture = unevenDurationFixture();
  const selected = buildTripFromWishlist(fixture.raw, 2, "balanced", "en", fixture.context);
  const selectedFit = assessTripFit(fixture.raw, 2, "balanced", "en", fixture.context, selected);
  assert.equal(selectedFit.minimumDays, 2, "geographic long/long seeding must not produce a false three-day minimum");
  assert.equal(selectedFit.status, "fits");

  const oneDay = buildTripFromWishlist(fixture.raw, 1, "balanced", "en", fixture.context);
  const fromOneDay = assessTripFit(fixture.raw, 1, "balanced", "en", fixture.context, oneDay);
  assert.equal(fromOneDay.minimumDays, 2);
  assert.equal(fromOneDay.additionalDaysNeeded, 1);
  assert.deepEqual(fromOneDay.minimumDaysAssumptions.dates, ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(fromOneDay.minimumDaysAssumptions.dayWindows, [
    { dayIndex: 0, start: "09:00", end: "22:00" },
    { dayIndex: 1, start: "09:00", end: "22:00" },
  ]);
});

test("reports spare days when the wishlist needs less time than selected", () => {
  const current = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 3, "balanced");
  const fit = assessTripFit("Senso-ji\nTokyo Skytree", 3, "balanced", "en", {}, current);

  assert.equal(fit.minimumDays, 1);
  assert.equal(fit.spareDays, 2);
  assert.equal(fit.additionalDaysNeeded, 0);
});

test("subtracts arrival and airport departure constraints from usable time", () => {
  const context = {
    hotelQuery: "Ueno hotel",
    arrivalAirport: "HND",
    arrivalTime: "16:00",
    departureAirport: "NRT",
    departureTime: "14:00",
    flightKind: "international" as const,
  };
  const current = buildTripFromWishlist("Senso-ji\nTokyo Skytree", 2, "balanced", "en", context);
  const fit = assessTripFit("Senso-ji\nTokyo Skytree", 2, "balanced", "en", context, current);

  assert.equal(fit.days[0].startTime, "18:30");
  assert.equal(fit.days[0].usableUntil, "22:00");
  assert.equal(fit.days[0].availableMinutes, 210);
  assert.equal(fit.days[1].limitedBy, "airport");
  assert.equal(fit.days[1].usableUntil, "10:15");
  assert.equal(fit.days[1].availableMinutes, 75);
});

test("evaluates each day against its own end time", () => {
  const raw = "Senso-ji — Day 1\nTokyo Skytree — Day 2";
  const context = {
    dayStartTimes: { 0: "09:00", 1: "10:00" },
    dayEndTarget: "22:00",
    dayEndTimes: { 0: "12:00", 1: "23:00" },
  };
  const current = buildTripFromWishlist(raw, 2, "balanced", "en", context);
  const fit = assessTripFit(raw, 2, "balanced", "en", context, current);

  assert.equal(fit.days[0].usableUntil, "12:00");
  assert.equal(fit.days[0].availableMinutes, 180);
  assert.equal(fit.days[1].usableUntil, "23:00");
  assert.equal(fit.days[1].availableMinutes, 780, "the user's clock window, not a hidden pace cap");
});

test("never suggests dropping a must-do or booked stop", () => {
  const raw = `Ghibli Museum — must
Shibuya Sky — 10:00 booked
Senso-ji
Tokyo Skytree
teamLab Planets`;
  const current = buildTripFromWishlist(raw, 1, "balanced");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, current);
  const ids = new Set(fit.cutCandidates.map((candidate) => candidate.id));

  assert.equal(ids.has("ghibli-museum"), false);
  assert.equal(ids.has("shibuya-sky"), false);
  assert.ok(fit.cutCandidates.length > 0);
});

test("does not shorten below an explicitly pinned day", () => {
  const raw = "Senso-ji\nTokyo Skytree — Day 3";
  const current = buildTripFromWishlist(raw, 4, "balanced");
  const fit = assessTripFit(raw, 4, "balanced", "en", {}, current);

  assert.equal(fit.minimumDays, 3);
  assert.equal(fit.spareDays, 1);
});

test("never calls a plan with an impossible fixed reservation a fit", () => {
  const raw = "teamLab Planets — Day 1 12:00 booked";
  const context = {
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    flightKind: "international" as const,
  };
  const current = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, current);

  assert.equal(current.scheduleConflictCount, 1);
  assert.equal(fit.status, "needs_change");
  assert.equal(fit.minimumDays, null);
  assert.equal(fit.scheduleConflictCount, 1);
  assert.equal(fit.days[0].hasScheduleConflict, true);
});

test("does not report spare days while the selected plan still has a conflict", () => {
  const raw = "Senso-ji";
  const otherwiseValid = buildTripFromWishlist(raw, 3, "balanced");
  const conflictedCurrent = {
    ...otherwiseValid,
    scheduleConflictCount: 1,
    days: otherwiseValid.days.map((day, index) => index === 0
      ? { ...day, reservationConflictCount: 1 }
      : day),
  };
  const fit = assessTripFit(raw, 3, "balanced", "en", {}, conflictedCurrent);

  assert.equal(fit.minimumDays, 1);
  assert.equal(fit.status, "needs_change");
  assert.equal(fit.spareDays, null);
});

test("ignores the day pin of a stop the traveller removed", () => {
  const raw = "Senso-ji\nTokyo Skytree — Day 3";
  const context = { excludedStopIds: ["tokyo-skytree"] };
  const current = buildTripFromWishlist(raw, 4, "balanced", "en", context);
  const fit = assessTripFit(raw, 4, "balanced", "en", context, current);

  assert.equal(current.minimumPinnedDay, 1);
  assert.equal(fit.minimumDays, 1);
  assert.equal(fit.spareDays, 3);
});

test("never proposes a scenario beyond the supported fourteen-day horizon", () => {
  const raw = "Senso-ji — Day 20";
  const current = buildTripFromWishlist(raw, 1, "balanced");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, current);

  assert.equal(current.minimumPinnedDay, 20);
  assert.equal(fit.minimumDays, null);
  assert.equal(fit.searchedThroughDays, 0, "a day-20 hard pin is outside the supported horizon, so no fake search is reported");
});

test("labels unresolved places as incomplete instead of claiming a clean fit", () => {
  const raw = "Senso-ji\nA private cafe from my notes";
  const current = buildTripFromWishlist(raw, 1, "balanced");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, current);

  assert.equal(fit.status, "incomplete");
  assert.equal(fit.unresolvedCount, 1);
  assert.equal(fit.minimumDays, null);
  assert.equal(fit.additionalDaysNeeded, null);
  assert.equal(fit.spareDays, null);
  assert.deepEqual(fit.cutCandidates, []);
  assert.equal(fit.suggestedCutCount, 0);
});

test("keeps place-count load as a soft diagnostic while resolution is incomplete", () => {
  const raw = `${eightPlaces}\nA private cafe from my notes`;
  const current = buildTripFromWishlist(raw, 1, "balanced");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, current);

  assert.equal(fit.status, "incomplete");
  assert.ok(fit.days.some((day) => day.excessPlaceCount > 0));
  assert.equal(fit.minimumDays, null);
  assert.equal(fit.additionalDaysNeeded, null);
  assert.equal(fit.spareDays, null);
  assert.deepEqual(fit.cutCandidates, []);
  assert.equal(fit.suggestedCutCount, 0);
});

test("treats an unavailable optional stop as a declared trade-off, not a hard conflict", () => {
  const raw = "Senso-ji\nTokyo Skytree — optional";
  const context = {
    openingWindowsByDay: {
      "tokyo-skytree": { 0: [] },
    },
  };
  const current = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, current);

  assert.deepEqual(current.deferredUnavailableStops, []);
  assert.deepEqual(current.deferredOptionalStops.map((stop) => stop.id), ["tokyo-skytree"]);
  assert.equal(fit.unavailableCount, 0);
  assert.notEqual(fit.status, "incomplete");
});

test("withholds fit and cut conclusions when a known place is unavailable", () => {
  const raw = "Senso-ji\nTokyo Skytree";
  const context = {
    openingWindowsByDay: {
      sensoji: { 0: [], 1: [] },
    },
  };
  const current = buildTripFromWishlist(raw, 2, "balanced", "en", context);
  const fit = assessTripFit(raw, 2, "balanced", "en", context, current);

  assert.equal(fit.status, "incomplete");
  assert.equal(fit.unavailableCount, 1);
  assert.equal(fit.days.flatMap((day) => day.placeCount).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(fit.minimumDays, null);
  assert.equal(fit.additionalDaysNeeded, null);
  assert.equal(fit.spareDays, null);
  assert.deepEqual(fit.cutCandidates, []);
  assert.equal(fit.suggestedCutCount, 0);
});

test("binds a minimum-day answer to the exact planning assumptions", () => {
  const raw = "Senso-ji — Day 1 10:00 booked\nTokyo Skytree";
  const context = {
    tripStartDate: "2026-09-14",
    hotelQuery: "Ueno hotel",
    dayStartTimes: { 0: "08:30" },
    dayEndTimes: { 0: "20:30" },
    transferBufferMinutes: 20 as const,
    legModeOverrides: { "sensoji::tokyo-skytree": "walk" as const },
  };
  const current = buildTripFromWishlist(raw, 2, "balanced", "en", context);
  const fit = assessTripFit(raw, 2, "balanced", "en", context, current);

  assert.equal(fit.minimumDaysAssumptions.dates[0], "2026-09-14");
  assert.deepEqual(fit.minimumDaysAssumptions.dayWindows[0], { dayIndex: 0, start: "08:30", end: "20:30" });
  assert.equal(fit.minimumDaysAssumptions.transferBufferMinutes, 20);
  assert.deepEqual(fit.minimumDaysAssumptions.lockedModes, [{ legId: "sensoji::tokyo-skytree", mode: "walk" }]);
  assert.ok(fit.minimumDaysAssumptions.fixedBookings.some((booking) => booking.stopId === "sensoji" && booking.time === "10:00"));
  assert.ok(fit.minimumDaysAssumptions.stayDurations.some((stay) => stay.stopId === "tokyo-skytree"));
});

test("returns an explicit timeout instead of a minimum-day claim", () => {
  const raw = eightPlaces;
  const current = buildTripFromWishlist(raw, 1, "balanced");
  let tick = 0;
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, current, 14, {
    timeoutMs: 1,
    now: () => tick++,
  });

  assert.equal(fit.solverTimedOut, true);
  assert.equal(fit.status, "timed_out");
  assert.equal(fit.minimumDays, null);
});

test("the three-option shortlist retains a complete one-change repair when one exists", () => {
  const current = buildTripFromWishlist(eightPlaces, 1, "balanced", "en", { dayEndTarget: "18:00" });
  const fit = assessTripFit(eightPlaces, 1, "balanced", "en", { dayEndTarget: "18:00" }, current);
  const alternatives = generateTripCounterfactuals(
    eightPlaces,
    1,
    "balanced",
    "en",
    { dayEndTarget: "18:00" },
    current,
    fit,
  );

  assert.ok(alternatives.length <= 3);
  assert.ok(alternatives.some((alternative) => (
    alternative.kind !== "OPTIMIZE_ORDER"
      && alternative.after.hardConflictCount === 0
      && alternative.after.overrunMinutes === 0
  )), "a feasible repair must not be displaced by a nicer but still-conflicted comparison");
});

test("a transport alternative is re-solved with the compared day's order locked", () => {
  const raw = "Senso-ji\nTokyo Skytree";
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, plan);
  const alternatives = generateTripCounterfactuals(raw, 1, "balanced", "en", {}, plan, fit);
  const mode = alternatives.find((entry) => entry.kind === "CHANGE_MODE");

  assert.ok(mode, "a faster deterministic mode can be compared without an AI suggestion");
  assert.equal(mode.change.legId, "sensoji::tokyo-skytree");
  assert.equal(mode.change.mode, "taxi");
  assert.equal(mode.loss?.kind, "TRANSPORT_TRADEOFF");
  assert.ok((mode.improvement.slackMinutesGained ?? 0) > 0);
  assert.deepEqual(plan.days[0].stops.map((entry) => entry.stop.id), ["sensoji", "tokyo-skytree"], "the current plan remains untouched");
});

test("an existing itinerary compares its pasted order with a shorter in-day order", () => {
  const raw = "Day 1\nSenso-ji\nShibuya Sky\nTokyo Skytree";
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, plan);
  const alternatives = generateTripCounterfactuals(raw, 1, "balanced", "en", {}, plan, fit);
  const optimized = alternatives.find((entry) => entry.kind === "OPTIMIZE_ORDER");

  assert.deepEqual(plan.days[0].stops.map((entry) => entry.stop.id), ["sensoji", "shibuya-sky", "tokyo-skytree"], "the pasted order is the original verdict");
  assert.ok(optimized, "Flow B always exposes a genuinely shorter order when one exists");
  assert.ok((optimized.change.travelMinutesSaved ?? 0) > 0);
  assert.equal(optimized.loss?.kind, "ORIGINAL_ORDER");
  assert.notDeepEqual(optimized.change.orderByDay?.[0], plan.days[0].stops.map((entry) => entry.stop.id));

  const applied = buildTripFromWishlist(raw, 1, "balanced", "en", { lockedOrderByDay: optimized.change.orderByDay });
  assert.deepEqual(applied.days[0].stops.map((entry) => entry.stop.id), optimized.change.orderByDay?.[0]);
  assert.equal(applied.days[0].label, plan.days[0].label, "day assignment remains fixed while order changes");
});
