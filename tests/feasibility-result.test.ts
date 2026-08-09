import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanSnapshot,
  createPlannerEvidenceSnapshot,
  deriveFeasibilityResult,
  hashEvidenceFacts,
  type CriticalFact,
  type EvidenceStatus,
  type PlannerEvidenceSnapshot,
} from "../lib/feasibility-result.ts";
import { buildTripFromWishlist, type TripPlannerContext } from "../lib/trip-builder.ts";
import { assessTripFit, generateTripCounterfactuals } from "../lib/trip-scenarios.ts";

function fact(id: string, status: EvidenceStatus): CriticalFact {
  return {
    id,
    kind: id.startsWith("hours") ? "opening_hours" : id.startsWith("route") ? "route_leg" : "place_identity",
    label: id,
    evidence: {
      value: status === "unknown" || status === "failed" ? null : 1,
      status,
      source: status === "user_provided" ? "user" : status === "verified" ? "google" : "derived",
    },
  };
}

function snapshot(statuses: EvidenceStatus[], solverTimedOut = false): PlannerEvidenceSnapshot {
  const facts = statuses.map((status, index) => fact(`fact-${index}`, status));
  return {
    facts,
    capturedAt: "2026-08-09T00:00:00.000Z",
    providerSnapshotHash: hashEvidenceFacts(facts),
    ...(solverTimedOut ? { solverTimedOut: true } : {}),
  };
}

function cleanPlan() {
  const raw = "Senso-ji\nTokyo Skytree";
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, plan);
  return { raw, plan, fit };
}

test("maps explicit evidence to the five feasibility states without upgrading uncertainty", () => {
  const { plan, fit } = cleanPlan();
  assert.equal(deriveFeasibilityResult(plan, fit, snapshot(["verified", "user_provided"])).state, "VERIFIED_FEASIBLE");
  assert.equal(deriveFeasibilityResult(plan, fit, snapshot(["verified", "estimated"])).state, "PROVISIONAL_FEASIBLE");
  assert.equal(deriveFeasibilityResult(plan, fit, snapshot(["verified", "unknown"])).state, "FEASIBLE_IF_ASSUMPTIONS");
  assert.equal(deriveFeasibilityResult(plan, fit, snapshot(["verified"], true)).state, "UNKNOWN");

  const raw = "teamLab Planets — Day 1 12:00 booked";
  const conflictPlan = buildTripFromWishlist(raw, 1, "balanced", "en", {
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    flightKind: "international",
  });
  const conflictFit = assessTripFit(raw, 1, "balanced", "en", {
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    flightKind: "international",
  }, conflictPlan);
  assert.equal(deriveFeasibilityResult(conflictPlan, conflictFit, snapshot(["verified"])).state, "INFEASIBLE_HARD_CONFLICT");

  const unknownRaw = "Senso-ji\nA private cafe from my notes";
  const unknownPlan = buildTripFromWishlist(unknownRaw, 1, "balanced", "en");
  const unknownFit = assessTripFit(unknownRaw, 1, "balanced", "en", {}, unknownPlan);
  assert.equal(deriveFeasibilityResult(unknownPlan, unknownFit, snapshot(["verified"])).state, "UNKNOWN");
});

test("counts verified, user-provided, estimated and unknown critical facts", () => {
  const { plan, fit } = cleanPlan();
  const result = deriveFeasibilityResult(plan, fit, snapshot([
    "verified",
    "user_provided",
    "estimated",
    "unknown",
    "failed",
  ]));

  assert.deepEqual(result.criticalFacts, {
    total: 5,
    verified: 2,
    estimated: 1,
    unknown: 2,
    userProvided: 1,
  });
  assert.notEqual(result.state, "VERIFIED_FEASIBLE");
});

