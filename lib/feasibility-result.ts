import type { BuiltTripPlan } from "./trip-builder.ts";
import type { MinimumDaysAssumptions, TripCounterfactualAlternative, TripFitAssessment } from "./trip-scenarios.ts";

export const ENGINE_VERSION = "tripcheck-feasibility-v0.1";

export type EvidenceStatus =
  | "user_provided"
  | "verified"
  | "estimated"
  | "unknown"
  | "failed";

export type EvidenceSource =
  | "user"
  | "google"
  | "tripcheck_catalog"
  | "derived"
  | "other";

export type Evidence<T> = {
  value: T | null;
  status: EvidenceStatus;
  source: EvidenceSource;
  fetchedAt?: string;
  expiresAt?: string;
  providerRef?: string;
  explanation?: string;
};

export type CriticalFactKind =
  | "place_identity"
  | "stay_duration"
  | "opening_hours"
  | "last_entry"
  | "route_leg"
  | "mobility_policy"
  | "day_window"
  | "base"
  | "airport_boundary";

export type CriticalFact = {
  id: string;
  kind: CriticalFactKind;
  label: string;
  evidence: Evidence<unknown>;
};

export type PlannerEvidenceSnapshot = {
  facts: CriticalFact[];
  capturedAt: string;
  providerSnapshotHash: string;
  solverTimedOut?: boolean;
};

export type FeasibilityState =
  | "VERIFIED_FEASIBLE"
  | "PROVISIONAL_FEASIBLE"
  | "FEASIBLE_IF_ASSUMPTIONS"
  | "INFEASIBLE_HARD_CONFLICT"
  | "UNKNOWN";

export type ConflictCode =
  | "AIRPORT_CUTOFF"
  | "DAY_END_OVERRUN"
  | "FIXED_BOOKING_LATE"
  | "OPENING_HOURS_CONFLICT"
  | "CLOSED_ON_FIXED_DAY"
  | "LAST_ENTRY_CONFLICT"
  | "PLACE_UNAVAILABLE"
  | "DAY_CAPACITY";

export type Conflict = {
  code: ConflictCode;
  affectedItems: string[];
  dayIndex: number | null;
  overrunMinutes: number | null;
  evidenceIds: string[];
};

export type AttentionCode = "LOW_BUFFER" | "UNVERIFIED_FACTS" | "WALKING_LIMIT_EXCEEDED" | "TRANSFER_LIMIT_EXCEEDED" | "TRANSIT_NON_CONVERGED";

export type Attention = {
  code: AttentionCode;
  dayIndex: number | null;
  minutes: number | null;
  affectedItems: string[];
  transferCount?: number;
  transferLimit?: number;
};

export type AssumptionCode =
  | "DATE_PROVISIONAL"
  | "BASE_UNKNOWN"
  | "DAY_START_DEFAULT"
  | "DAY_END_DEFAULT"
  | "STAY_DURATION_ESTIMATED"
  | "ROUTE_ESTIMATED"
  | "OPENING_HOURS_UNKNOWN"
  | "LAST_ENTRY_ESTIMATED"
  | "AIRPORT_TRANSFER_ESTIMATED"
  | "TRANSFER_BUFFER"
  | "WALKING_LIMIT_DEFAULT"
  | "TRANSFER_LIMIT_DEFAULT"
  | "TRANSFER_COUNT_UNKNOWN"
  | "TRANSIT_NON_CONVERGED";

export type Assumption = {
  code: AssumptionCode;
  count: number;
  evidenceIds: string[];
};

export type AlternativePlan = TripCounterfactualAlternative;

/**
 * Why a verdict is UNKNOWN. The computation cap (LIMIT) is a distinct
 * user-facing cause with its own action (shrink the candidate list); it must
 * never be blended into a generic "something is unresolved" sentence.
 */
export type FeasibilityUnknownCause = "UNRESOLVED_PLACE" | "COMPUTATION_LIMIT";

export type CriticalFactCounts = {
  total: number;
  verified: number;
  estimated: number;
  unknown: number;
  userProvided: number;
};

export type FeasibilityResult = {
  state: FeasibilityState;
  /** Set only when state is UNKNOWN: which blocker withheld the verdict. */
  unknownCause: FeasibilityUnknownCause | null;
  minimumDays: number | null;
  /** Qualified subset answer while unresolved/unavailable entries block the verdict. */
  partialMinimumDays: number | null;
  /** Wishlist entries that never resolved to a place; they gate the verdict. */
  unresolvedPlaceNames: string[];
  searchedThroughDays: number;
  minimumDaysAssumptions: MinimumDaysAssumptions;
  scheduledDays: BuiltTripPlan["days"];
  conflicts: Conflict[];
  primaryConflict: Conflict | null;
  primaryAttention: Attention | null;
  alternatives: AlternativePlan[];
  criticalFacts: CriticalFactCounts;
  assumptions: Assumption[];
  engineVersion: string;
  providerSnapshotHash: string;
};

