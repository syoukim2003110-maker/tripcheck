// Planner application-state building blocks: the state slice types, their
// idle values, and framework-free helpers shared by the planner hooks and
// components. No React imports belong here.
import { estimateStayMinutes } from "./stay-estimates.ts";
import { decodeTripShare, type ShareableResolutionOverride } from "./share-link.ts";
import type { StoredTripRecord } from "./trip-store.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import type { FoodCandidate } from "./google-food.ts";
import type { FreshVoicesResult } from "./fresh-voices.ts";
import type { PlaceIntelligenceResult } from "./place-intelligence.ts";
import type { HotelCandidate, HotelStyle } from "./google-hotels.ts";
import type { RouteRecommendation } from "./route-recommendations.ts";
import type { TransitStepSummary } from "./google-routes.ts";
import type { TransitConvergenceStopReason } from "./transit-convergence.ts";
import type { TransportMode, TravelPreference } from "./time-feasibility.ts";
import type { BuiltTripPlan, Pace, TripBase } from "./trip-builder.ts";
import type { PlannerHistory } from "./planner-history.ts";
import type { ParsedWishlistPlace } from "./wishlist-parser.ts";
import { destinationById, localDateIn, type Destination } from "./destinations.ts";
import {
  hardEditBookingDelayTitle,
  hardEditConflictSentence,
  type HardEditConflictKind,
  type PlannerLocale,
} from "./presentation/planner-copy.ts";

export type TransitLegBoarding = {
  steps: TransitStepSummary[];
  walkToStopMinutes: number | null;
  walkFromStopMinutes: number | null;
};

export type PlannerInputStep = "places" | "conditions";
export type PlannerBuildMode = "automatic" | "custom";
export type MobileResultView = "timeline" | "map" | "compact";
export type PlannerMapScope = "all" | "day";
export type PassportCountry = "unset" | "JP" | "other";
export type TransitConvergenceState = {
  inputKey: string;
  status: "idle" | "loading" | "complete";
  eventCount: number;
  iterations: number;
  nonConverged: boolean;
  stopReason: TransitConvergenceStopReason | null;
};
export const emptyTransitConvergenceState: TransitConvergenceState = {
  inputKey: "",
  status: "idle",
  eventCount: 0,
  iterations: 0,
  nonConverged: false,
  stopReason: null,
};

export function upsertResolutionOverride(
  current: readonly ShareableResolutionOverride[],
  next: ShareableResolutionOverride,
) {
  return [...current.filter((entry) => entry.inputIndex !== next.inputIndex), next]
    .sort((left, right) => left.inputIndex - right.inputIndex)
    .slice(0, 12);
}

export function manualStopFromResolutionOverride(
  override: ShareableResolutionOverride,
): ResolvedInputStop | null {
  if ("providerRef" in override) return null;
  return {
    id: `manual-${override.inputIndex}-${override.latitude.toFixed(5)}-${override.longitude.toFixed(5)}`,
    input: override.name,
    inputIndex: override.inputIndex,
    name: override.name,
    area: override.address,
    address: override.address,
    latitude: override.latitude,
    longitude: override.longitude,
    sourceUrl: "",
    verifiedAt: "",
    confidence: "low",
    planningDurationMinutes: estimateStayMinutes(override.name, [], 90),
    isAnchor: false,
    isUserEntered: true,
    userProvidedCoordinates: true,
  };
}

export function withManualResolutionOverrides(
  places: readonly ResolvedInputStop[],
  overrides: readonly ShareableResolutionOverride[],
) {
  const manual = overrides.flatMap((override) => {
    const stop = manualStopFromResolutionOverride(override);
    return stop ? [stop] : [];
  });
  if (manual.length === 0) return [...places];
  const manualIndexes = new Set(manual.map((stop) => stop.inputIndex));
  return [
    ...places.filter((stop) => stop.inputIndex === undefined || !manualIndexes.has(stop.inputIndex)),
    ...manual,
  ];
}

