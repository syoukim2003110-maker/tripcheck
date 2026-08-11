"use client";

// The build pipeline (refactor spec v2.1 hooks/): place resolution, the
// staged plan build, the demo/reset/cancel lifecycle and the per-place
// evidence checks, plus the resolution and build state they own. usePlanBuild
// owns the state and is called at the old state block's position, before the
// planner-context memos that read the resolved stops and base and before the
// edit-history hook that receives the resolved base. The pipeline actions
// close over the derived review rows, input signatures and `plan`-derived
// values, and over refs owned by the transit, hotel, persistence and
// discovery hooks — all available only much later — so they are exported as
// the companion hook usePlanBuildActions below, called at the old checkPlace
// position with the state and setters this hook returns (the call site
// spreads the state hook's whole return).
// useTripPersistence is called before the actions hook but needs buildPlan:
// the state hook therefore owns buildPlanRef, the actions hook writes the
// render-fresh buildPlan into it, and TripPlannerApp hands persistence a
// forwarder that reads the ref. Because the ref is written during render, the
// closure the persistence effect invokes is exactly the one created by the
// render that flipped its dependency — the same per-render closure semantics
// it had when buildPlan was declared inline in TripPlannerApp.
// The domain input states the pipeline snapshots and resets (itinerary, trip
// days, dates, airports, hotel query, overrides...) deliberately stay in
// TripPlannerApp; their current values and setters are passed in as params so
// closure and dependency semantics stay exactly what they were before the
// extraction.
// This file is intentionally .tsx: the planner-surface contract tests scan
// app/**/*.tsx for these contracts, wherever they live.
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { foodRecommendationRequestKey } from "../../../../lib/food-recommendations-client";
import { defaultFoodDiscoveryQuery } from "../../../../lib/google-food";
import { requestHotelRecommendations, requestHotelRanking } from "../../../../lib/hotel-recommendations-client";
import { placeTypesIncludeLodging, type HotelCandidate } from "../../../../lib/google-hotels";
import { fullTripDemo } from "../../../../lib/mock-trip";
import { requestFreshVoices, requestPlaceIntelligence, PlaceIntelligenceError } from "../../../../lib/place-intelligence-client";
import { googleCurrentOpeningWindowsForDate, googleOpeningWindowsForDate } from "../../../../lib/google-opening-hours";
import { deriveStopPlanningEvidence } from "../../../../lib/planning-evidence";
import {
  PlaceResolutionError,
  placeReviewInputSignature,
  requestPlaceResolution,
  type AmbiguousPlaceResolution,
  type PlaceReviewStatus,
} from "../../../../lib/place-resolution-client";
import { PLANNING_BUDGET, takeWithinPlanningBudget } from "../../../../lib/planning-budget";
import { resolveKnownStops, type ResolvedInputStop, type RouteStop } from "../../../../lib/route-optimizer";
import {
  buildTripFromWishlist,
  hotelRouteContextForDraft,
  type AirportCode,
  type BuiltTripPlan,
  type MealPlan,
  type VisitWindow,
} from "../../../../lib/trip-builder";
import type { Pace } from "../../../../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../../../../lib/time-feasibility";
import {
  destinationById,
  type Destination,
  type DestinationChoice,
  type DestinationId,
} from "../../../../lib/destinations";
import type { ShareableResolutionOverride } from "../../../../lib/share-link";
import { assessTripFit } from "../../../../lib/trip-scenarios";
import type { AlternativePlan, RouteFactEvidence } from "../../../../lib/feasibility-result";
import { estimateStayMinutes } from "../../../../lib/stay-estimates";
import { trackProductEvent, type ProductEventFields, type ProductEventName } from "../../../../lib/product-analytics";
import { rotateTripRequestToken } from "../../../../lib/trip-request-identity";
import { parsedWishlistPlaces, type ParsedWishlistPlace } from "../../../../lib/wishlist-parser";
import { createPlannerHistory, type PlannerHistory } from "../../../../lib/planner-history";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy";
import { hotelShortlist } from "../../../../lib/presentation/recommendation-presentation";
import {
  P0_CORE_ONLY,
  initialBuildProgress,
  emptyTransitConvergenceState,
  emptyFreshState,
  emptyHotelAi,
  emptyHotelState,
  upsertResolutionOverride,
  withManualResolutionOverrides,
  addCalendarDays,
  clampTripDays,
  builtPlanTravelMinutes,
  hotelPlanSignature,
  defaultTripDate,
  mapWithConcurrency,
  hotelAsResolvedBase,
  provisionalBaseAsResolved,
  normalizeHotelName,
  shouldUseRecommendedHotel,
  matchingHotelCandidate,
  type PlannerInputStep,
  type PlannerBuildMode,
  type MobileResultView,
  type PlannerMapScope,
  type FoodState,
  type IntelligenceState,
  type FreshState,
  type HotelState,
  type HotelStayMode,
  type HotelStyleChoice,
  type HotelPurpose,
  type BuildProgress,
  type Inspector,
  type ManualPlaceDraft,
  type PlannerEditState,
  type RouteRecommendationState,
  type TransitConvergenceState,
  type TransitLegBoarding,
} from "../../../../lib/planner-app-state";
import type { RouteRecommendationPoint } from "../../../../lib/route-recommendations";
import type { PendingHardEdit } from "./usePlannerEdits";

export function usePlanBuild() {
  const [detectedDestinationId, setDetectedDestinationId] = useState<DestinationId | null>(null);
  const [isResolvingPlaces, setIsResolvingPlaces] = useState(false);
  const [reviewedInputSignature, setReviewedInputSignature] = useState("");
  const [resolvedStops, setResolvedStops] = useState<ResolvedInputStop[]>([]);
  const [ambiguousPlaces, setAmbiguousPlaces] = useState<AmbiguousPlaceResolution[]>([]);
  const [resolutionOverrides, setResolutionOverrides] = useState<ShareableResolutionOverride[]>([]);
  const [resolvedBase, setResolvedBase] = useState<ResolvedInputStop | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [placeWarning, setPlaceWarning] = useState<false | "unavailable" | "quota_exhausted">(false);
  const [intelligence, setIntelligence] = useState<Record<string, IntelligenceState>>({});
  const [freshVoices, setFreshVoices] = useState<Record<string, FreshState>>({});
  const [startInputError, setStartInputError] = useState<"" | "empty" | "limit">("");
  // v1.1 §12.3 / QA-043: recalculation completes politely, hard violations
  // (booking time, airport cutoff) interrupt. Both regions stay mounted so a
  // text change is what triggers the announcement, exactly once per event.
  const [buildAnnouncement, setBuildAnnouncement] = useState("");
  // "See a finished example" must finish: the demo build starts on the next
  // render, after loadDemo's state (itinerary, destination, days) commits.
  // The seed ref carries the destination's bundled coordinates so the sample
  // builds deterministically with zero provider keys.
  const [queuedDemoBuild, setQueuedDemoBuild] = useState(false);
  const queuedDemoSeedRef = useRef<ResolvedInputStop[] | null>(null);
  const [previewStops, setPreviewStops] = useState<RouteStop[]>([]);
  const [buildProgress, setBuildProgress] = useState<BuildProgress>(initialBuildProgress);
  // v1.1 TC-023: the manual-pin address path resolves the typed address
  // through the shared place-resolution client; this per-occurrence status
  // drives the confirm button's loading state and the inline failure note.
  const [manualAddressResolution, setManualAddressResolution] = useState<Record<number, "loading" | "failed">>({});
  const manualAddressAbortRef = useRef<AbortController | null>(null);
  const buildRunRef = useRef(0);
  const buildAbortRef = useRef<AbortController | null>(null);
  const placeReviewAbortRef = useRef<AbortController | null>(null);
  const intelligenceRef = useRef<Record<string, IntelligenceState>>({});
  // The pipeline's buildPlan is created by the actions hook below — after
  // useTripPersistence, which needs to call it. Persistence receives a
  // forwarder that reads this ref; the actions hook writes each render's
  // buildPlan into it during render (see the note in the file header).
  const buildPlanRef = useRef<(options?: { preserveEdits?: boolean; prefetchedReview?: { places: ResolvedInputStop[] } }) => Promise<void>>(async () => {});

  useEffect(() => {
    intelligenceRef.current = intelligence;
  }, [intelligence]);

  return {
    detectedDestinationId,
    setDetectedDestinationId,
    isResolvingPlaces,
    setIsResolvingPlaces,
    reviewedInputSignature,
    setReviewedInputSignature,
    resolvedStops,
    setResolvedStops,
    ambiguousPlaces,
    setAmbiguousPlaces,
    resolutionOverrides,
    setResolutionOverrides,
    resolvedBase,
    setResolvedBase,
    isBuilding,
    setIsBuilding,
    placeWarning,
    setPlaceWarning,
    intelligence,
    setIntelligence,
    freshVoices,
    setFreshVoices,
    startInputError,
    setStartInputError,
    buildAnnouncement,
    setBuildAnnouncement,
    queuedDemoBuild,
    setQueuedDemoBuild,
    queuedDemoSeedRef,
    previewStops,
    setPreviewStops,
    buildProgress,
    setBuildProgress,
    manualAddressResolution,
    setManualAddressResolution,
    manualAddressAbortRef,
    buildRunRef,
    buildAbortRef,
    placeReviewAbortRef,
    intelligenceRef,
    buildPlanRef,
  };
}

