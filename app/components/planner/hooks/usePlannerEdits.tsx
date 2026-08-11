"use client";

// Planner edits (refactor spec v2.1 hooks/): the bounded undo/redo history,
// the hard-edit confirmation queue, the edit toast and the edit actions that
// drive them. usePlannerEdits owns the state AND the history core
// (commit/undo/redo, the toast and the Cmd/Ctrl+Z shortcut): unlike the other
// planner hooks, those actions close over only input-step state declared
// before the old state block, so state and actions share one hook called at
// the old editHistory position — showEditToast must exist there because the
// hotel actions hook takes it as a param. The guarded edit actions rebuild
// candidate plans, so they close over the derived `plan`, the active planner
// context and the hotel actions' nightly reset — all computed later — and are
// exported as useGuardedPlannerEdits, called at the old hardEditConflicts
// position. Meal and gap acceptance additionally close over the derived day
// slots, planned-stop ids and the active gap/search state, so they are
// exported as useRecommendationEdits, called at the old addRouteRecommendation
// position. The domain input states the history snapshots (tripDays, pace,
// hotel query, stay times, overrides...) deliberately stay in TripPlannerApp;
// their current values and setters are passed in as params so closure and
// dependency semantics stay exactly what they were before the extraction.
// This file is intentionally .tsx: the planner-surface contract tests scan
// app/**/*.tsx for these contracts, wherever they live.
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { foodCandidateReason } from "../../../../lib/food-recommendations-client";
import { bayesianWeightedRating, restaurantRatingPrior } from "../../../../lib/rating-confidence";
import { areaFromAddress } from "../../../../lib/google-place-resolver";
import { resolveKnownStops, type ResolvedInputStop, type RouteStop } from "../../../../lib/route-optimizer";
import {
  buildTripFromWishlist,
  routeLegKey,
  type BuiltTripPlan,
  type FoodRecommendationSlot,
  type TripPlannerContext,
} from "../../../../lib/trip-builder";
import type { Pace } from "../../../../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../../../../lib/time-feasibility";
import type { Destination } from "../../../../lib/destinations";
import { estimateStayMinutes } from "../../../../lib/stay-estimates";
import { createRecommendation } from "../../../../lib/itinerary-domain";
import {
  evaluateRecommendationCandidate,
  recommendationPlaceAlreadyScheduled,
  recommendationPlanSnapshot,
} from "../../../../lib/recommendation-evaluator";
import type { RouteRecommendation, RouteRecommendationPoint } from "../../../../lib/route-recommendations";
import { trackProductEvent, type ProductEventFields, type ProductEventName } from "../../../../lib/product-analytics";
import { assessTripFit, type TripFitAssessment } from "../../../../lib/trip-scenarios";
import type { ItineraryGap } from "../../../../lib/gap-detection";
import type { AlternativePlan } from "../../../../lib/feasibility-result";
import type { ShareableResolutionOverride } from "../../../../lib/share-link";
import { parsedWishlistPlaces } from "../../../../lib/wishlist-parser";
import {
  commitPlannerHistory,
  createPlannerHistory,
  plannerHistoryStateEqual,
  redoPlannerHistory,
  undoPlannerHistory,
  type PlannerHistory,
} from "../../../../lib/planner-history";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";
import { shiftPlannerClock } from "../../../../lib/presentation/trip-presentation";
import {
  boundedRecommendationScore,
  fillerOccurrenceLine,
  recommendationStopId,
  routeRecommendationFillerKind,
} from "../../../../lib/presentation/recommendation-presentation";
import {
  builtPlanTravelMinutes,
  clampTripDays,
  clockRangeContainsVisit,
  upsertResolutionOverride,
  type FoodState,
  type Inspector,
  type PlannerEditState,
  type RouteRecommendationState,
} from "../../../../lib/planner-app-state";

// The hard-edit confirmation payload. Named (it was an inline useState type in
// TripPlannerApp) only so the guarded-actions hook below can type the setter
// it receives; the shape is unchanged.
export type PendingHardEdit = {
  title: string;
  conflicts: string[];
  apply: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
};