export type FoodState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  /** Why an unavailable state happened; "quota" = daily allowance exhausted. */
  reason?: "quota";
  requestKey: string;
  query: string;
  candidates: FoodCandidate[];
  fetchedAt?: string;
  notes: Record<string, { reason: string; tag: string }>;
  /** True once the AI selector's order has replaced the Google-score order. */
  aiOrdered?: boolean;
  fresh: Record<string, FreshState>;
};
export type IntelligenceState = {
  status: "loading" | "ready" | "unavailable";
  result: PlaceIntelligenceResult | null;
};
export type FreshState = {
  status: "idle" | "loading" | "ready" | "unavailable" | "paused";
  result: FreshVoicesResult | null;
};
export type HotelAiState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  notes: Record<string, { reason: string; tag: string }>;
  recommendedId: string | null;
};
export type HotelState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  candidates: HotelCandidate[];
  selectedId: string | null;
  fresh: FreshState;
  ai: HotelAiState;
};
export type HotelStayMode = "single" | "nightly";
export type HotelStyleChoice = "recommended" | HotelStyle;
export type HotelPurpose = "balanced" | "nearest" | "rated" | "value" | "picked";
export type NightlyHotelNight = {
  area: string;
  fetchedAt: string;
  candidates: HotelCandidate[];
  selectedId: string | null;
};
export type NightlyHotelState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  nights: NightlyHotelNight[];
};
export type RouteRecommendationState = {
  status: "idle" | "loading" | "ready" | "unavailable" | "rate_limited";
  fetchedAt: string | null;
  candidates: RouteRecommendation[];
};
// Copy Deck build.stage1-3: the build screen narrates three traveller-facing
// outcomes, not internal pipeline phases. Place resolution and clustering are
// "grouping", the constraint solve is "ordering", and hotel/meal/evidence
// enrichment is "enriching". No counts, no provider names.
export type BuildStage = "grouping" | "ordering" | "enriching";
export type BuildProgress = {
  stage: BuildStage;
};
export type Inspector =
  | { kind: "stop"; stopId: string }
  | { kind: "food"; slotId: string; candidateId?: string }
  | { kind: "hotel" }
  | { kind: "recommendations"; dayIndex: number; candidateId?: string }
  | null;
export type SourcePreviewState = { status: "loading" | "ready" | "failed"; imageUrl: string | null };
export type ManualPlaceDraft = { address: string; latitude: string; longitude: string };

export const emptyFreshState: FreshState = { status: "idle", result: null };
export const emptyHotelAi: HotelAiState = { status: "idle", notes: {}, recommendedId: null };
export const emptyHotelState: HotelState = { status: "idle", candidates: [], selectedId: null, fresh: emptyFreshState, ai: emptyHotelAi };
export const emptyNightlyHotelState: NightlyHotelState = { status: "idle", nights: [] };
export const emptyRouteRecommendationState: RouteRecommendationState = { status: "idle", fetchedAt: null, candidates: [] };

export function addCalendarDays(date: string, dayOffset: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + dayOffset);
  return parsed.toISOString().slice(0, 10);
}

export function clampTripDays(value: number) {
  return Math.min(14, Math.max(1, Math.round(value)));
}

export function storedTripShareCode(entry: StoredTripRecord) {
  const direct = entry.payload.input.shareCode;
  if (typeof direct === "string") return direct;
  const legacy = entry.payload.input.legacyShareCode;
  return typeof legacy === "string" ? legacy : null;
}

export function storedTripInput(entry: StoredTripRecord) {
  const code = storedTripShareCode(entry);
  return code ? decodeTripShare(code) : null;
}

export function newDeviceTripId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function builtPlanTravelMinutes(plan: BuiltTripPlan) {
  return plan.days.reduce((sum, planDay) => (
    sum
    + (planDay.hotelOutboundMinutes ?? 0)
    + (planDay.hotelInboundMinutes ?? 0)
    + planDay.legs.reduce((legSum, leg) => legSum + leg.comparison.recommended.minutes, 0)
  ), 0);
}