export type PlanSnapshot = {
  id: string;
  plan: BuiltTripPlan;
  engineVersion: string;
  providerSnapshotHash: string;
  createdAt: string;
  seed: number;
  result: FeasibilityResult;
};

export type RouteFactEvidence = {
  legId: string;
  mode: "transit";
  departureBucket: string;
  requestKey: string;
  status: "verified" | "failed" | "unknown";
  fetchedAt?: string;
  providerRef?: string;
  minutes: number | null;
  transferCount?: number | null;
  reason?: string;
  routeGeometry?: {
    points: readonly { latitude: number; longitude: number }[];
    distanceMeters: number | null;
  };
};

export type EvidenceSnapshotOptions = {
  dateWasProvided: boolean;
  baseWasProvided: boolean;
  dayEndWasProvided: boolean;
  userDurationStopIds?: Iterable<string>;
  capturedAt?: string;
  solverTimedOut?: boolean;
  transferBufferMinutes?: number;
  dayStartTimes?: Record<number, string>;
  dayEndTimes?: Record<number, string>;
  /** Exact fact -> mode/time/request evidence. Pair-only evidence is unsafe. */
  routeEvidenceByFactId?: Record<string, RouteFactEvidence>;
  transitConvergence?: {
    nonConverged: boolean;
    stopReason: string;
    iterations: number;
    eventCount: number;
  };
  openingEvidenceByStop?: Record<string, { fetchedAt: string; providerRef?: string; dateSpecific?: boolean; dateSpecificDates?: string[] }>;
  lastEntryEvidenceByStop?: Record<string, {
    time: string;
    status: "user_provided" | "verified" | "estimated";
    fetchedAt?: string;
    providerRef?: string;
  }>;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

/** A small deterministic hash used only to bind a verdict to one evidence set. */
export function hashEvidenceFacts(facts: CriticalFact[]) {
  const source = stableStringify(facts);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function statusCounts(facts: CriticalFact[]): CriticalFactCounts {
  const counts: CriticalFactCounts = { total: facts.length, verified: 0, estimated: 0, unknown: 0, userProvided: 0 };
  for (const fact of facts) {
    if (fact.evidence.status === "verified") counts.verified += 1;
    else if (fact.evidence.status === "user_provided") {
      counts.userProvided += 1;
      counts.verified += 1;
    } else if (fact.evidence.status === "estimated") counts.estimated += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function fact(
  id: string,
  kind: CriticalFactKind,
  label: string,
  value: unknown,
  status: EvidenceStatus,
  source: EvidenceSource,
  extra: Omit<Evidence<unknown>, "value" | "status" | "source"> = {},
): CriticalFact {
  return { id, kind, label, evidence: { value, status, source, ...extra } };
}

/**
 * Adapts the existing deterministic planner into the explicit evidence model.
 * It deliberately counts a stay estimate and an unverified opening window as
 * separate facts: a resolved pin is not proof that the visit will be open or
 * that the assumed stay is correct.
 */
export function createPlannerEvidenceSnapshot(
  plan: BuiltTripPlan,
  options: EvidenceSnapshotOptions,
): PlannerEvidenceSnapshot {
  const facts: CriticalFact[] = [];
  const durationOverrides = new Set(options.userDurationStopIds ?? []);
  const seenStops = new Set<string>();
  const addStopCoreFacts = (stop: BuiltTripPlan["days"][number]["stops"][number]["stop"]) => {
    if (seenStops.has(stop.id)) return false;
    seenStops.add(stop.id);
    const source = stop.providerRef || stop.id.startsWith("google-") ? "google" : "tripcheck_catalog";
    // A Maps search URL authored from free text is only a convenience link,
    // not proof that the traveller meant one exact provider entity.
    const identityIsKnown = !stop.isUserEntered && Boolean(stop.sourceUrl && stop.verifiedAt);
    const identityStatus: EvidenceStatus = stop.userProvidedCoordinates
      ? "user_provided"
      : identityIsKnown ? "verified" : "unknown";
    facts.push(fact(
      `place:${stop.id}`,
      "place_identity",
      stop.name,
      identityStatus === "unknown" ? null : stop.id,
      identityStatus,
      stop.userProvidedCoordinates ? "user" : source,
      { fetchedAt: stop.verifiedAt || undefined, providerRef: stop.providerRef ?? (stop.id.startsWith("google-") ? stop.id.slice(7) : undefined) },
    ));
    facts.push(fact(
      `duration:${stop.id}`,
      "stay_duration",
      stop.name,
      stop.planningDurationMinutes,
      durationOverrides.has(stop.id) ? "user_provided" : "estimated",
      durationOverrides.has(stop.id) ? "user" : "derived",
    ));
    return true;
  };
  const addRouteFact = (
    id: string,
    label: string,
    minutes: number | null,
    mode: "walk" | "transit" | "taxi" | null,
    planSource: "estimate" | "live" | null | undefined,
  ) => {
    const routeEvidence = options.routeEvidenceByFactId?.[id];
    const hasBoundProvenance = routeEvidence?.mode === "transit"
      && routeEvidence.requestKey.length > 0
      && routeEvidence.departureBucket.length > 0;
    const exactLiveValue = mode === "transit"
      && planSource === "live"
      && routeEvidence?.status === "verified"
      && routeEvidence.minutes === minutes
      && Boolean(routeEvidence.fetchedAt)
      && hasBoundProvenance;
    const metadata = routeEvidence ? {
      fetchedAt: routeEvidence.fetchedAt,
      providerRef: routeEvidence.providerRef,
      explanation: options.transitConvergence?.nonConverged
        ? "Transit times were measured, but the itinerary did not stabilize within the bounded replan loop. The schedule uses the largest observed duration."
        : routeEvidence.status === "failed" || routeEvidence.status === "unknown"
          ? `Live transit evidence was ${routeEvidence.status}; the schedule still uses a planning estimate of ${minutes ?? "unknown"} minutes.`
          : routeEvidence.minutes !== minutes
            ? `This departure bucket measured ${routeEvidence.minutes ?? "unknown"} minutes; the schedule conservatively consumes ${minutes ?? "unknown"} minutes from the bounded route loop.`
            : undefined,
    } : {};

    if (mode === "transit" && routeEvidence?.status !== "verified") {
      // The schedule value came from a live measurement at the provisional
      // departure (post-build prefetch) even though no convergence-bound
      // evidence exists yet — that is a live-informed estimate, not an
      // untouched unknown.
      const provisionallyMeasured = planSource === "live" && !routeEvidence;
      facts.push(fact(
        id,
        "route_leg",
        label,
        provisionallyMeasured ? minutes : null,
        provisionallyMeasured ? "estimated" : routeEvidence?.status ?? "unknown",
        provisionallyMeasured || routeEvidence?.providerRef ? "google" : "other",
        provisionallyMeasured
          ? { explanation: "Measured live for the provisional date; confirming the trip date binds it to an exact departure." }
          : metadata,
      ));
      return;
    }
    const verified = exactLiveValue && !options.transitConvergence?.nonConverged;
    facts.push(fact(
      id,
      "route_leg",
      label,
      minutes,
      verified ? "verified" : "estimated",
      exactLiveValue ? "google" : "derived",
      metadata,
    ));
  };
  const addTransferFact = (
    id: string,
    routeFactId: string,
    label: string,
    routeMinutes: number | null,
    count: number | null,
  ) => {
    // Transfer counts only exist for a concrete departure time. Without a
    // confirmed trip date they are structurally unobtainable, so listing them
    // as unresolved critical facts would be an impossible to-do; the date
    // assumption row already carries the one real action.
    if (!options.dateWasProvided) return;
    const routeEvidence = options.routeEvidenceByFactId?.[routeFactId];
    const hasBoundProvenance = routeEvidence?.mode === "transit"
      && routeEvidence.requestKey.length > 0
      && routeEvidence.departureBucket.length > 0;
    const exactProviderValue = count !== null
      && routeEvidence?.status === "verified"
      && routeEvidence.minutes === routeMinutes
      && routeEvidence.transferCount === count
      && Boolean(routeEvidence.fetchedAt)
      && hasBoundProvenance;
    const status: EvidenceStatus = routeEvidence?.status === "failed"
      ? "failed"
      : exactProviderValue
        ? options.transitConvergence?.nonConverged ? "estimated" : "verified"
        : "unknown";
    facts.push(fact(
      id,
      "mobility_policy",
      label,
      status === "unknown" || status === "failed" ? null : count,
      status,
      exactProviderValue ? "google" : routeEvidence?.providerRef ? "google" : "other",
      {
        fetchedAt: routeEvidence?.fetchedAt,
        providerRef: routeEvidence?.providerRef,
        explanation: exactProviderValue
          ? options.transitConvergence?.nonConverged
            ? "The observed transfer count is retained, but the transit schedule did not converge."
            : undefined
          : routeEvidence?.status === "failed"
            ? "The transit provider failed, so the transfer limit has not been checked."
            : "Complete transit-step data was not returned for this exact departure bucket.",
      },
    ));
  };

  for (const [dayIndex, day] of plan.days.entries()) {
    for (const built of day.stops) {
      if (built.kind !== "place" || !addStopCoreFacts(built.stop)) continue;
      const hoursKnown = built.openingStatus !== "unknown";
      const hoursEvidence = options.openingEvidenceByStop?.[built.stop.id];
      const isDateSpecific = Boolean(
        hoursEvidence?.dateSpecific
        || (day.date && hoursEvidence?.dateSpecificDates?.includes(day.date)),
      );
      // Fetched weekly hours that are not yet bound to a confirmed date (or a
      // place with no listed hours at all) are known-but-unbound evidence:
      // "estimated", never the actionable-critical "unknown" reserved for
      // hours nobody has fetched.
      const hoursStatus: EvidenceStatus = !hoursEvidence
        ? "unknown"
        : !hoursKnown
          ? "estimated"
          : isDateSpecific
            ? "verified"
            : "estimated";
      facts.push(fact(
        `hours:${built.stop.id}:${day.date ?? day.label}`,
        "opening_hours",
        built.stop.name,
        hoursKnown ? built.openingStatus : null,
        hoursStatus,
        hoursEvidence ? "google" : "other",
        hoursEvidence
          ? { ...hoursEvidence, ...(!hoursKnown ? { explanation: "Weekly hours are fetched; confirm the trip date to bind them to exact days." } : {}) }
          : {},
      ));
      const lastEntryEvidence = options.lastEntryEvidenceByStop?.[built.stop.id];
      if (lastEntryEvidence) {
        facts.push(fact(
          `last-entry:${built.stop.id}:${day.date ?? day.label}`,
          "last_entry",
          `${built.stop.name} last entry`,
          lastEntryEvidence.time,
          lastEntryEvidence.status,
          lastEntryEvidence.status === "user_provided" ? "user" : lastEntryEvidence.providerRef ? "google" : "other",
          { fetchedAt: lastEntryEvidence.fetchedAt, providerRef: lastEntryEvidence.providerRef },
        ));
      }
    }

    for (const leg of day.legs) {
      const routeFactId = `route:${day.label}:${leg.from.id}:${leg.to.id}`;
      addRouteFact(
        routeFactId,
        `${leg.from.name} → ${leg.to.name}`,
        leg.comparison.recommended.minutes,
        leg.comparison.recommended.mode,
        leg.comparison.recommended.source,
      );
      if (leg.comparison.recommended.mode === "transit") {
        addTransferFact(
          `transfers:${day.label}:${leg.from.id}:${leg.to.id}`,
          routeFactId,
          `${leg.from.name} → ${leg.to.name} transfers`,
          leg.comparison.recommended.minutes,
          leg.transferCount,
        );
      }
    }

    if (day.startBase && day.stops[0]) {
      const routeFactId = `route:${day.label}:${day.startBase.id}:${day.stops[0].stop.id}`;
      addRouteFact(
        routeFactId,
        `${day.startBase.name} → ${day.stops[0].stop.name}`,
        day.hotelOutboundMinutes,
        day.hotelOutboundMode,
        day.hotelOutboundSource,
      );
      if (day.hotelOutboundMode === "transit") {
        addTransferFact(
          `transfers:${day.label}:${day.startBase.id}:${day.stops[0].stop.id}`,
          routeFactId,
          `${day.startBase.name} → ${day.stops[0].stop.name} transfers`,
          day.hotelOutboundMinutes,
          day.hotelOutboundTransferCount,
        );
      }
    }
    if (day.endBase && day.stops.at(-1)) {
      const routeFactId = `route:${day.label}:${day.stops.at(-1)!.stop.id}:${day.endBase.id}`;
      addRouteFact(
        routeFactId,
        `${day.stops.at(-1)!.stop.name} → ${day.endBase.name}`,
        day.hotelInboundMinutes,
        day.hotelInboundMode,
        day.hotelInboundSource,
      );
      if (day.hotelInboundMode === "transit") {
        addTransferFact(
          `transfers:${day.label}:${day.stops.at(-1)!.stop.id}:${day.endBase.id}`,
          routeFactId,
          `${day.stops.at(-1)!.stop.name} → ${day.endBase.name} transfers`,
          day.hotelInboundMinutes,
          day.hotelInboundTransferCount,
        );
      }
    }

    const startWasProvided = Boolean(options.dayStartTimes?.[dayIndex]);
    const endWasProvided = Boolean(options.dayEndTimes?.[dayIndex]) || options.dayEndWasProvided;
    facts.push(fact(
      `day-start:${day.label}`,
      "day_window",
      `${day.label} start`,
      day.requestedStartTime,
      startWasProvided ? "user_provided" : "estimated",
      startWasProvided ? "user" : "derived",
    ));
    facts.push(fact(
      `day-end:${day.label}`,
      "day_window",
      `${day.label} end`,
      day.deadline,
      endWasProvided ? "user_provided" : "estimated",
      endWasProvided ? "user" : "derived",
    ));
  }

  for (const stop of plan.deferredOptionalStops) {
    if (!addStopCoreFacts(stop)) continue;
    facts.push(fact(`hours:${stop.id}:deferred`, "opening_hours", stop.name, null, "unknown", "other"));
  }
  for (const stop of plan.deferredUnavailableStops) {
    if (!addStopCoreFacts(stop)) continue;
    const hoursEvidence = options.openingEvidenceByStop?.[stop.id];
    const plannedDates = plan.days.flatMap((day) => day.date ? [day.date] : []);
    const allDatesSpecific = Boolean(
      hoursEvidence?.dateSpecific
      || (plannedDates.length > 0 && plannedDates.every((date) => hoursEvidence?.dateSpecificDates?.includes(date))),
    );
    facts.push(fact(
      `hours:${stop.id}:unavailable`,
      "opening_hours",
      stop.name,
      hoursEvidence ? "closed_on_all_days" : null,
      allDatesSpecific ? "verified" : hoursEvidence ? "estimated" : "unknown",
      hoursEvidence ? "google" : "other",
      hoursEvidence ?? {},
    ));
  }

  for (const entry of plan.unknownEntries) {
    facts.push(fact(`place:unresolved:${entry}`, "place_identity", entry, null, "unknown", "other"));
  }

  const baseVerified = Boolean(
    plan.selectedBase
    && options.baseWasProvided
    && !plan.selectedBase.isUserEntered
    && plan.selectedBase.sourceUrl
    && plan.selectedBase.verifiedAt,
  );
  const baseSource: EvidenceSource = plan.selectedBase?.providerRef || plan.selectedBase?.id.startsWith("google-") || plan.selectedBase?.id.startsWith("hotel-")
    ? "google"
    : plan.selectedBase?.sourceUrl
      ? "tripcheck_catalog"
      : "derived";
  facts.push(fact(
    "base",
    "base",
    plan.selectedBase?.name ?? "base",
    plan.selectedBase?.id ?? null,
    plan.selectedBase ? (baseVerified ? "verified" : "estimated") : "unknown",
    baseSource,
    plan.selectedBase ? { fetchedAt: plan.selectedBase.verifiedAt, providerRef: plan.selectedBase.providerRef } : {},
  ));

  for (const boundary of plan.airportConstraints) {
    facts.push(fact(
      `airport:${boundary.direction}:${boundary.airport}`,
      "airport_boundary",
      `${boundary.direction}:${boundary.airport}`,
      boundary.cityTime,
      "estimated",
      "derived",
      { explanation: "Flight time is user-provided; airport processing and city transfer are planning estimates." },
    ));
    const routeFactId = `route:airport:${boundary.direction}:${boundary.airport}`;
    const routeEvidence = options.routeEvidenceByFactId?.[routeFactId];
    if (routeEvidence) {
      const label = `${boundary.direction === "arrival" ? boundary.airport : "base"} → ${boundary.direction === "arrival" ? "base" : boundary.airport}`;
      addRouteFact(
        routeFactId,
        label,
        boundary.transferMinutes,
        "transit",
        routeEvidence.status === "verified" ? "live" : "estimate",
      );
      addTransferFact(
        `transfers:airport:${boundary.direction}:${boundary.airport}`,
        routeFactId,
        `${label} transfers`,
        boundary.transferMinutes,
        boundary.transferCount,
      );
    }
  }

  if (!options.dateWasProvided) {
    facts.push(fact("assumption:date", "opening_hours", "trip date", null, "unknown", "derived"));
  }
  if (options.transferBufferMinutes !== undefined) {
    facts.push(fact(
      "assumption:transfer-buffer",
      "route_leg",
      "transfer buffer",
      options.transferBufferMinutes,
      "estimated",
      "derived",
      { explanation: `${options.transferBufferMinutes} minutes is added after each travelled leg.` },
    ));
  }
  if (options.transitConvergence?.nonConverged) {
    facts.push(fact(
      "assumption:transit-convergence",
      "route_leg",
      "transit schedule convergence",
      null,
      "unknown",
      "derived",
      { explanation: `The route/schedule loop stopped after ${options.transitConvergence.iterations} iterations and ${options.transitConvergence.eventCount} provider events (${options.transitConvergence.stopReason}).` },
    ));
  }
  facts.push(fact(
    "mobility:walking-limit",
    "mobility_policy",
    "maximum walking per leg",
    plan.mobilityPolicy.maxWalkingMinutesPerLeg,
    plan.mobilityPolicy.walkingLimitWasProvided ? "user_provided" : "estimated",
    plan.mobilityPolicy.walkingLimitWasProvided ? "user" : "derived",
  ));
  facts.push(fact(
    "mobility:transfer-limit",
    "mobility_policy",
    "maximum transfers per leg",
    plan.mobilityPolicy.maxTransfersPerLeg,
    plan.mobilityPolicy.transferLimitWasProvided ? "user_provided" : "estimated",
    plan.mobilityPolicy.transferLimitWasProvided ? "user" : "derived",
  ));

  const capturedAt = options.capturedAt ?? new Date().toISOString();
  return {
    facts,
    capturedAt,
    providerSnapshotHash: hashEvidenceFacts(facts),
    ...(options.solverTimedOut ? { solverTimedOut: true } : {}),
  };
}

function collectConflicts(plan: BuiltTripPlan): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const [dayIndex, day] of plan.days.entries()) {
    if (day.deadlineOverrunMinutes > 0) {
      conflicts.push({
        code: day.deadlineKind === "airport" ? "AIRPORT_CUTOFF" : "DAY_END_OVERRUN",
        affectedItems: day.stops.map((stop) => stop.stop.name),
        dayIndex,
        overrunMinutes: day.deadlineOverrunMinutes,
        evidenceIds: day.deadlineKind === "airport"
          ? plan.airportConstraints.filter((entry) => entry.direction === "departure").map((entry) => `airport:departure:${entry.airport}`)
          : [`day-end:${day.label}`],
      });
    }
    for (const built of day.stops) {
      if (built.reservationLateMinutes > 0) {
        const inboundLeg = day.legs.find((leg) => leg.to.id === built.stop.id);
        const routeEvidenceId = inboundLeg
          ? `route:${day.label}:${inboundLeg.from.id}:${inboundLeg.to.id}`
          : day.startBase
            ? `route:${day.label}:${day.startBase.id}:${built.stop.id}`
            : null;
        conflicts.push({
          code: "FIXED_BOOKING_LATE",
          affectedItems: [built.stop.name],
          dayIndex,
          overrunMinutes: built.reservationLateMinutes,
          evidenceIds: [`place:${built.stop.id}`, ...(routeEvidenceId ? [routeEvidenceId] : [])],
        });
      }
      if (built.openingStatus === "conflict" || built.openingStatus === "closed_day" || built.openingStatus === "last_entry_conflict") {
        conflicts.push({
          code: built.openingStatus === "closed_day"
            ? "CLOSED_ON_FIXED_DAY"
            : built.openingStatus === "last_entry_conflict"
              ? "LAST_ENTRY_CONFLICT"
              : "OPENING_HOURS_CONFLICT",
          affectedItems: [built.stop.name],
          dayIndex,
          overrunMinutes: null,
          evidenceIds: [built.openingStatus === "last_entry_conflict"
            ? `last-entry:${built.stop.id}:${day.date ?? day.label}`
            : `hours:${built.stop.id}:${day.date ?? day.label}`],
        });
      }
    }
  }

  for (const stop of plan.deferredUnavailableStops) {
    conflicts.push({
      code: "PLACE_UNAVAILABLE",
      affectedItems: [stop.name],
      dayIndex: null,
      overrunMinutes: null,
      evidenceIds: [`place:${stop.id}`, `hours:${stop.id}:unavailable`],
    });
  }

  const severity: Record<ConflictCode, number> = {
    AIRPORT_CUTOFF: 7,
    FIXED_BOOKING_LATE: 6,
    CLOSED_ON_FIXED_DAY: 5,
    LAST_ENTRY_CONFLICT: 5,
    OPENING_HOURS_CONFLICT: 4,
    PLACE_UNAVAILABLE: 3,
    DAY_END_OVERRUN: 2,
    DAY_CAPACITY: 1,
  };
  return conflicts.sort((left, right) => (
    severity[right.code] - severity[left.code]
    || (right.overrunMinutes ?? 0) - (left.overrunMinutes ?? 0)
    || (left.dayIndex ?? Number.MAX_SAFE_INTEGER) - (right.dayIndex ?? Number.MAX_SAFE_INTEGER)
    || left.affectedItems.join("|").localeCompare(right.affectedItems.join("|"))
  ));
}

function collectAssumptions(snapshot: PlannerEvidenceSnapshot): Assumption[] {
  const groups = new Map<AssumptionCode, string[]>();
  const add = (code: AssumptionCode, id: string) => groups.set(code, [...(groups.get(code) ?? []), id]);
  for (const item of snapshot.facts) {
    if (item.id === "assumption:date") add("DATE_PROVISIONAL", item.id);
    else if (item.id === "assumption:transit-convergence") add("TRANSIT_NON_CONVERGED", item.id);
    else if (item.id === "base" && item.evidence.status === "unknown") add("BASE_UNKNOWN", item.id);
    else if (item.id.startsWith("day-start:") && item.evidence.status === "estimated") add("DAY_START_DEFAULT", item.id);
    else if (item.id.startsWith("day-end:") && item.evidence.status === "estimated") add("DAY_END_DEFAULT", item.id);
    else if (item.kind === "stay_duration" && item.evidence.status === "estimated") add("STAY_DURATION_ESTIMATED", item.id);
    else if (item.id === "assumption:transfer-buffer") add("TRANSFER_BUFFER", item.id);
    else if (item.id === "mobility:walking-limit" && item.evidence.status === "estimated") add("WALKING_LIMIT_DEFAULT", item.id);
    else if (item.id === "mobility:transfer-limit" && item.evidence.status === "estimated") add("TRANSFER_LIMIT_DEFAULT", item.id);
    else if (item.id.startsWith("transfers:") && item.evidence.status !== "verified") add("TRANSFER_COUNT_UNKNOWN", item.id);
    else if (item.kind === "route_leg" && item.evidence.status === "estimated") add("ROUTE_ESTIMATED", item.id);
    else if (item.kind === "opening_hours" && item.evidence.status !== "verified" && item.evidence.status !== "user_provided") add("OPENING_HOURS_UNKNOWN", item.id);
    else if (item.kind === "last_entry" && item.evidence.status === "estimated") add("LAST_ENTRY_ESTIMATED", item.id);
    else if (item.kind === "airport_boundary" && item.evidence.status === "estimated") add("AIRPORT_TRANSFER_ESTIMATED", item.id);
  }
  return [...groups.entries()].map(([code, evidenceIds]) => ({ code, count: evidenceIds.length, evidenceIds }));
}

export function deriveFeasibilityResult(
  plan: BuiltTripPlan,
  fit: TripFitAssessment,
  snapshot: PlannerEvidenceSnapshot,
  alternatives: AlternativePlan[] = [],
): FeasibilityResult {
  const criticalFacts = statusCounts(snapshot.facts);
  const evidenceIds = new Set(snapshot.facts.map((item) => item.id));
  const factsById = new Map(snapshot.facts.map((item) => [item.id, item]));
  const conflicts = collectConflicts(plan)
    .map((conflict) => ({
      ...conflict,
      evidenceIds: conflict.evidenceIds.filter((id) => evidenceIds.has(id)),
    }))
    // Hours can reject a plan only when they are date-qualified. A typical
    // weekly schedule is useful evidence, but holidays and special hours keep
    // the conclusion provisional rather than turning it into a hard conflict.
    .filter((conflict) => {
      if (conflict.code === "LAST_ENTRY_CONFLICT") {
        return conflict.evidenceIds.some((id) => {
          const status = factsById.get(id)?.evidence.status;
          return status === "verified" || status === "user_provided";
        });
      }
      if (conflict.code !== "OPENING_HOURS_CONFLICT" && conflict.code !== "CLOSED_ON_FIXED_DAY" && conflict.code !== "PLACE_UNAVAILABLE") return true;
      return conflict.evidenceIds.some((id) => factsById.get(id)?.evidence.status === "verified");
    });
  const assumptions = collectAssumptions(snapshot);
  const hasUnresolvedPlace = plan.unknownEntries.length > 0;
  // Unresolved places stay the operative blocker; the computation cap only
  // names itself when everything the traveller typed did resolve.
  const unknownCause: FeasibilityUnknownCause | null = hasUnresolvedPlace
    ? "UNRESOLVED_PLACE"
    : snapshot.solverTimedOut ? "COMPUTATION_LIMIT" : null;
  let state: FeasibilityState;
  if (unknownCause) state = "UNKNOWN";
  else if (conflicts.length > 0) state = "INFEASIBLE_HARD_CONFLICT";
  else if (criticalFacts.unknown > 0) state = "FEASIBLE_IF_ASSUMPTIONS";
  else if (criticalFacts.estimated > 0) state = "PROVISIONAL_FEASIBLE";
  else state = "VERIFIED_FEASIBLE";

  const lowestSlack = [...fit.days]
    .filter((day) => day.placeCount > 0 && day.slackMinutes >= 0)
    .sort((left, right) => left.slackMinutes - right.slackMinutes || left.dayIndex - right.dayIndex)[0];
  const walkingLimitViolation = plan.days.flatMap((day, dayIndex) => day.legs.flatMap((leg) => (
    leg.comparison.recommended.mode === "walk" && leg.walkingLimitExceededMinutes > 0
      ? [{ dayIndex, leg, exceededBy: leg.walkingLimitExceededMinutes }]
      : []
  ))).sort((left, right) => right.exceededBy - left.exceededBy || left.dayIndex - right.dayIndex)[0];
  const transferLimit = plan.mobilityPolicy.maxTransfersPerLeg;
  const transferLimitViolation = snapshot.facts.flatMap((item) => {
    if (!item.id.startsWith("transfers:")
      || (item.evidence.status !== "verified" && item.evidence.status !== "estimated")
      || typeof item.evidence.value !== "number"
      || !Number.isSafeInteger(item.evidence.value)
      || item.evidence.value <= transferLimit) return [];
    const dayIndex = plan.days.findIndex((day) => item.id.startsWith(`transfers:${day.label}:`));
    return [{
      id: item.id,
      label: item.label,
      dayIndex: dayIndex >= 0 ? dayIndex : null,
      transferCount: item.evidence.value,
      exceededBy: item.evidence.value - transferLimit,
    }];
  }).sort((left, right) => (
    right.exceededBy - left.exceededBy
    || (left.dayIndex ?? Number.MAX_SAFE_INTEGER) - (right.dayIndex ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id)
  ))[0];
  const primaryAttention: Attention | null = conflicts.length > 0
    ? null
    : snapshot.facts.some((item) => item.id === "assumption:transit-convergence")
      ? { code: "TRANSIT_NON_CONVERGED", dayIndex: null, minutes: null, affectedItems: ["transit schedule"] }
    : walkingLimitViolation
      ? {
          code: "WALKING_LIMIT_EXCEEDED",
          dayIndex: walkingLimitViolation.dayIndex,
          minutes: walkingLimitViolation.exceededBy,
          affectedItems: [walkingLimitViolation.leg.from.name, walkingLimitViolation.leg.to.name],
        }
      : transferLimitViolation
        ? {
            code: "TRANSFER_LIMIT_EXCEEDED",
            dayIndex: transferLimitViolation.dayIndex,
            minutes: null,
            transferCount: transferLimitViolation.transferCount,
            transferLimit,
            affectedItems: [transferLimitViolation.label],
          }
      : criticalFacts.unknown > 0
        ? { code: "UNVERIFIED_FACTS", dayIndex: null, minutes: null, affectedItems: snapshot.facts.filter((item) => item.evidence.status === "unknown" || item.evidence.status === "failed").map((item) => item.label) }
      : lowestSlack && lowestSlack.slackMinutes < 60
        ? { code: "LOW_BUFFER", dayIndex: lowestSlack.dayIndex, minutes: lowestSlack.slackMinutes, affectedItems: [lowestSlack.label] }
        : null;

  return {
    state,
    unknownCause,
    minimumDays: fit.minimumDays,
    partialMinimumDays: fit.partialMinimumDays,
    unresolvedPlaceNames: [...plan.unknownEntries],
    searchedThroughDays: fit.searchedThroughDays,
    minimumDaysAssumptions: fit.minimumDaysAssumptions,
    scheduledDays: plan.days,
    conflicts,
    primaryConflict: conflicts[0] ?? null,
    primaryAttention,
    alternatives: alternatives.slice(0, 3),
    criticalFacts,
    assumptions,
    engineVersion: ENGINE_VERSION,
    providerSnapshotHash: snapshot.providerSnapshotHash,
  };
}

export function createPlanSnapshot(
  id: string,
  plan: BuiltTripPlan,
  result: FeasibilityResult,
  options: { createdAt?: string; seed?: number } = {},
): PlanSnapshot {
  return {
    id,
    plan,
    engineVersion: ENGINE_VERSION,
    providerSnapshotHash: result.providerSnapshotHash,
    createdAt: options.createdAt ?? new Date().toISOString(),
    seed: options.seed ?? 0,
    result,
  };
}
