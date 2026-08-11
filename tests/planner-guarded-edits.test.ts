import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTripFromWishlist } from "../lib/trip-builder.ts";
import {
  evaluatePlannerHardEdit,
  plannerHardEditConflicts,
} from "../lib/planner-app-state.ts";
import { hardEditBookingDelayTitle, hardEditTitles } from "../lib/presentation/planner-copy.ts";

// v1.1 TC-007: every plan-affecting edit runs the same simulate-then-confirm
// pipeline. These tests exercise the shared, framework-free evaluation that
// usePlannerEdits routes stay-time, last-entry, day-window and leg-mode edits
// through, plus the source contract that the call sites actually use it.

const bookedRaw = "Senso-ji\nteamLab Planets — Day 1 13:00 booked";
// The pasted order is a user constraint, so the optimizer cannot dodge the
// booking by resequencing the day around the longer stay.
const bookedContext = { lockedOrderByDay: { 0: ["sensoji", "teamlab-planets"] } };

test("a stay-minutes edit that makes a booked stop late queues a confirmation instead of committing", () => {
  const plan = buildTripFromWishlist(bookedRaw, 1, "balanced", "en", bookedContext);
  assert.equal(plan.days[0].stops.every((stop) => stop.reservationLateMinutes === 0), true, "the baseline must be on time");

  // The same candidate-context shape setStayMinutes builds: the user's stay
  // edit lands in durationOverrides on top of the evidence buffer.
  const candidatePlan = buildTripFromWishlist(bookedRaw, 1, "balanced", "en", {
    ...bookedContext,
    durationOverrides: { sensoji: 360 },
  });
  const evaluation = evaluatePlannerHardEdit({
    title: "Set the stay at “Senso-ji” to 360 minutes?",
    locale: "en",
    plan,
    candidatePlan,
  });

  assert.equal(evaluation.decision, "confirm", "new booking lateness must queue a confirmation");
  assert.ok(evaluation.decision === "confirm" && evaluation.conflicts.some((line) => line.includes("late for “teamLab Planets”")));
  const conflicts = plannerHardEditConflicts(plan, candidatePlan, "en");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, "booking_late");
  assert.ok(conflicts[0].minutes > 0);
});

test("a harmless stay-minutes edit still applies instantly without a confirmation", () => {
  const plan = buildTripFromWishlist(bookedRaw, 1, "balanced", "en", bookedContext);
  const candidatePlan = buildTripFromWishlist(bookedRaw, 1, "balanced", "en", {
    ...bookedContext,
    durationOverrides: { sensoji: 100 },
  });
  const evaluation = evaluatePlannerHardEdit({
    title: "Set the stay at “Senso-ji” to 100 minutes?",
    locale: "en",
    plan,
    candidatePlan,
  });
  assert.equal(evaluation.decision, "apply");
});

test("exactly one new booking delay titles the dialog with the Copy Deck delay sentence in both locales", () => {
  for (const locale of ["ja", "en"] as const) {
    const plan = buildTripFromWishlist(bookedRaw, 1, "balanced", locale, bookedContext);
    const candidatePlan = buildTripFromWishlist(bookedRaw, 1, "balanced", locale, {
      ...bookedContext,
      durationOverrides: { sensoji: 360 },
    });
    const conflicts = plannerHardEditConflicts(plan, candidatePlan, locale);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, "booking_late");
    const minutes = conflicts[0].minutes;

    const evaluation = evaluatePlannerHardEdit({
      title: hardEditTitles[locale].stayMinutes("Senso-ji", 360),
      locale,
      plan,
      candidatePlan,
    });
    assert.equal(evaluation.decision, "confirm");
    assert.ok(evaluation.decision === "confirm");
    assert.equal(evaluation.title, hardEditBookingDelayTitle(minutes, locale));
    if (locale === "ja") assert.equal(evaluation.title, `この変更で予約に${minutes}分遅れます`);
    else assert.equal(evaluation.title, `This change makes you ${minutes} minutes late`);

    // Any additional conflict keeps the caller's question-style title.
    const multi = evaluatePlannerHardEdit({
      title: hardEditTitles[locale].stayMinutes("Senso-ji", 360),
      locale,
      plan,
      candidatePlan,
      extraConflicts: ["another protected promise breaks"],
    });
    assert.equal(multi.decision, "confirm");
    assert.ok(multi.decision === "confirm");
    assert.equal(multi.title, hardEditTitles[locale].stayMinutes("Senso-ji", 360));
  }
});

test("stay, last-entry, day-window and leg-mode edits are wired through the guarded pipeline", () => {
  const hookSource = readFileSync(new URL("../app/components/planner/hooks/usePlannerEdits.tsx", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../app/components/planner/TripPlannerShell.tsx", import.meta.url), "utf8");

  // The hook owns the guarded actions and each one runs applyGuardedEdit.
  for (const action of ["setLegMode", "setStayMinutes", "setLastEntryTime", "setDayStartTime", "setDayEndTime"]) {
    const bodyStart = hookSource.indexOf(`function ${action}(`);
    assert.ok(bodyStart >= 0, `${action} must exist in usePlannerEdits`);
    const bodyEnd = hookSource.indexOf("\n  function ", bodyStart + 1);
    const body = hookSource.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined);
    assert.match(body, /applyGuardedEdit\(\{/, `${action} must run the simulate-then-confirm pipeline`);
  }
  // The shared evaluation is the single conflict detector.
  assert.match(hookSource, /evaluatePlannerHardEdit\(\{/);

  // The shell no longer commits these edits directly; it calls the guarded actions.
  assert.match(shellSource, /onCommitLastEntry=\{\(stopId, value\) => setLastEntryTime\(/);
  assert.match(shellSource, /onCommitStayMinutes=\{\(stopId, value\) => setStayMinutes\(/);
  assert.match(shellSource, /setDayStartTime\(activeDay, /);
  assert.match(shellSource, /setDayEndTime\(activeDay, /);
  assert.doesNotMatch(shellSource, /commitPlannerEdit\(\{ dayStartTimes/);
  assert.doesNotMatch(shellSource, /commitPlannerEdit\(\{ dayEndTimes/);
  assert.doesNotMatch(shellSource, /commitPlannerEdit\(\{ userStayMinutes/);
  assert.doesNotMatch(shellSource, /commitPlannerEdit\(\{ lastEntryTimes/);
});
