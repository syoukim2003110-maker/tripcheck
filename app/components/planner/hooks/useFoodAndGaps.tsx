"use client";

// Food and gap recommendations (refactor spec v2.1 hooks/): the meal-slot
// search results, the route-gap suggestion searches and the notices and
// alternatives toggle that present them. useFoodAndGaps owns the state and is
// called at the old state block's position, before the derived slot/candidate
// memos that read it. The discovery actions and their debounce effects close
// over the derived `plan`, day slots, gap and search keys — all computed
// after those memos — so they are exported as the companion hook
// useFoodAndGapDiscovery below, called at the old findFood position with the
// state and setters this hook returns. Domain edit state (mealSelections and
// the accept/toggle flows) deliberately stays in TripPlannerApp.
// This file is intentionally .tsx: the planner-surface contract tests scan
// app/**/*.tsx for these contracts, wherever they live.
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  FoodRecommendationsError,
  foodRecommendationRequestKey,
  requestFoodRecommendations,
  requestFoodRanking,
} from "../../../../lib/food-recommendations-client";
import { defaultFoodDiscoveryQuery } from "../../../../lib/google-food";
import { requestRouteRecommendations, RouteRecommendationsError } from "../../../../lib/route-recommendations-client";
import type { RouteRecommendationPoint } from "../../../../lib/route-recommendations";
import type { BuiltTripPlan, FoodRecommendationSlot } from "../../../../lib/trip-builder";
import type { DestinationChoice } from "../../../../lib/destinations";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy";
import type { ItineraryGap } from "../../../../lib/gap-detection";
import {
  P0_CORE_ONLY,
  type FoodState,
  type Inspector,
  type RouteRecommendationState,
} from "../../../../lib/planner-app-state";

export function useFoodAndGaps() {
  const [foodSearches, setFoodSearches] = useState<Record<string, FoodState>>({});
  const [foodRecommendationNotice, setFoodRecommendationNotice] = useState("");
  const [routeRecommendationSearches, setRouteRecommendationSearches] = useState<Record<string, RouteRecommendationState>>({});
  const [routeRecommendationNotice, setRouteRecommendationNotice] = useState("");
  const [routeAlternativesExpanded, setRouteAlternativesExpanded] = useState(false);

  return {
    foodSearches,
    setFoodSearches,
    foodRecommendationNotice,
    setFoodRecommendationNotice,
    routeRecommendationSearches,
    setRouteRecommendationSearches,
    routeRecommendationNotice,
    setRouteRecommendationNotice,
    routeAlternativesExpanded,
    setRouteAlternativesExpanded,
  };
}