// v1.1 TC-007 / §8.2: the hard-conflict damage a candidate plan would
// introduce compared to the current one. Only the three protected promises
// are inspected — booking lateness, a dropped Must stop and the airport
// cutoff. Every guarded edit path (remove/move/day-count, leg mode, stay
// time, last entry, day windows) shares this one detector.
export type PlannerHardEditConflict = {
  kind: HardEditConflictKind;
  message: string;
  minutes: number;
};

export function plannerHardEditConflicts(
  plan: BuiltTripPlan,
  candidatePlan: BuiltTripPlan,
  locale: PlannerLocale,
  allowDropStopId?: string,
): PlannerHardEditConflict[] {
  const conflicts: PlannerHardEditConflict[] = [];
  const lateNow = new Map<string, number>();
  for (const planDay of plan.days) {
    for (const built of planDay.stops) {
      if (built.reservationLateMinutes > 0) lateNow.set(built.stop.id, built.reservationLateMinutes);
    }
  }
  for (const planDay of candidatePlan.days) {
    for (const built of planDay.stops) {
      if (built.reservationLateMinutes > (lateNow.get(built.stop.id) ?? 0)) {
        conflicts.push({
          kind: "booking_late",
          minutes: built.reservationLateMinutes,
          message: hardEditConflictSentence("booking_late", built.stop.name, built.reservationLateMinutes, locale),
        });
      }
    }
  }
  const scheduledAfter = new Set(candidatePlan.days.flatMap((planDay) => planDay.stops.map((built) => built.stop.id)));
  for (const planDay of plan.days) {
    for (const built of planDay.stops) {
      if (built.priority !== "must" || built.stop.id === allowDropStopId || scheduledAfter.has(built.stop.id)) continue;
      conflicts.push({
        kind: "must_drop",
        minutes: 0,
        message: hardEditConflictSentence("must_drop", built.stop.name, 0, locale),
      });
    }
  }
  const deadlineOverrun = (candidate: BuiltTripPlan) => candidate.days.reduce((sum, planDay) => sum + Math.max(0, planDay.deadlineOverrunMinutes ?? 0), 0);
  const overrunAfter = deadlineOverrun(candidatePlan);
  if (overrunAfter > deadlineOverrun(plan)) {
    conflicts.push({
      kind: "airport_cutoff",
      minutes: overrunAfter,
      message: hardEditConflictSentence("airport_cutoff", "", overrunAfter, locale),
    });
  }
  return conflicts;
}

export type PlannerHardEditEvaluation =
  | { decision: "apply"; travelDeltaMinutes: number }
  | { decision: "confirm"; title: string; conflicts: string[] };

/**
 * The one simulate-then-confirm decision behind every guarded planner edit:
 * a clean candidate applies instantly, and only NEW hard damage queues the
 * confirmation dialog. When the only new damage is a single booking delay,
 * the dialog title becomes the Copy Deck delay sentence.
 */
export function evaluatePlannerHardEdit(input: {
  title: string;
  locale: PlannerLocale;
  plan: BuiltTripPlan | null;
  candidatePlan: BuiltTripPlan | null;
  allowDropStopId?: string;
  extraConflicts?: string[];
}): PlannerHardEditEvaluation {
  const extra = input.extraConflicts ?? [];
  if (!input.plan || !input.candidatePlan) {
    if (extra.length > 0) return { decision: "confirm", title: input.title, conflicts: [...new Set(extra)] };
    return { decision: "apply", travelDeltaMinutes: 0 };
  }
  const hardConflicts = plannerHardEditConflicts(input.plan, input.candidatePlan, input.locale, input.allowDropStopId);
  const messages = [...new Set([...extra, ...hardConflicts.map((conflict) => conflict.message)])];
  if (messages.length === 0) {
    return {
      decision: "apply",
      travelDeltaMinutes: builtPlanTravelMinutes(input.candidatePlan) - builtPlanTravelMinutes(input.plan),
    };
  }
  const singleBookingDelay = extra.length === 0 && hardConflicts.length === 1 && hardConflicts[0].kind === "booking_late"
    ? hardConflicts[0]
    : null;
  return {
    decision: "confirm",
    title: singleBookingDelay ? hardEditBookingDelayTitle(singleBookingDelay.minutes, input.locale) : input.title,
    conflicts: messages,
  };
}