export function usePlannerEdits({
  dayEndTimes,
  dayOverrides,
  dayStartTimes,
  hasPlan,
  hotelQuery,
  lastEntryTimes,
  legModeOverrides,
  locale,
  lockedOrderByDay,
  pace,
  planReady,
  removedStops,
  resolvedBase,
  setActiveDay,
  setDayEndTimes,
  setDayOverrides,
  setDayStartTimes,
  setHotelQuery,
  setInspector,
  setLastEntryTimes,
  setLegModeOverrides,
  setLockedOrderByDay,
  setPace,
  setRemovedStops,
  setResolvedBase,
  setTransferBufferMinutes,
  setTravelPreference,
  setTripDays,
  setUserStayMinutes,
  transferBufferMinutes,
  travelPreference,
  tripDays,
  userStayMinutes,
}: {
  dayEndTimes: Record<number, string>;
  dayOverrides: Record<string, number>;
  dayStartTimes: Record<number, string>;
  hasPlan: boolean;
  hotelQuery: string;
  lastEntryTimes: Record<string, string>;
  legModeOverrides: Record<string, TransportMode>;
  locale: PlannerLocale;
  lockedOrderByDay: Record<number, string[]>;
  pace: Pace;
  planReady: boolean;
  removedStops: Array<{ id: string; name: string }>;
  resolvedBase: ResolvedInputStop | null;
  setActiveDay: Dispatch<SetStateAction<number>>;
  setDayEndTimes: Dispatch<SetStateAction<Record<number, string>>>;
  setDayOverrides: Dispatch<SetStateAction<Record<string, number>>>;
  setDayStartTimes: Dispatch<SetStateAction<Record<number, string>>>;
  setHotelQuery: Dispatch<SetStateAction<string>>;
  setInspector: Dispatch<SetStateAction<Inspector>>;
  setLastEntryTimes: Dispatch<SetStateAction<Record<string, string>>>;
  setLegModeOverrides: Dispatch<SetStateAction<Record<string, TransportMode>>>;
  setLockedOrderByDay: Dispatch<SetStateAction<Record<number, string[]>>>;
  setPace: Dispatch<SetStateAction<Pace>>;
  setRemovedStops: Dispatch<SetStateAction<Array<{ id: string; name: string }>>>;
  setResolvedBase: Dispatch<SetStateAction<ResolvedInputStop | null>>;
  setTransferBufferMinutes: Dispatch<SetStateAction<0 | 10 | 20 | 30>>;
  setTravelPreference: Dispatch<SetStateAction<TravelPreference>>;
  setTripDays: Dispatch<SetStateAction<number>>;
  setUserStayMinutes: Dispatch<SetStateAction<Record<string, number>>>;
  transferBufferMinutes: 0 | 10 | 20 | 30;
  travelPreference: TravelPreference;
  tripDays: number;
  userStayMinutes: Record<string, number>;
}) {
  const [editHistory, setEditHistory] = useState<PlannerHistory<PlannerEditState>>(() => createPlannerHistory({
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
  }));
  const [historyAnnouncement, setHistoryAnnouncement] = useState("");
  // v1.1 TC-007 / §8.2: an edit that breaks a hard promise (booking time,
  // must-visit, airport cutoff) never applies silently; it waits here for an
  // explicit decision while every ordinary edit stays instant.
  const [pendingHardEdit, setPendingHardEdit] = useState<PendingHardEdit | null>(null);
  // v1.1 §8.1: ordinary edits apply instantly and answer with one 6-second
  // toast (≤2 metrics) plus Undo, instead of a confirmation dialog.
  const [editToast, setEditToast] = useState<{ message: string; detail: string | null } | null>(null);
  const editToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyActionRef = useRef<{ undo: () => void; redo: () => void }>({ undo: () => {}, redo: () => {} });

  function currentPlannerEditState(): PlannerEditState {
    return {
      tripDays,
      pace,
      hotelQuery,
      resolvedBase,
      travelPreference,
      transferBufferMinutes,
      userStayMinutes,
      lastEntryTimes,
      dayStartTimes,
      dayEndTimes,
      legModeOverrides,
      dayOverrides,
      lockedOrderByDay,
      removedStops,
    };
  }

  function applyPlannerEditState(next: PlannerEditState) {
    setTripDays(next.tripDays);
    setPace(next.pace);
    setHotelQuery(next.hotelQuery);
    setResolvedBase(next.resolvedBase);
    setTravelPreference(next.travelPreference);
    setTransferBufferMinutes(next.transferBufferMinutes);
    setUserStayMinutes(next.userStayMinutes);
    setLastEntryTimes(next.lastEntryTimes);
    setDayStartTimes(next.dayStartTimes);
    setDayEndTimes(next.dayEndTimes);
    setLegModeOverrides(next.legModeOverrides);
    setDayOverrides(next.dayOverrides);
    setLockedOrderByDay(next.lockedOrderByDay);
    setRemovedStops(next.removedStops);
    setActiveDay((current) => Math.min(current, Math.max(0, next.tripDays - 1)));
    setInspector(null);
  }

  function plannerEditType(patch: Partial<PlannerEditState>): NonNullable<ProductEventFields["edit_type"]> {
    if ("dayOverrides" in patch) return "move_day";
    if ("removedStops" in patch) return "remove_stop";
    if ("tripDays" in patch) return "trip_days";
    if ("userStayMinutes" in patch || "lastEntryTimes" in patch) return "stay_time";
    if ("legModeOverrides" in patch) return "leg_mode";
    if ("lockedOrderByDay" in patch) return "reorder";
    return "other";
  }

  function commitPlannerEdit(patch: Partial<PlannerEditState>) {
    if (hasPlan) trackProductEvent("plan_edited", { edit_type: plannerEditType(patch) });
    const current = currentPlannerEditState();
    const next = { ...current, ...patch };
    setEditHistory((history) => commitPlannerHistory(
      plannerHistoryStateEqual(history.present, current) ? history : createPlannerHistory(current),
      next,
    ));
    applyPlannerEditState(next);
  }

  function undoPlannerEdit() {
    const current = currentPlannerEditState();
    const aligned = plannerHistoryStateEqual(editHistory.present, current)
      ? editHistory
      : createPlannerHistory(current);
    const nextHistory = undoPlannerHistory(aligned);
    if (nextHistory === aligned) return;
    setEditHistory(nextHistory);
    applyPlannerEditState(nextHistory.present);
    trackProductEvent("undo_used", {});
    setHistoryAnnouncement(locale === "ja" ? "直前の変更を取り消しました" : "Undid the last change");
  }

  function redoPlannerEdit() {
    const current = currentPlannerEditState();
    const aligned = plannerHistoryStateEqual(editHistory.present, current)
      ? editHistory
      : createPlannerHistory(current);
    const nextHistory = redoPlannerHistory(aligned);
    if (nextHistory === aligned) return;
    setEditHistory(nextHistory);
    applyPlannerEditState(nextHistory.present);
    setHistoryAnnouncement(locale === "ja" ? "変更をやり直しました" : "Redid the change");
  }
  // The Cmd/Ctrl+Z listener below reads the freshest undo/redo closures
  // through this ref so it never has to re-subscribe per keystroke-relevant
  // render. The render-time write is TripPlannerApp's original code verbatim;
  // the linter only surfaces it here because this small hook is analyzable
  // where the 4,000-line component bailed out of compiler analysis.
  // eslint-disable-next-line react-hooks/refs
  historyActionRef.current = { undo: undoPlannerEdit, redo: redoPlannerEdit };

  function showEditToast(message: string, detail: string | null = null) {
    if (editToastTimerRef.current !== null) clearTimeout(editToastTimerRef.current);
    setEditToast({ message, detail });
    editToastTimerRef.current = setTimeout(() => setEditToast(null), 6_000);
  }

  useEffect(() => {
    if (!planReady) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      if (event.shiftKey) historyActionRef.current.redo();
      else historyActionRef.current.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [planReady]);

  return {
    editHistory,
    setEditHistory,
    historyAnnouncement,
    pendingHardEdit,
    setPendingHardEdit,
    editToast,
    setEditToast,
    commitPlannerEdit,
    undoPlannerEdit,
    redoPlannerEdit,
    showEditToast,
  };
}

export function useGuardedPlannerEdits({
  activeDay,
  activePlannerContext,
  clearNightlyHotelResults,
  commitPlannerEdit,
  dayEndTarget,
  dayEndTimes,
  dayOverrides,
  dayStartTimes,
  hasPlan,
  itinerary,
  legModeOverrides,
  locale,
  lockedOrderByDay,
  maxParsedDay,
  pace,
  plan,
  removedStops,
  resolvedStops,
  setActiveDay,
  setComparisonAlternative,
  setDaysUndecided,
  setFoodSearches,
  setHotelUsesRecommendations,
  setInspector,
  setMealSelections,
  setPendingHardEdit,
  setRouteGeometryByDay,
  setRouteRecommendationNotice,
  setRouteRecommendationSearches,
  showEditToast,
  trackMilestone,
  tripDays,
}: {
  activeDay: number;
  activePlannerContext: TripPlannerContext;
  clearNightlyHotelResults: () => void;
  commitPlannerEdit: (patch: Partial<PlannerEditState>) => void;
  dayEndTarget: string;
  dayEndTimes: Record<number, string>;
  dayOverrides: Record<string, number>;
  dayStartTimes: Record<number, string>;
  hasPlan: boolean;
  itinerary: string;
  legModeOverrides: Record<string, TransportMode>;
  locale: PlannerLocale;
  lockedOrderByDay: Record<number, string[]>;
  maxParsedDay: number;
  pace: Pace;
  plan: BuiltTripPlan | null;
  removedStops: Array<{ id: string; name: string }>;
  resolvedStops: ResolvedInputStop[];
  setActiveDay: Dispatch<SetStateAction<number>>;
  setComparisonAlternative: Dispatch<SetStateAction<AlternativePlan | null>>;
  setDaysUndecided: Dispatch<SetStateAction<boolean>>;
  setFoodSearches: Dispatch<SetStateAction<Record<string, FoodState>>>;
  setHotelUsesRecommendations: Dispatch<SetStateAction<boolean>>;
  setInspector: Dispatch<SetStateAction<Inspector>>;
  setMealSelections: Dispatch<SetStateAction<Record<string, string>>>;
  setPendingHardEdit: Dispatch<SetStateAction<PendingHardEdit | null>>;
  setRouteGeometryByDay: Dispatch<SetStateAction<Record<string, RouteRecommendationPoint[]>>>;
  setRouteRecommendationNotice: Dispatch<SetStateAction<string>>;
  setRouteRecommendationSearches: Dispatch<SetStateAction<Record<string, RouteRecommendationState>>>;
  showEditToast: (message: string, detail?: string | null) => void;
  trackMilestone: (event: ProductEventName, fields?: ProductEventFields) => void;
  tripDays: number;
}) {
  // Hard-conflict damage a candidate plan would introduce compared to the
  // current one. Only the three protected promises are inspected (v1.1 §8.2).
  function hardEditConflicts(candidatePlan: BuiltTripPlan, allowDropStopId?: string) {
    if (!plan) return [];
    const conflicts: string[] = [];
    const lateNow = new Map<string, number>();
    for (const planDay of plan.days) {
      for (const built of planDay.stops) {
        if (built.reservationLateMinutes > 0) lateNow.set(built.stop.id, built.reservationLateMinutes);
      }
    }
    for (const planDay of candidatePlan.days) {
      for (const built of planDay.stops) {
        if (built.reservationLateMinutes > (lateNow.get(built.stop.id) ?? 0)) {
          conflicts.push(locale === "ja"
            ? `「${built.stop.name}」の予約に${built.reservationLateMinutes}分遅れます`
            : `You would be ${built.reservationLateMinutes} minutes late for “${built.stop.name}”`);
        }
      }
    }
    const scheduledAfter = new Set(candidatePlan.days.flatMap((planDay) => planDay.stops.map((built) => built.stop.id)));
    for (const planDay of plan.days) {
      for (const built of planDay.stops) {
        if (built.priority !== "must" || built.stop.id === allowDropStopId || scheduledAfter.has(built.stop.id)) continue;
        conflicts.push(locale === "ja"
          ? `必須の「${built.stop.name}」が日程に入らなくなります`
          : `Must-visit “${built.stop.name}” would no longer fit the plan`);
      }
    }
    const deadlineOverrun = (candidate: BuiltTripPlan) => candidate.days.reduce((sum, planDay) => sum + Math.max(0, planDay.deadlineOverrunMinutes ?? 0), 0);
    const overrunAfter = deadlineOverrun(candidatePlan);
    if (overrunAfter > deadlineOverrun(plan)) {
      conflicts.push(locale === "ja"
        ? `空港へ向かう締切を${overrunAfter}分超えます`
        : `The airport cutoff would be missed by ${overrunAfter} minutes`);
    }
    return conflicts;
  }

  function applyGuardedEdit(input: {
    title: string;
    apply: () => void;
    contextPatch?: Partial<TripPlannerContext>;
    candidateDays?: number;
    allowDropStopId?: string;
    extraConflicts?: string[];
    toast?: string;
  }) {
    const extra = input.extraConflicts ?? [];
    if (!plan) {
      if (extra.length > 0) {
        setPendingHardEdit({ title: input.title, conflicts: extra, apply: input.apply });
        return;
      }
      input.apply();
      return;
    }
    const candidateContext: TripPlannerContext = { ...activePlannerContext, ...(input.contextPatch ?? {}) };
    const candidatePlan = buildTripFromWishlist(itinerary, input.candidateDays ?? tripDays, pace, locale, candidateContext);
    const conflicts = [...extra, ...hardEditConflicts(candidatePlan, input.allowDropStopId)];
    if (conflicts.length === 0) {
      input.apply();
      if (input.toast) {
        const travelDelta = builtPlanTravelMinutes(candidatePlan) - builtPlanTravelMinutes(plan);
        showEditToast(input.toast, travelDelta !== 0
          ? locale === "ja"
            ? `移動 ${travelDelta > 0 ? "+" : "−"}${Math.abs(travelDelta)}分`
            : `travel ${travelDelta > 0 ? "+" : "−"}${Math.abs(travelDelta)} min`
          : null);
      }
      return;
    }
    setPendingHardEdit({ title: input.title, conflicts: [...new Set(conflicts)], apply: input.apply });
  }

  function removeStopFromPlan(stop: RouteStop) {
    if (removedStops.some((entry) => entry.id === stop.id)) return;
    const parsed = parsedWishlistPlaces(itinerary);
    const runtimeInputIndex = "inputIndex" in stop && typeof stop.inputIndex === "number"
      ? stop.inputIndex
      : null;
    const occurrenceName = runtimeInputIndex !== null ? parsed[runtimeInputIndex]?.name : null;
    const reviewedName = resolvedStops.find((candidate) => (
      stop.id === candidate.id || stop.id.startsWith(`${candidate.id}--occurrence-`)
    ))?.input;
    const catalogName = parsed.find((place) => (
      resolveKnownStops(place.name, locale).some((candidate) => candidate.id === stop.id)
    ))?.name;
    const authoredName = occurrenceName
      ?? reviewedName
      ?? catalogName
      ?? (stop.isUserEntered ? stop.name : null)
      ?? (locale === "ja" ? "除外した場所" : "Removed place");
    const builtStop = plan?.days.flatMap((planDay) => planDay.stops).find((built) => built.stop.id === stop.id) ?? null;
    const protectedRemoval = builtStop?.priority === "must" || builtStop?.isReservation;
    applyGuardedEdit({
      title: locale === "ja" ? `「${stop.name}」を予定から外しますか？` : `Remove “${stop.name}” from the plan?`,
      apply: () => commitPlannerEdit({ removedStops: [...removedStops, { id: stop.id, name: authoredName }] }),
      contextPatch: { excludedStopIds: [...removedStops.map((entry) => entry.id), stop.id] },
      allowDropStopId: stop.id,
      toast: locale === "ja" ? `「${stop.name}」を外しました` : `Removed “${stop.name}”`,
      extraConflicts: protectedRemoval
        ? [builtStop?.priority === "must"
          ? (locale === "ja" ? `「${stop.name}」は必須に指定されています` : `“${stop.name}” is marked as a must-visit`)
          : (locale === "ja" ? `「${stop.name}」は予約済みとして固定されています` : `“${stop.name}” is pinned as a booking`)]
        : [],
    });
  }

  function restoreRemovedStop(stopId: string) {
    commitPlannerEdit({ removedStops: removedStops.filter((entry) => entry.id !== stopId) });
  }

  function removeSystemFiller(stop: RouteStop) {
    removeStopFromPlan(stop);
    setMealSelections((current) => Object.fromEntries(Object.entries(current).filter(([, candidateId]) => (
      recommendationStopId(candidateId) !== stop.id
    ))));
  }

  function moveStopToDay(stopId: string, dayIndex: number) {
    const stopName = plan?.days.flatMap((planDay) => planDay.stops).find((built) => built.stop.id === stopId)?.stop.name
      ?? (locale === "ja" ? "この場所" : "this stop");
    if (dayIndex === activeDay) {
      // Tapping the current day releases the stop back to automatic placement.
      if (!(stopId in dayOverrides)) return;
      const next = { ...dayOverrides };
      delete next[stopId];
      applyGuardedEdit({
        title: locale === "ja" ? `「${stopName}」の日程を自動配置に戻しますか？` : `Return “${stopName}” to automatic placement?`,
        apply: () => commitPlannerEdit({ dayOverrides: next }),
        contextPatch: { dayOverrides: next },
        toast: locale === "ja" ? `「${stopName}」を自動配置に戻しました` : `Returned “${stopName}” to automatic placement`,
      });
      return;
    }
    const nextOverrides = { ...dayOverrides, [stopId]: dayIndex + 1 };
    applyGuardedEdit({
      title: locale === "ja" ? `「${stopName}」を${dayIndex + 1}日目へ移動しますか？` : `Move “${stopName}” to day ${dayIndex + 1}?`,
      apply: () => {
        commitPlannerEdit({ dayOverrides: nextOverrides });
        setActiveDay(dayIndex);
      },
      contextPatch: { dayOverrides: nextOverrides },
      toast: locale === "ja" ? `${dayIndex + 1}日目へ移動しました` : `Moved to Day ${dayIndex + 1}`,
    });
  }

  function changeTripDays(nextValue: number) {
    // Explicit "Day N" pins are promises. Shortening below the highest pinned
    // day would silently discard one, so that day becomes the lower bound.
    const pinnedDay = plan?.minimumPinnedDay ?? maxParsedDay;
    const supportedPinnedDay = pinnedDay >= 1 && pinnedDay <= 14 ? pinnedDay : 1;
    const nextDays = clampTripDays(Math.max(supportedPinnedDay, nextValue));
    if (nextDays === tripDays) return;
    const nextStartTimes = Object.fromEntries(Object.entries(dayStartTimes).filter(([day]) => Number(day) < nextDays));
    const nextEndTimes = Object.fromEntries(Object.entries(dayEndTimes).filter(([day]) => Number(day) < nextDays));
    const applyDaysChange = () => {
      setDaysUndecided(false);
      commitPlannerEdit({ tripDays: nextDays, dayStartTimes: nextStartTimes, dayEndTimes: nextEndTimes });
      if (hasPlan) showEditToast(locale === "ja" ? `${nextDays}日の旅程にしました` : `Trip length set to ${nextDays} days`);
      setActiveDay((current) => Math.min(current, nextDays - 1));
      setInspector(null);
      // These results are keyed to the old day clustering. Clearing them is
      // safer than leaving a restaurant or nightly hotel attached to a new area.
      setFoodSearches({});
      setRouteRecommendationSearches({});
      setRouteRecommendationNotice("");
      setRouteGeometryByDay({});
      setMealSelections({});
      clearNightlyHotelResults();
    };
    // Only shrinking the trip can silently break a booking or drop a must
    // stop; growing it stays instant (v1.1 §8.2).
    if (nextDays < tripDays && hasPlan && plan) {
      applyGuardedEdit({
        title: locale === "ja" ? `${nextDays}日に短縮しますか？` : `Shorten the trip to ${nextDays} days?`,
        apply: applyDaysChange,
        contextPatch: { dayStartTimes: nextStartTimes, dayEndTimes: nextEndTimes },
        candidateDays: nextDays,
      });
      return;
    }
    applyDaysChange();
  }

  function setLegMode(legKey: string, mode: TransportMode) {
    const next = { ...legModeOverrides };
    // Tapping the already-pinned mode releases the leg back to automatic.
    if (next[legKey] === mode) delete next[legKey];
    else next[legKey] = mode;
    const nextLockedOrder = { ...lockedOrderByDay };
    const dayIndex = plan?.days.findIndex((planDay) => planDay.legs.some((leg) => routeLegKey(leg.from.id, leg.to.id) === legKey)) ?? -1;
    if (dayIndex >= 0 && plan) {
      const day = plan.days[dayIndex];
      const dayLegKeys = new Set(day.legs.map((leg) => routeLegKey(leg.from.id, leg.to.id)));
      const stillHasPinnedLeg = Object.keys(next).some((key) => dayLegKeys.has(key));
      if (stillHasPinnedLeg) nextLockedOrder[dayIndex] = day.stops.map((stop) => stop.stop.id);
      else delete nextLockedOrder[dayIndex];
    }
    commitPlannerEdit({ legModeOverrides: next, lockedOrderByDay: nextLockedOrder });
  }

  function applyTripAlternative(alternative: AlternativePlan) {
    if (!plan) return;
    trackMilestone("alternative_applied", { alternative_type: alternative.kind });
    if (alternative.kind === "CHANGE_DAYS" && alternative.change.days) {
      changeTripDays(alternative.change.days);
    } else if (alternative.kind === "START_EARLIER") {
      const minutes = alternative.change.minutes ?? 60;
      commitPlannerEdit({ dayStartTimes: Object.fromEntries(plan.days.map((planDay, dayIndex) => [
        dayIndex,
        shiftPlannerClock(dayStartTimes[dayIndex] ?? planDay.requestedStartTime, -minutes),
      ])) });
    } else if (alternative.kind === "END_LATER") {
      const minutes = alternative.change.minutes ?? 60;
      commitPlannerEdit({ dayEndTimes: Object.fromEntries(plan.days.map((_, dayIndex) => [
        dayIndex,
        shiftPlannerClock((dayEndTimes[dayIndex] ?? dayEndTarget) || "22:00", minutes),
      ])) });
    } else if (alternative.kind === "CHANGE_BASE" && alternative.change.baseId) {
      const candidate = plan.baseRecommendations.find((entry) => entry.base.id === alternative.change.baseId)?.base;
      if (candidate) {
        commitPlannerEdit({
          hotelQuery: candidate.query,
          resolvedBase: { ...candidate, input: candidate.query, address: candidate.area },
        });
        setHotelUsesRecommendations(false);
      }
    } else if (alternative.kind === "CHANGE_MODE" && alternative.change.legId && alternative.change.mode) {
      const dayIndex = plan.days.findIndex((planDay) => planDay.legs.some((leg) => routeLegKey(leg.from.id, leg.to.id) === alternative.change.legId));
      const nextLockedOrder = { ...lockedOrderByDay };
      if (dayIndex >= 0) nextLockedOrder[dayIndex] = plan.days[dayIndex].stops.map((stop) => stop.stop.id);
      commitPlannerEdit({
        legModeOverrides: { ...legModeOverrides, [alternative.change.legId]: alternative.change.mode },
        lockedOrderByDay: nextLockedOrder,
      });
    } else if (alternative.kind === "OPTIMIZE_ORDER" && alternative.change.orderByDay) {
      commitPlannerEdit({ lockedOrderByDay: alternative.change.orderByDay });
    } else if (alternative.kind === "REMOVE_OPTIONAL" && alternative.change.stopId) {
      const stop = plan.days.flatMap((planDay) => planDay.stops.map((built) => built.stop))
        .concat(plan.deferredOptionalStops)
        .find((entry) => entry.id === alternative.change.stopId);
      if (stop) removeStopFromPlan(stop);
    }
    setComparisonAlternative(null);
  }

  return {
    removeStopFromPlan,
    restoreRemovedStop,
    removeSystemFiller,
    moveStopToDay,
    changeTripDays,
    setLegMode,
    applyTripAlternative,
  };
}

export function useRecommendationEdits({
  activeDay,
  activeDestination,
  activePlannerContext,
  activeRouteRecommendationState,
  day,
  daySlots,
  fillerKindsByStopId,
  fillerStopIds,
  foodSearches,
  itinerary,
  locale,
  mealSelections,
  pace,
  plan,
  plannedStopIds,
  postBuildLegBudgetRef,
  primaryRecommendationGap,
  removedStops,
  removeSystemFiller,
  resolvedStops,
  setDayOverrides,
  setFoodRecommendationNotice,
  setInspector,
  setItinerary,
  setMealSelections,
  setRemovedStops,
  setResolutionOverrides,
  setResolvedStops,
  setRouteAlternativesExpanded,
  setRouteRecommendationNotice,
  text,
  tripDays,
  tripFit,
}: {
  activeDay: number;
  activeDestination: Destination;
  activePlannerContext: TripPlannerContext;
  activeRouteRecommendationState: RouteRecommendationState;
  day: BuiltTripPlan["days"][number] | null;
  daySlots: FoodRecommendationSlot[];
  fillerKindsByStopId: Map<string, "micro" | "lunch" | "dinner">;
  fillerStopIds: Set<string>;
  foodSearches: Record<string, FoodState>;
  itinerary: string;
  locale: PlannerLocale;
  mealSelections: Record<string, string>;
  pace: Pace;
  plan: BuiltTripPlan | null;
  plannedStopIds: Set<string>;
  postBuildLegBudgetRef: RefObject<number>;
  primaryRecommendationGap: ItineraryGap | null;
  removedStops: Array<{ id: string; name: string }>;
  removeSystemFiller: (stop: RouteStop) => void;
  resolvedStops: ResolvedInputStop[];
  setDayOverrides: Dispatch<SetStateAction<Record<string, number>>>;
  setFoodRecommendationNotice: Dispatch<SetStateAction<string>>;
  setInspector: Dispatch<SetStateAction<Inspector>>;
  setItinerary: Dispatch<SetStateAction<string>>;
  setMealSelections: Dispatch<SetStateAction<Record<string, string>>>;
  setRemovedStops: Dispatch<SetStateAction<Array<{ id: string; name: string }>>>;
  setResolutionOverrides: Dispatch<SetStateAction<ShareableResolutionOverride[]>>;
  setResolvedStops: Dispatch<SetStateAction<ResolvedInputStop[]>>;
  setRouteAlternativesExpanded: Dispatch<SetStateAction<boolean>>;
  setRouteRecommendationNotice: Dispatch<SetStateAction<string>>;
  text: (typeof ui)[PlannerLocale];
  tripDays: number;
  tripFit: TripFitAssessment | null;
}) {
  function toggleMealSelection(slotId: string, candidateId: string) {
    if (!plan || !tripFit || !day) return;
    const slot = daySlots.find((candidateSlot) => candidateSlot.id === slotId);
    const foodState = foodSearches[slotId];
    const candidate = foodState?.candidates.find((entry) => entry.id === candidateId);
    if (!slot || !candidate || typeof candidate.latitude !== "number" || typeof candidate.longitude !== "number") return;
    const currentCandidateId = mealSelections[slotId];
    const currentStopId = currentCandidateId ? recommendationStopId(currentCandidateId) : null;
    if (currentCandidateId === candidateId) {
      const currentStop = resolvedStops.find((stop) => stop.id === currentStopId);
      if (currentStop) removeSystemFiller(currentStop);
      else setMealSelections((current) => {
        const next = { ...current };
        delete next[slotId];
        return next;
      });
      setFoodRecommendationNotice("");
      return;
    }
    const duplicatePlannedPlace = recommendationPlaceAlreadyScheduled(candidate.id, plannedStopIds, resolvedStops, currentStopId);
    if (duplicatePlannedPlace) {
      setFoodRecommendationNotice(locale === "ja"
        ? "同じ場所が、すでにこの旅程に入っています。別の候補を選んでください。"
        : "That place is already in this itinerary. Choose a different suggestion.");
      return;
    }
    const fillerKind = slot.kind === "lunch" ? "lunch" as const : "dinner" as const;
    const otherFillers = day.stops.filter(({ stop }) => (
      fillerStopIds.has(stop.id) && stop.id !== currentStopId
    ));
    if (otherFillers.length >= 3 || otherFillers.some(({ stop }) => fillerKindsByStopId.get(stop.id) === fillerKind)) {
      setFoodRecommendationNotice(locale === "ja"
        ? "この時間帯には、すでに別のおすすめがあります。先に外してから入れ替えてください。"
        : "This recommendation slot is already in use. Remove the current suggestion before replacing it.");
      return;
    }
    const inputIndex = parsedWishlistPlaces(itinerary).length;
    const input = fillerOccurrenceLine(inputIndex, fillerKind, slot.displayTime);
    const resolvedId = recommendationStopId(candidate.id);
    const resolved: ResolvedInputStop = {
      id: resolvedId,
      input,
      inputIndex,
      name: candidate.name,
      address: candidate.address,
      area: areaFromAddress(candidate.address, candidate.name, activeDestination),
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      sourceUrl: candidate.googleMapsUrl,
      verifiedAt: foodState.fetchedAt?.slice(0, 10) ?? "",
      confidence: "medium",
      planningDurationMinutes: slot.kind === "lunch" ? 60 : 75,
      isAnchor: false,
      isUserEntered: false,
      placeTypes: [candidate.type],
      providerRef: candidate.id,
    };
    const candidateItinerary = `${itinerary.trimEnd()}\n${input}`.trimStart();
    const candidateRemovedStops = currentStopId
      ? [...new Set([...removedStops.map((entry) => entry.id), currentStopId])]
      : removedStops.map((entry) => entry.id);
    const candidateContext: TripPlannerContext = {
      ...activePlannerContext,
      resolvedStops: [...resolvedStops.filter((stop) => stop.inputIndex !== inputIndex), resolved],
      dayOverrides: { ...(activePlannerContext.dayOverrides ?? {}), [resolved.id]: slot.dayIndex + 1 },
      excludedStopIds: candidateRemovedStops,
    };
    const candidatePlan = buildTripFromWishlist(candidateItinerary, tripDays, pace, locale, candidateContext);
    const candidateFit = assessTripFit(candidateItinerary, tripDays, pace, locale, candidateContext, candidatePlan);
    const scheduledMeal = candidatePlan.days[slot.dayIndex]?.stops.find(({ stop }) => stop.id === resolved.id);
    // The meal must BEGIN inside the meal window; finishing a little past it
    // (a 13:30 lunch running to 14:30) is normal restaurant reality.
    if (!scheduledMeal || !clockRangeContainsVisit(slot.window, scheduledMeal.arrival, scheduledMeal.arrival)) {
      setFoodRecommendationNotice(locale === "ja"
        ? "この候補は食事時間内に収まらないため、旅程へ追加しませんでした。"
        : "We did not add this option because it does not fit inside the meal window.");
      return;
    }
    const anchorStopIds = new Set([
      ...resolvedStops.filter((stop) => !fillerStopIds.has(stop.id)).map((stop) => stop.id),
      ...plan.days.flatMap((planDay) => planDay.stops.flatMap(({ stop }) => fillerStopIds.has(stop.id) ? [] : [stop.id])),
    ]);
    const addedTravelMinutes = Math.max(0, builtPlanTravelMinutes(candidatePlan) - builtPlanTravelMinutes(plan));
    const distanceScore = boundedRecommendationScore(100 - (candidate.distanceMeters ?? 1_500) / 18);
    const qualityScore = boundedRecommendationScore(
      (bayesianWeightedRating(candidate.rating, candidate.userRatingCount, restaurantRatingPrior) ?? restaurantRatingPrior.priorMean) / 5 * 82
      + Math.min(18, Math.log10((candidate.userRatingCount ?? 0) + 1) * 6),
    );
    const recommendation = createRecommendation({
      id: `meal:${slot.id}:${candidate.id}`,
      type: "MEAL",
      placeId: candidate.id,
      fillerKind: slot.kind === "lunch" ? "LUNCH" : "DINNER",
      slotId: slot.id,
      proposedDayIndex: slot.dayIndex,
      proposedStartAt: slot.displayTime,
      addedTravelMinutes,
      score: {
        total: distanceScore * 0.35 + qualityScore * 0.4 + 25,
        detour: distanceScore,
        timeFit: 100,
        qualityConfidence: qualityScore,
        preferenceFit: 75,
      },
      reasons: [foodCandidateReason(candidate, locale)],
    });
    const evaluation = evaluateRecommendationCandidate({
      recommendation,
      openingStatus: candidate.plannedOpen === false || candidate.businessStatus?.includes("CLOSED")
        ? "CLOSED"
        : candidate.plannedOpen === true ? "OPEN" : "UNKNOWN",
      baseline: recommendationPlanSnapshot(plan, tripFit, anchorStopIds),
      candidate: recommendationPlanSnapshot(candidatePlan, candidateFit, anchorStopIds),
    });
    const wasScheduled = candidatePlan.days.some((planDay) => planDay.stops.some(({ stop }) => stop.id === resolved.id));
    if (evaluation.decision === "REJECTED" || !wasScheduled) {
      setFoodRecommendationNotice(locale === "ja"
        ? "この店を入れると、行きたい場所か予約条件を守れないため追加しませんでした。"
        : "We did not add this place because it would displace a chosen stop or break a hard constraint.");
      return;
    }
    setResolvedStops((current) => [...current.filter((stop) => stop.id !== resolved.id), resolved]);
    setResolutionOverrides((current) => upsertResolutionOverride(current, { inputIndex, providerRef: candidate.id }));
    setItinerary(candidateItinerary);
    setDayOverrides((current) => ({ ...current, [resolved.id]: slot.dayIndex + 1 }));
    if (currentStopId) {
      setRemovedStops((current) => current.some((entry) => entry.id === currentStopId)
        ? current
        : [...current, { id: currentStopId, name: locale === "ja" ? "以前のおすすめ" : "Previous suggestion" }]);
    }
    trackProductEvent("meal_accepted", { provider_name: "google" });
    setMealSelections((current) => ({ ...current, [slotId]: candidate.id }));
    setFoodRecommendationNotice(evaluation.decision === "CONDITIONAL"
      ? (locale === "ja" ? "旅程に追加しました。営業時間は未確認として表示します。" : "Added; opening hours remain unverified.")
      : "");
    postBuildLegBudgetRef.current = Math.max(postBuildLegBudgetRef.current, 6);
  }

  function addRouteRecommendation(candidate: RouteRecommendation) {
    if (!plan || !tripFit || !day || !primaryRecommendationGap || plannedStopIds.has(recommendationStopId(candidate.id))) return;
    if (recommendationPlaceAlreadyScheduled(candidate.providerRef, plannedStopIds, resolvedStops)) {
      setRouteRecommendationNotice(locale === "ja"
        ? "同じ場所が、すでにこの旅程に入っています。別の候補を選んでください。"
        : "That place is already in this itinerary. Choose a different suggestion.");
      return;
    }
    const checkedAt = activeRouteRecommendationState.fetchedAt?.slice(0, 10);
    if (!checkedAt) return;
    const acceptedMicroFillers = day.stops.filter(({ stop }) => fillerKindsByStopId.get(stop.id) === "micro").length;
    const acceptedMeals = daySlots.filter((slot) => Boolean(mealSelections[slot.id])).length;
    if (acceptedMicroFillers >= 1 || acceptedMicroFillers + acceptedMeals >= 3) {
      setRouteRecommendationNotice(locale === "ja"
        ? "この日のおすすめ枠は埋まっています。追加済みのおすすめを外すと入れ替えられます。"
        : "This day's recommendation slots are full. Remove an accepted suggestion to replace it.");
      return;
    }
    const inputIndex = parsedWishlistPlaces(itinerary).length;
    const input = fillerOccurrenceLine(inputIndex, "micro", primaryRecommendationGap.startAt);
    const resolvedId = recommendationStopId(candidate.id);
    const resolved: ResolvedInputStop = {
      id: resolvedId,
      input,
      inputIndex,
      name: candidate.name,
      address: candidate.address,
      area: areaFromAddress(candidate.address, candidate.name, activeDestination),
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      sourceUrl: candidate.googleMapsUrl,
      verifiedAt: checkedAt,
      confidence: "medium",
      planningDurationMinutes: Math.min(
        estimateStayMinutes(candidate.name, candidate.placeTypes, 90),
        Math.max(20, primaryRecommendationGap.availableMinutes - 10),
      ),
      isAnchor: false,
      isUserEntered: false,
      placeTypes: candidate.placeTypes,
      providerRef: candidate.providerRef,
    };
    const candidateItinerary = `${itinerary.trimEnd()}\n${input}`.trimStart();
    const candidateContext: TripPlannerContext = {
      ...activePlannerContext,
      resolvedStops: [...resolvedStops.filter((stop) => stop.inputIndex !== inputIndex), resolved],
      dayOverrides: { ...(activePlannerContext.dayOverrides ?? {}), [resolved.id]: activeDay + 1 },
    };
    const candidatePlan = buildTripFromWishlist(candidateItinerary, tripDays, pace, locale, candidateContext);
    const candidateFit = assessTripFit(candidateItinerary, tripDays, pace, locale, candidateContext, candidatePlan);
    const scheduledRecommendation = candidatePlan.days[activeDay]?.stops.find(({ stop }) => stop.id === resolved.id);
    if (!scheduledRecommendation || !clockRangeContainsVisit(
      `${primaryRecommendationGap.startAt}–${primaryRecommendationGap.endAt}`,
      scheduledRecommendation.arrival,
      scheduledRecommendation.departure,
    )) {
      setRouteRecommendationNotice(locale === "ja"
        ? "この候補は空き時間内に収まらないため、旅程へ追加しませんでした。"
        : "We did not add this suggestion because it does not fit inside the detected gap.");
      return;
    }
    const anchorStopIds = new Set([
      ...resolvedStops.filter((stop) => !fillerStopIds.has(stop.id)).map((stop) => stop.id),
      ...plan.days.flatMap((planDay) => planDay.stops.flatMap(({ stop }) => fillerStopIds.has(stop.id) ? [] : [stop.id])),
    ]);
    const baselineTravel = builtPlanTravelMinutes(plan);
    const candidateTravel = builtPlanTravelMinutes(candidatePlan);
    const addedTravelMinutes = Math.max(0, candidateTravel - baselineTravel);
    const detourScore = boundedRecommendationScore(100 - candidate.routeDistanceMeters / 20);
    const qualityScore = boundedRecommendationScore(
      (candidate.rating === null ? 62 : candidate.rating / 5 * 82)
      + Math.min(18, Math.log10(Math.max(1, candidate.userRatingCount ?? 1)) * 6),
    );
    const availableMinutes = primaryRecommendationGap?.availableMinutes ?? 60;
    const timeFitScore = boundedRecommendationScore(
      100 - Math.max(0, resolved.planningDurationMinutes + addedTravelMinutes - availableMinutes) * 2,
    );
    const recommendation = createRecommendation({
      id: `route:${activeDay}:${candidate.id}`,
      type: routeRecommendationFillerKind(candidate) === "CAFE" ? "CAFE" : "MICRO_STOP",
      placeId: candidate.providerRef,
      fillerKind: routeRecommendationFillerKind(candidate),
      slotId: primaryRecommendationGap?.id,
      proposedDayIndex: activeDay,
      proposedStartAt: primaryRecommendationGap?.startAt,
      addedTravelMinutes,
      score: {
        total: detourScore * 0.4 + timeFitScore * 0.35 + qualityScore * 0.25,
        detour: detourScore,
        timeFit: timeFitScore,
        qualityConfidence: qualityScore,
        preferenceFit: 70,
      },
      reasons: [text.routeIdeasDistance(candidate.routeDistanceMeters)],
    });
    const evaluation = evaluateRecommendationCandidate({
      recommendation,
      openingStatus: candidate.businessStatus?.includes("CLOSED") ? "CLOSED" : "UNKNOWN",
      baseline: recommendationPlanSnapshot(plan, tripFit, anchorStopIds),
      candidate: recommendationPlanSnapshot(candidatePlan, candidateFit, anchorStopIds),
    });
    const wasScheduled = candidatePlan.days.some((planDay) => planDay.stops.some(({ stop }) => stop.id === resolved.id));
    if (evaluation.decision === "REJECTED" || !wasScheduled) {
      setRouteRecommendationNotice(locale === "ja"
        ? "この候補を足すと、行きたい場所か予約条件を守れないため追加しませんでした。"
        : "We did not add this suggestion because it would displace a chosen stop or break a hard constraint.");
      return;
    }
    trackProductEvent("gap_accepted", { provider_name: "google" });
    setResolvedStops((current) => current.some((stop) => stop.id === resolved.id) ? current : [...current, resolved]);
    setResolutionOverrides((current) => upsertResolutionOverride(current, { inputIndex, providerRef: candidate.providerRef }));
    setItinerary(candidateItinerary);
    setDayOverrides((current) => ({ ...current, [resolved.id]: activeDay + 1 }));
    setRemovedStops((current) => current.filter((stop) => stop.id !== resolved.id));
    setRouteRecommendationNotice(evaluation.decision === "CONDITIONAL"
      ? (locale === "ja" ? "営業時間は未確認です。旅程には追加し、未確認として表示します。" : "Added with opening hours still marked unverified.")
      : "");
    postBuildLegBudgetRef.current = Math.max(postBuildLegBudgetRef.current, 6);
    setRouteAlternativesExpanded(false);
    setInspector(null);
  }

  return {
    toggleMealSelection,
    addRouteRecommendation,
  };
}