test("returns structured booking and airport conflicts with affected items and overrun", () => {
  const raw = "teamLab Planets — Day 1 12:00 booked";
  const context = {
    arrivalAirport: "HND",
    arrivalTime: "10:00",
    departureAirport: "HND",
    departureTime: "13:00",
    flightKind: "international" as const,
  };
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, plan);
  const result = deriveFeasibilityResult(plan, fit, snapshot(["verified"]));

  assert.equal(result.state, "INFEASIBLE_HARD_CONFLICT");
  assert.ok(result.conflicts.some((entry) => entry.code === "FIXED_BOOKING_LATE"));
  assert.ok(result.conflicts.some((entry) => entry.code === "AIRPORT_CUTOFF"));
  assert.ok(result.conflicts.every((entry) => Array.isArray(entry.affectedItems) && Array.isArray(entry.evidenceIds)));
  assert.ok(result.primaryConflict);
});

test("builds a fact-level snapshot without treating a resolved pin as verified hours", () => {
  const { plan } = cleanPlan();
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: false,
    baseWasProvided: false,
    dayEndWasProvided: false,
    capturedAt: "2026-08-09T00:00:00.000Z",
  });

  assert.equal(evidence.facts.filter((entry) => entry.kind === "place_identity" && entry.evidence.status === "verified").length, 2);
  assert.equal(evidence.facts.filter((entry) => entry.kind === "opening_hours" && entry.evidence.status === "unknown").length, 3, "two place-hour facts plus the provisional trip date");
  assert.ok(evidence.facts.some((entry) => entry.kind === "stay_duration" && entry.evidence.status === "estimated"));
  assert.ok(evidence.facts.some((entry) => entry.id === "base" && entry.evidence.status === "unknown"));
});

test("same facts and engine inputs produce an identical result and snapshot", () => {
  const { plan, fit } = cleanPlan();
  const evidence = snapshot(["verified", "estimated", "unknown"]);
  const serialized = Array.from({ length: 100 }, () => {
    const result = deriveFeasibilityResult(plan, fit, evidence);
    return JSON.stringify(createPlanSnapshot("trip-1", plan, result, {
      createdAt: "2026-08-09T00:00:00.000Z",
      seed: 7,
    }));
  });

  assert.equal(new Set(serialized).size, 1);
});

test("returns no more than three deterministic alternatives and declares any loss", () => {
  const raw = `Ghibli Museum
Shibuya Sky
Senso-ji
Tokyo Skytree
teamLab Planets
Tsukiji Outer Market
Meiji Jingu
Akihabara — optional`;
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, plan);
  const alternatives = generateTripCounterfactuals(raw, 1, "balanced", "en", {}, plan, fit);
  const result = deriveFeasibilityResult(plan, fit, snapshot(["verified"]), alternatives);

  assert.ok(result.alternatives.length <= 3);
  assert.equal(result.alternatives[0]?.kind, "CHANGE_DAYS");
  const removal = result.alternatives.find((entry) => entry.kind === "REMOVE_OPTIONAL");
  if (removal?.kind === "REMOVE_OPTIONAL") {
    assert.equal(removal.loss?.kind, "OPTIONAL_STOP");
    assert.ok(removal.improvement.overrunMinutesReduced > 0 || removal.improvement.hardConflictsRemoved > 0 || (removal.improvement.slackMinutesGained ?? 0) > 0);
  }
});

