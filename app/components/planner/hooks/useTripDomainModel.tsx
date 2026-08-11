"use client";

// The domain/derivation model (refactor spec v2.1 hooks/): every pure
// derivation TripPlannerApp computes between its state hooks and its JSX —
// the destination model, the planner contexts, the built plan and its
// fit/feasibility evidence, and the day/map/food/hotel/review/build view
// derivations. Nothing here owns state; every hook receives the states it
// reads as params and returns the derived values, so closure and dependency
// semantics stay exactly what they were before the extraction.
// The cluster cannot be one hook: the derivations are interleaved with hook
// calls whose params they produce and whose returns they consume, so the file
// exports four hooks, each called at the moved code's original position:
// - useDestinationModel at the old activeDestination position — before the
//   airport/date effects that read the active destination.
// - useStablePlannerContext at the old nightBases position — its stable
//   context and convergence input key feed useTransitEvidence.
// - useTripDomainModel at the old plannerContextWithoutTransit position —
//   after useTransitEvidence (whose live measurements it merges), before
//   useTripPersistence (which needs localTripCode/localTripTitle) and
//   useHotelActions (which needs activePlannerContext and the current hotel
//   plan signature).
// - usePlannerViewModel at the old `day` position — after useTripPersistence
//   (preTripItems reads the on-device passport memory) and useHotelActions,
//   before the guarded-edit, discovery and pipeline hooks that consume the
//   day slots, review rows and build gates it derives.
// This file is intentionally .tsx: the planner-surface contract tests scan
// app/**/*.tsx for these contracts, wherever they live. The privacy contract
// additionally pins the plan/fit derivations to this file by pattern.
import { useCallback, useMemo } from "react";
import {
  type FoodPin,
  type HotelPin,
  type PlannerMapDayLayer,
  type RecommendationPin,
} from "../../../PlannerGoogleMap";
import { type SearchableOption } from "../../../SearchableCombobox";
import { foodRecommendationRequestKey } from "../../../../lib/food-recommendations-client";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "../../../../lib/google-food";
import { googleCurrentOpeningWindowsForDate } from "../../../../lib/google-opening-hours";
import {
  buildSelectedTransitLegRequests,
  type PlanningTransitLegRequest,
} from "../../../../lib/planning-live-routes-client";
import { placeReviewInputSignature, placeReviewStatus, type AmbiguousPlaceResolution } from "../../../../lib/place-resolution-client";
import { resolveKnownStops, type ResolvedInputStop, type RouteStop } from "../../../../lib/route-optimizer";
import type { Pace } from "../../../../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../../../../lib/time-feasibility";
import {
  destinationById,
  destinationEntryAuthority,
  destinationEssentials,
  destinationForCountryCode,
  destinationOptions,
  destinationPassportRule,
  destinations,
  localDateTimeWithOffset,
  type Destination,
  type DestinationChoice,
  type DestinationId,
} from "../../../../lib/destinations";
import { buildPreTripTimeline } from "../../../../lib/pre-trip-timeline";
import { encodeTripShare } from "../../../../lib/share-link";
import type { ShareableResolutionOverride } from "../../../../lib/share-link";
import { assessTripFit, generateTripCounterfactuals, type TripFitAssessment } from "../../../../lib/trip-scenarios";
import {
  createPlannerEvidenceSnapshot,
  deriveFeasibilityResult,
  type FeasibilityResult,
  type PlannerEvidenceSnapshot,
  type RouteFactEvidence,
} from "../../../../lib/feasibility-result";
import { detectGapsFromBuiltDay } from "../../../../lib/gap-detection";
import { reserveDistinctRecommendationCandidates } from "../../../../lib/recommendation-evaluator";
import type { RouteRecommendationPoint } from "../../../../lib/route-recommendations";
import {
  buildTripFromWishlist,
  hotelRouteContextForDraft,
  routeLegKey,
  type AirportCode,
  type BuiltTripPlan,
  type FoodRecommendationSlot,
  type MealPlan,
  type TripPlannerContext,
  type VisitWindow,
} from "../../../../lib/trip-builder";
import {
  formatWishlistLines,
  parsedWishlistPlaces,
  parseWishlist,
} from "../../../../lib/wishlist-parser";
import { coverageProfileForLocation } from "../../../../lib/coverage-profile";
import { PLANNER_MAP_DAY_COLORS } from "../../../../lib/planner-map-model";
import { buildDayPresentation } from "../../../../lib/day-presentation";
import {
  ui,
  feasibilityStateCopy,
  conflictCopy,
  type PlannerLocale,
} from "../../../../lib/presentation/planner-copy";
import {
  priceBand,
  airportOptionsFor,
  airportComparisonDestination,
} from "../../../../lib/presentation/trip-presentation";
import { TRIPCHECK_FILLER_PREFIX } from "../../../../lib/presentation/recommendation-presentation";
import {
  P0_CORE_ONLY,
  buildStageOrder,
  emptyRouteRecommendationState,
  builtPlanTravelMinutes,
  clockToMinutes,
  hotelPlanSignature,
  hotelAsResolvedBase,
  type PlannerInputStep,
  type FoodState,
  type FreshState,
  type HotelState,
  type HotelStayMode,
  type IntelligenceState,
  type Inspector,
  type BuildProgress,
  type ManualPlaceDraft,
  type NightlyHotelState,
  type ParsePreviewRow,
  type PassportCountry,
  type RouteRecommendationState,
  type TransitConvergenceState,
} from "../../../../lib/planner-app-state";

// One day palette for the timeline, day rail and map (v1.1 spec §7.1). The
// map model owns the tokens so a map polyline can never disagree with a tab.
const plannerDayColors = PLANNER_MAP_DAY_COLORS;

export function useDestinationModel({
  arrivalAirport,
  departureAirport,
  destinationChoice,
  detectedDestinationId,
  locale,
}: {
  arrivalAirport: AirportCode;
  departureAirport: AirportCode;
  destinationChoice: DestinationChoice;
  detectedDestinationId: DestinationId | null;
  locale: PlannerLocale;
}) {
  const activeDestination = useMemo(
    () => destinationById(destinationChoice === "auto" ? detectedDestinationId ?? "worldwide" : destinationChoice),
    [destinationChoice, detectedDestinationId],
  );
  // Everything downstream of the first resolution can use the detected
  // country even while the picker still says "auto".
  const requestDestination: DestinationChoice = destinationChoice !== "auto"
    ? destinationChoice
    : detectedDestinationId ?? "auto";

  const airportChoices = useMemo(
    () => airportOptionsFor(locale, activeDestination),
    [activeDestination, locale],
  );
  const arrivalAirportDestination = airportComparisonDestination(activeDestination, arrivalAirport);
  const departureAirportDestination = airportComparisonDestination(activeDestination, departureAirport);
  const destinationChoices = useMemo(() => destinationOptions(locale), [locale]);
  const destinationComboOptions = useMemo<SearchableOption[]>(() => destinationChoices.map((option) => {
    const profile = option.value === "auto" ? null : destinationById(option.value);
    return {
      value: option.value,
      label: option.label,
      keywords: profile
        ? [...Object.values(profile.names), ...profile.countryCodes, profile.id]
        : ["auto", "anywhere", "自動", "おまかせ"],
    };
  }), [destinationChoices]);
  const airportComboOptions = useMemo<SearchableOption[]>(() => airportChoices.flatMap((group) => (
    group.options.map((option) => {
      const owner = option.value === "none"
        ? null
        : destinations.find((candidate) => candidate.airports.some((airport) => airport.code === option.value)) ?? null;
      const airport = owner?.airports.find((candidate) => candidate.code === option.value);
      return {
        value: option.value,
        label: option.label,
        ...(group.label ? { group: group.label } : {}),
        keywords: airport && owner
          ? [airport.code, airport.names.en, airport.names.ja, ...Object.values(owner.names), ...owner.countryCodes]
          : ["none", "not specified", "未指定"],
      };
    })
  )), [airportChoices]);
  const activeEssentials = useMemo(() => destinationEssentials(activeDestination), [activeDestination]);

  return {
    activeDestination,
    activeEssentials,
    airportComboOptions,
    arrivalAirportDestination,
    departureAirportDestination,
    destinationComboOptions,
    requestDestination,
  };
}

