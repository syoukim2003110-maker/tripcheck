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
  // Restoring a removed stop is an edit too: the returning visit spends
  // minutes and can push a booked stop late or breach the airport cutoff.
  const restoreStart = hookSource.indexOf("function restoreRemovedStop(");
  assert.ok(restoreStart >= 0, "restoreRemovedStop must exist");
  const restoreBody = hookSource.slice(restoreStart, hookSource.indexOf("\n  function ", restoreStart + 1));
  assert.match(restoreBody, /applyGuardedEdit\(\{/, "restoring a stop must run the simulate-then-confirm pipeline");
  assert.match(restoreBody, /contextPatch: \{ excludedStopIds: next\.map/);

  // Accepting an alternative is an edit as well. Every branch of
  // applyTripAlternative that changes the plan runs the guard — the only
  // exceptions are CHANGE_DAYS and REMOVE_OPTIONAL, which delegate to
  // changeTripDays / removeStopFromPlan (both guarded in their own right).
  const alternativeStart = hookSource.indexOf("function applyTripAlternative(");
  assert.ok(alternativeStart >= 0, "applyTripAlternative must exist");
  const alternativeBody = hookSource.slice(alternativeStart, hookSource.indexOf("\n  return {", alternativeStart));
  for (const [kind, delegate] of [
    ["CHANGE_DAYS", /changeTripDays\(alternative\.change\.days\)/],
    ["START_EARLIER", null],
    ["END_LATER", null],
    ["CHANGE_BASE", null],
    ["CHANGE_MODE", null],
    ["OPTIMIZE_ORDER", null],
    ["REMOVE_OPTIONAL", /removeStopFromPlan\(stop\)/],
  ] as const) {
    const branchStart = alternativeBody.indexOf(`alternative.kind === "${kind}"`);
    assert.ok(branchStart >= 0, `${kind} branch must exist`);
    const nextBranch = alternativeBody.indexOf("} else if", branchStart);
    const branch = alternativeBody.slice(branchStart, nextBranch > branchStart ? nextBranch : undefined);
    if (delegate) {
      assert.match(branch, delegate, `${kind} must delegate to a guarded action`);
      continue;
    }
    assert.match(branch, /applyGuardedEdit\(\{/, `${kind} must run the simulate-then-confirm pipeline`);
    // …and the commit must sit INSIDE that pipeline's apply callback, never
    // ahead of it, which is exactly how these branches used to bypass it.
    const commitIndex = branch.indexOf("commitPlannerEdit(");
    if (commitIndex >= 0) {
      assert.ok(
        commitIndex > branch.indexOf("applyGuardedEdit({"),
        `${kind} commits before it asks — the guard is bypassed`,
      );
    }
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

// DoD-PLAN-5 / TC-051: base changes are plan-affecting edits like any other —
// a base swap can silently make a booking late (spec §8.2 case 4).
test("hotel swaps and CHANGE_BASE alternatives run the hard-conflict guard; accepts commit through history", () => {
  const hookSource = readFileSync(new URL("../app/components/planner/hooks/usePlannerEdits.tsx", import.meta.url), "utf8");
  const hotelSource = readFileSync(new URL("../app/components/planner/hooks/useHotels.tsx", import.meta.url), "utf8");

  // A user-initiated hotel selection simulates the candidate plan and asks
  // before applying new hard damage; clean swaps commit as ONE history op.
  assert.match(hotelSource, /evaluatePlannerHardEdit\(\{/, "selectHotelCandidate must run the shared evaluation");
  assert.match(hotelSource, /commitPlannerEdit\(\{ resolvedBase: nextBase \}/, "a user hotel swap must be a history operation");
  assert.match(hotelSource, /attachPlannerBase\(nextBase\)/, "system base handovers must rebase, not commit");
  assert.match(hotelSource, /setPendingHardEdit\(\{ title: evaluation.title/, "a damaging swap must queue the confirm dialog");

  // The CHANGE_BASE alternative goes through applyGuardedEdit with the base patched in.
  const changeBaseStart = hookSource.indexOf('alternative.kind === "CHANGE_BASE"');
  assert.ok(changeBaseStart >= 0);
  const changeBaseBody = hookSource.slice(changeBaseStart, hookSource.indexOf("} else if", changeBaseStart));
  assert.match(changeBaseBody, /applyGuardedEdit\(\{/, "CHANGE_BASE must run the simulate-then-confirm pipeline");
  assert.match(changeBaseBody, /contextPatch: \{ resolvedBase: nextBase \}/);

  // TC-048/TC-050: meal and gap accepts are single history operations.
  const acceptCommits = hookSource.match(/commitPlannerEdit\(\{\s*itinerary: candidateItinerary,/g) ?? [];
  assert.equal(acceptCommits.length, 2, "both the meal accept and the gap accept must commit through history");
  assert.doesNotMatch(hookSource, /setResolvedStops\(\(current\)/, "accepts must not mutate tracked state outside history");
});