test("every structured conflict references facts that exist in the same evidence snapshot", () => {
  const cases: Array<{
    raw: string;
    days: number;
    context: TripPlannerContext;
    evidence: Record<string, { fetchedAt: string; dateSpecific: boolean }>;
  }> = [
    {
      raw: "Senso-ji — Day 1 10:00 booked",
      days: 1,
      context: {
        openingWindowsByDay: { sensoji: { 0: [{ openMinutes: 11 * 60, closeMinutes: 17 * 60 }] } },
      },
      evidence: { sensoji: { fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: true } },
    },
    {
      raw: "Senso-ji",
      days: 1,
      context: { defaultDayStart: "09:00", dayEndTarget: "09:15" },
      evidence: {},
    },
    {
      raw: "Senso-ji",
      days: 2,
      context: { openingWindowsByDay: { sensoji: { 0: [], 1: [] } } },
      evidence: { sensoji: { fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: true } },
    },
  ];

  for (const scenario of cases) {
    const plan = buildTripFromWishlist(scenario.raw, scenario.days, "balanced", "en", scenario.context);
    const fit = assessTripFit(scenario.raw, scenario.days, "balanced", "en", scenario.context, plan);
    const evidence = createPlannerEvidenceSnapshot(plan, {
      dateWasProvided: true,
      baseWasProvided: false,
      dayEndWasProvided: "dayEndTarget" in scenario.context,
      capturedAt: "2026-08-09T00:00:00.000Z",
      openingEvidenceByStop: scenario.evidence,
    });
    const ids = new Set(evidence.facts.map((entry) => entry.id));
    const result = deriveFeasibilityResult(plan, fit, evidence);
    assert.ok(result.conflicts.length > 0, scenario.raw);
    for (const conflict of result.conflicts) {
      assert.ok(conflict.evidenceIds.length > 0, `${conflict.code} must explain itself`);
      assert.ok(conflict.evidenceIds.every((id) => ids.has(id)), `${conflict.code} has a dangling evidence id`);
    }
  }
});

test("coverage retains deferred optional and unavailable requested places", () => {
  const optionalRaw = "Senso-ji\nTokyo Skytree — optional";
  const optionalContext = { openingWindowsByDay: { "tokyo-skytree": { 0: [] } } };
  const optionalPlan = buildTripFromWishlist(optionalRaw, 1, "balanced", "en", optionalContext);
  const optionalEvidence = createPlannerEvidenceSnapshot(optionalPlan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
  });
  assert.ok(optionalEvidence.facts.some((entry) => entry.id === "place:tokyo-skytree"));
  assert.ok(optionalEvidence.facts.some((entry) => entry.id === "hours:tokyo-skytree:deferred"));

  const unavailableRaw = "Senso-ji";
  const unavailableContext = { openingWindowsByDay: { sensoji: { 0: [], 1: [] } } };
  const unavailablePlan = buildTripFromWishlist(unavailableRaw, 2, "balanced", "en", unavailableContext);
  const unavailableEvidence = createPlannerEvidenceSnapshot(unavailablePlan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    openingEvidenceByStop: { sensoji: { fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: true } },
  });
  assert.ok(unavailableEvidence.facts.some((entry) => entry.id === "place:sensoji"));
  assert.ok(unavailableEvidence.facts.some((entry) => entry.id === "hours:sensoji:unavailable"));
});

test("failed and typical-week opening hours stay explicit and cannot create a verified hard conflict", () => {
  const { plan, fit } = cleanPlan();
  const failed = snapshot(["verified"]);
  failed.facts.push(fact("hours:provider-failed", "failed"));
  failed.providerSnapshotHash = hashEvidenceFacts(failed.facts);
  const failedResult = deriveFeasibilityResult(plan, fit, failed);
  assert.equal(failedResult.state, "FEASIBLE_IF_ASSUMPTIONS");
  assert.ok(failedResult.assumptions.some((entry) => entry.code === "OPENING_HOURS_UNKNOWN" && entry.evidenceIds.includes("hours:provider-failed")));

  const raw = "Senso-ji — Day 1";
  const context = { openingWindowsByDay: { sensoji: { 0: [] } } };
  const closedPlan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const closedFit = assessTripFit(raw, 1, "balanced", "en", context, closedPlan);
  const weeklyEvidence = createPlannerEvidenceSnapshot(closedPlan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    openingEvidenceByStop: { sensoji: { fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: false } },
  });
  const result = deriveFeasibilityResult(closedPlan, closedFit, weeklyEvidence);
  assert.equal(weeklyEvidence.facts.find((entry) => entry.id.startsWith("hours:sensoji:"))?.evidence.status, "estimated");
  assert.equal(result.conflicts.some((entry) => entry.code === "CLOSED_ON_FIXED_DAY"), false);
  assert.notEqual(result.state, "INFEASIBLE_HARD_CONFLICT");
});