export function useStablePlannerContext({
  arrivalAirport,
  arrivalTime,
  dayEndTarget,
  dayEndTimes,
  dayOverrides,
  dayStartDefault,
  dayStartTimes,
  departureAirport,
  departureTime,
  destinationChoice,
  durationOverrides,
  earlyVisitStopIds,
  flightKind,
  hotelQuery,
  hotelStayMode,
  itinerary,
  lastEntryTimes,
  legModeOverrides,
  locale,
  lockedOrderByDay,
  maxTransfersPerLeg,
  maxWalkingMinutesPerLeg,
  mealPlan,
  nightlyHotels,
  openingWindowsByDay,
  pace,
  removedStops,
  resolvedBase,
  resolvedStops,
  transferBufferMinutes,
  travelPreference,
  tripDays,
  tripStartDate,
  userStayMinutes,
}: {
  arrivalAirport: AirportCode;
  arrivalTime: string;
  dayEndTarget: string;
  dayEndTimes: Record<number, string>;
  dayOverrides: Record<string, number>;
  dayStartDefault: string;
  dayStartTimes: Record<number, string>;
  departureAirport: AirportCode;
  departureTime: string;
  destinationChoice: DestinationChoice;
  durationOverrides: Record<string, number>;
  earlyVisitStopIds: string[];
  flightKind: "international" | "domestic";
  hotelQuery: string;
  hotelStayMode: HotelStayMode;
  itinerary: string;
  lastEntryTimes: Record<string, string>;
  legModeOverrides: Record<string, TransportMode>;
  locale: PlannerLocale;
  lockedOrderByDay: Record<number, string[]>;
  maxTransfersPerLeg: number | null;
  maxWalkingMinutesPerLeg: number | null;
  mealPlan: MealPlan;
  nightlyHotels: NightlyHotelState;
  openingWindowsByDay: Record<string, Record<number, VisitWindow[]>>;
  pace: Pace;
  removedStops: Array<{ id: string; name: string }>;
  resolvedBase: ResolvedInputStop | null;
  resolvedStops: ResolvedInputStop[];
  transferBufferMinutes: 0 | 10 | 20 | 30;
  travelPreference: TravelPreference;
  tripDays: number;
  tripStartDate: string;
  userStayMinutes: Record<string, number>;
}) {
  // Nightly hotel picks become per-night routing bases; nights without a
  // usable candidate keep the trip-wide hotel.
  const nightBases = useMemo(() => {
    if (hotelStayMode !== "nightly" || nightlyHotels.status !== "ready") return undefined;
    const record: Record<number, ResolvedInputStop | null> = {};
    nightlyHotels.nights.forEach((night, index) => {
      const selected = night.candidates.find((candidate) => candidate.id === night.selectedId) ?? null;
      if (selected) record[index] = hotelAsResolvedBase(selected, "", night.area, night.fetchedAt);
    });
    return Object.keys(record).length > 0 ? record : undefined;
  }, [hotelStayMode, nightlyHotels]);

  const plannerContextStable = useMemo<TripPlannerContext>(() => ({
    destination: destinationChoice,
    tripStartDate,
    hotelQuery,
    arrivalAirport,
    arrivalTime,
    departureAirport,
    departureTime,
    flightKind,
    mealPlan: P0_CORE_ONLY ? "none" : mealPlan,
    resolvedStops,
    resolvedBase,
    nightBases,
    dayStartTimes,
    dayEndTimes,
    // Evidence buffers first, the user's explicit stay edits on top.
    durationOverrides: { ...durationOverrides, ...userStayMinutes },
    lastEntryTimes,
    earlyVisitStopIds,
    liveTransitMinutes: {},
    liveWalkingMinutes: {},
    liveDrivingMinutes: {},
    travelPreference,
    legModeOverrides,
    dayOverrides,
    lockedOrderByDay,
    defaultDayStart: dayStartDefault,
    dayEndTarget: dayEndTarget || undefined,
    transferBufferMinutes,
    maxWalkingMinutesPerLeg: maxWalkingMinutesPerLeg ?? undefined,
    maxTransfersPerLeg: maxTransfersPerLeg ?? undefined,
    excludedStopIds: removedStops.map((entry) => entry.id),
    openingWindowsByDay,
  }), [arrivalAirport, arrivalTime, dayEndTarget, dayEndTimes, dayOverrides, dayStartDefault, dayStartTimes, departureAirport, departureTime, destinationChoice, durationOverrides, earlyVisitStopIds, flightKind, hotelQuery, lastEntryTimes, legModeOverrides, lockedOrderByDay, maxTransfersPerLeg, maxWalkingMinutesPerLeg, mealPlan, nightBases, openingWindowsByDay, removedStops, resolvedBase, resolvedStops, transferBufferMinutes, travelPreference, tripStartDate, userStayMinutes]);
  // The convergence input key derives from the stable context only, so it can
  // be computed before the transit-evidence hook that consumes it; the hook's
  // state feeds the planner-context memos below.
  const transitConvergenceInputKey = useMemo(() => JSON.stringify([
    itinerary,
    tripDays,
    pace,
    locale,
    plannerContextStable,
  ]), [itinerary, locale, pace, plannerContextStable, tripDays]);

  return {
    plannerContextStable,
    transitConvergenceInputKey,
  };
}

