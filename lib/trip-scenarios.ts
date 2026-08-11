import type { Locale } from "./i18n.ts";
import {
  buildTripFromWishlist,
  routeLegKey,
  type BuiltPlanDay,
  type BuiltTripPlan,
  type Pace,
  type StopPriority,
  type TripPlannerContext,
} from "./trip-builder.ts";

const DEFAULT_DAY_END = "22:00";
const MAX_SCENARIO_DAYS = 14;

export type TripFitLimit = "airport" | "curfew";

export type TripFitDay = {
  dayIndex: number;
  label: string;
  startTime: string;
  usableUntil: string;
  availableMinutes: number;
  plannedMinutes: number;
  slackMinutes: number;
  overrunMinutes: number;
  placeCount: number;
  placeCapacity: number;
  excessPlaceCount: number;
  hasScheduleConflict: boolean;
  limitedBy: TripFitLimit;
};

export type TripCutCandidate = {
  id: string;
  name: string;
  dayIndex: number | null;
  priority: StopPriority;
  stayMinutes: number;
};

export type TripFitAssessment = {
  status: "fits" | "tight" | "needs_change" | "incomplete" | "timed_out";
  requestedDays: number;
  minimumDays: number | null;
  /**
   * Minimum days for the places that DID resolve, computed while the full
   * verdict is withheld by unresolved/unavailable entries. Clearly qualified
   * in the UI; never a substitute for minimumDays.
   */
  partialMinimumDays: number | null;
  additionalDaysNeeded: number | null;
  spareDays: number | null;
  searchedThroughDays: number;
  dayEndAssumption: string;
  solverTimedOut: boolean;
  minimumDaysAssumptions: MinimumDaysAssumptions;
  days: TripFitDay[];
  overloadedDayCount: number;
  scheduleConflictCount: number;
  deferredOptionalCount: number;
  unavailableCount: number;
  unresolvedCount: number;
  cutCandidates: TripCutCandidate[];
  suggestedCutCount: number;
};

export type MinimumDaysAssumptions = {
  dates: Array<string | null>;
  dayWindows: Array<{ dayIndex: number; start: string; end: string }>;
  base: { id: string | null; name: string | null };
  stayDurations: Array<{ stopId: string; minutes: number }>;
  lockedModes: Array<{ legId: string; mode: string }>;
  airportBoundaries: Array<{ direction: "arrival" | "departure"; airport: string; flightTime: string; cityTime: string }>;
  fixedBookings: Array<{ stopId: string; dayIndex: number; time: string }>;
  openingStatuses: Array<{ stopId: string; dayIndex: number; status: string }>;
  transferBufferMinutes: number;
  mobilityPolicy: BuiltTripPlan["mobilityPolicy"];
};

export type TripFitSearchOptions = {
  /** Wall-clock guard. A timeout never falls through to a minimum-day claim. */
  timeoutMs?: number;
  /** Test seam for deterministic timeout coverage. */
  now?: () => number;
};

export type TripScenarioMetrics = {
  hardConflictCount: number;
  overrunMinutes: number;
  minimumSlackMinutes: number | null;
  scheduledStopCount: number;
  dayCount: number;
  travelMinutes: number;
};

export type TripCounterfactualAlternative = {
  id: string;
  kind: "CHANGE_DAYS" | "START_EARLIER" | "END_LATER" | "REMOVE_OPTIONAL" | "CHANGE_BASE" | "CHANGE_MODE" | "OPTIMIZE_ORDER";
  change: {
    days?: number;
    dayDelta?: number;
    minutes?: number;
    stopId?: string;
    stopName?: string;
    baseId?: string;
    baseName?: string;
    legId?: string;
    fromName?: string;
    toName?: string;
    mode?: "walk" | "transit" | "taxi";
    orderByDay?: Record<number, string[]>;
    travelMinutesSaved?: number;
  };
  before: TripScenarioMetrics;
  after: TripScenarioMetrics;
  improvement: {
    hardConflictsRemoved: number;
    overrunMinutesReduced: number;
    slackMinutesGained: number | null;
    travelMinutesReduced: number;
  };
  loss: null | {
    kind: "OPTIONAL_STOP" | "TRANSPORT_TRADEOFF" | "ORIGINAL_ORDER";
    stopId?: string;
    stopName?: string;
    stayMinutes?: number;
    legId?: string;
    mode?: "walk" | "transit" | "taxi";
  };
};

function clockMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function paceCapacity(pace: Pace) {
  return pace === "relaxed" ? 3 : pace === "fast" ? 5 : 4;
}

function dayWindow(day: BuiltPlanDay, dayIndex: number, pace: Pace, dayEnd: string): TripFitDay {
  const start = clockMinutes(day.startTime) ?? 0;
  const ordinaryEnd = clockMinutes(dayEnd) ?? 22 * 60;
  const deadline = day.deadline ? clockMinutes(day.deadline) : null;
  // A 02:00 airport cutoff on the final calendar day is before a 09:00
  // sightseeing start, not 17 hours after it. Do not silently roll it into
  // the following day.
  const clockWindow = day.deadlinePreviousDay
    ? 0
    : deadline === null
      ? Math.max(0, ordinaryEnd - start)
      : Math.max(0, Math.min(ordinaryEnd, deadline) - start);
  // Pace and a preferred number of stops are comfort signals, not hard facts.
  // Only the traveller's usable clock window can make a day impossible.
  const availableMinutes = clockWindow;
  const placeCount = day.stops.filter((stop) => stop.kind === "place").length;
  const capacity = paceCapacity(pace);
  const overrunMinutes = Math.max(0, day.totalMinutes - availableMinutes);
  const limitedBy: TripFitLimit = deadline !== null && deadline <= ordinaryEnd && day.deadlineKind === "airport"
    ? "airport"
    : "curfew";
  return {
    dayIndex,
    label: day.label,
    startTime: day.startTime,
    usableUntil: deadline !== null && deadline <= ordinaryEnd ? day.deadline! : dayEnd,
    availableMinutes,
    plannedMinutes: day.totalMinutes,
    slackMinutes: availableMinutes - day.totalMinutes,
    overrunMinutes,
    placeCount,
    placeCapacity: capacity,
    excessPlaceCount: Math.max(0, placeCount - capacity),
    hasScheduleConflict: day.deadlineOverrunMinutes > 0
      || day.reservationConflictCount > 0
      || day.openingConflictCount > 0,
    limitedBy,
  };
}

/**
 * Total schedule buffer (余裕) of a built plan: the sum of each day's slack —
 * the usable clock window minus the planned minutes. This is the truthful
 * "how much room is left" metric the edit/accept toasts and recommendation
 * cards report as a delta between the current plan and a genuinely simulated
 * candidate plan. Slack is independent of pace (pace only shapes the comfort
 * capacity), so the fixed pace argument below changes nothing it returns.
 */
export function totalPlanBufferMinutes(plan: BuiltTripPlan, context: TripPlannerContext): number {
  return plan.days.reduce((sum, day, index) => sum + dayWindow(
    day,
    index,
    "balanced",
    context.dayEndTimes?.[index] ?? context.dayEndTarget ?? DEFAULT_DAY_END,
  ).slackMinutes, 0);
}

function evaluateCapacity(plan: BuiltTripPlan, pace: Pace, context: TripPlannerContext) {
  const days = plan.days.map((day, index) => dayWindow(
    day,
    index,
    pace,
    context.dayEndTimes?.[index] ?? context.dayEndTarget ?? DEFAULT_DAY_END,
  ));
  const overloadedDayCount = days.filter((day) => day.overrunMinutes > 0).length;
  return {
    days,
    overloadedDayCount,
    fitsAllKnownStops: overloadedDayCount === 0 && plan.scheduleConflictCount === 0,
  };
}

function suggestedCutCount(days: TripFitDay[]) {
  return days.reduce((sum, day) => {
    if (day.overrunMinutes <= 0 && day.excessPlaceCount <= 0) return sum;
    // Without asking the traveller which normal-priority experience matters
    // least, only a lower-bound count is defensible. The UI presents choices;
    // it never silently removes one.
    return sum + Math.max(1, day.excessPlaceCount);
  }, 0);
}