export function clockToMinutes(value: string) {
  const match = /^(?:([01]?\d|2[0-3])):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function clockRangeContainsVisit(range: string, arrival: string, departure: string) {
  const toMinutes = (value: string) => {
    const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const [startText, endText] = range.split("–");
  const start = toMinutes(startText ?? "");
  let end = toMinutes(endText ?? "");
  let visitStart = toMinutes(arrival);
  let visitEnd = toMinutes(departure);
  if (start === null || end === null || visitStart === null || visitEnd === null) return false;
  if (end < start) end += 1440;
  while (visitStart < start) visitStart += 1440;
  while (visitEnd < visitStart) visitEnd += 1440;
  return visitStart >= start && visitEnd <= end;
}

/* Stop order can change when the route is optimized, so the hotel becomes
 * stale only when a day's actual set of destinations changes. */
export function hotelPlanSignature(plan: BuiltTripPlan | null) {
  if (!plan) return "";
  return plan.days.map((day, dayIndex) => (
    `${dayIndex}:${day.stops.map(({ stop }) => stop.id).sort().join(",")}`
  )).join("|");
}

export type ParsePreviewRow =
  | { type: "day"; day: number }
  | { type: "warn"; raw: string }
  | { type: "place"; place: ParsedWishlistPlace; showDay: boolean; placeIndex: number };

export type PlannerEditState = {
  tripDays: number;
  pace: Pace;
  hotelQuery: string;
  resolvedBase: ResolvedInputStop | null;
  travelPreference: TravelPreference;
  transferBufferMinutes: 0 | 10 | 20 | 30;
  userStayMinutes: Record<string, number>;
  lastEntryTimes: Record<string, string>;
  dayStartTimes: Record<number, string>;
  dayEndTimes: Record<number, string>;
  legModeOverrides: Record<string, TransportMode>;
  dayOverrides: Record<string, number>;
  lockedOrderByDay: Record<number, string[]>;
  removedStops: Array<{ id: string; name: string }>;
  // v1.1 TC-048/TC-050: recommendation accepts are first-class history
  // operations. They mutate the wishlist text, the resolved-stop set, the
  // provider pins and the meal selections, so those live in the same tracked
  // state — one Undo restores the exact prior plan, because the plan is a
  // memo over this state.
  itinerary: string;
  mealSelections: Record<string, string>;
  resolvedStops: ResolvedInputStop[];
  resolutionOverrides: ShareableResolutionOverride[];
};

/** v1.1 §8.1: Undo/Redo reaches the last 10 operations (直近10操作). */
export const PLANNER_UNDO_LIMIT = 10;

export function emptyPlannerEditState(): PlannerEditState {
  return {
    tripDays: 3,
    pace: "balanced",
    hotelQuery: "",
    resolvedBase: null,
    travelPreference: "auto",
    transferBufferMinutes: 10,
    userStayMinutes: {},
    lastEntryTimes: {},
    dayStartTimes: {},
    dayEndTimes: {},
    legModeOverrides: {},
    dayOverrides: {},
    lockedOrderByDay: {},
    removedStops: [],
    itinerary: "",
    mealSelections: {},
    resolvedStops: [],
    resolutionOverrides: [],
  };
}

/**
 * The post-build provisional-base attach (and other system-driven base
 * handovers) establish the plan's baseline; they are not user operations.
 * Rewriting the base across past/present/future keeps the attach out of the
 * undo history entirely: no entry is added, Undo never "reverts" to the
 * pre-attach routing base, and the drift check cannot mistake the attach for
 * external damage and wipe the stack.
 */
export function attachPlannerBaseToHistory(
  history: PlannerHistory<PlannerEditState>,
  base: ResolvedInputStop | null,
): PlannerHistory<PlannerEditState> {
  return {
    ...history,
    past: history.past.map((state) => ({ ...state, resolvedBase: base })),
    present: { ...history.present, resolvedBase: base },
    future: history.future.map((state) => ({ ...state, resolvedBase: base })),
  };
}

// Product / UX specification v0.3 promotes route-aware hotels, meals and one
// useful gap-filler per day into the core completion experience.  Keep the
// switch explicit so a provider incident can still be isolated without
// weakening the deterministic feasibility engine.
export const P0_CORE_ONLY = false;
export const P1_TRAVEL_ENRICHMENTS = false;
export const initialBuildProgress: BuildProgress = {
  stage: "grouping",
};

/* "Tomorrow" means tomorrow where the trip happens. Until a destination is
 * known, the traveller's own clock is the least surprising answer. */
export function plannerTimeZone(destination: Destination) {
  if (destination.id !== "worldwide") return destination.timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function defaultTripDate(destination: Destination = destinationById("worldwide")) {
  return localDateIn(plannerTimeZone(destination), new Date(Date.now() + 86_400_000));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
  shouldStop?: () => boolean,
) {
  const results: Array<{ index: number; value: R }> = [];
  let cursor = 0;
  let completed = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length && !shouldStop?.()) {
      const index = cursor;
      cursor += 1;
      const value = await worker(items[index], index);
      if (shouldStop?.()) return;
      results.push({ index, value });
      completed += 1;
      onProgress?.(completed, items.length);
    }
  });
  await Promise.all(runners);
  return results.sort((a, b) => a.index - b.index).map(({ value }) => value);
}