test("per-day window provenance does not upgrade untouched days", () => {
  const raw = "Senso-ji\nTokyo Skytree";
  const context = { dayStartTimes: { 0: "08:30" }, dayEndTimes: { 0: "20:00" } };
  const plan = buildTripFromWishlist(raw, 2, "balanced", "en", context);
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    dayStartTimes: context.dayStartTimes,
    dayEndTimes: context.dayEndTimes,
  });

  assert.equal(evidence.facts.find((entry) => entry.id === "day-start:Day 1")?.evidence.status, "user_provided");
  assert.equal(evidence.facts.find((entry) => entry.id === "day-end:Day 1")?.evidence.status, "user_provided");
  assert.equal(evidence.facts.find((entry) => entry.id === "day-start:Day 2")?.evidence.status, "estimated");
  assert.equal(evidence.facts.find((entry) => entry.id === "day-end:Day 2")?.evidence.status, "estimated");
});

test("a user-entered reservation search link is not provider verification", () => {
  const raw = "Sushi Dai Ginza — 12:00 booked";
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en");
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
  });
  const identity = evidence.facts.find((entry) => entry.kind === "place_identity" && entry.label.includes("Sushi Dai"));
  assert.equal(identity?.evidence.status, "unknown");
});

test("does not offer removing an Optional stop that is already outside the schedule", () => {
  const raw = "Senso-ji\nTokyo Skytree — optional";
  const context = { openingWindowsByDay: { "tokyo-skytree": { 0: [] } } };
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, plan);
  const result = deriveFeasibilityResult(plan, fit, snapshot(["verified"]));

  assert.deepEqual(plan.deferredOptionalStops.map((stop) => stop.id), ["tokyo-skytree"]);
  assert.equal(result.alternatives.some((entry) => entry.kind === "REMOVE_OPTIONAL" && entry.change.stopId === "tokyo-skytree"), false);
});

test("route provenance verifies only the exact duration consumed by the solver", () => {
  const raw = "Senso-ji\nteamLab Planets";
  const baseline = buildTripFromWishlist(raw, 1, "balanced", "en");
  const baselineLeg = baseline.days[0].legs[0];
  const key = `${baselineLeg.from.id}::${baselineLeg.to.id}`;
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", { liveTransitMinutes: { [key]: 17 } });
  const evidenceOptions = {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
  };
  const factId = `route:${plan.days[0].label}:${baselineLeg.from.id}:${baselineLeg.to.id}`;
  const routeEvidence = (minutes: number) => ({
    legId: key,
    mode: "transit" as const,
    departureBucket: "2026-08-09T00:00:00.000Z",
    requestKey: `transit|${encodeURIComponent(key)}|2026-08-09T00:00:00.000Z`,
    status: "verified" as const,
    fetchedAt: "2026-08-09T00:00:00.000Z",
    providerRef: "google_maps",
    minutes,
  });
  const mismatched = createPlannerEvidenceSnapshot(plan, {
    ...evidenceOptions,
    routeEvidenceByFactId: { [factId]: routeEvidence(31) },
  });
  const matched = createPlannerEvidenceSnapshot(plan, {
    ...evidenceOptions,
    routeEvidenceByFactId: { [factId]: routeEvidence(17) },
  });

  assert.equal(mismatched.facts.find((entry) => entry.id.includes(`:${baselineLeg.from.id}:${baselineLeg.to.id}`))?.evidence.status, "estimated");
  assert.equal(matched.facts.find((entry) => entry.id.includes(`:${baselineLeg.from.id}:${baselineLeg.to.id}`))?.evidence.status, "verified");
});