function cutCandidates(plan: BuiltTripPlan, fitDays: TripFitDay[]) {
  const overloaded = new Set(
    fitDays
      .filter((day) => day.overrunMinutes > 0 || day.excessPlaceCount > 0)
      .map((day) => day.dayIndex),
  );
  const candidates: TripCutCandidate[] = [];
  const seen = new Set<string>();

  // Places the traveller explicitly marked optional and the engine already
  // protected the plan from are the least-loss choices.
  for (const stop of plan.deferredOptionalStops) {
    if (seen.has(stop.id)) continue;
    seen.add(stop.id);
    candidates.push({
      id: stop.id,
      name: stop.name,
      dayIndex: null,
      priority: "optional",
      stayMinutes: stop.planningDurationMinutes,
    });
  }

  for (const day of plan.days) {
    const dayIndex = plan.days.indexOf(day);
    if (!overloaded.has(dayIndex)) continue;
    for (const built of day.stops) {
      if (
        built.kind !== "place"
        || built.priority === "must"
        || built.isReservation
        || built.fixedTime !== null
        || seen.has(built.stop.id)
      ) continue;
      seen.add(built.stop.id);
      candidates.push({
        id: built.stop.id,
        name: built.stop.name,
        dayIndex,
        priority: built.priority,
        stayMinutes: built.stop.planningDurationMinutes,
      });
    }
  }

  return candidates.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority === "optional" ? -1 : 1;
    return right.stayMinutes - left.stayMinutes;
  }).slice(0, 6);
}

function minimumDaysAssumptions(plan: BuiltTripPlan, context: TripPlannerContext): MinimumDaysAssumptions {
  const stayDurations = new Map<string, number>();
  const fixedBookings: MinimumDaysAssumptions["fixedBookings"] = [];
  const openingStatuses: MinimumDaysAssumptions["openingStatuses"] = [];
  plan.days.forEach((day, dayIndex) => {
    for (const built of day.stops) {
      if (built.kind !== "place") continue;
      stayDurations.set(built.stop.id, built.stop.planningDurationMinutes);
      if (built.fixedTime) fixedBookings.push({ stopId: built.stop.id, dayIndex, time: built.fixedTime });
      openingStatuses.push({ stopId: built.stop.id, dayIndex, status: built.openingStatus });
    }
  });
  for (const stop of [...plan.deferredOptionalStops, ...plan.deferredUnavailableStops]) {
    stayDurations.set(stop.id, stop.planningDurationMinutes);
  }
  return {
    dates: plan.days.map((day) => day.date),
    dayWindows: plan.days.map((day, dayIndex) => ({
      dayIndex,
      start: day.requestedStartTime,
      end: context.dayEndTimes?.[dayIndex] ?? context.dayEndTarget ?? DEFAULT_DAY_END,
    })),
    base: { id: plan.selectedBase?.id ?? null, name: plan.selectedBase?.name ?? null },
    stayDurations: [...stayDurations.entries()]
      .map(([stopId, minutes]) => ({ stopId, minutes }))
      .sort((left, right) => left.stopId.localeCompare(right.stopId)),
    lockedModes: Object.entries(context.legModeOverrides ?? {})
      .map(([legId, mode]) => ({ legId, mode }))
      .sort((left, right) => left.legId.localeCompare(right.legId)),
    airportBoundaries: plan.airportConstraints.map((boundary) => ({
      direction: boundary.direction,
      airport: boundary.airport,
      flightTime: boundary.flightTime,
      cityTime: boundary.cityTime,
    })),
    fixedBookings: fixedBookings.sort((left, right) => left.dayIndex - right.dayIndex || left.time.localeCompare(right.time) || left.stopId.localeCompare(right.stopId)),
    openingStatuses: openingStatuses.sort((left, right) => left.dayIndex - right.dayIndex || left.stopId.localeCompare(right.stopId)),
    transferBufferMinutes: context.transferBufferMinutes ?? 10,
    mobilityPolicy: plan.mobilityPolicy,
  };
}

/**
 * Deterministically compares the same resolved wishlist across trip lengths.
 * It performs no network or AI calls: every scenario reuses the provider data
 * already present in `context` and runs the local constraint engine only.
 */