export function hotelAsResolvedBase(candidate: HotelCandidate, input: string, area: string, verifiedAt: string): ResolvedInputStop {
  return {
    id: `hotel-${candidate.id}`,
    providerRef: candidate.id,
    input: input.trim() || candidate.name,
    name: candidate.name,
    area,
    address: candidate.address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    sourceUrl: candidate.googleMapsUrl,
    verifiedAt,
    confidence: "medium",
    planningDurationMinutes: 0,
    isAnchor: false,
  };
}

export function provisionalBaseAsResolved(base: TripBase): ResolvedInputStop {
  return {
    ...base,
    input: base.query || base.name,
    address: base.area,
  };
}

export function normalizeHotelName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function isAreaLikeHotelQuery(value: string) {
  const query = value.normalize("NFKC").trim().toLowerCase();
  if (!query) return true;
  return /(?:周辺|近く|近辺|付近|エリア|界隈|あたり|駅前|駅のそば|のホテル|で泊まりたい|near\b|around\b|\barea\b|hotels?\s+(?:in|near)|(?:near|around)\s+.+\s+hotels?)/iu.test(query);
}

export function shouldUseRecommendedHotel(query: string) {
  return !query.trim() || isAreaLikeHotelQuery(query);
}

export function matchingHotelCandidate(resolved: ResolvedInputStop, candidates: HotelCandidate[]) {
  const resolvedName = normalizeHotelName(resolved.name);
  return candidates.find((candidate) => {
    const candidateName = normalizeHotelName(candidate.name);
    const namesMatch = resolvedName.length >= 3
      && candidateName.length >= 3
      && (resolvedName.includes(candidateName) || candidateName.includes(resolvedName));
    const latitudeDelta = candidate.latitude - resolved.latitude;
    const longitudeDelta = candidate.longitude - resolved.longitude;
    return namesMatch || latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta < 0.000004;
  }) ?? null;
}

// Food, public-source checks and measured routes are progressive, result-side
// actions. They must never masquerade as prerequisites for the first plan.
// Under the P0 incident switch no hotel or meal search runs at all, so the
// "enriching" stage would over-promise and stays off the screen.
export const buildStageOrder: BuildStage[] = P0_CORE_ONLY
  ? ["grouping", "ordering"]
  : ["grouping", "ordering", "enriching"];