test("failed transit evidence stays failed and non-convergence is an explicit condition", () => {
  const raw = "Senso-ji\nteamLab Planets";
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en");
  const fit = assessTripFit(raw, 1, "balanced", "en", {}, plan);
  const leg = plan.days[0].legs.find((entry) => entry.comparison.recommended.mode === "transit");
  assert.ok(leg);
  const factId = `route:${plan.days[0].label}:${leg.from.id}:${leg.to.id}`;
  const legId = `${leg.from.id}::${leg.to.id}`;
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: {
      [factId]: {
        legId,
        mode: "transit",
        departureBucket: "2026-08-09T00:00:00.000Z",
        requestKey: `transit|${encodeURIComponent(legId)}|2026-08-09T00:00:00.000Z`,
        status: "failed",
        providerRef: "google_maps",
        minutes: null,
      },
    },
    transitConvergence: {
      nonConverged: true,
      stopReason: "max_iterations",
      iterations: 3,
      eventCount: 8,
    },
  });
  const result = deriveFeasibilityResult(plan, fit, evidence);

  assert.equal(evidence.facts.find((entry) => entry.id === factId)?.evidence.status, "failed");
  assert.ok(evidence.facts.some((entry) => entry.id === "assumption:transit-convergence" && entry.evidence.status === "unknown"));
  assert.equal(result.state, "FEASIBLE_IF_ASSUMPTIONS");
  assert.equal(result.primaryAttention?.code, "TRANSIT_NON_CONVERGED");
  assert.ok(result.assumptions.some((entry) => entry.code === "TRANSIT_NON_CONVERGED"));
});

test("a user-confirmed last-entry cutoff produces an explainable hard conflict", () => {
  const raw = "Senso-ji — Day 1";
  const context = {
    defaultDayStart: "16:40",
    durationOverrides: { sensoji: 45 },
    openingWindowsByDay: { sensoji: { 0: [{ openMinutes: 9 * 60, closeMinutes: 18 * 60 }] } },
    lastEntryTimes: { sensoji: "16:30" },
  };
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, plan);
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    lastEntryEvidenceByStop: { sensoji: { time: "16:30", status: "user_provided" } },
  });
  const result = deriveFeasibilityResult(plan, fit, evidence);
  const conflict = result.conflicts.find((entry) => entry.code === "LAST_ENTRY_CONFLICT");

  assert.equal(result.state, "INFEASIBLE_HARD_CONFLICT");
  assert.ok(conflict);
  assert.deepEqual(conflict?.evidenceIds, ["last-entry:sensoji:Day 1"]);
  assert.equal(evidence.facts.find((entry) => entry.id === "last-entry:sensoji:Day 1")?.evidence.status, "user_provided");
});

test("traveller-supplied coordinates remain user-provided rather than provider-verified", () => {
  const raw = "My saved lookout";
  const context = { resolvedStops: [{
    id: "manual-lookout",
    input: "My saved lookout",
    inputIndex: 0,
    name: "My saved lookout",
    area: "Pinned on map",
    address: "Pinned on map",
    latitude: 35.7,
    longitude: 139.7,
    sourceUrl: "",
    verifiedAt: "",
    confidence: "low" as const,
    planningDurationMinutes: 60,
    isAnchor: false,
    isUserEntered: true,
    userProvidedCoordinates: true,
  }] };
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: false,
    baseWasProvided: false,
    dayEndWasProvided: false,
  });

  const identity = evidence.facts.find((entry) => entry.id === "place:manual-lookout");
  assert.equal(identity?.evidence.status, "user_provided");
  assert.equal(identity?.evidence.source, "user");
});