// Every network call in this file goes through a named request client: the
// privacy contract test scans this file and asserts, by pattern, that the
// pipeline performs no direct network calls.
export function usePlanBuildActions({
  activeDestination,
  aiEnabledRef,
  attemptedLegKeysRef,
  buildAbortRef,
  buildPlanRef,
  buildRunRef,
  canBuild,
  canReviewPlaces,
  clearNightlyHotelResults,
  currentInputSignature,
  currentStoredTripIdRef,
  dayEndTarget,
  dayEndTimes,
  dayOverrides,
  dayStartDefault,
  dayStartTimes,
  daysUndecided,
  departureAirport,
  departureTime,
  destinationChoice,
  flightKind,
  freshVoices,
  hasPlan,
  hotelQuery,
  hotelRefreshAbortRef,
  hotelStyleRef,
  intelligence,
  intelligenceRef,
  isBuilding,
  isResolvingPlaces,
  itinerary,
  lastEntryTimes,
  legModeOverrides,
  locale,
  lockedOrderByDay,
  manualAddressAbortRef,
  manualPlaceDrafts,
  maxTransfersPerLeg,
  maxWalkingMinutesPerLeg,
  mealPlan,
  pace,
  parsedPlaceCount,
  placeReviewAbortRef,
  placesHaveBeenReviewed,
  placesInputRef,
  planReady,
  postBuildLegBudgetRef,
  queuedDemoBuild,
  queuedDemoSeedRef,
  removedStops,
  requestDestination,
  resetAnalyticsMilestones,
  resolutionOverrides,
  resolvedStops,
  reviewedInputSignature,
  reviewedPlaceRows,
  routeRecommendationRequestRef,
  selectHotelCandidate,
  selectedBuiltStop,
  setActiveDay,
  setAmbiguousPlaces,
  setArrivalAirport,
  setArrivalTime,
  setBuildAnnouncement,
  setBuildMode,
  setBuildProgress,
  setComparisonAlternative,
  setDayEndTarget,
  setDayEndTimes,
  setDayOverrides,
  setDayStartDefault,
  setDayStartTimes,
  setDepartureAirport,
  setDepartureTime,
  setDestinationChoice,
  setDetectedDestinationId,
  setDurationOverrides,
  setEarlyVisitStopIds,
  setEditHistory,
  setFlightKind,
  setFoodSearches,
  setFreshVoices,
  setHasPlan,
  setHintDismissed,
  setHotelPurpose,
  setHotelQuery,
  setHotelRefreshFailed,
  setHotelRefreshing,
  setHotelSearchSignature,
  setHotelState,
  setHotelStayMode,
  setHotelStyle,
  setHotelUsesRecommendations,
  setInputStep,
  setInspector,
  setIntelligence,
  setIsBuilding,
  setIsResolvingPlaces,
  setItinerary,
  setLastEntryTimes,
  setLegModeOverrides,
  setLiveDriving,
  setLiveRouteEvidence,
  setLiveTransit,
  setLiveTransitAbsent,
  setLiveTransitTransferCounts,
  setLiveWalking,
  setLocale,
  setLockedOrderByDay,
  setManualAddressResolution,
  setManualPinTarget,
  setManualPlaceDrafts,
  setMapScope,
  setMaxTransfersPerLeg,
  setMaxWalkingMinutesPerLeg,
  setMealPlan,
  setMealSelections,
  setMobileResultView,
  setOpeningWindowsByDay,
  setPace,
  setPendingHardEdit,
  setPlaceWarning,
  setPlanReady,
  setPrefetchGeometry,
  setPrefetchTransit,
  setPrefetchTransitAbsent,
  setPrefetchTransitSteps,
  setPreviewStops,
  setQueuedDemoBuild,
  setRemovedStops,
  setResolutionOverrides,
  setResolvedBase,
  setResolvedStops,
  setReviewedInputSignature,
  setRouteGeometryByDay,
  setRouteRecommendationNotice,
  setRouteRecommendationSearches,
  setStartInputError,
  setTransferBufferMinutes,
  setTransitConvergence,
  setTravelPreference,
  setTripDateTouched,
  setTripDays,
  setTripStartDate,
  setUserStayMinutes,
  trackMilestone,
  transferBufferMinutes,
  transitConvergenceRunRef,
  travelPreference,
  tripDateTouched,
  tripDays,
  tripStartDate,
  userStayMinutes,
  arrivalAirport,
  arrivalTime,
}: ReturnType<typeof usePlanBuild> & {
  activeDestination: Destination;
  aiEnabledRef: RefObject<boolean>;
  arrivalAirport: AirportCode;
  arrivalTime: string;
  attemptedLegKeysRef: RefObject<Set<string>>;
  canBuild: boolean;
  canReviewPlaces: boolean;
  clearNightlyHotelResults: () => void;
  currentInputSignature: string;
  currentStoredTripIdRef: RefObject<string | null>;
  dayEndTarget: string;
  dayEndTimes: Record<number, string>;
  dayOverrides: Record<string, number>;
  dayStartDefault: string;
  dayStartTimes: Record<number, string>;
  daysUndecided: boolean;
  departureAirport: AirportCode;
  departureTime: string;
  destinationChoice: DestinationChoice;
  flightKind: "international" | "domestic";
  hasPlan: boolean;
  hotelQuery: string;
  hotelRefreshAbortRef: RefObject<AbortController | null>;
  hotelStyleRef: RefObject<HotelStyleChoice>;
  itinerary: string;
  lastEntryTimes: Record<string, string>;
  legModeOverrides: Record<string, TransportMode>;
  locale: PlannerLocale;
  lockedOrderByDay: Record<number, string[]>;
  manualPlaceDrafts: Record<number, ManualPlaceDraft>;
  maxTransfersPerLeg: number | null;
  maxWalkingMinutesPerLeg: number | null;
  mealPlan: MealPlan;
  pace: Pace;
  parsedPlaceCount: number;
  placesHaveBeenReviewed: boolean;
  placesInputRef: RefObject<HTMLTextAreaElement | null>;
  planReady: boolean;
  postBuildLegBudgetRef: RefObject<number>;
  removedStops: Array<{ id: string; name: string }>;
  requestDestination: DestinationChoice;
  resetAnalyticsMilestones: () => void;
  reviewedPlaceRows: Array<{ place: ParsedWishlistPlace; status: PlaceReviewStatus }>;
  routeRecommendationRequestRef: RefObject<number>;
  selectHotelCandidate: (candidate: HotelCandidate, purpose?: HotelPurpose) => void;
  selectedBuiltStop: BuiltTripPlan["days"][number]["stops"][number] | null;
  setActiveDay: Dispatch<SetStateAction<number>>;
  setArrivalAirport: Dispatch<SetStateAction<AirportCode>>;
  setArrivalTime: Dispatch<SetStateAction<string>>;
  setBuildMode: Dispatch<SetStateAction<PlannerBuildMode>>;
  setComparisonAlternative: Dispatch<SetStateAction<AlternativePlan | null>>;
  setDayEndTarget: Dispatch<SetStateAction<string>>;
  setDayEndTimes: Dispatch<SetStateAction<Record<number, string>>>;
  setDayOverrides: Dispatch<SetStateAction<Record<string, number>>>;
  setDayStartDefault: Dispatch<SetStateAction<string>>;
  setDayStartTimes: Dispatch<SetStateAction<Record<number, string>>>;
  setDepartureAirport: Dispatch<SetStateAction<AirportCode>>;
  setDepartureTime: Dispatch<SetStateAction<string>>;
  setDestinationChoice: Dispatch<SetStateAction<DestinationChoice>>;
  setDurationOverrides: Dispatch<SetStateAction<Record<string, number>>>;
  setEarlyVisitStopIds: Dispatch<SetStateAction<string[]>>;
  setEditHistory: Dispatch<SetStateAction<PlannerHistory<PlannerEditState>>>;
  setFlightKind: Dispatch<SetStateAction<"international" | "domestic">>;
  setFoodSearches: Dispatch<SetStateAction<Record<string, FoodState>>>;
  setHasPlan: Dispatch<SetStateAction<boolean>>;
  setHintDismissed: Dispatch<SetStateAction<boolean>>;
  setHotelPurpose: Dispatch<SetStateAction<HotelPurpose>>;
  setHotelQuery: Dispatch<SetStateAction<string>>;
  setHotelRefreshFailed: Dispatch<SetStateAction<boolean>>;
  setHotelRefreshing: Dispatch<SetStateAction<boolean>>;
  setHotelSearchSignature: Dispatch<SetStateAction<string>>;
  setHotelState: Dispatch<SetStateAction<HotelState>>;
  setHotelStayMode: Dispatch<SetStateAction<HotelStayMode>>;
  setHotelStyle: Dispatch<SetStateAction<HotelStyleChoice>>;
  setHotelUsesRecommendations: Dispatch<SetStateAction<boolean>>;
  setInputStep: Dispatch<SetStateAction<PlannerInputStep>>;
  setInspector: Dispatch<SetStateAction<Inspector>>;
  setItinerary: Dispatch<SetStateAction<string>>;
  setLastEntryTimes: Dispatch<SetStateAction<Record<string, string>>>;
  setLegModeOverrides: Dispatch<SetStateAction<Record<string, TransportMode>>>;
  setLiveDriving: Dispatch<SetStateAction<Record<string, number>>>;
  setLiveRouteEvidence: Dispatch<SetStateAction<Record<string, RouteFactEvidence>>>;
  setLiveTransit: Dispatch<SetStateAction<Record<string, number>>>;
  setLiveTransitAbsent: Dispatch<SetStateAction<Record<string, boolean>>>;
  setLiveTransitTransferCounts: Dispatch<SetStateAction<Record<string, number>>>;
  setLiveWalking: Dispatch<SetStateAction<Record<string, number>>>;
  setLocale: Dispatch<SetStateAction<PlannerLocale>>;
  setLockedOrderByDay: Dispatch<SetStateAction<Record<number, string[]>>>;
  setManualPinTarget: Dispatch<SetStateAction<number | null>>;
  setManualPlaceDrafts: Dispatch<SetStateAction<Record<number, ManualPlaceDraft>>>;
  setMapScope: Dispatch<SetStateAction<PlannerMapScope>>;
  setMaxTransfersPerLeg: Dispatch<SetStateAction<number | null>>;
  setMaxWalkingMinutesPerLeg: Dispatch<SetStateAction<number | null>>;
  setMealPlan: Dispatch<SetStateAction<MealPlan>>;
  setMealSelections: Dispatch<SetStateAction<Record<string, string>>>;
  setMobileResultView: Dispatch<SetStateAction<MobileResultView>>;
  setOpeningWindowsByDay: Dispatch<SetStateAction<Record<string, Record<number, VisitWindow[]>>>>;
  setPace: Dispatch<SetStateAction<Pace>>;
  setPendingHardEdit: Dispatch<SetStateAction<PendingHardEdit | null>>;
  setPlanReady: Dispatch<SetStateAction<boolean>>;
  setPrefetchGeometry: Dispatch<SetStateAction<Record<string, Partial<Record<"transit" | "walk" | "drive", { points: Array<{ latitude: number; longitude: number }>; encoded: string }>>>>>;
  setPrefetchTransit: Dispatch<SetStateAction<Record<string, number>>>;
  setPrefetchTransitAbsent: Dispatch<SetStateAction<Record<string, boolean>>>;
  setPrefetchTransitSteps: Dispatch<SetStateAction<Record<string, TransitLegBoarding>>>;
  setRemovedStops: Dispatch<SetStateAction<Array<{ id: string; name: string }>>>;
  setRouteGeometryByDay: Dispatch<SetStateAction<Record<string, RouteRecommendationPoint[]>>>;
  setRouteRecommendationNotice: Dispatch<SetStateAction<string>>;
  setRouteRecommendationSearches: Dispatch<SetStateAction<Record<string, RouteRecommendationState>>>;
  setTransferBufferMinutes: Dispatch<SetStateAction<0 | 10 | 20 | 30>>;
  setTransitConvergence: Dispatch<SetStateAction<TransitConvergenceState>>;
  setTravelPreference: Dispatch<SetStateAction<TravelPreference>>;
  setTripDateTouched: Dispatch<SetStateAction<boolean>>;
  setTripDays: Dispatch<SetStateAction<number>>;
  setTripStartDate: Dispatch<SetStateAction<string>>;
  setUserStayMinutes: Dispatch<SetStateAction<Record<string, number>>>;
  trackMilestone: (event: ProductEventName, fields?: ProductEventFields) => void;
  transferBufferMinutes: 0 | 10 | 20 | 30;
  transitConvergenceRunRef: RefObject<number>;
  travelPreference: TravelPreference;
  tripDateTouched: boolean;
  tripDays: number;
  tripStartDate: string;
  userStayMinutes: Record<string, number>;
}) {
  // v1.1 QA-002: the CTA stays pressable; an empty submit names the missing
  // field inline, moves focus back to the places box and sends no request.
  function requestBuildFromStart() {
    if (isBuilding || isResolvingPlaces) return;
    if (parsedPlaceCount === 0 || itinerary.trim().length < 3) {
      setStartInputError("empty");
      placesInputRef.current?.focus();
      return;
    }
    if (parsedPlaceCount > 12) {
      setStartInputError("limit");
      placesInputRef.current?.focus();
      return;
    }
    setStartInputError("");
    // v1.1 §5.2: the CTA resolves places first. High-confidence input builds
    // straight away; anything ambiguous or missing stops at the Resolve step
    // instead of silently guessing.
    void reviewWishlistPlaces({ continueCleanBuild: true });
  }

  function chooseAmbiguousCandidate(placeIndex: number, candidate: ResolvedInputStop) {
    const occurrenceResolved = { ...candidate, inputIndex: placeIndex };
    setResolvedStops((current) => [
      ...current.filter((entry) => entry.inputIndex !== placeIndex),
      occurrenceResolved,
    ]);
    if (candidate.providerRef) {
      setResolutionOverrides((current) => upsertResolutionOverride(current, {
        inputIndex: placeIndex,
        providerRef: candidate.providerRef!,
      }));
    }
    setManualPinTarget((current) => current === placeIndex ? null : current);
    setPreviewStops((current) => [
      ...current.filter((stop) => !("inputIndex" in stop) || stop.inputIndex !== placeIndex),
      occurrenceResolved,
    ]);
    trackProductEvent("issue_resolved", { issue_type: "ambiguous_place" });
  }

  // v1.1 §5.2: leaving the Resolve step with an unconfirmed Must or booked
  // place is a hard decision, not a silent default.
  function continueFromResolve() {
    const blockedMusts = reviewedPlaceRows.filter((row) => (row.status === "review" || row.status === "unresolved")
      && (row.place.isReservation || row.place.priority === "must"));
    const run = () => void buildPlan(planReady ? { preserveEdits: true } : {});
    if (blockedMusts.length > 0) {
      setPendingHardEdit({
        title: locale === "ja" ? "必須・予約の場所が未確認のままです" : "Must-see or booked places are still unconfirmed",
        conflicts: blockedMusts.map((row) => locale === "ja"
          ? `「${row.place.name}」の場所を確定できていません。このまま続けると旅程に入りません。`
          : `“${row.place.name}” has no confirmed location yet and would be left out of the plan.`),
        cancelLabel: locale === "ja" ? "もどって確認する" : "Go back and confirm",
        confirmLabel: locale === "ja" ? "このまま続ける" : "Continue anyway",
        apply: run,
      });
      return;
    }
    run();
  }

  async function confirmManualPlace(inputIndex: number, inputName: string) {
    const draft = manualPlaceDrafts[inputIndex];
    const latitudeText = draft?.latitude.trim() ?? "";
    const longitudeText = draft?.longitude.trim() ?? "";
    let latitude = latitudeText ? Number(latitudeText) : NaN;
    let longitude = longitudeText ? Number(longitudeText) : NaN;
    const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
      && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    const addressText = draft?.address.trim() ?? "";
    if (!hasCoordinates) {
      // v1.1 TC-023: an address without coordinates is a real path, not a
      // dead label. The typed address goes through the same place-resolution
      // client (same origin, same privacy posture) and the top candidate's
      // coordinates anchor the pin; the traveller's own text stays the label.
      if (!addressText) return;
      manualAddressAbortRef.current?.abort();
      const controller = new AbortController();
      manualAddressAbortRef.current = controller;
      setManualAddressResolution((current) => ({ ...current, [inputIndex]: "loading" }));
      let candidate: { latitude: number; longitude: number } | null = null;
      try {
        const response = await requestPlaceResolution(addressText, "", locale, destinationChoice, controller.signal);
        candidate = response.places[0]
          ?? response.ambiguous[0]?.candidates[0]
          ?? resolveKnownStops(addressText, locale)[0]
          ?? null;
      } catch {
        candidate = resolveKnownStops(addressText, locale)[0] ?? null;
      } finally {
        if (manualAddressAbortRef.current === controller) manualAddressAbortRef.current = null;
      }
      if (controller.signal.aborted) return;
      if (!candidate) {
        setManualAddressResolution((current) => ({ ...current, [inputIndex]: "failed" }));
        return;
      }
      latitude = candidate.latitude;
      longitude = candidate.longitude;
    }
    setManualAddressResolution((current) => {
      if (!(inputIndex in current)) return current;
      const next = { ...current };
      delete next[inputIndex];
      return next;
    });
    const address = addressText || (locale === "ja" ? "ユーザー指定の地点" : "Traveller-supplied coordinates");
    const resolved: ResolvedInputStop = {
      id: `manual-${inputIndex}-${latitude.toFixed(5)}-${longitude.toFixed(5)}`,
      input: inputName,
      inputIndex,
      name: inputName,
      area: address,
      address,
      latitude,
      longitude,
      sourceUrl: "",
      verifiedAt: "",
      confidence: "low",
      planningDurationMinutes: estimateStayMinutes(inputName, [], 90),
      isAnchor: false,
      isUserEntered: true,
      userProvidedCoordinates: true,
    };
    setResolvedStops((current) => [...current.filter((candidate) => candidate.inputIndex !== inputIndex), resolved]);
    setResolutionOverrides((current) => upsertResolutionOverride(current, {
      inputIndex,
      name: inputName,
      address,
      latitude,
      longitude,
    }));
    setPreviewStops((current) => [
      ...current.filter((candidate) => !("inputIndex" in candidate) || candidate.inputIndex !== inputIndex),
      resolved,
    ]);
    setManualPinTarget((current) => current === inputIndex ? null : current);
    trackProductEvent("issue_resolved", { issue_type: "not_found_place" });
  }

  function changeLocale(next: PlannerLocale) {
    if (next === locale) return;
    transitConvergenceRunRef.current += 1;
    placeReviewAbortRef.current?.abort();
    placeReviewAbortRef.current = null;
    setIsResolvingPlaces(false);
    // Switching language must not throw away the built plan or its evidence
    // (coordinates, measured routes, reviews, public sources). Labels and the
    // schedule text rebuild instantly from the same data; already-fetched
    // evidence keeps the language it was collected in until re-checked.
    if (isBuilding) {
      buildAbortRef.current?.abort();
      buildAbortRef.current = null;
      buildRunRef.current += 1;
      setIsBuilding(false);
      setPreviewStops([]);
      setBuildProgress(initialBuildProgress);
    }
    routeRecommendationRequestRef.current += 1;
    setInspector(null);
    if (!hasPlan) {
      setInputStep("places");
      setReviewedInputSignature("");
      setResolvedStops([]);
      setAmbiguousPlaces([]);
      setManualPlaceDrafts({});
      manualAddressAbortRef.current?.abort();
      manualAddressAbortRef.current = null;
      setManualAddressResolution({});
      setPreviewStops([]);
    } else {
      // The built plan deliberately retains the same provider identities and
      // coordinates across a language switch. Move the review identity with
      // that retained evidence so returning to Details cannot relabel every
      // confirmed place as pending or unresolved.
      setReviewedInputSignature(placeReviewInputSignature(itinerary, next, destinationChoice));
    }
    setLocale(next);
    window.history.replaceState({}, "", next === "ja" ? "/ja" : "/");
  }

  function loadDemo(destinationOverride?: Destination) {
    trackProductEvent("sample_used", {});
    rotateTripRequestToken();
    resetAnalyticsMilestones();
    currentStoredTripIdRef.current = null;
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
    // A place review still in flight belongs to the previous text; letting it
    // land would overwrite the demo's cleared state and yank the step forward.
    placeReviewAbortRef.current?.abort();
    placeReviewAbortRef.current = null;
    setIsResolvingPlaces(false);
    buildRunRef.current += 1;
    transitConvergenceRunRef.current += 1;
    routeRecommendationRequestRef.current += 1;
    // A Tokyo demo is useless for a Swiss trip: load the destination's own
    // starter wishlist when it has one.
    const demoDestination = destinationOverride ?? activeDestination;
    const sample = demoDestination.sample;
    setItinerary(sample ? sample[locale] : fullTripDemo.places[locale]);
    setInputStep("places");
    setReviewedInputSignature("");
    setMobileResultView("timeline");
    setMapScope("day");
    setTravelPreference("auto");
    setDayStartDefault("09:00");
    setDayEndTarget("");
    setTransferBufferMinutes(10);
    setMaxWalkingMinutesPerLeg(null);
    setMaxTransfersPerLeg(null);
    setTripDays(destinationOverride?.id === "switzerland" ? 4 : sample ? Math.min(14, Math.max(3, tripDays)) : fullTripDemo.tripDays);
    if (destinationOverride) {
      setDestinationChoice(demoDestination.id);
      setDetectedDestinationId(demoDestination.id);
      setTripStartDate(defaultTripDate(demoDestination));
      setTripDateTouched(false);
    } else if (!sample) {
      setDestinationChoice(fullTripDemo.destination);
      setTripStartDate(fullTripDemo.tripStartDate);
      setTripDateTouched(true);
    }
    setHotelQuery(sample ? "" : fullTripDemo.hotelQuery[locale]);
    setPace(fullTripDemo.pace);
    setArrivalAirport(sample ? "none" : fullTripDemo.arrivalAirport);
    setArrivalTime(sample ? "" : fullTripDemo.arrivalTime);
    setDepartureAirport(sample ? "none" : fullTripDemo.departureAirport);
    setDepartureTime(sample ? "" : fullTripDemo.departureTime);
    setFlightKind(sample ? "international" : fullTripDemo.flightKind);
    setMealPlan(P0_CORE_ONLY ? "none" : "all");
    setResolvedStops([]);
    setAmbiguousPlaces([]);
    setManualPlaceDrafts({});
    manualAddressAbortRef.current?.abort();
    manualAddressAbortRef.current = null;
    setManualAddressResolution({});
    setResolutionOverrides([]);
    setManualPinTarget(null);
    setResolvedBase(null);
    setPlaceWarning(false);
    setActiveDay(0);
    setInspector(null);
    setFoodSearches({});
    setRouteRecommendationSearches({});
    setRouteRecommendationNotice("");
    setRouteGeometryByDay({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setHotelSearchSignature("");
    setHotelRefreshing(false);
    setHotelRefreshFailed(false);
    setHotelUsesRecommendations(shouldUseRecommendedHotel(fullTripDemo.hotelQuery[locale]));
    setHotelStayMode("single");
    setHotelStyle("recommended");
    setHotelPurpose("balanced");
    clearNightlyHotelResults();
    setDurationOverrides({});
    setUserStayMinutes({});
    setLastEntryTimes({});
    setEarlyVisitStopIds([]);
    setDayStartTimes({});
    setDayEndTimes({});
    setPreviewStops([]);
    attemptedLegKeysRef.current.clear();
    setLiveTransit({});
    setLiveTransitTransferCounts({});
    setLiveWalking({});
    setLiveDriving({});
    setPrefetchTransit({});
    setLiveTransitAbsent({});
    setPrefetchTransitAbsent({});
    setPrefetchGeometry({});
    setPrefetchTransitSteps({});
    setLiveRouteEvidence({});
    setTransitConvergence(emptyTransitConvergenceState);
    setLegModeOverrides({});
    setDayOverrides({});
    setLockedOrderByDay({});
    setMealSelections({});
    setRemovedStops([]);
    setEditHistory(createPlannerHistory({
      tripDays: 3, pace: "balanced", hotelQuery: "", resolvedBase: null,
      travelPreference: "auto", transferBufferMinutes: 10, userStayMinutes: {},
      lastEntryTimes: {}, dayStartTimes: {}, dayEndTimes: {}, legModeOverrides: {},
      dayOverrides: {}, lockedOrderByDay: {}, removedStops: [],
    }));
    setOpeningWindowsByDay({});
    setBuildProgress(initialBuildProgress);
    setIsBuilding(false);
    setHasPlan(false);
    setPlanReady(false);
    queuedDemoSeedRef.current = demoDestination.sampleStops?.map((stop, index) => ({
      id: `sample-${demoDestination.id}-${index}`,
      input: stop.names[locale],
      inputIndex: index,
      name: stop.names[locale],
      area: stop.area[locale],
      address: stop.area[locale],
      latitude: stop.latitude,
      longitude: stop.longitude,
      sourceUrl: "",
      verifiedAt: "",
      confidence: "medium",
      planningDurationMinutes: stop.stayMinutes,
      isAnchor: false,
    })) ?? null;
    setQueuedDemoBuild(true);
  }

  useEffect(() => {
    if (!queuedDemoBuild) return;
    setQueuedDemoBuild(false);
    const seed = queuedDemoSeedRef.current;
    queuedDemoSeedRef.current = null;
    void buildPlan(seed ? { prefetchedReview: { places: seed } } : {});
    // buildPlan is redeclared per render by design; this effect only needs the
    // one render where the queued flag flips true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedDemoBuild]);

  async function reviewWishlistPlaces(options: { continueCleanBuild?: boolean } = {}) {
    if (!canReviewPlaces) return;
    trackMilestone("places_parsed", { place_count: parsedPlaceCount });
    placeReviewAbortRef.current?.abort();
    const controller = new AbortController();
    placeReviewAbortRef.current = controller;
    const rawAtStart = itinerary;
    const signatureAtStart = currentInputSignature;
    setIsResolvingPlaces(true);
    setPlaceWarning(false);
    setReviewedInputSignature("");
    setResolvedStops([]);
    setAmbiguousPlaces([]);
    setManualPlaceDrafts({});
    manualAddressAbortRef.current?.abort();
    manualAddressAbortRef.current = null;
    setManualAddressResolution({});
    setManualPinTarget(null);
    setResolvedBase(null);
    setPreviewStops([]);
    try {
      let places: ResolvedInputStop[] = withManualResolutionOverrides([], resolutionOverrides);
      let ambiguous: AmbiguousPlaceResolution[] = [];
      try {
        const response = await requestPlaceResolution(
          rawAtStart,
          "",
          locale,
          destinationChoice,
          controller.signal,
          resolutionOverrides,
        );
        places = withManualResolutionOverrides(response.places, resolutionOverrides);
        ambiguous = response.ambiguous;
      } catch (error) {
        if (controller.signal.aborted) return;
        setPlaceWarning(error instanceof PlaceResolutionError
          ? error.code === "quota_exhausted" ? "quota_exhausted" : "unavailable"
          : false);
      }
      if (controller.signal.aborted) return;
      const known = parsedWishlistPlaces(rawAtStart).flatMap((place) => resolveKnownStops(place.name, locale));
      const preview = [...new Map([...known, ...places].map((stop) => [stop.id, stop] as const)).values()];
      setResolvedStops(places);
      setAmbiguousPlaces(ambiguous);
      setPreviewStops(preview);
      trackMilestone("places_resolved", {
        place_count: preview.length,
        provider_name: places.length > 0 ? "google" : "derived",
      });
      const draft = buildTripFromWishlist(rawAtStart, tripDays, pace, locale, {
        destination: destinationChoice,
        resolvedStops: places,
        tripStartDate,
        defaultDayStart: dayStartDefault,
        dayEndTarget: dayEndTarget || undefined,
      });
      if (destinationChoice === "auto") {
        setDetectedDestinationId(draft.destination === "worldwide" ? null : draft.destination);
      }
      setReviewedInputSignature(signatureAtStart);
      // v1.1 §5.2: only places that resolved neither remotely nor from bundled
      // knowledge need a human decision. A clean result skips the Resolve step.
      const needsAttention = parsedWishlistPlaces(rawAtStart).some((place, index) => {
        const normalized = place.name.normalize("NFKC").toLocaleLowerCase();
        const remote = places.find((candidate) => candidate.inputIndex === index)
          ?? places.find((candidate) => candidate.inputIndex === undefined && candidate.input.normalize("NFKC").toLocaleLowerCase() === normalized);
        return !remote && resolveKnownStops(place.name, locale).length === 0;
      });
      if (options.continueCleanBuild && !needsAttention) {
        void buildPlan({ prefetchedReview: { places } });
      } else {
        setInputStep("conditions");
      }
    } finally {
      if (placeReviewAbortRef.current === controller) {
        placeReviewAbortRef.current = null;
        setIsResolvingPlaces(false);
      }
    }
  }

  async function buildPlan(options: { preserveEdits?: boolean; prefetchedReview?: { places: ResolvedInputStop[] } } = {}) {
    if (!canBuild && !options.preserveEdits) return;
    const buildStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Bind the place-resolution result to the exact paste/country/language that
    // produced it. The automatic path skips the separate review screen, but its
    // provider results are still a completed review. Without this signature,
    // returning from the result to "Review details" labels every resolved place
    // as unresolved even though the same provider records built the plan.
    const inputSignatureAtBuildStart = currentInputSignature;
    const authoredConstraintCount = parsedWishlistPlaces(itinerary).filter((place) => (
      place.priority !== "normal" || place.isReservation || place.time !== null || place.stayMinutes !== null || place.day !== null
    )).length
      + Number(Boolean(hotelQuery.trim()))
      + Number(arrivalAirport !== "none")
      + Number(departureAirport !== "none")
      + Number(tripDateTouched)
      + Object.keys(dayStartTimes).length
      + Object.keys(dayEndTimes).length;
    trackMilestone("constraints_completed", {
      place_count: parsedPlaceCount,
      trip_day_count: tripDays,
      constraint_count: authoredConstraintCount,
    });
    buildAbortRef.current?.abort();
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
    const controller = new AbortController();
    buildAbortRef.current = controller;
    const runId = ++buildRunRef.current;
    transitConvergenceRunRef.current += 1;
    routeRecommendationRequestRef.current += 1;
    const cancelled = () => controller.signal.aborted || buildRunRef.current !== runId;
    const commit = (action: () => void) => {
      if (cancelled()) return false;
      action();
      return true;
    };
    if (!commit(() => {
      setIsBuilding(true);
      setHasPlan(false);
      setPlanReady(false);
      setBuildAnnouncement("");
      setPlaceWarning(false);
      setFoodSearches({});
      setRouteRecommendationSearches({});
      setRouteRecommendationNotice("");
      setRouteGeometryByDay({});
      setIntelligence({});
      setFreshVoices({});
      setHotelState({ ...emptyHotelState, status: "loading" });
      setHotelSearchSignature("");
      setHotelRefreshing(false);
      setHotelRefreshFailed(false);
      setHotelUsesRecommendations(shouldUseRecommendedHotel(hotelQuery));
      setHotelStayMode("single");
      setHotelStyle("recommended");
      setHotelPurpose("balanced");
      clearNightlyHotelResults();
      setDurationOverrides({});
      setEarlyVisitStopIds([]);
      setPreviewStops([]);
      attemptedLegKeysRef.current.clear();
      setLiveTransit({});
      setLiveTransitTransferCounts({});
      setLiveWalking({});
      setLiveDriving({});
      setPrefetchTransit({});
      setLiveTransitAbsent({});
      setPrefetchTransitAbsent({});
      setPrefetchGeometry({});
      setPrefetchTransitSteps({});
      setLiveRouteEvidence({});
      setTransitConvergence(emptyTransitConvergenceState);
      setMealSelections({});
      setOpeningWindowsByDay({});
      setInspector(null);
      setComparisonAlternative(null);
      // A shared link or history entry arrives WITH the traveller's
      // result-screen edits already hydrated; wiping them here would rebuild
      // the untouched first draft and break the share contract. A manual
      // build still clears them, because stale edits from the previous trip
      // must not bend a new one.
      if (!options.preserveEdits) {
        setUserStayMinutes({});
        setLastEntryTimes({});
        setDayStartTimes({});
        setDayEndTimes({});
        setLegModeOverrides({});
        setDayOverrides({});
        setLockedOrderByDay({});
        setRemovedStops([]);
      }
      setBuildProgress(initialBuildProgress);
    })) return;

    // A review that just finished in this same tick hands its places over
    // directly; React state (resolvedStops et al.) has not re-rendered yet.
    const prefetchedReview = options.prefetchedReview ?? null;
    const canReusePlaceReview = prefetchedReview !== null
      || (placesHaveBeenReviewed && reviewedInputSignature === currentInputSignature);
    let places: ResolvedInputStop[] = prefetchedReview
      ? prefetchedReview.places
      : canReusePlaceReview
        ? resolvedStops
        : withManualResolutionOverrides([], resolutionOverrides);
    let resolvedHotel: ResolvedInputStop | null = null;
    // Starts as the traveller's pick and is replaced by the detected country
    // once the first draft exists, so hotels, food and evidence for the rest
    // of this build are biased to the right place.
    let buildDestination: DestinationChoice = destinationChoice;
    let buildTripStartDate = tripStartDate;
    let useRecommendedHotelForBuild = shouldUseRecommendedHotel(hotelQuery);
    try {
      const response = await requestPlaceResolution(
        canReusePlaceReview ? "" : itinerary,
        hotelQuery,
        locale,
        buildDestination,
        controller.signal,
        canReusePlaceReview ? [] : resolutionOverrides,
      );
      if (cancelled()) return;
      if (!canReusePlaceReview) places = withManualResolutionOverrides(response.places, resolutionOverrides);
      resolvedHotel = response.hotel;
      // The field accepts either a hotel or an area. Google place types settle
      // ambiguous plain inputs such as "新宿駅" or "Nara": non-lodging results
      // become an area anchor, while an actual hotel name remains fixed.
      if (!useRecommendedHotelForBuild && resolvedHotel?.placeTypes?.length) {
        useRecommendedHotelForBuild = !placeTypesIncludeLodging(resolvedHotel.placeTypes);
      }
      if (!commit(() => {
        setResolvedStops(places);
        if (!canReusePlaceReview) setAmbiguousPlaces(response.ambiguous);
        setResolvedBase(resolvedHotel);
        setPreviewStops(places);
      })) return;
    } catch (error) {
      if (cancelled()) return;
      if (!commit(() => {
        setResolvedStops(places);
        setAmbiguousPlaces([]);
        setManualPlaceDrafts({});
        setManualAddressResolution({});
        setResolvedBase(null);
        setPreviewStops(places);
        setPlaceWarning(error instanceof PlaceResolutionError
          ? error.code === "quota_exhausted" ? "quota_exhausted" : "unavailable"
          : false);
      })) return;
    }
    if (cancelled()) return;
    if (!commit(() => setHotelUsesRecommendations(useRecommendedHotelForBuild))) return;

    const plannerContext = (
      baseOverride: ResolvedInputStop | null,
      overrides: Record<string, number> = {},
      earlyStops: string[] = [],
      openings: Record<string, Record<number, VisitWindow[]>> = {},
      transit: Record<string, number> = {},
      walking: Record<string, number> = {},
      driving: Record<string, number> = {},
    ) => ({
      destination: buildDestination,
      tripStartDate: buildTripStartDate,
      hotelQuery,
      arrivalAirport,
      arrivalTime,
      departureAirport,
      departureTime,
      flightKind,
      mealPlan: P0_CORE_ONLY ? "none" : mealPlan,
      travelPreference,
      resolvedStops: places,
      resolvedBase: baseOverride,
      durationOverrides: overrides,
      earlyVisitStopIds: earlyStops,
      openingWindowsByDay: openings,
      liveTransitMinutes: transit,
      liveWalkingMinutes: walking,
      liveDrivingMinutes: driving,
      defaultDayStart: dayStartDefault,
      dayEndTarget: dayEndTarget || undefined,
      transferBufferMinutes,
      maxWalkingMinutesPerLeg: maxWalkingMinutesPerLeg ?? undefined,
      maxTransfersPerLeg: maxTransfersPerLeg ?? undefined,
      dayEndTimes,
    });
    let buildDays = tripDays;
    if (daysUndecided) {
      // The traveller only promised places. Search the deterministic minimum
      // day count over the resolved places — no provider call is involved —
      // and propose it as the trip length (v1.1 §5.1 "未定").
      const probeFit = assessTripFit(itinerary, buildDays, pace, locale, plannerContext(resolvedHotel));
      const proposedDays = probeFit.minimumDays ?? probeFit.partialMinimumDays;
      if (proposedDays !== null && clampTripDays(proposedDays) !== buildDays) {
        buildDays = clampTripDays(proposedDays);
        if (!commit(() => setTripDays(buildDays))) return;
      }
    }
    let draft = buildTripFromWishlist(itinerary, buildDays, pace, locale, plannerContext(resolvedHotel));
    if (buildDestination === "auto" && draft.destination !== "worldwide") {
      buildDestination = draft.destination;
      if (!tripDateTouched) buildTripStartDate = defaultTripDate(destinationById(draft.destination));
      if (!commit(() => setDetectedDestinationId(draft.destination))) return;
    }
    if (!commit(() => setPreviewStops(draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop))))) return;
    // The first draft grouped the wishlist into days; what remains before the
    // reveal is the deterministic ordering/constraint pass (Copy Deck stage2).
    if (!commit(() => setBuildProgress({ stage: "ordering" }))) return;

    // Place facts and hotel candidates are independent once the wishlist has
    // resolved. Start them together so a slow hotel provider never adds a
    // second full wait before opening-hours checks begin.
    const evidencePriority = (entry: BuiltTripPlan["days"][number]["stops"][number]) => (
      entry.fixedTime ? 0 : entry.priority === "must" ? 1 : entry.priority === "normal" ? 2 : 3
    );
    const preHotelStops = [...new Map(
      draft.days.flatMap((candidate) => candidate.stops)
        .sort((left, right) => evidencePriority(left) - evidencePriority(right) || left.stop.id.localeCompare(right.stop.id))
        .map(({ stop }) => [stop.id, stop] as const),
    ).values()];
    // Weekly opening hours are date-independent evidence, so they are fetched
    // even while the trip date is provisional — otherwise every hours fact
    // stays "unknown" forever on an undated trip. What remains date-gated is
    // APPLYING the windows to the schedule (below), so a placeholder weekday
    // still never turns into a hard closure.
    const preHotelEvidenceStops = takeWithinPlanningBudget(preHotelStops, PLANNING_BUDGET.openingHours);
    const loadPlaceIntelligence = async (stop: RouteStop): Promise<readonly [string, IntelligenceState]> => {
      try {
        const result = await requestPlaceIntelligence(stop, locale, buildDestination, controller.signal);
        return [stop.id, { status: "ready", result } satisfies IntelligenceState] as const;
      } catch {
        return [stop.id, { status: "unavailable", result: null } satisfies IntelligenceState] as const;
      }
    };
    const preHotelIntelligencePromise = mapWithConcurrency(
      preHotelEvidenceStops,
      4,
      loadPlaceIntelligence,
      () => undefined,
      cancelled,
    );

    // Every day gets one route point. A distant excursion no longer drags the
    // hotel halfway toward itself, and every returned candidate is measured
    // against the whole trip.
    const draftHotelContext = hotelRouteContextForDraft(draft);
    const hotelAnchor = resolvedHotel
      ?? draftHotelContext
      ?? draft.baseRecommendations[0]?.base
      ?? draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop))[0]
      ?? null;
    // The build does not fetch hotels on the critical path (TC-025 / §5.3),
    // but omitting a base would also omit two daily transfer legs and
    // understate the required days. Use the deterministic best area as an
    // explicitly provisional routing base: the reveal never waits on the
    // hotel provider and a provider outage can never make the planner
    // silently omit both daily hotel legs. The area recommendation remains a
    // clearly provisional routing base until a live hotel is selected.
    let effectiveBase = resolvedHotel
      ?? (draft.baseRecommendations[0]?.base
        ? provisionalBaseAsResolved(draft.baseRecommendations[0].base)
        : null);
    // The late hotel attach recomputes the stored plan signature with the
    // schedule inputs applied by then; the post-reveal tail keeps this mirror
    // current so the "re-search hotels" prompt never fires on the attach.
    const appliedScheduleParams = {
      overrides: {} as Record<string, number>,
      earlyStops: [] as string[],
      openings: {} as Record<string, Record<number, VisitWindow[]>>,
    };
    // TC-025: the hotel shortlist is progressive enrichment. It starts now,
    // never blocks the reveal, and lands through the same provisional-base
    // path a user's own hotel acceptance takes (setHotelState + setResolvedBase
    // rebuild the plan memo). The build-run staleness guards make sure a late
    // result can never paint over a newer plan, and cancel/reset/new-build
    // abort it through the existing controller and run counter.
    const attachHotelDiscovery = async () => {
      if (P0_CORE_ONLY || !hotelAnchor) {
        commit(() => setHotelState({ status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState, ai: emptyHotelAi }));
        return;
      }
      let localHotelState: HotelState;
      let nextBase: ResolvedInputStop | null = null;
      const buildHotelTravelMinutes = new Map<string, number>();
      try {
        const hotelResponse = await requestHotelRecommendations({
          latitude: hotelAnchor.latitude,
          longitude: hotelAnchor.longitude,
          area: hotelQuery.trim() && useRecommendedHotelForBuild ? hotelQuery.trim() : hotelAnchor.area,
          ...(!useRecommendedHotelForBuild ? { query: hotelQuery } : {}),
          ...(draftHotelContext?.routePoints.length ? { routePoints: draftHotelContext.routePoints } : {}),
        }, locale, buildDestination, controller.signal);
        if (cancelled()) return;
        const hotelCandidatesByTripTime = hotelResponse.candidates
          .map((candidate) => ({
            candidate,
            travelMinutes: builtPlanTravelMinutes(buildTripFromWishlist(
              itinerary,
              buildDays,
              pace,
              locale,
              plannerContext(hotelAsResolvedBase(candidate, hotelQuery, hotelAnchor.area, hotelResponse.fetchedAt)),
            )),
          }))
          .sort((left, right) => left.travelMinutes - right.travelMinutes
            || right.candidate.score - left.candidate.score
            || left.candidate.id.localeCompare(right.candidate.id));
        for (const entry of hotelCandidatesByTripTime) {
          buildHotelTravelMinutes.set(entry.candidate.id, entry.travelMinutes);
        }
        const rankedHotelCandidates = hotelCandidatesByTripTime.map(({ candidate }) => candidate);
        const recommended = rankedHotelCandidates[0] ?? null;
        const matchedExact = resolvedHotel ? matchingHotelCandidate(resolvedHotel, rankedHotelCandidates) : null;
        // A typed hotel name can still match a Google candidate directly, but
        // only when place resolution failed — once a resolved hotel is the
        // routing base, the displayed hotel must never diverge from it.
        const normalizedQuery = normalizeHotelName(hotelQuery);
        const matchedByQuery = !useRecommendedHotelForBuild && !resolvedHotel && normalizedQuery.length >= 3
          ? rankedHotelCandidates.find((candidate) => {
            const candidateName = normalizeHotelName(candidate.name);
            return candidateName.length >= 3 && (candidateName.includes(normalizedQuery) || normalizedQuery.includes(candidateName));
          }) ?? null
          : null;
        const selected = useRecommendedHotelForBuild ? recommended : matchedExact ?? matchedByQuery;
        if (selected && (useRecommendedHotelForBuild || !resolvedHotel)) {
          nextBase = hotelAsResolvedBase(selected, hotelQuery, hotelAnchor.area, hotelResponse.fetchedAt);
        }
        const candidates = selected
          ? [selected, ...rankedHotelCandidates.filter((candidate) => candidate.id !== selected.id)]
          : rankedHotelCandidates;
        localHotelState = { status: "ready", candidates: hotelShortlist(candidates, selected?.id), selectedId: selected?.id ?? null, fresh: emptyFreshState, ai: emptyHotelAi };
      } catch {
        if (cancelled()) return;
        commit(() => setHotelState({ status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState, ai: emptyHotelAi }));
        return;
      }
      if (!commit(() => {
        setHotelState(localHotelState);
        setHotelPurpose(useRecommendedHotelForBuild ? "balanced" : "picked");
        if (nextBase) {
          // The provisional area base hands over to the live hotel through
          // the existing base path; the plan memo rebuilds from it. Keep the
          // final-commit rebuild below on the same base if it has not run yet.
          effectiveBase = nextBase;
          setResolvedBase(nextBase);
          setHotelSearchSignature(hotelPlanSignature(buildTripFromWishlist(
            itinerary,
            buildDays,
            pace,
            locale,
            plannerContext(nextBase, appliedScheduleParams.overrides, appliedScheduleParams.earlyStops, appliedScheduleParams.openings),
          )));
        }
      })) return;

      // AI takes over the "which hotel" decision once the deterministic
      // shortlist exists: it researches the same candidates (bounded web
      // search) and may promote a different base. It can only pick among the
      // shortlisted ids, and a user choice made meanwhile always wins.
      if (aiEnabledRef.current && localHotelState.status === "ready" && localHotelState.candidates.length >= 2 && hotelAnchor) {
        const aiShortlist = localHotelState.candidates;
        const aiInitialSelectedId = localHotelState.selectedId;
        const aiMaySwitch = useRecommendedHotelForBuild && aiInitialSelectedId !== null;
        setHotelState((current) => current.status === "ready"
          ? { ...current, ai: { ...current.ai, status: "loading" } }
          : current);
        void requestHotelRanking({
          destination: locale === "ja" ? destinationById(draft.destination).names.ja : destinationById(draft.destination).names.en,
          area: hotelAnchor.area,
          tripDays: buildDays,
          purpose: useRecommendedHotelForBuild ? "balanced" : "picked",
          candidates: aiShortlist.slice(0, 6).map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            area: candidate.address.slice(0, 100) || hotelAnchor.area,
            rating: candidate.rating,
            reviewCount: candidate.userRatingCount,
            totalTravelMinutes: buildHotelTravelMinutes.get(candidate.id) ?? null,
            styles: candidate.styles,
            priceHint: candidate.rakuten?.minCharge
              ? `~¥${candidate.rakuten.minCharge.toLocaleString("ja-JP")}/night`
              : null,
          })),
        }, locale, controller.signal).then((ai) => {
          if (cancelled()) return;
          let userUntouched = false;
          setHotelState((current) => {
            if (current.status !== "ready") return current;
            userUntouched = current.selectedId === aiInitialSelectedId;
            const order = new Map(ai.ranked.map((item, index) => [item.id, index]));
            const reordered = [...current.candidates].sort((left, right) => (
              (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99)
            ));
            return {
              ...current,
              candidates: reordered,
              ai: {
                status: "ready",
                notes: Object.fromEntries(ai.ranked.map((item) => [item.id, { reason: item.reason, tag: item.tag }])),
                recommendedId: ai.recommendedId,
              },
            };
          });
          const pick = aiShortlist.find((candidate) => candidate.id === ai.recommendedId);
          if (pick && userUntouched && aiMaySwitch && pick.id !== aiInitialSelectedId && hotelStyleRef.current === "recommended") {
            selectHotelCandidate(pick, "balanced");
          }
        }).catch(() => {
          if (cancelled()) return;
          setHotelState((current) => ({ ...current, ai: { ...current.ai, status: "unavailable" } }));
        });
      }
    };
    // Kicked off before the reveal so the request is already in flight while
    // the deterministic plan commits; its state writes can only land after
    // this synchronous block, i.e. after the reveal below.
    void attachHotelDiscovery();

    draft = buildTripFromWishlist(itinerary, buildDays, pace, locale, plannerContext(effectiveBase));
    const uniqueStops = [...new Map(
      draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => [stop.id, stop] as const)),
    ).values()];
    if (!commit(() => {
      const requestedEvidenceIds = new Set(preHotelEvidenceStops.map((stop) => stop.id));
      setIntelligence(Object.fromEntries(uniqueStops.map((stop) => [
        stop.id,
        requestedEvidenceIds.has(stop.id)
          ? { status: "loading", result: null } satisfies IntelligenceState
          : { status: "unavailable", result: null } satisfies IntelligenceState,
      ])));
      setResolvedStops(places);
      setResolvedBase(effectiveBase);
      setTripStartDate(buildTripStartDate);
      setEditHistory(createPlannerHistory({
        tripDays: buildDays,
        pace,
        hotelQuery,
        resolvedBase: effectiveBase,
        travelPreference,
        transferBufferMinutes,
        userStayMinutes: options.preserveEdits ? userStayMinutes : {},
        lastEntryTimes: options.preserveEdits ? lastEntryTimes : {},
        dayStartTimes: options.preserveEdits ? dayStartTimes : {},
        dayEndTimes: options.preserveEdits ? dayEndTimes : {},
        legModeOverrides: options.preserveEdits ? legModeOverrides : {},
        dayOverrides: options.preserveEdits ? dayOverrides : {},
        lockedOrderByDay: options.preserveEdits ? lockedOrderByDay : {},
        removedStops: options.preserveEdits ? removedStops : [],
      }));
      setHotelSearchSignature(hotelPlanSignature(draft));
      setReviewedInputSignature(inputSignatureAtBuildStart);
      setActiveDay(0);
      setHasPlan(true);
      setPlanReady(true);
      setBuildAnnouncement(options.preserveEdits
        ? (locale === "ja" ? "旅程を計算し直しました。" : "Your itinerary has been recalculated.")
        : (locale === "ja" ? "旅程ができました。" : "Your itinerary is ready."));
      trackProductEvent("plan_ready", { trip_day_count: buildDays, place_count: places.length });
      setHintDismissed(false);
      setPreviewStops([]);
      // The deterministic provisional plan is ready. Hotels, meals, hours and
      // time-dependent routes continue in the background and refine this same
      // result (Copy Deck stage3 — not shown under the P0 incident switch,
      // where no hotel or meal search runs).
      if (!P0_CORE_ONLY) setBuildProgress({ stage: "enriching" });
      setIsBuilding(false);
    })) return;
    trackMilestone("provisional_result_shown", {
      place_count: draft.scheduledStopCount,
      trip_day_count: draft.requestedDays,
      solver_time_ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - buildStartedAt,
    });

    const prefetchedEntries = await preHotelIntelligencePromise;
    if (cancelled()) return;
    const prefetchedById = new Map<string, IntelligenceState>(prefetchedEntries);
    const unrequestedStops = uniqueStops.filter((stop) => !prefetchedById.has(stop.id));
    const missingStops = !tripDateTouched
      ? []
      : takeWithinPlanningBudget(unrequestedStops, PLANNING_BUDGET.openingHours, prefetchedEntries.length);
    const missingEntries = await mapWithConcurrency(missingStops, 4, loadPlaceIntelligence, () => undefined, cancelled);
    if (cancelled()) return;
    const intelligenceById = new Map<string, IntelligenceState>([...prefetchedEntries, ...missingEntries]);
    const intelligenceEntries = uniqueStops.map((stop) => [
      stop.id,
      intelligenceById.get(stop.id)
        ?? { status: "unavailable", result: null } satisfies IntelligenceState,
    ] as const);
    const localIntelligence = Object.fromEntries(intelligenceEntries) as Record<string, IntelligenceState>;
    if (!commit(() => setIntelligence(localIntelligence))) return;

    const localOpeningWindows: Record<string, Record<number, VisitWindow[]>> = {};
    for (const stop of tripDateTouched ? uniqueStops : []) {
      const place = localIntelligence[stop.id]?.result?.place;
      if (!place) continue;
      // Trip-fit scenarios compare up to fourteen days. Build the same dated
      // weekly opening windows for that full horizon so "add one day" never
      // treats a missing future-day lookup as proof that a closed place fits.
      for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
        const date = addCalendarDays(buildTripStartDate, dayIndex);
        if (!date) continue;
        const currentWindows = googleCurrentOpeningWindowsForDate({
          businessStatus: place.businessStatus,
          currentOpeningPeriods: place.currentOpeningPeriods,
          currentSpecialDays: place.currentSpecialDays,
        }, date);
        const windows = currentWindows ?? googleOpeningWindowsForDate({
          businessStatus: place.businessStatus,
          regularOpeningPeriods: place.regularOpeningPeriods,
        }, date);
        if (windows !== null) {
          localOpeningWindows[stop.id] ??= {};
          localOpeningWindows[stop.id][dayIndex] = windows;
        }
      }
    }
    const appliedOpeningWindows = tripDateTouched ? localOpeningWindows : {};
    draft = buildTripFromWishlist(itinerary, buildDays, pace, locale, plannerContext(effectiveBase, {}, [], appliedOpeningWindows));

    // Public-web and meal checks are deliberately user initiated. They are
    // useful enrichment, not prerequisites for a feasible first itinerary.
    const localFreshVoices: Record<string, FreshState> = {};
    if (!commit(() => setFreshVoices(localFreshVoices))) return;

    const overrides: Record<string, number> = {};
    const earlyStops: string[] = [];
    if (!P0_CORE_ONLY) {
      for (const stop of uniqueStops) {
        const evidence = deriveStopPlanningEvidence(localIntelligence[stop.id]?.result, undefined);
        if (evidence.bufferMinutes > 0) overrides[stop.id] = Math.min(480, stop.planningDurationMinutes + evidence.bufferMinutes);
        if (evidence.reasons.some((reason) => reason === "queue" || reason === "sold_out" || reason === "early_close")) earlyStops.push(stop.id);
      }
    }
    // Live route measurements refine this estimate after the result is visible.
    // Starting from empty records keeps paid-provider latency off the critical path.
    const measuredTransit: Record<string, number> = {};
    const measuredWalking: Record<string, number> = {};
    const measuredDriving: Record<string, number> = {};

    // From here on the late hotel attach must rebuild with the same schedule
    // inputs as the final commit, or its stored signature would disagree with
    // the live plan and raise a phantom "re-search hotels" prompt.
    appliedScheduleParams.overrides = overrides;
    appliedScheduleParams.earlyStops = earlyStops;
    appliedScheduleParams.openings = appliedOpeningWindows;

    const finalDraft = buildTripFromWishlist(
      itinerary,
      buildDays,
      pace,
      locale,
      plannerContext(effectiveBase, overrides, earlyStops, appliedOpeningWindows, measuredTransit, measuredWalking, measuredDriving),
    );
    const finalFoodSearches = Object.fromEntries(finalDraft.foodRecommendationSlots.map((slot) => [
      slot.id,
      { status: "idle", requestKey: foodRecommendationRequestKey(slot, locale), query: defaultFoodDiscoveryQuery(locale), candidates: [], notes: {}, fresh: {} } satisfies FoodState,
    ])) as Record<string, FoodState>;
    if (!commit(() => setFoodSearches(finalFoodSearches))) return;

    if (!commit(() => {
      postBuildLegBudgetRef.current = P0_CORE_ONLY ? 0 : 16;
      setDurationOverrides(overrides);
      setEarlyVisitStopIds(earlyStops);
      setOpeningWindowsByDay(appliedOpeningWindows);
      setHotelSearchSignature(hotelPlanSignature(finalDraft));
      buildAbortRef.current = null;
    })) return;
  }

  // useTripPersistence runs before this hook and calls buildPlan through the
  // forwarder reading this ref. The render-time write keeps the forwarded
  // closure exactly the one this render created — the same per-render closure
  // the persistence effect captured when buildPlan was declared inline in
  // TripPlannerApp (the write happens during render, before any effect of the
  // same commit can invoke the forwarder).
  buildPlanRef.current = buildPlan;

  function resetTrip() {
    rotateTripRequestToken();
    resetAnalyticsMilestones();
    currentStoredTripIdRef.current = null;
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    placeReviewAbortRef.current?.abort();
    placeReviewAbortRef.current = null;
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
    buildRunRef.current += 1;
    transitConvergenceRunRef.current += 1;
    routeRecommendationRequestRef.current += 1;
    setItinerary("");
    setInputStep("places");
    setBuildMode("automatic");
    setIsResolvingPlaces(false);
    setReviewedInputSignature("");
    setMobileResultView("timeline");
    setMapScope("day");
    setTravelPreference("auto");
    setDayStartDefault("09:00");
    setDayEndTarget("");
    setTransferBufferMinutes(10);
    setMaxWalkingMinutesPerLeg(null);
    setMaxTransfersPerLeg(null);
    setTripDays(3);
    setHotelQuery("");
    setDetectedDestinationId(null);
    setTripStartDate(defaultTripDate(destinationById(destinationChoice === "auto" ? "worldwide" : destinationChoice)));
    setTripDateTouched(false);
    setPace("balanced");
    setMealPlan(P0_CORE_ONLY ? "none" : "all");
    setArrivalAirport("none");
    setArrivalTime("");
    setDepartureAirport("none");
    setDepartureTime("");
    setFlightKind("international");
    setResolvedStops([]);
    setAmbiguousPlaces([]);
    setManualPlaceDrafts({});
    manualAddressAbortRef.current?.abort();
    manualAddressAbortRef.current = null;
    setManualAddressResolution({});
    setResolutionOverrides([]);
    setResolvedBase(null);
    setFoodSearches({});
    setRouteRecommendationSearches({});
    setRouteRecommendationNotice("");
    setRouteGeometryByDay({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setHotelSearchSignature("");
    setHotelRefreshing(false);
    setHotelRefreshFailed(false);
    setHotelUsesRecommendations(true);
    setHotelStayMode("single");
    setHotelStyle("recommended");
    setHotelPurpose("balanced");
    clearNightlyHotelResults();
    setDurationOverrides({});
    setUserStayMinutes({});
    setLastEntryTimes({});
    setEarlyVisitStopIds([]);
    setDayStartTimes({});
    setDayEndTimes({});
    setPreviewStops([]);
    attemptedLegKeysRef.current.clear();
    setLiveTransit({});
    setLiveTransitTransferCounts({});
    setLiveWalking({});
    setLiveDriving({});
    setPrefetchTransit({});
    setLiveTransitAbsent({});
    setPrefetchTransitAbsent({});
    setPrefetchGeometry({});
    setPrefetchTransitSteps({});
    setLiveRouteEvidence({});
    setTransitConvergence(emptyTransitConvergenceState);
    setLegModeOverrides({});
    setDayOverrides({});
    setLockedOrderByDay({});
    setMealSelections({});
    setRemovedStops([]);
    setEditHistory(createPlannerHistory({
      tripDays: 3, pace: "balanced", hotelQuery: "", resolvedBase: null,
      travelPreference: "auto", transferBufferMinutes: 10, userStayMinutes: {},
      lastEntryTimes: {}, dayStartTimes: {}, dayEndTimes: {}, legModeOverrides: {},
      dayOverrides: {}, lockedOrderByDay: {}, removedStops: [],
    }));
    setOpeningWindowsByDay({});
    setInspector(null);
    setComparisonAlternative(null);
    setHasPlan(false);
    setPlanReady(false);
    setPlaceWarning(false);
    setActiveDay(0);
    setIsBuilding(false);
    setBuildProgress(initialBuildProgress);
  }

  function cancelBuild() {
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
    buildRunRef.current += 1;
    transitConvergenceRunRef.current += 1;
    routeRecommendationRequestRef.current += 1;
    setIsBuilding(false);
    setInputStep("places");
    setReviewedInputSignature("");
    setHasPlan(false);
    setPlanReady(false);
    setResolvedStops([]);
    setAmbiguousPlaces([]);
    setManualPlaceDrafts({});
    manualAddressAbortRef.current?.abort();
    manualAddressAbortRef.current = null;
    setManualAddressResolution({});
    setResolvedBase(null);
    setFoodSearches({});
    setRouteRecommendationSearches({});
    setRouteRecommendationNotice("");
    setRouteGeometryByDay({});
    setIntelligence({});
    setFreshVoices({});
    setHotelState(emptyHotelState);
    setHotelSearchSignature("");
    setHotelRefreshing(false);
    setHotelRefreshFailed(false);
    setHotelUsesRecommendations(true);
    setHotelStayMode("single");
    setHotelStyle("recommended");
    setHotelPurpose("balanced");
    clearNightlyHotelResults();
    setDurationOverrides({});
    setUserStayMinutes({});
    setLastEntryTimes({});
    setEarlyVisitStopIds([]);
    setDayStartTimes({});
    setDayEndTimes({});
    setPreviewStops([]);
    attemptedLegKeysRef.current.clear();
    setLiveTransit({});
    setLiveTransitTransferCounts({});
    setLiveWalking({});
    setLiveDriving({});
    setPrefetchTransit({});
    setLiveTransitAbsent({});
    setPrefetchTransitAbsent({});
    setPrefetchGeometry({});
    setPrefetchTransitSteps({});
    setLiveRouteEvidence({});
    setTransitConvergence(emptyTransitConvergenceState);
    setLegModeOverrides({});
    setDayOverrides({});
    setMealSelections({});
    setRemovedStops([]);
    setOpeningWindowsByDay({});
    setPlaceWarning(false);
    setActiveDay(0);
    setBuildProgress(initialBuildProgress);
    setInspector(null);
    setComparisonAlternative(null);
  }

  async function checkPlace(stop: RouteStop) {
    const runId = buildRunRef.current;
    const stale = () => buildRunRef.current !== runId;
    const cachedIntel = intelligence[stop.id];
    const cachedFresh = freshVoices[stop.id];
    if (cachedIntel?.status === "loading" || cachedFresh?.status === "loading") return;
    if (cachedIntel?.status === "ready" && (cachedFresh?.status === "ready" || cachedFresh?.status === "paused")) return;

    let placeResult = cachedIntel?.status === "ready" ? cachedIntel.result : null;
    if (!placeResult) {
      setIntelligence((current) => ({ ...current, [stop.id]: { status: "loading", result: null } }));
      try {
        placeResult = await requestPlaceIntelligence(stop, locale, requestDestination);
        if (stale()) return;
        setIntelligence((current) => ({ ...current, [stop.id]: { status: "ready", result: placeResult } }));
      } catch {
        if (stale()) return;
        setIntelligence((current) => ({ ...current, [stop.id]: { status: "unavailable", result: null } }));
        return;
      }
    }

    if (cachedFresh?.status === "ready") return;
    if (!aiEnabledRef.current) {
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "paused", result: null } }));
      return;
    }
    setFreshVoices((current) => ({ ...current, [stop.id]: { status: "loading", result: null } }));
    try {
      // One search per ordinary target; only the selected hotel earns a deeper check.
      const result = await requestFreshVoices({
        name: placeResult.place.name,
        area: placeResult.place.address.slice(0, 100) || stop.area,
      }, locale, { intent: "place", depth: "quick", destination: requestDestination });
      if (stale()) return;
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: "ready", result } }));
    } catch (error) {
      if (stale()) return;
      const paused = error instanceof PlaceIntelligenceError && error.code === "not_configured";
      setFreshVoices((current) => ({ ...current, [stop.id]: { status: paused ? "paused" : "unavailable", result: null } }));
    }
  }

  // Google facts are part of the place view, not a user-triggered "check".
  // The build normally preloads them, but a route regroup or provider race can
  // leave a newly selected stop without an entry. Fill that gap on selection;
  // the separate button below remains only for optional public-web recency.
  const selectedStopForEvidence = selectedBuiltStop?.stop ?? null;
  useEffect(() => {
    // The P0 opening-hours budget is consumed during the build. Selecting a
    // pin must not create an invisible second pass beyond that trip cap.
    if (P0_CORE_ONLY) return;
    if (!selectedStopForEvidence) return;
    const cached = intelligenceRef.current[selectedStopForEvidence.id];
    if (cached?.status === "ready" || cached?.status === "loading") return;
    const runId = buildRunRef.current;
    setIntelligence((current) => ({
      ...current,
      [selectedStopForEvidence.id]: { status: "loading", result: null },
    }));
    void requestPlaceIntelligence(selectedStopForEvidence, locale, requestDestination).then((result) => {
      if (buildRunRef.current !== runId) return;
      setIntelligence((current) => ({
        ...current,
        [selectedStopForEvidence.id]: { status: "ready", result },
      }));
    }).catch(() => {
      if (buildRunRef.current !== runId) return;
      setIntelligence((current) => ({
        ...current,
        [selectedStopForEvidence.id]: { status: "unavailable", result: null },
      }));
    });
    // The setters and refs passed from the planner are stable channels the
    // linter can no longer prove stable across the hook boundary; the
    // dependency list stays exactly what it was in TripPlannerApp before the
    // hooks extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, requestDestination, selectedStopForEvidence]);

  return {
    requestBuildFromStart,
    chooseAmbiguousCandidate,
    continueFromResolve,
    confirmManualPlace,
    changeLocale,
    loadDemo,
    reviewWishlistPlaces,
    buildPlan,
    resetTrip,
    cancelBuild,
    checkPlace,
  };
}