export function assessTripFit(
  raw: string,
  requestedDays: number,
  pace: Pace,
  locale: Locale,
  context: TripPlannerContext,
  currentPlan?: BuiltTripPlan,
  maxDays = MAX_SCENARIO_DAYS,
  searchOptions: TripFitSearchOptions = {},
): TripFitAssessment {
  const normalizedRequestedDays = Math.max(1, Math.round(requestedDays));
  const dayEndAssumption = context.dayEndTarget ?? DEFAULT_DAY_END;
  const plan = currentPlan ?? buildTripFromWishlist(raw, normalizedRequestedDays, pace, locale, context);
  const current = evaluateCapacity(plan, pace, context);
  const unresolvedCount = plan.unknownEntries.length;
  const unavailableCount = plan.deferredUnavailableStops.length;
  const incomplete = unresolvedCount > 0 || unavailableCount > 0;
  // The builder resolves day pins against actual stop IDs before exclusions.
  // Reusing that result prevents a removed `Day 3` stop from forcing an
  // otherwise one-day wishlist to remain three days long.
  const firstAllowedDays = plan.minimumPinnedDay;
  const searchLimit = Math.min(MAX_SCENARIO_DAYS, Math.max(normalizedRequestedDays, maxDays));
  const now = searchOptions.now ?? Date.now;
  const timeoutMs = Math.max(1, Math.floor(searchOptions.timeoutMs ?? 1_000));
  const deadline = now() + timeoutMs;
  let solverTimedOut = false;
  let searchedThroughDays = 0;
  let minimumDays: number | null = null;
  let minimumPlan: BuiltTripPlan | null = null;

  // A minimum-day answer is only meaningful when every requested place took
  // part in the comparison. While place resolution or opening availability is
  // incomplete the same search still runs over the resolvable subset, but its
  // answer is returned separately as partialMinimumDays so a false "two days
  // is enough" can never be presented as the settled verdict.
  let partialMinimumDays: number | null = null;
  if (firstAllowedDays <= searchLimit) {
    for (let days = firstAllowedDays; days <= searchLimit; days += 1) {
      if (now() >= deadline) {
        // A timeout during the qualified partial search must not relabel the
        // verdict: unresolved places remain the operative blocker.
        if (!incomplete) solverTimedOut = true;
        break;
      }
      if (!incomplete) searchedThroughDays = days;
      const candidatePlan = days === normalizedRequestedDays
        ? plan
        : buildTripFromWishlist(raw, days, pace, locale, context);
      const candidateFit = days === normalizedRequestedDays
        ? current
        : evaluateCapacity(candidatePlan, pace, context);
      if (candidateFit.fitsAllKnownStops) {
        if (incomplete) partialMinimumDays = days;
        else {
          minimumDays = days;
          minimumPlan = candidatePlan;
        }
        break;
      }
      if (now() >= deadline) {
        if (!incomplete) {
          solverTimedOut = true;
          minimumDays = null;
        }
        break;
      }
    }
  }

  const capacityNeedsChange = !current.fitsAllKnownStops;
  const tight = !capacityNeedsChange && current.days.some((day) => day.placeCount > 0 && day.slackMinutes >= 0 && day.slackMinutes < 60);
  const status: TripFitAssessment["status"] = solverTimedOut
    ? "timed_out"
    : incomplete
    ? "incomplete"
    : capacityNeedsChange ? "needs_change"
      : tight ? "tight" : "fits";

  return {
    status,
    requestedDays: normalizedRequestedDays,
    minimumDays,
    partialMinimumDays,
    additionalDaysNeeded: minimumDays === null ? null : Math.max(0, minimumDays - normalizedRequestedDays),
    // A shorter scenario does not repair a reservation/opening conflict in
    // the plan the traveller actually selected. Never turn that into an
    // "everything fits" headline merely because another day count fits.
    spareDays: incomplete || capacityNeedsChange || minimumDays === null
      ? null
      : Math.max(0, normalizedRequestedDays - minimumDays),
    searchedThroughDays,
    dayEndAssumption,
    solverTimedOut,
    minimumDaysAssumptions: minimumDaysAssumptions(minimumPlan ?? plan, context),
    days: current.days,
    overloadedDayCount: current.overloadedDayCount,
    scheduleConflictCount: plan.scheduleConflictCount,
    deferredOptionalCount: plan.deferredOptionalStops.length,
    unavailableCount,
    unresolvedCount,
    cutCandidates: incomplete || solverTimedOut ? [] : cutCandidates(plan, current.days),
    suggestedCutCount: incomplete || solverTimedOut ? 0 : suggestedCutCount(current.days),
  };
}