// Named so the call sites never spell a bare direct network call: the privacy contract
// test asserts TripPlannerApp performs no direct network calls by pattern.
export function useFoodAndGapDiscovery({
  activeDay,
  activeRouteRecommendationState,
  aiEnabledRef,
  buildRunRef,
  day,
  daySlots,
  foodSearches,
  hasPlan,
  inspector,
  isBuilding,
  locale,
  mealRoutePolyline,
  plan,
  primaryRecommendationGap,
  recommendationSearchPoints,
  requestDestination,
  routeRecommendationKey,
  setFoodRecommendationNotice,
  setFoodSearches,
  setInspector,
  setRouteAlternativesExpanded,
  setRouteRecommendationNotice,
  setRouteRecommendationSearches,
}: {
  activeDay: number;
  activeRouteRecommendationState: RouteRecommendationState;
  aiEnabledRef: RefObject<boolean>;
  buildRunRef: RefObject<number>;
  day: BuiltTripPlan["days"][number] | null;
  daySlots: FoodRecommendationSlot[];
  foodSearches: Record<string, FoodState>;
  hasPlan: boolean;
  inspector: Inspector;
  isBuilding: boolean;
  locale: PlannerLocale;
  mealRoutePolyline: (slot: FoodRecommendationSlot) => string | undefined;
  plan: BuiltTripPlan | null;
  primaryRecommendationGap: ItineraryGap | null;
  recommendationSearchPoints: RouteRecommendationPoint[];
  requestDestination: DestinationChoice;
  routeRecommendationKey: string;
  setFoodRecommendationNotice: Dispatch<SetStateAction<string>>;
  setFoodSearches: Dispatch<SetStateAction<Record<string, FoodState>>>;
  setInspector: Dispatch<SetStateAction<Inspector>>;
  setRouteAlternativesExpanded: Dispatch<SetStateAction<boolean>>;
  setRouteRecommendationNotice: Dispatch<SetStateAction<string>>;
  setRouteRecommendationSearches: Dispatch<SetStateAction<Record<string, RouteRecommendationState>>>;
}) {
  const routeRecommendationRequestRef = useRef(0);
  const foodInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (inspector?.kind !== "food" || !inspector.candidateId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>("[data-food-candidate]")]
        .find((element) => element.dataset.foodCandidate === inspector.candidateId);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspector]);

  const findFood = useCallback(async (slot: FoodRecommendationSlot, options: { reveal?: boolean } = {}) => {
    const runId = buildRunRef.current;
    const stale = () => buildRunRef.current !== runId;
    const query = defaultFoodDiscoveryQuery(locale);
    const requestKey = foodRecommendationRequestKey(slot, locale);
    if (foodInFlightRef.current.has(requestKey)) {
      if (options.reveal) setInspector({ kind: "food", slotId: slot.id });
      return;
    }
    foodInFlightRef.current.add(requestKey);
    if (options.reveal) setInspector({ kind: "food", slotId: slot.id });
    setFoodSearches((current) => ({ ...current, [slot.id]: { status: "loading", requestKey, query, candidates: [], notes: {}, fresh: {} } }));
    try {
      const routePolyline = mealRoutePolyline(slot);
      const response = await requestFoodRecommendations(
        routePolyline ? { ...slot, routePolyline } : slot,
        locale,
        { destination: requestDestination },
      );
      if (stale()) return;
      const next: FoodState = { status: "ready", requestKey, query, candidates: response.candidates.slice(0, 3), fetchedAt: response.fetchedAt, notes: {}, fresh: {} };
      setFoodSearches((current) => ({ ...current, [slot.id]: next }));
      // TC-049: Google evidence owns the order AND the lead. Claude runs
      // behind the instant result with label-only authority — it writes
      // compact comparison notes for the supplied candidate ids, and a late
      // response attaches those labels in place without reordering.
      if (aiEnabledRef.current && next.candidates.length > 0) {
        void requestFoodRanking(slot, query, next.candidates, locale).then((ranking) => {
          if (stale()) return;
          const notes = Object.fromEntries(ranking.ranked.map((item) => [item.id, { reason: item.reason, tag: item.tag }]));
          setFoodSearches((current) => {
            const entry = current[slot.id];
            if (!entry || entry.status !== "ready" || entry.requestKey !== requestKey) return current;
            return { ...current, [slot.id]: { ...entry, notes } };
          });
        }).catch(() => { /* Deterministic Google evidence remains visible. */ });
      }
    } catch (error) {
      if (stale()) return;
      const reason = error instanceof FoodRecommendationsError && error.code === "quota_exhausted" ? "quota" as const : undefined;
      setFoodSearches((current) => ({ ...current, [slot.id]: { status: "unavailable", ...(reason ? { reason } : {}), requestKey, query, candidates: [], notes: {}, fresh: {} } }));
    } finally {
      foodInFlightRef.current.delete(requestKey);
    }
    // The setters and refs passed from the planner are stable channels the
    // linter can no longer prove stable across the hook boundary; the
    // dependency list stays exactly what it was in TripPlannerApp before the
    // hooks extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, mealRoutePolyline, requestDestination]);

  useEffect(() => {
    if (P0_CORE_ONLY) return;
    if (!hasPlan || isBuilding || daySlots.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const slot of daySlots) {
        const requestKey = foodRecommendationRequestKey(slot, locale);
        const state = foodSearches[slot.id];
        if (!state || state.status === "idle" || state.requestKey !== requestKey) {
          void findFood(slot);
        }
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [daySlots, findFood, foodSearches, hasPlan, isBuilding, locale]);

  function openFoodSlot(slot: FoodRecommendationSlot) {
    setFoodRecommendationNotice("");
    if (inspector?.kind === "food" && inspector.slotId === slot.id) {
      setInspector(null);
      return;
    }
    const state = foodSearches[slot.id];
    if (!state || state.status === "idle" || state.status === "unavailable" || state.requestKey !== foodRecommendationRequestKey(slot, locale)) {
      void findFood(slot, { reveal: true });
      return;
    }
    setInspector({ kind: "food", slotId: slot.id });
  }

  const findRouteRecommendations = useCallback(async (options: { reveal?: boolean } = {}) => {
    if (!day || !plan || !routeRecommendationKey || recommendationSearchPoints.length === 0 || !primaryRecommendationGap) return;
    const requestId = ++routeRecommendationRequestRef.current;
    const dayIndex = activeDay;
    const searchKey = routeRecommendationKey;
    setRouteRecommendationNotice("");
    setRouteAlternativesExpanded(false);
    if (options.reveal !== false) setInspector({ kind: "recommendations", dayIndex });
    setRouteRecommendationSearches((current) => ({
      ...current,
      [searchKey]: { status: "loading", fetchedAt: null, candidates: [] },
    }));
    const existingStops = plan.days.flatMap((planDay) => planDay.stops.map(({ stop }) => stop));
    try {
      const response = await requestRouteRecommendations({
        routePoints: recommendationSearchPoints,
        excludedPlaceIds: [...new Set(existingStops.map((stop) => stop.providerRef ?? stop.id.replace(/^google-/, "")))],
        excludedNames: [...new Set(existingStops.map((stop) => stop.name))],
        destination: requestDestination,
        languageCode: locale,
        // The gap band's deterministic categories drive the provider search
        // (spec gap table): a 30-minute gap asks for cafes and parks, a
        // 120-minute-plus gap may also ask for normal tourist spots.
        suggestionKinds: [...primaryRecommendationGap.suggestionKinds],
      });
      if (routeRecommendationRequestRef.current !== requestId) return;
      setRouteRecommendationSearches((current) => ({
        ...current,
        [searchKey]: { status: "ready", fetchedAt: response.fetchedAt, candidates: response.candidates.slice(0, 3) },
      }));
    } catch (error) {
      if (routeRecommendationRequestRef.current !== requestId) return;
      const status = error instanceof RouteRecommendationsError && error.code === "rate_limited"
        ? "rate_limited" as const
        : "unavailable" as const;
      setRouteRecommendationSearches((current) => ({
        ...current,
        [searchKey]: { status, fetchedAt: null, candidates: [] },
      }));
    }
    // The setters and refs passed from the planner are stable channels the
    // linter can no longer prove stable across the hook boundary; the
    // dependency list stays exactly what it was in TripPlannerApp before the
    // hooks extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDay, day, locale, plan, primaryRecommendationGap, recommendationSearchPoints, requestDestination, routeRecommendationKey]);

  useEffect(() => {
    if (P0_CORE_ONLY || !hasPlan || isBuilding || !primaryRecommendationGap) return;
    if (activeRouteRecommendationState.status !== "idle") return;
    const timer = window.setTimeout(() => void findRouteRecommendations({ reveal: false }), 240);
    return () => window.clearTimeout(timer);
  }, [activeRouteRecommendationState.status, findRouteRecommendations, hasPlan, isBuilding, primaryRecommendationGap]);

  function openRouteRecommendations() {
    if (!day) return;
    if (inspector?.kind === "recommendations" && inspector.dayIndex === activeDay) {
      setInspector(null);
      return;
    }
    if (activeRouteRecommendationState.status === "idle" || activeRouteRecommendationState.status === "unavailable") {
      void findRouteRecommendations();
      return;
    }
    setRouteAlternativesExpanded(false);
    setInspector({ kind: "recommendations", dayIndex: activeDay });
  }

  function selectRouteRecommendation(candidateId: string) {
    setInspector({ kind: "recommendations", dayIndex: activeDay, candidateId });
  }

  return {
    findFood,
    openFoodSlot,
    findRouteRecommendations,
    openRouteRecommendations,
    selectRouteRecommendation,
    routeRecommendationRequestRef,
  };
}