export function useTripDomainModel({
  arrivalAirport,
  arrivalTime,
  dayEndTarget,
  dayEndTimes,
  dayOverrides,
  dayStartDefault,
  dayStartTimes,
  departureAirport,
  departureTime,
  earlyVisitStopIds,
  flightKind,
  hasPlan,
  hotelQuery,
  hotelSearchSignature,
  intelligence,
  itinerary,
  lastEntryTimes,
  legModeOverrides,
  liveDriving,
  liveRouteEvidence,
  liveTransit,
  liveTransitAbsent,
  liveTransitTransferCounts,
  liveWalking,
  lockedOrderByDay,
  locale,
  maxTransfersPerLeg,
  maxWalkingMinutesPerLeg,
  mealPlan,
  pace,
  planReady,
  plannerContextStable,
  prefetchTransit,
  prefetchTransitAbsent,
  removedStops,
  requestDestination,
  resolutionOverrides,
  resolvedStops,
  transferBufferMinutes,
  transitConvergence,
  transitConvergenceInputKey,
  travelPreference,
  tripDateTouched,
  tripDays,
  tripStartDate,
  userStayMinutes,
}: {
  arrivalAirport: AirportCode;
  arrivalTime: string;
  dayEndTarget: string;
  dayEndTimes: Record<number, string>;
  dayOverrides: Record<string, number>;
  dayStartDefault: string;
  dayStartTimes: Record<number, string>;
  departureAirport: AirportCode;
  departureTime: string;
  earlyVisitStopIds: string[];
  flightKind: "international" | "domestic";
  hasPlan: boolean;
  hotelQuery: string;
  hotelSearchSignature: string;
  intelligence: Record<string, IntelligenceState>;
  itinerary: string;
  lastEntryTimes: Record<string, string>;
  legModeOverrides: Record<string, TransportMode>;
  liveDriving: Record<string, number>;
  liveRouteEvidence: Record<string, RouteFactEvidence>;
  liveTransit: Record<string, number>;
  liveTransitAbsent: Record<string, boolean>;
  liveTransitTransferCounts: Record<string, number>;
  liveWalking: Record<string, number>;
  lockedOrderByDay: Record<number, string[]>;
  locale: PlannerLocale;
  maxTransfersPerLeg: number | null;
  maxWalkingMinutesPerLeg: number | null;
  mealPlan: MealPlan;
  pace: Pace;
  planReady: boolean;
  plannerContextStable: TripPlannerContext;
  prefetchTransit: Record<string, number>;
  prefetchTransitAbsent: Record<string, boolean>;
  removedStops: Array<{ id: string; name: string }>;
  requestDestination: DestinationChoice;
  resolutionOverrides: ShareableResolutionOverride[];
  resolvedStops: ResolvedInputStop[];
  transferBufferMinutes: 0 | 10 | 20 | 30;
  transitConvergence: TransitConvergenceState;
  transitConvergenceInputKey: string;
  travelPreference: TravelPreference;
  tripDateTouched: boolean;
  tripDays: number;
  tripStartDate: string;
  userStayMinutes: Record<string, number>;
}) {
  const plannerContextWithoutTransit = useMemo<TripPlannerContext>(() => ({
    ...plannerContextStable,
    liveWalkingMinutes: liveWalking,
    liveDrivingMinutes: liveDriving,
  }), [liveDriving, liveWalking, plannerContextStable]);
  const activePlannerContext = useMemo<TripPlannerContext>(() => ({
    ...plannerContextWithoutTransit,
    liveTransitMinutes: { ...prefetchTransit, ...liveTransit },
    liveTransitAbsentLegs: { ...prefetchTransitAbsent, ...liveTransitAbsent },
    liveTransitTransferCounts,
  }), [liveTransit, liveTransitAbsent, liveTransitTransferCounts, plannerContextWithoutTransit, prefetchTransit, prefetchTransitAbsent]);

  const plan = useMemo(() => hasPlan
    ? buildTripFromWishlist(itinerary, tripDays, pace, locale, activePlannerContext)
    : null, [activePlannerContext, hasPlan, itinerary, locale, pace, tripDays]);
  const regionalCoverage = useMemo(() => {
    if (!plan) return null;
    const first = resolvedStops[0] ?? plan.days.flatMap((day) => day.stops.map(({ stop }) => stop))[0] ?? null;
    return coverageProfileForLocation({
      destination: plan.destination,
      countryCode: resolvedStops[0]?.countryCode,
      latitude: first?.latitude,
      longitude: first?.longitude,
      regionHint: first?.area,
    });
  }, [plan, resolvedStops]);

  // The core answer appears before the day-by-day itinerary: how much of the
  // trip is genuinely usable after airport constraints, and how many days the
  // same wishlist needs. Scenario builds reuse resolved data and never call a
  // provider or model.
  const tripFit = useMemo(() => plan
    ? assessTripFit(itinerary, tripDays, pace, locale, activePlannerContext, plan)
    : null, [activePlannerContext, itinerary, locale, pace, plan, tripDays]);
  const tripAlternatives = useMemo(() => plan && tripFit
    ? generateTripCounterfactuals(itinerary, tripDays, pace, locale, activePlannerContext, plan, tripFit)
    : [], [activePlannerContext, itinerary, locale, pace, plan, tripDays, tripFit]);
  const routeEvidenceByFactId = useMemo<Record<string, RouteFactEvidence>>(() => {
    if (!plan || transitConvergence.status !== "complete" || transitConvergence.inputKey !== transitConvergenceInputKey) return {};
    let requests: PlanningTransitLegRequest[];
    try {
      requests = buildSelectedTransitLegRequests(plan);
    } catch {
      return {};
    }
    return Object.fromEntries(requests.flatMap((request) => {
      const evidence = liveRouteEvidence[request.requestKey];
      return evidence ? request.factIds.map((factId) => [factId, evidence] as const) : [];
    }));
  }, [liveRouteEvidence, plan, transitConvergence.inputKey, transitConvergence.status, transitConvergenceInputKey]);
  const currentTransitConvergence = transitConvergence.status === "complete"
    && transitConvergence.inputKey === transitConvergenceInputKey
    ? transitConvergence
    : null;
  const feasibilityEvidence = useMemo(() => plan ? createPlannerEvidenceSnapshot(plan, {
    dateWasProvided: tripDateTouched,
    baseWasProvided: Boolean(hotelQuery.trim() && plan.selectedBase),
    dayEndWasProvided: Boolean(dayEndTarget),
    userDurationStopIds: Object.keys(userStayMinutes),
    transferBufferMinutes,
    solverTimedOut: tripFit?.solverTimedOut,
    dayStartTimes,
    dayEndTimes,
    lastEntryEvidenceByStop: Object.fromEntries(Object.entries(lastEntryTimes).map(([stopId, time]) => [stopId, {
      time,
      status: "user_provided" as const,
    }])),
    routeEvidenceByFactId,
    ...(currentTransitConvergence?.nonConverged ? { transitConvergence: {
      nonConverged: true,
      stopReason: currentTransitConvergence.stopReason ?? "max_iterations",
      iterations: currentTransitConvergence.iterations,
      eventCount: currentTransitConvergence.eventCount,
    } } : {}),
    openingEvidenceByStop: Object.fromEntries(Object.entries(intelligence).flatMap(([stopId, state]) => (
      state.status === "ready" && state.result
        ? [[stopId, {
          fetchedAt: state.result.checkedAt,
          providerRef: plan.days.flatMap((day) => day.stops.map((entry) => entry.stop)).find((stop) => stop.id === stopId)?.providerRef,
          dateSpecificDates: plan.days.flatMap((day) => day.date && googleCurrentOpeningWindowsForDate({
            businessStatus: state.result!.place.businessStatus,
            currentOpeningPeriods: state.result!.place.currentOpeningPeriods,
            currentSpecialDays: state.result!.place.currentSpecialDays,
          }, day.date) !== null ? [day.date] : []),
        }]]
        : []
    ))),
  }) : null, [currentTransitConvergence, dayEndTarget, dayEndTimes, dayStartTimes, hotelQuery, intelligence, lastEntryTimes, plan, routeEvidenceByFactId, transferBufferMinutes, tripDateTouched, tripFit?.solverTimedOut, userStayMinutes]);
  const durationEvidenceByStopId = useMemo(() => Object.fromEntries(
    (feasibilityEvidence?.facts ?? []).flatMap((item) => (
      item.kind === "stay_duration" && item.id.startsWith("duration:")
        ? [[item.id.slice("duration:".length), item.evidence.status] as const]
        : []
    )),
  ), [feasibilityEvidence]);
  const feasibilityResult = useMemo(() => plan && tripFit && feasibilityEvidence
    ? deriveFeasibilityResult(plan, tripFit, feasibilityEvidence, tripAlternatives)
    : null, [feasibilityEvidence, plan, tripAlternatives, tripFit]);
  const localTripCode = useMemo(() => {
    if (!planReady || !itinerary.trim()) return "";
    return encodeTripShare({
      destination: requestDestination,
      itinerary,
      tripDays,
      tripStartDate,
      dateWasProvided: tripDateTouched,
      hotelQuery,
      pace,
      mealPlan: P0_CORE_ONLY ? "none" : mealPlan,
      travelPreference,
      arrivalAirport,
      arrivalTime,
      departureAirport,
      departureTime,
      flightKind,
      dayStartDefault,
      dayEndTarget,
      transferBufferMinutes,
      ...(maxWalkingMinutesPerLeg !== null ? { maxWalkingMinutesPerLeg } : {}),
      ...(maxTransfersPerLeg !== null ? { maxTransfersPerLeg } : {}),
      userStayMinutes,
      lastEntryTimes,
      dayStartTimes,
      dayEndTimes,
      legModeOverrides,
      dayOverrides,
      lockedOrderByDay,
      removedStops,
      resolutionOverrides,
    });
  }, [arrivalAirport, arrivalTime, dayEndTarget, dayEndTimes, dayOverrides, dayStartDefault, dayStartTimes, departureAirport, departureTime, flightKind, hotelQuery, itinerary, lastEntryTimes, legModeOverrides, lockedOrderByDay, maxTransfersPerLeg, maxWalkingMinutesPerLeg, mealPlan, pace, planReady, removedStops, requestDestination, resolutionOverrides, transferBufferMinutes, travelPreference, tripDateTouched, tripDays, tripStartDate, userStayMinutes]);
  const localTripTitle = useMemo(() => parsedWishlistPlaces(itinerary)[0]?.name ?? "Trip", [itinerary]);

  // The pre-departure checklist is derived, never invented: booked stops come
  // from the traveller's own markers, the watchlist from stops whose public
  // evidence reported sell-outs or queues during the build.
  const beforeYouGo = useMemo(() => {
    if (!plan) return null;
    const early = new Set(earlyVisitStopIds);
    const seen = new Set<string>();
    const reservations: Array<{ name: string; time: string | null }> = [];
    const watchlist: string[] = [];
    for (const day of plan.days) {
      for (const built of day.stops) {
        if (built.kind !== "place" || seen.has(built.stop.id)) continue;
        seen.add(built.stop.id);
        if (built.isReservation) reservations.push({ name: built.stop.name, time: built.fixedTime });
        else if (early.has(built.stop.id)) watchlist.push(built.stop.name);
      }
    }
    return { reservations, watchlist };
  }, [plan, earlyVisitStopIds]);

  const currentHotelPlanSignature = useMemo(() => hotelPlanSignature(plan), [plan]);
  const hotelRouteContext = useMemo(() => plan ? hotelRouteContextForDraft(plan) : null, [plan]);
  const hotelPlanDirty = Boolean(
    currentHotelPlanSignature
    && hotelSearchSignature
    && currentHotelPlanSignature !== hotelSearchSignature,
  );

  return {
    activePlannerContext,
    beforeYouGo,
    currentHotelPlanSignature,
    currentTransitConvergence,
    durationEvidenceByStopId,
    feasibilityEvidence,
    feasibilityResult,
    hotelPlanDirty,
    hotelRouteContext,
    localTripCode,
    localTripTitle,
    plan,
    regionalCoverage,
    routeEvidenceByFactId,
    tripAlternatives,
    tripFit,
  };
}