function scenarioMetrics(plan: BuiltTripPlan, fit: TripFitAssessment): TripScenarioMetrics {
  const populatedDays = fit.days.filter((day) => day.placeCount > 0);
  return {
    hardConflictCount: plan.scheduleConflictCount + plan.deferredUnavailableStops.length,
    overrunMinutes: fit.days.reduce((sum, day) => sum + day.overrunMinutes, 0)
      + plan.days.reduce((sum, day) => sum
        + day.stops.reduce((late, stop) => late + stop.reservationLateMinutes, 0), 0),
    minimumSlackMinutes: populatedDays.length > 0
      ? Math.min(...populatedDays.map((day) => day.slackMinutes))
      : null,
    scheduledStopCount: plan.scheduledStopCount,
    dayCount: plan.requestedDays,
    travelMinutes: plan.days.reduce((total, day) => total
      + day.legs.reduce((sum, leg) => sum + leg.comparison.recommended.minutes, 0)
      + (day.hotelTravelMinutes ?? 0), 0),
  };
}

function improvementBetween(before: TripScenarioMetrics, after: TripScenarioMetrics) {
  return {
    hardConflictsRemoved: before.hardConflictCount - after.hardConflictCount,
    overrunMinutesReduced: before.overrunMinutes - after.overrunMinutes,
    slackMinutesGained: before.minimumSlackMinutes === null || after.minimumSlackMinutes === null
      ? null
      : after.minimumSlackMinutes - before.minimumSlackMinutes,
    travelMinutesReduced: before.travelMinutes - after.travelMinutes,
  };
}

/**
 * Product gate for showing a hotel/base change. The candidate metrics must
 * come from a full deterministic rebuild; geometric distance alone is not
 * sufficient evidence for a traveller-facing claim.
 */
export function qualifiesHotelBaseChange(
  before: TripScenarioMetrics,
  after: TripScenarioMetrics,
) {
  if (after.hardConflictCount < before.hardConflictCount) return true;
  const minutesSaved = before.travelMinutes - after.travelMinutes;
  if (!Number.isFinite(minutesSaved) || minutesSaved <= 0) return false;
  if (minutesSaved >= 60) return true;
  return Number.isFinite(before.travelMinutes)
    && before.travelMinutes > 0
    && minutesSaved * 100 >= before.travelMinutes * 15;
}

function improvesFeasibility(before: TripScenarioMetrics, after: TripScenarioMetrics) {
  if (after.hardConflictCount !== before.hardConflictCount) return after.hardConflictCount < before.hardConflictCount;
  if (after.overrunMinutes !== before.overrunMinutes) return after.overrunMinutes < before.overrunMinutes;
  const beforeSlack = before.minimumSlackMinutes ?? Number.NEGATIVE_INFINITY;
  const afterSlack = after.minimumSlackMinutes ?? Number.NEGATIVE_INFINITY;
  if (afterSlack !== beforeSlack) return afterSlack > beforeSlack;
  return after.travelMinutes < before.travelMinutes;
}

function shiftClock(value: string, minutes: number) {
  const parsed = clockMinutes(value);
  if (parsed === null) return value;
  const shifted = Math.max(0, Math.min(23 * 60 + 59, parsed + minutes));
  return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
}

/**
 * Produces only alternatives that were actually rebuilt and compared against
 * the current plan. A label is never presented as a fix merely because it
 * sounds plausible; every entry carries its before/after metrics and loss.
 */