test("mobility limits are evidence-backed and a locked over-limit walk is explicit", () => {
  const raw = "Senso-ji\nTokyo Skytree";
  const initial = buildTripFromWishlist(raw, 1, "balanced", "en", { maxWalkingMinutesPerLeg: 5, maxTransfersPerLeg: 1 });
  const firstLeg = initial.days[0].legs[0];
  const context = {
    maxWalkingMinutesPerLeg: 5,
    maxTransfersPerLeg: 1,
    legModeOverrides: { [`${firstLeg.from.id}::${firstLeg.to.id}`]: "walk" as const },
  };
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, plan);
  const evidence = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: false,
    baseWasProvided: false,
    dayEndWasProvided: false,
  });
  const result = deriveFeasibilityResult(plan, fit, evidence);

  assert.equal(evidence.facts.find((entry) => entry.id === "mobility:walking-limit")?.evidence.status, "user_provided");
  assert.equal(evidence.facts.find((entry) => entry.id === "mobility:transfer-limit")?.evidence.status, "user_provided");
  assert.equal(result.primaryAttention?.code, "WALKING_LIMIT_EXCEEDED");
  assert.ok((result.primaryAttention?.minutes ?? 0) > 0);
});

test("an exact over-limit transfer count is soft attention while missing step data stays unknown", () => {
  const raw = "Senso-ji\nTokyo Skytree";
  const seed = buildTripFromWishlist(raw, 1, "balanced", "en");
  const seedLeg = seed.days[0].legs[0];
  const legId = `${seedLeg.from.id}::${seedLeg.to.id}`;
  const context = {
    tripStartDate: "2026-09-14",
    maxTransfersPerLeg: 1,
    liveTransitMinutes: { [legId]: 12 },
    liveTransitTransferCounts: { [legId]: 3 },
    lockedOrderByDay: { 0: [seedLeg.from.id, seedLeg.to.id] },
    legModeOverrides: { [legId]: "transit" as const },
  };
  const plan = buildTripFromWishlist(raw, 1, "balanced", "en", context);
  const fit = assessTripFit(raw, 1, "balanced", "en", context, plan);
  const leg = plan.days[0].legs[0];
  const routeFactId = `route:${plan.days[0].label}:${leg.from.id}:${leg.to.id}`;
  const transferFactId = `transfers:${plan.days[0].label}:${leg.from.id}:${leg.to.id}`;
  const exactRouteEvidence = {
    legId,
    mode: "transit" as const,
    departureBucket: "2026-09-14T00:00:00.000Z",
    requestKey: `transit|${encodeURIComponent(legId)}|2026-09-14T00:00:00.000Z`,
    status: "verified" as const,
    fetchedAt: "2026-08-09T00:00:00.000Z",
    providerRef: "google_maps",
    minutes: 12,
    transferCount: 3,
  };
  const exactSnapshot = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: { [routeFactId]: exactRouteEvidence },
  });
  const result = deriveFeasibilityResult(plan, fit, exactSnapshot);
  const transferFact = exactSnapshot.facts.find((entry) => entry.id === transferFactId);

  assert.equal(leg.transferCount, 3);
  assert.equal(transferFact?.evidence.status, "verified");
  assert.equal(transferFact?.evidence.value, 3);
  assert.equal(result.conflicts.length, 0, "transfer preference violations are never hard conflicts");
  assert.equal(result.primaryAttention?.code, "TRANSFER_LIMIT_EXCEEDED");
  assert.equal(result.primaryAttention?.transferCount, 3);
  assert.equal(result.primaryAttention?.transferLimit, 1);

  const unknownSnapshot = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: { [routeFactId]: { ...exactRouteEvidence, transferCount: null } },
  });
  const unknownTransfer = unknownSnapshot.facts.find((entry) => entry.id === transferFactId);
  assert.equal(unknownTransfer?.evidence.status, "unknown");
  assert.equal(unknownTransfer?.evidence.value, null, "a missing step count is not silently treated as compliant");

  const wrongBucketSnapshot = createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: { [routeFactId]: { ...exactRouteEvidence, minutes: 13 } },
  });
  assert.equal(
    wrongBucketSnapshot.facts.find((entry) => entry.id === transferFactId)?.evidence.status,
    "unknown",
    "a count from evidence whose duration was not consumed cannot verify the selected leg",
  );
});