export function usePlannerViewModel({
  activeDay,
  activeDestination,
  activePlannerContext,
  ambiguousPlaces,
  buildProgress,
  destinationChoice,
  feasibilityEvidence,
  feasibilityResult,
  foodSearches,
  freshVoices,
  hasPlan,
  hotelQuery,
  hotelState,
  hotelStayMode,
  inputStep,
  inspector,
  intelligence,
  isBuilding,
  isResolvingPlaces,
  itinerary,
  liveDriving,
  liveTransit,
  liveWalking,
  locale,
  manualPinTarget,
  manualPlaceDrafts,
  mealSelections,
  pace,
  passportCountry,
  passportExpiry,
  placeWarning,
  plan,
  planReady,
  prefetchGeometry,
  previewStops,
  requestDestination,
  resolvedStops,
  reviewedInputSignature,
  routeAlternativesExpanded,
  routeEvidenceByFactId,
  routeGeometryByDay,
  routeRecommendationSearches,
  text,
  transferBufferMinutes,
  travelPreference,
  tripDays,
  tripFit,
}: {
  activeDay: number;
  activeDestination: Destination;
  activePlannerContext: TripPlannerContext;
  ambiguousPlaces: AmbiguousPlaceResolution[];
  buildProgress: BuildProgress;
  destinationChoice: DestinationChoice;
  feasibilityEvidence: PlannerEvidenceSnapshot | null;
  feasibilityResult: FeasibilityResult | null;
  foodSearches: Record<string, FoodState>;
  freshVoices: Record<string, FreshState>;
  hasPlan: boolean;
  hotelQuery: string;
  hotelState: HotelState;
  hotelStayMode: HotelStayMode;
  inputStep: PlannerInputStep;
  inspector: Inspector;
  intelligence: Record<string, IntelligenceState>;
  isBuilding: boolean;
  isResolvingPlaces: boolean;
  itinerary: string;
  liveDriving: Record<string, number>;
  liveTransit: Record<string, number>;
  liveWalking: Record<string, number>;
  locale: PlannerLocale;
  manualPinTarget: number | null;
  manualPlaceDrafts: Record<number, ManualPlaceDraft>;
  mealSelections: Record<string, string>;
  pace: Pace;
  passportCountry: PassportCountry;
  passportExpiry: string;
  placeWarning: false | "unavailable" | "quota_exhausted";
  plan: BuiltTripPlan | null;
  planReady: boolean;
  prefetchGeometry: Record<string, Partial<Record<"transit" | "walk" | "drive", { points: Array<{ latitude: number; longitude: number }>; encoded: string }>>>;
  previewStops: RouteStop[];
  requestDestination: DestinationChoice;
  resolvedStops: ResolvedInputStop[];
  reviewedInputSignature: string;
  routeAlternativesExpanded: boolean;
  routeEvidenceByFactId: Record<string, RouteFactEvidence>;
  routeGeometryByDay: Record<string, RouteRecommendationPoint[]>;
  routeRecommendationSearches: Record<string, RouteRecommendationState>;
  text: (typeof ui)[PlannerLocale];
  transferBufferMinutes: 0 | 10 | 20 | 30;
  travelPreference: TravelPreference;
  tripDays: number;
  tripFit: TripFitAssessment | null;
}) {
  // Entry paperwork and passport validity as dated to-dos against this trip.
  const preTripItems = useMemo(() => {
    if (!plan) return [];
    const dates = plan.days.map((day) => day.date).filter((date): date is string => Boolean(date));
    return buildPreTripTimeline({
      tripStartDate: dates[0] ?? null,
      tripEndDate: dates[dates.length - 1] ?? null,
      authority: passportCountry === "JP" ? destinationEntryAuthority(activeDestination) : null,
      passportRule: passportCountry === "JP" ? destinationPassportRule(activeDestination) : null,
      passportExpiry: passportCountry === "JP" ? passportExpiry || null : null,
    });
  }, [plan, activeDestination, passportCountry, passportExpiry]);

  const day = plan?.days[activeDay] ?? null;
  const activeFitDay = tripFit?.days[activeDay] ?? null;
  // v1.1 TC-001: the single presentation source for the day's clocks and
  // used/free minutes. Header, metrics and print all read this model.
  const activeDayPresentation = useMemo(() => day
    ? buildDayPresentation(day, activeFitDay, { dayIndex: activeDay })
    : null, [activeDay, activeFitDay, day]);
  const base = day ? day.startBase ?? plan?.selectedBase ?? null : null;
  const dayEndBase = day ? day.endBase ?? base : null;
  const dayTravelTotal = day
    ? day.legs.reduce((sum, leg) => sum + leg.comparison.recommended.minutes, 0)
      + (day.hotelOutboundMinutes ?? 0)
      + (day.hotelInboundMinutes ?? 0)
    : 0;
  const fillerKindsByStopId = useMemo(() => {
    const kindsByInputIndex = new Map<number, "micro" | "lunch" | "dinner">();
    parsedWishlistPlaces(itinerary).forEach((place, index) => {
      if (!place.name.startsWith(TRIPCHECK_FILLER_PREFIX)) return;
      const kind = /\blunch\b/i.test(place.name) ? "lunch" : /\bdinner\b/i.test(place.name) ? "dinner" : "micro";
      kindsByInputIndex.set(index, kind);
    });
    return new Map(resolvedStops.flatMap((stop) => {
      const kind = typeof stop.inputIndex === "number" ? kindsByInputIndex.get(stop.inputIndex) : undefined;
      return kind ? [[stop.id, kind] as const] : [];
    }));
  }, [itinerary, resolvedStops]);
  const fillerStopIds = useMemo(() => new Set(fillerKindsByStopId.keys()), [fillerKindsByStopId]);
  const mapStops = useMemo(() => day ? day.stops.map(({ stop }) => stop) : [], [day]);
  const mapItemKinds = useMemo(() => Object.fromEntries(
    mapStops.map((stop) => {
      const fillerKind = fillerKindsByStopId.get(stop.id);
      return [stop.id, fillerKind === "lunch" || fillerKind === "dinner" ? "meal" : fillerKind ? "filler" : "anchor"] as const;
    }),
  ), [fillerKindsByStopId, mapStops]);
  const mapWarningStopIds = useMemo(() => day?.stops.flatMap((entry) => (
    entry.reservationLateMinutes > 0
    || entry.openingStatus === "conflict"
    || entry.openingStatus === "closed_day"
    || entry.openingStatus === "last_entry_conflict"
      ? [entry.stop.id]
      : []
  )) ?? [], [day]);
  const mapDayLayers = useMemo<PlannerMapDayLayer[]>(() => {
    if (!plan) return [];
    return plan.days.map((planDay, dayIndex) => {
      const scheduledStops = planDay.stops.map(({ stop }) => stop);
      const startBase = planDay.startBase ?? plan.selectedBase ?? null;
      const endBase = planDay.endBase ?? startBase;
      const warningIds = new Set(planDay.stops.flatMap((entry) => (
        entry.reservationLateMinutes > 0
        || entry.openingStatus === "conflict"
        || entry.openingStatus === "closed_day"
        || entry.openingStatus === "last_entry_conflict"
          ? [entry.stop.id]
          : []
      )));
      const layerStops: PlannerMapDayLayer["stops"] = [
        ...(startBase ? [{
          id: startBase.id,
          name: startBase.name,
          latitude: startBase.latitude,
          longitude: startBase.longitude,
          kind: "hotel" as const,
        }] : []),
        ...scheduledStops.map((stop, index) => ({
          id: stop.id,
          name: stop.name,
          latitude: stop.latitude,
          longitude: stop.longitude,
          sequence: index + 1,
          kind: fillerKindsByStopId.get(stop.id) === "lunch" || fillerKindsByStopId.get(stop.id) === "dinner"
            ? "meal" as const
            : fillerStopIds.has(stop.id) ? "filler" as const : "anchor" as const,
          warning: warningIds.has(stop.id),
        })),
        ...(endBase && endBase.id !== startBase?.id ? [{
          id: endBase.id,
          name: endBase.name,
          latitude: endBase.latitude,
          longitude: endBase.longitude,
          kind: "hotel" as const,
        }] : []),
      ];
      const path = startBase && scheduledStops.length > 0
        ? [startBase, ...scheduledStops, endBase ?? startBase]
        : scheduledStops;
      const routeSegments = path.slice(0, -1).map((from, index) => {
        const to = path[index + 1];
        const factId = `route:${planDay.label}:${from.id}:${to.id}`;
        return routeEvidenceByFactId[factId]?.routeGeometry?.points ?? null;
      });
      return {
        dayIndex,
        dayColor: plannerDayColors[dayIndex % plannerDayColors.length],
        stops: layerStops,
        routeSegments,
      };
    });
  }, [fillerKindsByStopId, fillerStopIds, plan, routeEvidenceByFactId]);
  const routeDepartureTimes = useMemo(() => {
    if (!day?.date || mapStops.length === 0) return [];
    const stopDeparture = (index: number) => day.stops[index]?.departure ?? day.finishTime;
    const times: string[] = [];
    if (base) {
      times.push(day.startTime);
      for (let index = 0; index < mapStops.length; index += 1) times.push(stopDeparture(index));
    } else {
      for (let index = 0; index < mapStops.length - 1; index += 1) times.push(stopDeparture(index));
    }
    return times.flatMap((time) => {
      const stamped = localDateTimeWithOffset(day.date!, time, activeDestination.timeZone);
      return stamped ? [stamped] : [];
    });
  }, [activeDestination.timeZone, base, day, mapStops]);
  const routeModes = useMemo(() => {
    const fallbackBoundary = travelPreference === "car" ? "taxi" as const : "transit" as const;
    if (!day || mapStops.length < 2) {
      return base && mapStops.length === 1
        ? [day?.hotelOutboundMode ?? fallbackBoundary, day?.hotelInboundMode ?? fallbackBoundary]
        : [];
    }
    const betweenStops = day.legs.map((leg) => leg.comparison.recommended.mode);
    return base
      ? [day.hotelOutboundMode ?? fallbackBoundary, ...betweenStops, day.hotelInboundMode ?? fallbackBoundary]
      : betweenStops;
  }, [base, day, mapStops.length, travelPreference]);
  const routeTransitGeometry = useMemo(() => {
    if (!day) return [];
    const path = base && mapStops.length > 0
      ? [base, ...mapStops, dayEndBase ?? base]
      : mapStops;
    return path.slice(0, -1).map((from, index) => {
      const to = path[index + 1];
      const factId = `route:${day.label}:${from.id}:${to.id}`;
      const bound = routeEvidenceByFactId[factId]?.routeGeometry?.points;
      if (bound) return bound;
      // Prefetch-measured geometry (provisional departure) keeps the map on
      // real roads/rails instead of dashed sketches; the leg's recommended
      // mode wins; any measured mode beats nothing.
      const measured = prefetchGeometry[routeLegKey(from.id, to.id)];
      if (!measured) return null;
      const recommendedMode = routeModes[index];
      const preferred = recommendedMode === "taxi" ? "drive" : recommendedMode === "walk" ? "walk" : "transit";
      return (measured[preferred] ?? measured.transit ?? measured.drive ?? measured.walk)?.points ?? null;
    });
  }, [base, day, dayEndBase, mapStops, prefetchGeometry, routeEvidenceByFactId, routeModes]);

  const scheduledRecommendationRoutePoints = useMemo<RouteRecommendationPoint[]>(() => {
    if (!day) return [];
    const points = [base, ...mapStops, dayEndBase].filter((stop): stop is RouteStop => Boolean(stop));
    const unique: RouteRecommendationPoint[] = [];
    for (const stop of points) {
      const previous = unique.at(-1);
      if (!previous || previous.latitude !== stop.latitude || previous.longitude !== stop.longitude) {
        unique.push({ latitude: stop.latitude, longitude: stop.longitude });
      }
    }
    return unique.slice(0, 12);
  }, [base, day, dayEndBase, mapStops]);
  const routeGeometryKey = useMemo(() => day
    ? `${activeDay}|${scheduledRecommendationRoutePoints.map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`).join("|")}|${routeModes.join(",")}`
    : "", [activeDay, day, routeModes, scheduledRecommendationRoutePoints]);
  const recommendationRoutePoints = routeGeometryByDay[routeGeometryKey]?.length >= 2
    ? routeGeometryByDay[routeGeometryKey]
    : scheduledRecommendationRoutePoints;
  const activeDayGaps = useMemo(() => day && activeFitDay
    ? detectGapsFromBuiltDay(day, activeFitDay, { dayIndex: activeDay, transferBufferMinutes })
    : [], [activeDay, activeFitDay, day, transferBufferMinutes]);
  const primaryRecommendationGap = activeDayGaps[0] ?? null;
  const recommendationSearchPoints = useMemo<RouteRecommendationPoint[]>(() => {
    const segment = primaryRecommendationGap?.routeSegment;
    if (!segment) return recommendationRoutePoints;
    const points = [segment.from, segment.to].filter((point): point is RouteRecommendationPoint => Boolean(point));
    return points.length > 0 ? points : recommendationRoutePoints;
  }, [primaryRecommendationGap, recommendationRoutePoints]);
  const routeRecommendationKey = useMemo(() => day
    ? `${locale}|${requestDestination}|${activeDay}|${primaryRecommendationGap?.id ?? "no-gap"}|${recommendationSearchPoints.map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`).join("|")}`
    : "", [activeDay, day, locale, primaryRecommendationGap?.id, recommendationSearchPoints, requestDestination]);
  const activeRouteRecommendationState = routeRecommendationKey
    ? routeRecommendationSearches[routeRecommendationKey] ?? emptyRouteRecommendationState
    : emptyRouteRecommendationState;
  const plannedStopIds = useMemo(() => new Set(
    plan?.days.flatMap((planDay) => planDay.stops.map(({ stop }) => stop.id)) ?? [],
  ), [plan]);
  const selectedRouteRecommendation = inspector?.kind === "recommendations"
    ? activeRouteRecommendationState.candidates.find((candidate) => candidate.id === inspector.candidateId) ?? null
    : null;

  const daySlots = useMemo(
    () => plan?.foodRecommendationSlots.filter((slot) => slot.dayIndex === activeDay) ?? [],
    [activeDay, plan],
  );
  const mealCandidatesBySlot = useMemo<Record<string, FoodCandidate[]>>(() => {
    const usedProviderRefs = new Set(resolvedStops.flatMap((stop) => (
      plannedStopIds.has(stop.id) && stop.providerRef ? [stop.providerRef] : []
    )));
    const next: Record<string, FoodCandidate[]> = {};
    for (const slot of daySlots) {
      const state = foodSearches[slot.id];
      if (state?.status !== "ready" || state.requestKey !== foodRecommendationRequestKey(slot, locale)) continue;
      const selectedId = mealSelections[slot.id];
      next[slot.id] = reserveDistinctRecommendationCandidates(
        state.candidates,
        usedProviderRefs,
        selectedId ?? null,
        3,
      );
    }
    return next;
  }, [daySlots, foodSearches, locale, mealSelections, plannedStopIds, resolvedStops]);
  const selectedBuiltStop = inspector?.kind === "stop" && day
    ? day.stops.find(({ stop }) => stop.id === inspector.stopId) ?? null
    : null;
  const selectedStopIndex = inspector?.kind === "stop" && day
    ? day.stops.findIndex(({ stop }) => stop.id === inspector.stopId)
    : -1;
  const activeFoodSlot = inspector?.kind === "food"
    ? daySlots.find((slot) => slot.id === inspector.slotId) ?? null
    : null;
  const activeFoodState = useMemo<FoodState | null>(() => activeFoodSlot
    ? (() => {
      const requestKey = foodRecommendationRequestKey(activeFoodSlot, locale);
      const state = foodSearches[activeFoodSlot.id];
      return state?.requestKey === requestKey
        ? state
        : { status: "idle", requestKey, query: defaultFoodDiscoveryQuery(locale), candidates: [], notes: {}, fresh: {} };
    })()
    : null, [activeFoodSlot, foodSearches, locale]);
  const selectedHotel = hotelState.selectedId
    ? hotelState.candidates.find((candidate) => candidate.id === hotelState.selectedId) ?? null
    : null;
  const hotelTravelMinutesById = useMemo(() => !hasPlan
    ? {} as Record<string, number>
    : Object.fromEntries(hotelState.candidates.map((candidate) => [
      candidate.id,
      builtPlanTravelMinutes(buildTripFromWishlist(
        itinerary,
        tripDays,
        pace,
        locale,
        {
          ...activePlannerContext,
          resolvedBase: hotelAsResolvedBase(candidate, hotelQuery, candidate.address.slice(0, 100) || candidate.name, ""),
        },
      )),
    ])), [activePlannerContext, hasPlan, hotelQuery, hotelState.candidates, itinerary, locale, pace, tripDays]);
  const bestHotelTravelMinutes = Math.min(...Object.values(hotelTravelMinutesById));
  const hasRakutenHotelEvidence = hotelState.candidates.some((candidate) => candidate.rakuten !== null);
  const hotelPins = useMemo<HotelPin[]>(() => (
    inspector?.kind === "hotel" && hotelStayMode === "single"
      ? hotelState.candidates
        .filter((candidate) => candidate.id !== selectedHotel?.id)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          priceLabel: candidate.rakuten?.minCharge
            ? `¥${candidate.rakuten.minCharge.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}`
            : priceBand(candidate.priceLevel, activeDestination) ?? "H",
        }))
      : []
  ), [activeDestination, hotelState.candidates, hotelStayMode, inspector?.kind, locale, selectedHotel?.id]);
  // Live per-line reading of the wishlist so a misread line is visible before
  // the build starts, not after.
  const parsePreviewRows = useMemo<ParsePreviewRow[]>(() => {
    if (!itinerary.trim()) return [];
    const rows: ParsePreviewRow[] = [];
    let sectionDay: number | null = null;
    let placeIndex = 0;
    for (const line of parseWishlist(itinerary)) {
      if (line.kind === "empty") continue;
      if (line.kind === "heading") {
        sectionDay = line.day;
        rows.push({ type: "day", day: line.day });
        continue;
      }
      if (line.kind === "unparsed") {
        rows.push({ type: "warn", raw: line.raw });
        continue;
      }
      for (const place of line.places) {
        rows.push({ type: "place", place, showDay: place.day !== null && place.day !== sectionDay, placeIndex });
        placeIndex += 1;
      }
    }
    return rows;
  }, [itinerary]);
  const parsedPlaceCount = useMemo(() => parsePreviewRows.filter((row) => row.type === "place").length, [parsePreviewRows]);
  const currentInputSignature = useMemo(
    () => placeReviewInputSignature(itinerary, locale, destinationChoice),
    [destinationChoice, itinerary, locale],
  );
  const placesHaveBeenReviewed = inputStep === "conditions" && reviewedInputSignature === currentInputSignature;
  const reviewedPlaceRows = useMemo(() => parsePreviewRows.flatMap((row) => {
    if (row.type !== "place") return [];
    const normalized = row.place.name.normalize("NFKC").toLocaleLowerCase();
    const remote = resolvedStops.find((candidate) => candidate.inputIndex === row.placeIndex)
      ?? resolvedStops.find((candidate) => candidate.inputIndex === undefined && candidate.input.normalize("NFKC").toLocaleLowerCase() === normalized);
    const known = resolveKnownStops(row.place.name, locale)[0] ?? null;
    const resolved = remote ?? known;
    const ambiguity = resolved ? null : ambiguousPlaces.find((entry) => entry.input.normalize("NFKC").toLocaleLowerCase() === normalized) ?? null;
    return [{
      ...row,
      resolved,
      ambiguity,
      status: placeReviewStatus({
        reviewCompleted: placesHaveBeenReviewed,
        hasResolvedPlace: Boolean(resolved),
        hasAmbiguousMatch: Boolean(ambiguity),
      }),
    }];
  }), [ambiguousPlaces, locale, parsePreviewRows, placesHaveBeenReviewed, resolvedStops]);
  const unresolvedReviewedCount = reviewedPlaceRows.filter((row) => row.status === "unresolved").length;
  const ambiguousReviewedCount = reviewedPlaceRows.filter((row) => row.status === "review").length;
  const confirmedReviewedCount = reviewedPlaceRows.filter((row) => row.status === "confirmed").length;
  // v1.1 §5.2: confirmation asks surface at most three at a time, in input
  // order. Resolving one automatically brings the next into the window.
  const resolveAttentionRanks = useMemo(() => {
    const ranks = new Map<number, number>();
    for (const row of reviewedPlaceRows) {
      if (row.status === "review" || row.status === "unresolved") ranks.set(row.placeIndex, ranks.size);
    }
    return ranks;
  }, [reviewedPlaceRows]);
  // "Day 5" in the pasted text quietly outgrowing a 3-day selector produced a
  // plan that contradicted the paste; the selector now follows the headings.
  const maxParsedDay = useMemo(() => parsePreviewRows.reduce((max, row) => {
    if (row.type === "day") return Math.max(max, row.day);
    if (row.type === "place" && row.place.day !== null) return Math.max(max, row.place.day);
    return max;
  }, 0), [parsePreviewRows]);
  const formattedItinerary = useMemo(() => formatWishlistLines(itinerary, locale), [itinerary, locale]);
  const canNormalizeItinerary = parsedPlaceCount > 1 && formattedItinerary.trim() !== itinerary.trim();
  const measuredRouteCount = useMemo(() => new Set([
    ...Object.keys(liveTransit),
    ...Object.keys(liveWalking),
    ...Object.keys(liveDriving),
  ]).size, [liveDriving, liveTransit, liveWalking]);
  const routeFactCount = feasibilityEvidence?.facts.filter((fact) => fact.id.startsWith("route:")).length ?? 0;
  const confirmedRouteFactCount = feasibilityEvidence?.facts.filter((fact) => fact.id.startsWith("route:") && fact.evidence.status === "verified").length ?? 0;
  const openingVerificationCount = Object.values(intelligence).filter((entry) => entry.status === "loading").length;
  const deferredAnchorStops = useMemo(() => plan
    ? [...plan.deferredUnavailableStops, ...plan.deferredOptionalStops]
    : [], [plan]);
  // v1.1 §12.3: a booking-time or airport-cutoff violation is the one class of
  // problem that interrupts assistive technology instead of waiting politely.
  const hardViolationAnnouncement = useMemo(() => {
    if (!planReady || !feasibilityResult) return "";
    return feasibilityResult.conflicts
      .filter((conflict) => conflict.code === "AIRPORT_CUTOFF" || conflict.code === "FIXED_BOOKING_LATE" || conflict.code === "LAST_ENTRY_CONFLICT")
      .map((conflict) => conflictCopy(conflict, locale))
      .join(" ");
  }, [feasibilityResult, locale, planReady]);
  // v1.1 TC-004/TC-022/TC-030: one human issue list. Each entry names a single
  // cause, the affected places and exactly one next action.
  const unknownHoursStops = useMemo(() => {
    if (!plan) return [] as Array<{ id: string; name: string }>;
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string }> = [];
    for (const planDay of plan.days) {
      for (const built of planDay.stops) {
        if (built.openingStatus !== "unknown" || seen.has(built.stop.id)) continue;
        seen.add(built.stop.id);
        result.push({ id: built.stop.id, name: built.stop.name });
      }
    }
    return result;
  }, [plan]);
  // v1.1 TC-012 / QA-010: the country is auto-detected; only a genuine
  // multi-country paste asks for one explicit choice.
  const conflictingDestinations = useMemo(() => {
    if (destinationChoice !== "auto") return [] as Destination[];
    const seen = new Map<string, Destination>();
    for (const stop of resolvedStops) {
      const profile = destinationForCountryCode(stop.countryCode);
      if (profile && profile.id !== "worldwide") seen.set(profile.id, profile);
    }
    return seen.size >= 2 ? [...seen.values()] : [];
  }, [destinationChoice, resolvedStops]);
  const ambiguousIssuePlaces = useMemo(
    () => ambiguousPlaces.filter((entry) => entry.candidates.length >= 2),
    [ambiguousPlaces],
  );
  const planIssueCount = (plan?.unknownEntries.length ?? 0)
    + deferredAnchorStops.length
    + ambiguousIssuePlaces.length
    + (conflictingDestinations.length > 0 ? 1 : 0)
    + (unknownHoursStops.length > 0 ? 1 : 0)
    // v1.1 TC-004: the computation cap (LIMIT) renders its own issue row with
    // its own action — reduce the candidate list to 15 places or fewer.
    + (feasibilityResult?.unknownCause === "COMPUTATION_LIMIT" ? 1 : 0)
    + (placeWarning ? 1 : 0);
  // Copy Deck plan.stats: the trip totals line under the headline reuses the
  // exact numbers the collapsed verdict details already show — the shared
  // builtPlanTravelMinutes computation and the fit engine's per-day slack —
  // never a second, diverging tally.
  const tripStats = useMemo(() => plan && tripFit
    ? {
      placeCount: plan.scheduledStopCount,
      travelMinutes: builtPlanTravelMinutes(plan),
      bufferMinutes: tripFit.days.reduce((sum, fitDay) => sum + Math.max(0, fitDay.slackMinutes), 0),
    }
    : null, [plan, tripFit]);
  // Copy Deck plan.state.conditional: the headline's check count is the same
  // real number the issue chip shows — never a separate, invented tally.
  const resultStateCopy = feasibilityResult
    ? feasibilityStateCopy(
      feasibilityResult.state,
      locale,
      plan?.requestedDays ?? tripDays,
      plan?.scheduledStopCount ?? 0,
      plan ? plan.deferredUnavailableStops.length + plan.deferredOptionalStops.length : 0,
      planIssueCount,
    )
    : null;
  const displayedMapStops = hasPlan ? mapStops : previewStops;
  const displayedMapBase = hasPlan ? base : null;
  const manualPinDraft = manualPinTarget === null ? null : manualPlaceDrafts[manualPinTarget] ?? null;
  const manualPinLatitude = Number(manualPinDraft?.latitude);
  const manualPinLongitude = Number(manualPinDraft?.longitude);
  const manualPinCoordinate = Number.isFinite(manualPinLatitude)
    && manualPinLatitude >= -90 && manualPinLatitude <= 90
    && Number.isFinite(manualPinLongitude)
    && manualPinLongitude >= -180 && manualPinLongitude <= 180
    ? { latitude: manualPinLatitude, longitude: manualPinLongitude }
    : null;
  const foodPins = useMemo<FoodPin[]>(() => {
    const byCandidate = new Map<string, FoodPin>();
    for (const slot of daySlots) {
      const state = foodSearches[slot.id];
      if (state?.status !== "ready" || state.requestKey !== foodRecommendationRequestKey(slot, locale)) continue;
      (mealCandidatesBySlot[slot.id] ?? []).forEach((candidate, index) => {
        if (typeof candidate.latitude !== "number" || typeof candidate.longitude !== "number") return;
        const existing = byCandidate.get(candidate.id);
        if (existing) {
          if (existing.mealKind !== slot.kind) existing.mealKind = "both";
          return;
        }
        byCandidate.set(candidate.id, {
          id: candidate.id,
          candidateId: candidate.id,
          slotId: slot.id,
          mealKind: slot.kind,
          name: candidate.name,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          index,
        });
      });
    }
    return [...byCandidate.values()];
  }, [daySlots, foodSearches, locale, mealCandidatesBySlot]);
  const recommendationPins = useMemo<RecommendationPin[]>(() => (
    activeRouteRecommendationState.status === "ready"
      ? activeRouteRecommendationState.candidates.slice(0, routeAlternativesExpanded ? 3 : 1).map((candidate, index) => ({
        id: candidate.id,
        name: candidate.name,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        index,
      }))
      : []
  ), [activeRouteRecommendationState, routeAlternativesExpanded]);

  // Alpha guarantees one bounded review for 5–12 POIs. Larger pastes must be
  // split explicitly; sending only the first twelve would make omitted places
  // look like resolver failures and would violate the visible input contract.
  const canReviewPlaces = parsedPlaceCount > 0 && parsedPlaceCount <= 12 && !isResolvingPlaces;
  const canBuild = parsedPlaceCount > 0
    && parsedPlaceCount <= 12
    && itinerary.trim().length >= 3
    && !isResolvingPlaces
    && !isBuilding;

  // The encoded polyline of the leg being travelled at the meal's clock, so
  // mid-leg meal searches run ALONG the corridor instead of one circle.
  const mealRoutePolyline = useCallback((slot: FoodRecommendationSlot): string | undefined => {
    const slotDay = plan?.days[slot.dayIndex];
    if (!slotDay || !plan) return undefined;
    const minutes = clockToMinutes(slot.displayTime);
    if (minutes === null) return undefined;
    const dayBase = slotDay.startBase ?? plan.selectedBase;
    const stops = slotDay.stops;
    const path: Array<{ id: string }> = dayBase
      ? [dayBase, ...stops.map((entry) => entry.stop), slotDay.endBase ?? dayBase]
      : stops.map((entry) => entry.stop);
    if (path.length < 2) return undefined;
    const offset = dayBase ? 1 : 0;
    for (let legIndex = 0; legIndex < path.length - 1; legIndex += 1) {
      const startClock = legIndex === 0 && dayBase
        ? clockToMinutes(slotDay.startTime)
        : clockToMinutes(stops[legIndex - offset]?.departure ?? "");
      const endClock = legIndex === path.length - 2 && dayBase
        ? clockToMinutes(slotDay.finishTime)
        : clockToMinutes(stops[legIndex + 1 - offset]?.arrival ?? "");
      if (startClock === null || endClock === null) continue;
      if (minutes < startClock || minutes > endClock) continue;
      const measured = prefetchGeometry[routeLegKey(path[legIndex].id, path[legIndex + 1].id)];
      const entry = measured?.transit ?? measured?.drive ?? measured?.walk;
      return entry?.encoded;
    }
    return undefined;
  }, [plan, prefetchGeometry]);

  const selectedIntel = selectedBuiltStop ? intelligence[selectedBuiltStop.stop.id] : undefined;
  const selectedFresh = selectedBuiltStop ? freshVoices[selectedBuiltStop.stop.id] : undefined;
  const selectedCheckLoading = selectedIntel?.status === "loading" || selectedFresh?.status === "loading";
  // While social checks are paused, Google evidence alone completes a check.
  const selectedCheckReady = selectedIntel?.status === "ready" && (selectedFresh?.status === "ready" || selectedFresh?.status === "paused");
  const selectedCheckRetry = selectedIntel?.status === "unavailable" || selectedFresh?.status === "unavailable";
  const visibleBuildStages = buildStageOrder;
  const activeBuildIndex = visibleBuildStages.indexOf(buildProgress.stage);
  // Copy Deck build.stage1-3: the live announcement repeats the active stage
  // outcome — no counts, no provider or hotel names on the build screen.
  const activeBuildDetail = text.buildSteps[buildProgress.stage];

  return {
    activeBuildDetail,
    activeBuildIndex,
    activeDayPresentation,
    activeFitDay,
    activeFoodSlot,
    activeFoodState,
    activeRouteRecommendationState,
    ambiguousIssuePlaces,
    ambiguousReviewedCount,
    base,
    bestHotelTravelMinutes,
    canBuild,
    canNormalizeItinerary,
    canReviewPlaces,
    confirmedReviewedCount,
    confirmedRouteFactCount,
    conflictingDestinations,
    currentInputSignature,
    day,
    dayEndBase,
    daySlots,
    dayTravelTotal,
    deferredAnchorStops,
    displayedMapBase,
    displayedMapStops,
    fillerKindsByStopId,
    fillerStopIds,
    foodPins,
    formattedItinerary,
    hardViolationAnnouncement,
    hasRakutenHotelEvidence,
    hotelPins,
    hotelTravelMinutesById,
    manualPinCoordinate,
    mapDayLayers,
    mapItemKinds,
    mapStops,
    mapWarningStopIds,
    maxParsedDay,
    mealCandidatesBySlot,
    mealRoutePolyline,
    measuredRouteCount,
    openingVerificationCount,
    parsePreviewRows,
    parsedPlaceCount,
    placesHaveBeenReviewed,
    planIssueCount,
    plannedStopIds,
    preTripItems,
    primaryRecommendationGap,
    recommendationPins,
    recommendationSearchPoints,
    resolveAttentionRanks,
    resultStateCopy,
    reviewedPlaceRows,
    routeDepartureTimes,
    routeFactCount,
    routeGeometryKey,
    routeModes,
    routeRecommendationKey,
    routeTransitGeometry,
    selectedBuiltStop,
    selectedCheckLoading,
    selectedCheckReady,
    selectedCheckRetry,
    selectedFresh,
    selectedHotel,
    selectedIntel,
    selectedRouteRecommendation,
    selectedStopIndex,
    tripStats,
    unknownHoursStops,
    unresolvedReviewedCount,
    visibleBuildStages,
  };
}