export function generateTripCounterfactuals(
  raw: string,
  requestedDays: number,
  pace: Pace,
  locale: Locale,
  context: TripPlannerContext,
  currentPlan?: BuiltTripPlan,
  currentFit?: TripFitAssessment,
): TripCounterfactualAlternative[] {
  const plan = currentPlan ?? buildTripFromWishlist(raw, requestedDays, pace, locale, context);
  const fit = currentFit ?? assessTripFit(raw, requestedDays, pace, locale, context, plan);
  if (fit.status === "incomplete" || fit.status === "timed_out") return [];
  const before = scenarioMetrics(plan, fit);
  const candidates: TripCounterfactualAlternative[] = [];

  const compare = (
    id: string,
    kind: TripCounterfactualAlternative["kind"],
    nextDays: number,
    nextContext: TripPlannerContext,
    change: TripCounterfactualAlternative["change"],
    loss: TripCounterfactualAlternative["loss"] = null,
    alwaysComparable = false,
    eligibility?: (beforeMetrics: TripScenarioMetrics, afterMetrics: TripScenarioMetrics) => boolean,
  ) => {
    const nextPlan = buildTripFromWishlist(raw, nextDays, pace, locale, nextContext);
    const nextFit = assessTripFit(raw, nextDays, pace, locale, nextContext, nextPlan);
    if (nextFit.status === "incomplete" || nextFit.status === "timed_out") return;
    const after = scenarioMetrics(nextPlan, nextFit);
    if (eligibility && !eligibility(before, after)) return;
    if (!alwaysComparable && !improvesFeasibility(before, after)) return;
    candidates.push({ id, kind, change, before, after, improvement: improvementBetween(before, after), loss });
  };

  if (fit.minimumDays !== null && fit.minimumDays !== fit.requestedDays) {
    compare(
      "use-minimum-days",
      "CHANGE_DAYS",
      fit.minimumDays,
      context,
      { days: fit.minimumDays, dayDelta: fit.minimumDays - fit.requestedDays },
      null,
      true,
    );
  }

  const hasPressure = before.hardConflictCount > 0 || before.overrunMinutes > 0;
  if (hasPressure) {
    const earlierDefault = shiftClock(context.defaultDayStart ?? "09:00", -60);
    const earlierDayStarts = Object.fromEntries(
      Array.from({ length: requestedDays }, (_, dayIndex) => [
        dayIndex,
        shiftClock(context.dayStartTimes?.[dayIndex] ?? context.defaultDayStart ?? "09:00", -60),
      ]),
    );
    compare(
      "start-60-min-earlier",
      "START_EARLIER",
      requestedDays,
      { ...context, defaultDayStart: earlierDefault, dayStartTimes: earlierDayStarts },
      { minutes: 60 },
    );

    const laterDayEnds = Object.fromEntries(
      Array.from({ length: requestedDays }, (_, dayIndex) => [
        dayIndex,
        shiftClock(context.dayEndTimes?.[dayIndex] ?? context.dayEndTarget ?? DEFAULT_DAY_END, 60),
      ]),
    );
    compare(
      "end-60-min-later",
      "END_LATER",
      requestedDays,
      { ...context, dayEndTimes: laterDayEnds },
      { minutes: 60 },
    );
  }

  const alreadyDeferred = new Set(plan.deferredOptionalStops.map((stop) => stop.id));
  const optional = fit.cutCandidates.find((candidate) => candidate.priority === "optional" && !alreadyDeferred.has(candidate.id));
  if (optional) {
    compare(
      `remove-${optional.id}`,
      "REMOVE_OPTIONAL",
      requestedDays,
      { ...context, excludedStopIds: [...new Set([...(context.excludedStopIds ?? []), optional.id])] },
      { stopId: optional.id, stopName: optional.name },
      { kind: "OPTIONAL_STOP", stopId: optional.id, stopName: optional.name, stayMinutes: optional.stayMinutes },
    );
  }

  for (const recommendation of plan.baseRecommendations.slice(0, 3)) {
    if (recommendation.base.id === plan.selectedBase?.id) continue;
    const base = recommendation.base;
    compare(
      `base-${base.id}`,
      "CHANGE_BASE",
      requestedDays,
      {
        ...context,
        hotelQuery: base.query,
        resolvedBase: {
          ...base,
          input: base.query,
          address: base.area,
        },
      },
      { baseId: base.id, baseName: base.name },
      null,
      false,
      qualifiesHotelBaseChange,
    );
  }

  if (plan.inputMode === "existing_itinerary") {
    const optimizedContext = { ...context, optimizeExistingOrder: true };
    const optimizedPlan = buildTripFromWishlist(raw, requestedDays, pace, locale, optimizedContext);
    const optimizedFit = assessTripFit(raw, requestedDays, pace, locale, optimizedContext, optimizedPlan);
    if (optimizedFit.status !== "incomplete" && optimizedFit.status !== "timed_out") {
      const after = scenarioMetrics(optimizedPlan, optimizedFit);
      const orderByDay = Object.fromEntries(optimizedPlan.days.map((day, dayIndex) => [
        dayIndex,
        day.stops.map((stop) => stop.stop.id),
      ]));
      const currentOrder = plan.days.map((day) => day.stops.map((stop) => stop.stop.id).join("|")).join("::");
      const optimizedOrder = optimizedPlan.days.map((day) => day.stops.map((stop) => stop.stop.id).join("|")).join("::");
      const saved = before.travelMinutes - after.travelMinutes;
      if (optimizedOrder !== currentOrder && saved > 0) {
        candidates.push({
          id: "optimize-existing-order",
          kind: "OPTIMIZE_ORDER",
          change: { orderByDay, travelMinutesSaved: saved },
          before,
          after,
          improvement: improvementBetween(before, after),
          loss: { kind: "ORIGINAL_ORDER" },
        });
      }
    }
  }

  // A mode proposal is a real counterfactual, not a generic "take a taxi"
  // tip. Preserve this day's current order so the comparison isolates the
  // selected leg, then rebuild and keep it only when the measured schedule
  // improves. The transport trade-off is explicit because fastest and best
  // value are not the same objective.
  for (const [dayIndex, day] of plan.days.entries()) {
    for (const leg of day.legs) {
      const currentMode = leg.comparison.recommended.mode;
      const quicker = leg.comparison.options
        .filter((option) => option.mode !== currentMode && option.minutes < leg.comparison.recommended.minutes)
        .sort((left, right) => left.minutes - right.minutes || left.mode.localeCompare(right.mode))[0];
      if (!quicker) continue;
      const legId = routeLegKey(leg.from.id, leg.to.id);
      compare(
        `mode-${legId}-${quicker.mode}`,
        "CHANGE_MODE",
        requestedDays,
        {
          ...context,
          legModeOverrides: { ...(context.legModeOverrides ?? {}), [legId]: quicker.mode },
          lockedOrderByDay: {
            ...(context.lockedOrderByDay ?? {}),
            [dayIndex]: day.stops.map((stop) => stop.stop.id),
          },
        },
        {
          legId,
          fromName: leg.from.name,
          toName: leg.to.name,
          mode: quicker.mode,
        },
        { kind: "TRANSPORT_TRADEOFF", legId, mode: quicker.mode },
      );
    }
  }

  const kindRank: Record<TripCounterfactualAlternative["kind"], number> = {
    CHANGE_DAYS: 0,
    START_EARLIER: 1,
    END_LATER: 2,
    REMOVE_OPTIONAL: 3,
    CHANGE_BASE: 4,
    CHANGE_MODE: 5,
    OPTIMIZE_ORDER: 6,
  };
  const sorted = candidates.sort((left, right) => (
    right.improvement.hardConflictsRemoved - left.improvement.hardConflictsRemoved
    || right.improvement.overrunMinutesReduced - left.improvement.overrunMinutesReduced
    || (right.improvement.slackMinutesGained ?? Number.NEGATIVE_INFINITY) - (left.improvement.slackMinutesGained ?? Number.NEGATIVE_INFINITY)
    || kindRank[left.kind] - kindRank[right.kind]
    || left.id.localeCompare(right.id)
  ));
  const shortlist = sorted.slice(0, 3);
  const minimalCompleteRepair = sorted
    .filter((candidate) => candidate.kind !== "OPTIMIZE_ORDER"
      && candidate.after.hardConflictCount === 0
      && candidate.after.overrunMinutes === 0)
    .sort((left, right) => kindRank[left.kind] - kindRank[right.kind] || left.id.localeCompare(right.id))[0];
  const optimized = sorted.find((candidate) => candidate.kind === "OPTIMIZE_ORDER");
  const required = [minimalCompleteRepair, optimized].filter((candidate): candidate is TripCounterfactualAlternative => Boolean(candidate));
  for (const candidate of required) {
    if (shortlist.includes(candidate)) continue;
    const replaceIndex = [...shortlist].reverse().findIndex((entry) => !required.includes(entry));
    const actualIndex = replaceIndex < 0 ? shortlist.length - 1 : shortlist.length - 1 - replaceIndex;
    if (actualIndex >= 0) shortlist[actualIndex] = candidate;
  }
  return shortlist.sort((left, right) => sorted.indexOf(left) - sorted.indexOf(right));
}
