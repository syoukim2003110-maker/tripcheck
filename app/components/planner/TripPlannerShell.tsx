"use client";

// The planner orchestration shell (refactor spec v2.1 migration map:
// "TripPlannerApp → TripPlannerShell + hooks"). This component owns the
// traveller-authored input state, wires the extracted planner hooks together
// in dependency order and renders the planner surface; every derivation and
// every action lives in the hooks it calls. app/TripPlannerApp.tsx is the
// thin entry point that renders this shell.
// This file is intentionally scanned by the planner-surface contract tests
// (app/**/*.tsx), which pin the lifecycle rotation, hydration and storage
// contracts to the code wherever it lives.
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import Icon from "../../PlannerIcons";
import ErrorState from "./states/ErrorState";
import LoadingState from "./states/LoadingState";
import StartStepper from "./start/StartStepper";
import StartIntro from "./start/StartIntro";
import PlacesStep from "./start/PlacesStep";
import ResolveScreen from "./start/ResolveScreen";
import RecentTrips from "./start/RecentTrips";
import TripPrintSheet from "./summary/TripPrintSheet";
import ResultHeader from "./summary/ResultHeader";
import TripSummaryCard from "./summary/TripSummaryCard";
import VerdictDetails from "./summary/VerdictDetails";
import BeforeYouGoChecklist from "./summary/BeforeYouGoChecklist";
import IssueCard from "./summary/IssueCard";
import ShareDialog from "./dialogs/ShareDialog";
import DayTimeline from "./timeline/DayTimeline";
import ItineraryTimeline from "./timeline/ItineraryTimeline";
import TripMap from "./map/TripMap";
import MobileResultToggle from "./map/MobileResultToggle";
import TripEnhancementPanel from "./recommendation/TripEnhancementPanel";
import StopInspector from "./inspector/StopInspector";
import HotelInspector from "./inspector/HotelInspector";
import MealInspector from "./inspector/MealInspector";
import { useTripEnrichments } from "./hooks/useTripEnrichments";
import { useTripPersistence } from "./hooks/useTripPersistence";
import { usePostBuildLegPrefetching, useTransitEvidence } from "./hooks/useTransitEvidence";
import { useFoodAndGapDiscovery, useFoodAndGaps } from "./hooks/useFoodAndGaps";
import { useHotelActions, useHotels } from "./hooks/useHotels";
import { usePlanBuild, usePlanBuildActions } from "./hooks/usePlanBuild";
import { useDestinationModel, usePlannerViewModel, useStablePlannerContext, useTripDomainModel } from "./hooks/useTripDomainModel";
import { useGuardedPlannerEdits, usePlannerEdits, useRecommendationEdits } from "./hooks/usePlannerEdits";
import {
  destinationById,
  destinationName,
  type DestinationChoice,
} from "../../../lib/destinations";
import { type ShareableTripInput } from "../../../lib/share-link";
import { buildScopedTripShare } from "../../../lib/share-scope";
import type { RouteRecommendationPoint } from "../../../lib/route-recommendations";
import { trackProductEvent, type ProductEventFields, type ProductEventName } from "../../../lib/product-analytics";
import { rotateTripRequestToken } from "../../../lib/trip-request-identity";
import { rebaseResolutionOverrides } from "../../../lib/place-suggestion-client";
import { routeLegKey, type AirportCode } from "../../../lib/trip-builder";
import { tripScopeWarnings } from "../../../lib/trip-scope";
import {
  removeWishlistPlace,
  updateWishlistPlaceConstraints,
  type WishlistPlaceConstraintPatch,
} from "../../../lib/wishlist-parser";
import {
  canRedoPlannerHistory,
  canUndoPlannerHistory,
} from "../../../lib/planner-history";
import {
  bufferDeltaLine,
  travelDeltaLine,
  ui,
  type PlannerLocale,
} from "../../../lib/presentation/planner-copy";
import {
  formatDuration,
  weekdayInfo,
  safeRemovedStopLabels,
} from "../../../lib/presentation/trip-presentation";
import { recommendationStopId } from "../../../lib/presentation/recommendation-presentation";
import { detourWalkingMinutes } from "../../../lib/recommendation-evaluator";
import {
  P0_CORE_ONLY,
  P1_TRAVEL_ENRICHMENTS,
  defaultTripDate,
  shouldUseRecommendedHotel,
  upsertResolutionOverride,
} from "../../../lib/planner-app-state";
import { fillerRowLabel, mealSlotsAfterStop } from "../../../lib/presentation/timeline-presentation";
import { usePlaceSuggestions } from "./hooks/usePlaceSuggestions";
import { usePlanEditState } from "./hooks/usePlanEditState";
import { usePlannerViewState } from "./hooks/usePlannerViewState";
import { useTripRequestState } from "./hooks/useTripRequestState";

export default function TripPlannerShell({ initialLocale = "en", mapsApiKey = "" }: { initialLocale?: PlannerLocale; mapsApiKey?: string }) {
  // The shell used to declare all 53 of its state slices in one block. They
  // are grouped by who reads them: the request the engine plans from, the
  // edits it replans from, and the view state nothing outside the components
  // ever sees. tests/planner-state-boundary.test.ts holds the third group to
  // that promise.
  const {
    locale, setLocale,
    destinationChoice, setDestinationChoice,
    itinerary, setItinerary,
    buildMode, setBuildMode,
    tripDays, setTripDays,
    daysUndecided, setDaysUndecided,
    tripStartDate, setTripStartDate,
    tripDateTouched, setTripDateTouched,
    hotelQuery, setHotelQuery,
    pace, setPace,
    mealPlan, setMealPlan,
    arrivalAirport, setArrivalAirport,
    arrivalTime, setArrivalTime,
    departureAirport, setDepartureAirport,
    departureTime, setDepartureTime,
    flightKind, setFlightKind,
    travelPreference, setTravelPreference,
    dayStartDefault, setDayStartDefault,
    dayEndTarget, setDayEndTarget,
    transferBufferMinutes, setTransferBufferMinutes,
    maxWalkingMinutesPerLeg, setMaxWalkingMinutesPerLeg,
    maxTransfersPerLeg, setMaxTransfersPerLeg,
  } = useTripRequestState(initialLocale);
  const {
    legModeOverrides, setLegModeOverrides,
    dayOverrides, setDayOverrides,
    lockedOrderByDay, setLockedOrderByDay,
    mealSelections, setMealSelections,
    durationOverrides, setDurationOverrides,
    userStayMinutes, setUserStayMinutes,
    lastEntryTimes, setLastEntryTimes,
    earlyVisitStopIds, setEarlyVisitStopIds,
    dayStartTimes, setDayStartTimes,
    dayEndTimes, setDayEndTimes,
    removedStops, setRemovedStops,
    openingWindowsByDay, setOpeningWindowsByDay,
  } = usePlanEditState();
  const {
    inputStep, setInputStep,
    mobileResultView, setMobileResultView,
    mapScope, setMapScope,
    printMode, setPrintMode,
    manualPlaceDrafts, setManualPlaceDrafts,
    manualPinTarget, setManualPinTarget,
    hasPlan, setHasPlan,
    activeDay, setActiveDay,
    inspector, setInspector,
    mapFocusedStopId, setMapFocusedStopId,
    mapHoverChannel,
    shareCopied, setShareCopied,
    shareDialogOpen, setShareDialogOpen,
    shareScope, setShareScope,
    planReady, setPlanReady,
    hintDismissed, setHintDismissed,
    inspectorSheetState, setInspectorSheetState,
    comparisonAlternative, setComparisonAlternative,
    routeGeometryByDay, setRouteGeometryByDay,
  } = usePlannerViewState();
  // Grouping the state into hooks cost this file one lint signal: five effects
  // below set state directly, and react-hooks/set-state-in-effect flagged all
  // five while the setters came from useState in this scope. The rule cannot
  // see through a custom hook's return, so it is silent on them now. The code
  // is unchanged and the sites are: the airport reset and the trip-date reset
  // when the destination changes, the hint dismissal when an inspector opens,
  // the manual-pin reset when the step changes, and the sheet-size reset when
  // the inspector changes. They were already in the accepted lint baseline;
  // they are written down here because the linter no longer writes them down.
  // Place resolution, build lifecycle and per-place evidence state lives in
  // usePlanBuild, called here at the old state block's position — before the
  // planner-context memos that read the resolved stops and base, and before
  // the edit-history hook that receives the resolved base. The pipeline
  // actions join below (usePlanBuildActions) once the derived review rows,
  // input signatures and the later hooks' refs they close over exist.
  const planBuild = usePlanBuild();
  const {
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
    placeWarning,
    setPlaceWarning,
    intelligence,
    freshVoices,
    startInputError,
    setStartInputError,
    mixedCountryCodes,
    buildAnnouncement,
    previewStops,
    setPreviewStops,
    buildProgress,
    manualAddressResolution,
    setManualAddressResolution,
    buildRunRef,
    placeReviewAbortRef,
    buildPlanRef,
  } = planBuild;
  // v1.1 LIVE-P1-03: "how many days" may stay undecided. TripCheck then
  // proposes the deterministic minimum-day answer during the build.
  // Timeline hover/focus → map highlight (spec §7.4). A ref-like channel, not
  // React state: pointer movement across the timeline must not re-render the
  // shell tree, and the map applies the highlight imperatively. Selection
  // stays in React state above and is untouched by this channel.
  // Once a plan is built it stays available: "back to input" must never force
  // a full (paid, slow) rebuild just to peek at the form again.
  // Meal-slot and route-gap search state lives in useFoodAndGaps; the
  // discovery actions join below (useFoodAndGapDiscovery) once the derived
  // plan, slots and search keys they close over exist.
  const {
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
  } = useFoodAndGaps();
  // Hotel shortlist, stay-mode, style and nightly-base state lives in
  // useHotels; the selection/refresh actions join below (useHotelActions)
  // once the derived plan and hotel signature they close over exist.
  const {
    hotelState,
    setHotelState,
    hotelSearchSignature,
    setHotelSearchSignature,
    hotelRefreshing,
    setHotelRefreshing,
    hotelRefreshFailed,
    setHotelRefreshFailed,
    hotelUsesRecommendations,
    setHotelUsesRecommendations,
    hotelStayMode,
    setHotelStayMode,
    hotelStyle,
    setHotelStyle,
    hotelPurpose,
    setHotelPurpose,
    nightlyHotels,
    setNightlyHotels,
    hotelStyleRef,
  } = useHotels();
  // The planner edit history, the hard-edit confirmation and the edit toast
  // live in usePlannerEdits together with the undo/redo core and the
  // Cmd/Ctrl+Z shortcut: unlike the other extracted actions, that core closes
  // over only the input state declared above, so state and actions share one
  // hook called at the old state block's position. The guarded edit actions
  // join below (useGuardedPlannerEdits) once the derived plan and planner
  // context they close over exist.
  const {
    editHistory,
    setEditHistory,
    historyAnnouncement,
    pendingHardEdit,
    setPendingHardEdit,
    editToast,
    setEditToast,
    attachPlannerBase,
    commitPlannerEdit,
    undoPlannerEdit,
    redoPlannerEdit,
    showEditToast,
  } = usePlannerEdits({
    dayEndTimes,
    dayOverrides,
    dayStartTimes,
    hasPlan,
    hotelQuery,
    itinerary,
    lastEntryTimes,
    legModeOverrides,
    locale,
    lockedOrderByDay,
    mealSelections,
    pace,
    planReady,
    removedStops,
    resolutionOverrides,
    resolvedBase,
    resolvedStops,
    setActiveDay,
    setDayEndTimes,
    setDayOverrides,
    setDayStartTimes,
    setHotelQuery,
    setHotelState,
    setInspector,
    setItinerary,
    setLastEntryTimes,
    setLegModeOverrides,
    setLockedOrderByDay,
    setMealSelections,
    setPace,
    setRemovedStops,
    setResolutionOverrides,
    setResolvedBase,
    setResolvedStops,
    setTransferBufferMinutes,
    setTravelPreference,
    setTripDays,
    setUserStayMinutes,
    transferBufferMinutes,
    travelPreference,
    tripDays,
    userStayMinutes,
  });
  const placesInputRef = useRef<HTMLTextAreaElement | null>(null);
  // v1.1 §9.3: on phones the detail panel is a bottom sheet (half height by
  // default, full on request via an explicit button, never drag-only).
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const shareDialogRef = useRef<HTMLElement | null>(null);
  const shareTriggerRef = useRef<HTMLButtonElement | null>(null);
  const analyticsMilestonesRef = useRef<Set<ProductEventName>>(new Set());
  const text = ui[locale];
  // The destination model (active destination, request destination and the
  // combobox options) lives in useDestinationModel, called here at the old
  // activeDestination position — before the airport/date effects below that
  // read the active destination.
  const {
    activeDestination,
    activeEssentials,
    airportComboOptions,
    arrivalAirportDestination,
    departureAirportDestination,
    destinationComboOptions,
    requestDestination,
  } = useDestinationModel({
    arrivalAirport,
    departureAirport,
    destinationChoice,
    detectedDestinationId,
    locale,
  });

  function trackMilestone(event: ProductEventName, fields: ProductEventFields = {}) {
    if (analyticsMilestonesRef.current.has(event)) return;
    analyticsMilestonesRef.current.add(event);
    trackProductEvent(event, fields);
  }

  function resetAnalyticsMilestones() {
    analyticsMilestonesRef.current = new Set();
  }

  const inspectorOpen = Boolean(inspector);

  // The map inspector becomes a bottom sheet on mobile. Treat it as one
  // keyboard-accessible dialog on every viewport: focus enters on open, Escape
  // closes it, Tab stays inside, and focus returns to the invoking control.
  useEffect(() => {
    if (!inspectorOpen) return;
    const active = document.activeElement;
    inspectorTriggerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const frame = window.requestAnimationFrame(() => inspectorPanelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setInspector(null);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = inspectorPanelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      const trigger = inspectorTriggerRef.current;
      window.setTimeout(() => {
        if (trigger?.isConnected) trigger.focus();
      }, 0);
    };
  }, [inspectorOpen, setInspector]);

  // An airport that the newly chosen country does not serve is not a plan;
  // clearing it beats silently squeezing the wrong day. While the country is
  // still unknown, every gateway is on offer and nothing is cleared.
  useEffect(() => {
    if (activeDestination.id === "worldwide") return;
    const offered = new Set(activeDestination.airports.map((airport) => airport.code));
    if (arrivalAirport !== "none" && !offered.has(arrivalAirport)) setArrivalAirport("none");
    if (departureAirport !== "none" && !offered.has(departureAirport)) setDepartureAirport("none");
  }, [activeDestination, arrivalAirport, departureAirport, setArrivalAirport, setDepartureAirport]);

  // Until the traveller edits the date themselves, keep it as "tomorrow where
  // the trip happens" — Auckland's tomorrow is not Zurich's.
  useEffect(() => {
    if (tripDateTouched) return;
    setTripStartDate(defaultTripDate(activeDestination));
  }, [activeDestination, tripDateTouched, setTripStartDate]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.remove("cursor-visible", "motion-ready");
    try { window.localStorage.setItem("tripcheck-locale", locale); } catch { /* optional */ }
  }, [locale]);

  // Applies a self-contained trip code (share link or device-local history)
  // to the form, then a follow-up effect builds it immediately.
  const applySharedTripInput = useCallback((shared: ShareableTripInput) => {
    rotateTripRequestToken();
    analyticsMilestonesRef.current = new Set();
    // Same reasoning as loadDemo: a review racing this hydration must not
    // repopulate resolvedStops after the effect below builds the saved trip.
    placeReviewAbortRef.current?.abort();
    placeReviewAbortRef.current = null;
    setIsResolvingPlaces(false);
    // A saved/share payload contains only stable traveller-authored state.
    // Provider responses from the currently open trip must never satisfy the
    // new payload's review signature, even when its raw itinerary is identical.
    setReviewedInputSignature("");
    setResolvedStops([]);
    setAmbiguousPlaces([]);
    setManualPlaceDrafts({});
    setManualAddressResolution({});
    setManualPinTarget(null);
    setResolvedBase(null);
    setPreviewStops([]);
    setPlaceWarning(false);
    setHasPlan(false);
    setPlanReady(false);
    setInputStep("places");
    setItinerary(shared.itinerary);
    setTripDays(shared.tripDays);
    setDestinationChoice(shared.destination);
    // The restored trip must not inherit the previous session's detected
    // country; an "auto" payload re-detects during the immediate build.
    setDetectedDestinationId(null);
    const sharedDestination = destinationById(shared.destination === "auto" ? "worldwide" : shared.destination);
    setTripStartDate(shared.tripStartDate || defaultTripDate(sharedDestination));
    setTripDateTouched(shared.dateWasProvided);
    setHotelQuery(shared.hotelQuery);
    setHotelUsesRecommendations(shouldUseRecommendedHotel(shared.hotelQuery));
    setPace(shared.pace);
    setMealPlan(P0_CORE_ONLY ? "none" : shared.mealPlan);
    setTravelPreference(shared.travelPreference);
    setArrivalAirport(shared.arrivalAirport as AirportCode);
    setArrivalTime(shared.arrivalTime);
    setDepartureAirport(shared.departureAirport as AirportCode);
    setDepartureTime(shared.departureTime);
    setFlightKind(shared.flightKind);
    setDayStartDefault(shared.dayStartDefault);
    setDayEndTarget(shared.dayEndTarget);
    setTransferBufferMinutes(shared.transferBufferMinutes);
    setMaxWalkingMinutesPerLeg(shared.maxWalkingMinutesPerLeg ?? null);
    setMaxTransfersPerLeg(shared.maxTransfersPerLeg ?? null);
    // Result-screen edits ride along in the link so a companion sees the trip
    // as it was actually adjusted, not the untouched first draft.
    setUserStayMinutes(shared.userStayMinutes);
    setLastEntryTimes(shared.lastEntryTimes);
    setDayStartTimes(Object.fromEntries(
      Object.entries(shared.dayStartTimes).map(([day, clock]) => [Number(day), clock]),
    ));
    setDayEndTimes(Object.fromEntries(
      Object.entries(shared.dayEndTimes).map(([day, clock]) => [Number(day), clock]),
    ));
    setLegModeOverrides(shared.legModeOverrides);
    setDayOverrides(shared.dayOverrides);
    setLockedOrderByDay(Object.fromEntries(Object.entries(shared.lockedOrderByDay ?? {}).map(([day, ids]) => [Number(day), ids])));
    setRemovedStops(safeRemovedStopLabels(shared.removedStops, shared.itinerary, locale));
    setResolutionOverrides(shared.resolutionOverrides ?? []);
    setPendingSharedBuild(true);
    // setPendingSharedBuild is stable, but it is destructured from a hook that
    // runs further down this component, so naming it here would read it in the
    // temporal dead zone. The callback only ever calls it after a render.
  }, [locale, placeReviewAbortRef, setAmbiguousPlaces, setArrivalAirport, setArrivalTime, setDayEndTarget, setDayEndTimes, setDayOverrides, setDayStartDefault, setDayStartTimes, setDepartureAirport, setDepartureTime, setDestinationChoice, setDetectedDestinationId, setFlightKind, setHasPlan, setHotelQuery, setHotelUsesRecommendations, setInputStep, setIsResolvingPlaces, setItinerary, setLastEntryTimes, setLegModeOverrides, setLockedOrderByDay, setManualAddressResolution, setManualPinTarget, setManualPlaceDrafts, setMaxTransfersPerLeg, setMaxWalkingMinutesPerLeg, setMealPlan, setPace, setPlaceWarning, setPlanReady, setPreviewStops, setRemovedStops, setResolutionOverrides, setResolvedBase, setResolvedStops, setReviewedInputSignature, setTransferBufferMinutes, setTravelPreference, setTripDateTouched, setTripDays, setTripStartDate, setUserStayMinutes]);

  useEffect(() => {
    if (inspector !== null) setHintDismissed(true);
  }, [inspector, setHintDismissed]);

  useEffect(() => {
    if (!shareDialogOpen) return;
    const dialog = shareDialogRef.current;
    const returnTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : shareTriggerRef.current;
    if (!dialog) return;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
    const focusFirst = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShareDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("keydown", handleKeyDown);
      returnTarget?.focus();
    };
  }, [shareDialogOpen, setShareDialogOpen]);

  // The stable planner context (nightly bases folded in, live measurements
  // zeroed) and the transit-convergence input key live in
  // useStablePlannerContext, called here at the old nightBases position —
  // they feed the transit-evidence hook below.
  const { plannerContextStable, transitConvergenceInputKey } = useStablePlannerContext({
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
  });
  const {
    liveTransit,
    setLiveTransit,
    prefetchTransit,
    setPrefetchTransit,
    liveTransitAbsent,
    setLiveTransitAbsent,
    prefetchTransitAbsent,
    setPrefetchTransitAbsent,
    prefetchGeometry,
    setPrefetchGeometry,
    prefetchTransitSteps,
    setPrefetchTransitSteps,
    liveTransitTransferCounts,
    setLiveTransitTransferCounts,
    liveWalking,
    setLiveWalking,
    liveDriving,
    setLiveDriving,
    liveRouteEvidence,
    setLiveRouteEvidence,
    transitConvergence,
    setTransitConvergence,
    transitConvergenceRunRef,
    attemptedLegKeysRef,
    postBuildLegBudgetRef,
  } = useTransitEvidence({
    itinerary,
    tripDays,
    pace,
    locale,
    hasPlan,
    isBuilding,
    tripDateTouched,
    plannerContextStable,
    transitConvergenceInputKey,
  });
  // The trip domain model — the active planner contexts, the built plan, its
  // fit/feasibility evidence, the share code and the before-you-go checklist —
  // lives in useTripDomainModel, called here at the old
  // plannerContextWithoutTransit position: after the transit-evidence hook
  // whose live measurements it merges, before the persistence hook (which
  // needs localTripCode/localTripTitle) and the hotel actions hook (which
  // needs activePlannerContext and the current hotel plan signature).
  const {
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
    tripFit,
  } = useTripDomainModel({
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
  });

  const {
    recentTrips,
    tripStorePersistent,
    passportExpiry,
    setPassportExpiry,
    passportCountry,
    setPassportCountry,
    setPendingSharedBuild,
    currentStoredTripIdRef,
    openRecentTrip,
    deleteRecentTrip,
  } = useTripPersistence({
    planReady,
    tripDays,
    tripStartDate,
    localTripCode,
    localTripTitle,
    applySharedTripInput,
    // buildPlan is created by usePlanBuildActions, called after this hook
    // because it closes over the derived plan and the later hooks' refs. The
    // forwarder reads the render-fresh closure from buildPlanRef (written
    // during render by the actions hook), preserving the exact per-render
    // closure semantics the pendingSharedBuild effect relied on when
    // buildPlan was declared inline here.
    buildPlan: (options) => buildPlanRef.current(options),
  });
  const updatePassportExpiry = (value: string) => {
    setPassportExpiry(value);
    try {
      if (value) window.localStorage.setItem("tripcheck.passportExpiry", value);
      else window.localStorage.removeItem("tripcheck.passportExpiry");
    } catch { /* storage unavailable — the check still works for this session */ }
  };

  // The built plan is the authority on which country this trip is in — and a
  // plan with no curated country honestly clears the previous detection
  // instead of leaving another trip's flag on this one.
  useEffect(() => {
    if (plan) setDetectedDestinationId(plan.destination !== "worldwide" ? plan.destination : null);
    // The setter is a stable planner-owned channel the linter can no longer
    // prove stable across the usePlanBuild hook boundary; the dependency list
    // stays exactly what it was before the hooks extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const { weatherByDay, holidaysByDate, aiEnabled, aiEnabledRef, sourcePreviews, ensureSourcePreviews } = useTripEnrichments({ plan, activeDestination });

  // The print sheet renders every day at once, then hands control to the
  // browser's print dialog — the closest thing to "take the plan offline"
  // that needs no account and no network on the road.
  useEffect(() => {
    if (!printMode) return;
    const finish = () => setPrintMode(false);
    window.addEventListener("afterprint", finish);
    const frame = window.requestAnimationFrame(() => window.print());
    return () => {
      window.removeEventListener("afterprint", finish);
      window.cancelAnimationFrame(frame);
    };
  }, [printMode, setPrintMode]);

  // The hotel state lives in useHotels (called above, before the planner
  // context memos its stay mode feeds). The selection/refresh actions close
  // over the derived plan and the current hotel plan signature, so their hook
  // is called here, at the old signature-sync effect's position.
  const {
    hotelRefreshAbortRef,
    hotelAxis,
    hotelPriceLabel,
    hotelAxisLabels,
    selectHotelCandidate,
    refreshHotelRecommendations,
    clearNightlyHotelResults,
    selectNightCandidate,
    applyHotelStyle,
    enableNightlyHotels,
  } = useHotelActions({
    activeDestination,
    activePlannerContext,
    aiEnabledRef,
    attachPlannerBase,
    buildRunRef,
    commitPlannerEdit,
    currentHotelPlanSignature,
    hotelPurpose,
    hotelQuery,
    hotelRefreshing,
    hotelState,
    hotelStayMode,
    hotelStyle,
    hotelStyleRef,
    hotelUsesRecommendations,
    itinerary,
    locale,
    nightlyHotels,
    pace,
    plan,
    planReady,
    postBuildLegBudgetRef,
    requestDestination,
    resolvedBase,
    setHotelPurpose,
    setHotelRefreshFailed,
    setHotelRefreshing,
    setHotelSearchSignature,
    setHotelState,
    setHotelStayMode,
    setHotelStyle,
    setInspector,
    setNightlyHotels,
    setPendingHardEdit,
    showEditToast,
    text,
    tripDays,
  });

  // Every remaining derivation — the active day and its presentation, the
  // map layers and pins, the meal-slot and gap models, the hotel comparison
  // figures, the wishlist review rows, the issue list and the build gates —
  // lives in usePlannerViewModel, called here at the old `day` position:
  // after the persistence hook (preTripItems reads the on-device passport
  // memory) and the hotel actions hook, before the guarded-edit, discovery
  // and pipeline hooks that consume the day slots, review rows and build
  // gates it derives.
  const {
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
    gapDetourPartition,
    gapImpactById,
    gapOverCapIds,
    hardViolationAnnouncement,
    hasRakutenHotelEvidence,
    hotelImpactById,
    hotelPins,
    hotelTravelMinutesById,
    manualPinCoordinate,
    mapDayLayers,
    mapItemKinds,
    mapStops,
    mapWarningStopIds,
    maxParsedDay,
    mealCandidatesBySlot,
    mealDetourBySlot,
    mealImpactBySlot,
    mealRoutePolyline,
    measuredRouteCount,
    openingVerificationCount,
    orderedGapCandidates,
    activeDaySlackMinutes,
    activeDayRemainingFillerAllowance,
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
  } = usePlannerViewModel({
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
  });
  useEffect(() => {
    if (inputStep !== "conditions" || hasPlan) setManualPinTarget(null);
  }, [hasPlan, inputStep, setManualPinTarget]);
  // TC-062: scope warnings when the resolved trip leaves supported territory
  // (border crossing, multiple time zones) or measured transit boardings show
  // a ferry ride. Only boardings the current plan's legs actually consume are
  // scanned, so evidence for an edited-away leg cannot keep a warning alive.
  const scopeWarnings = useMemo(() => {
    if (!plan) return [];
    const boardingSteps = plan.days.flatMap((day) => day.legs.flatMap((leg) => (
      prefetchTransitSteps[routeLegKey(leg.from.id, leg.to.id)]?.steps ?? []
    )));
    return tripScopeWarnings(
      [...resolvedStops, ...(resolvedBase ? [resolvedBase] : [])],
      boardingSteps,
    );
  }, [plan, prefetchTransitSteps, resolvedBase, resolvedStops]);
  const autoBumpedDaysRef = useRef(0);
  useEffect(() => {
    if (maxParsedDay <= tripDays || maxParsedDay > 14) return;
    if (autoBumpedDaysRef.current === maxParsedDay) return;
    autoBumpedDaysRef.current = maxParsedDay;
    setTripDays(maxParsedDay);
  }, [maxParsedDay, tripDays, setTripDays]);
  useEffect(() => {
    if (!planReady || !tripDateTouched || !feasibilityResult || openingVerificationCount > 0 || !currentTransitConvergence) return;
    if (analyticsMilestonesRef.current.has("live_verification_completed")) return;
    analyticsMilestonesRef.current.add("live_verification_completed");
    trackProductEvent("live_verification_completed", {
      verified_count: feasibilityResult.criticalFacts.verified,
      unknown_count: feasibilityResult.criticalFacts.unknown,
      provider_name: "google",
      result_state: feasibilityResult.state,
    });
  }, [currentTransitConvergence, feasibilityResult, openingVerificationCount, planReady, tripDateTouched]);
  const handleRouteGeometry = useCallback((points: RouteRecommendationPoint[]) => {
    if (!routeGeometryKey) return;
    setRouteGeometryByDay((current) => {
      const previous = current[routeGeometryKey] ?? [];
      const same = previous.length === points.length && previous.every((point, index) => (
        point.latitude === points[index]?.latitude && point.longitude === points[index]?.longitude
      ));
      return same ? current : { ...current, [routeGeometryKey]: points };
    });
  }, [routeGeometryKey, setRouteGeometryByDay]);

  useEffect(() => {
    // A newly opened panel always starts at the half-height sheet state.
    setInspectorSheetState("half");
    // v1.1 §15.1: panel opens are funnel signals (no content fields).
    if (inspector?.kind === "hotel") trackProductEvent("hotel_opened", {});
    else if (inspector?.kind === "food") trackProductEvent("meal_opened", {});
    else if (inspector?.kind === "recommendations") trackProductEvent("gap_opened", {});
  }, [inspector, setInspectorSheetState]);

  const handleSelectStop = useCallback((stopId: string | null) => {
    setMapFocusedStopId(stopId);
    setInspector(stopId ? { kind: "stop", stopId } : null);
    if (stopId && typeof document !== "undefined") {
      const target = document.querySelector<HTMLElement>(`[data-planner-stop-id="${CSS.escape(stopId)}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [setInspector, setMapFocusedStopId]);

  const handleTimelineHoverStop = useCallback((stopId: string | null) => {
    mapHoverChannel.set(stopId ? { kind: "stop", stopId } : null);
  }, [mapHoverChannel]);

  const handleTimelineHoverLeg = useCallback((legKey: string | null) => {
    mapHoverChannel.set(legKey ? { kind: "leg", legKey } : null);
  }, [mapHoverChannel]);

  // One scroll container carries Start, Resolve and the result, so a position
  // reached on one screen was still applied to the next: building from a
  // scrolled Start opened the plan already past its headline. Each screen
  // starts at its own beginning.
  useEffect(() => {
    document.querySelector<HTMLElement>(".planner-sheet")?.scrollTo({ top: 0 });
  }, [hasPlan, inputStep]);

  // While the traveller reads the timeline, keep the map centred on the item
  // closest to the rail's visual centre. This changes map focus only; it does
  // not open the inspector or mutate the plan.
  useEffect(() => {
    if (!hasPlan || typeof IntersectionObserver === "undefined") return;
    const root = document.querySelector<HTMLElement>(".planner-sheet");
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-planner-stop-id]"));
    if (!root || rows.length === 0) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.plannerStopId;
        if (!id) continue;
        if (entry.isIntersecting) visible.set(id, entry.intersectionRatio);
        else visible.delete(id);
      }
      const next = [...visible].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
      if (next) setMapFocusedStopId(next);
    }, { root, rootMargin: "-28% 0px -42% 0px", threshold: [0.15, 0.5, 0.85] });
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [activeDay, hasPlan, plan?.days, setMapFocusedStopId]);

  // A photo that 404s must not leave a broken frame (17.4). The node stays in
  // the DOM (hidden) so React's reconciliation is never fighting a manually
  // removed element; the parent class lets CSS show the place-type icon.
  const handlePhotoError = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    image.style.display = "none";
    image.parentElement?.classList.add("is-photo-fallback");
  }, []);

  const handleSelectFoodPin = useCallback((slotId: string, candidateId: string) => {
    setInspector({ kind: "food", slotId, candidateId });
  }, [setInspector]);

  // The transit-convergence loop lives in useTransitEvidence (called above,
  // before the planner-context memos its state feeds). The budgeted post-build
  // leg prefetch depends on the derived `plan` memo, so its hook is called
  // here, at the old effect's position.
  usePostBuildLegPrefetching({
    hasPlan,
    isBuilding,
    plan,
    locale,
    buildRunRef,
    attemptedLegKeysRef,
    postBuildLegBudgetRef,
    setPrefetchTransit,
    setPrefetchTransitAbsent,
    setPrefetchGeometry,
    setPrefetchTransitSteps,
    setLiveWalking,
    setLiveDriving,
  });

  // The edit-history core lives in usePlannerEdits (called above, before the
  // planner-context memos). The guarded edit actions rebuild a candidate plan
  // to check the three protected promises, so they close over the derived
  // `plan`, the active planner context and the hotel actions' nightly reset —
  // their hook is called here, at the old hardEditConflicts position.
  const {
    removeStopFromPlan,
    restoreRemovedStop,
    removeSystemFiller,
    moveStopToDay,
    changeTripDays,
    setLegMode,
    setStayMinutes,
    setLastEntryTime,
    setDayStartTime,
    setDayEndTime,
    applyTripAlternative,
  } = useGuardedPlannerEdits({
    activeDay,
    activePlannerContext,
    clearNightlyHotelResults,
    commitPlannerEdit,
    dayEndTarget,
    dayEndTimes,
    dayOverrides,
    dayStartTimes,
    durationOverrides,
    hasPlan,
    itinerary,
    lastEntryTimes,
    legModeOverrides,
    locale,
    lockedOrderByDay,
    maxParsedDay,
    mealSelections,
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
    setPendingHardEdit,
    setRouteGeometryByDay,
    setRouteRecommendationNotice,
    setRouteRecommendationSearches,
    showEditToast,
    trackMilestone,
    tripDays,
    userStayMinutes,
  });

  // Meal slots interleave with the stop rows by TIME: a slot renders after
  // the last stop the route has reached by the slot's clock, so a 12:45 lunch
  // can never appear below a 15:40 visit. The anchor id only drives the geo
  // query behind the recommendation.
  function mealRowsAfter(stopIndex: number) {
    if (!day) return [];
    // Slot placement is the unit-tested presentation rule - one source of
    // truth, so a placement fix cannot drift from what the timeline renders.
    return mealSlotsAfterStop(daySlots, day.stops, stopIndex)
      .flatMap((slot) => {
        const state = foodSearches[slot.id];
        // v3.1 §2.1 Tier C / §7.4: a slot with nothing in it is not an
        // itinerary item. This used to render as a full proposal box — a
        // dashed card the height of a real stop, holding an apology
        // (「旅程はそのまま使えます。あとで再試行できます。」) and a lone
        // button in an otherwise empty field. The slot itself is real
        // information (the day does have a lunch window here), so the row
        // stays; what goes is the box, the 「おすすめ枠」 eyebrow and the
        // process narration. One line, with its one action beside it.
        // The quota sentence survives, because a real limit and when it
        // lifts is something the traveller can act on.
        if (state?.status !== "ready") {
          const unavailable = state?.status === "unavailable";
          return [(
            <li className={`planner-meal-row is-slot${unavailable ? " is-unavailable" : " is-pending"}`} key={`meal-${slot.id}`}>
              <span className="planner-meal-stop">
                <time>{slot.displayTime}</time>
                <span className="planner-meal-dot" aria-hidden="true"><Icon name="fork" size={13} /></span>
                <span className="planner-stop-main">
                  {/* The Filler label stays (v3.1 §2.3 #1, and product.md's
                      Anchor/Filler rule): a slot TripCheck opened must never
                      look like a place the traveller asked for. What went is
                      the box around it, not the marker — an earlier pass
                      dropped both and took the first viewport's "one safe
                      addition" with it. */}
                  <small className="planner-filler-label"><Icon name="spark" size={10} />{fillerRowLabel(slot.kind, locale)}</small>
                  <b>{unavailable
                    ? locale === "ja" ? "候補を取得できませんでした" : "Suggestions did not load"
                    : locale === "ja" ? "動線上のお店を探します" : "We can look along the route"}</b>
                  {unavailable && state.reason === "quota" ? (
                    <small>{locale === "ja" ? "候補取得が本日の上限に達しました。時間をおいてお試しください。" : "The suggestion allowance is used up for now. Try again later."}</small>
                  ) : null}
                </span>
              </span>
              <span className="planner-filler-actions">
                <button disabled={state?.status === "loading"} onClick={() => void findFood(slot, { reveal: true })} type="button">
                  {state?.status === "loading" ? (locale === "ja" ? "確認中" : "Checking") : unavailable ? (locale === "ja" ? "再試行" : "Retry") : (locale === "ja" ? "候補を見る" : "Find options")}
                </button>
              </span>
            </li>
          )];
        }
        const selectedId = mealSelections[slot.id];
        const eligibleCandidates = mealCandidatesBySlot[slot.id] ?? [];
        // TC-044: the auto-shown lead comes from the detour-capped shortlist
        // (nearest-over-cap fallback included); an explicit user acceptance
        // always keeps its row regardless of the cap.
        const autoLead = mealDetourBySlot[slot.id]?.autoDisplay[0] ?? eligibleCandidates[0];
        const candidate = eligibleCandidates.find((entry) => entry.id === selectedId) ?? autoLead;
        if (!candidate) return [];
        if (selectedId && plannedStopIds.has(recommendationStopId(selectedId))) return [];
        const accepted = selectedId === candidate.id;
        // TC-048: the pre-accept row states what accepting would really do —
        // travel delta and buffer (余裕) delta from the simulated candidate plan.
        const impact = accepted ? null : mealImpactBySlot[slot.id]?.[candidate.id] ?? null;
        // TC-044: the real walking detour (≈80m/min) — also shown for the
        // nearest-over-cap fallback, honesty over emptiness.
        const detourMinutes = detourWalkingMinutes(candidate.distanceMeters);
        return [(
          <li className={`planner-meal-row${accepted ? " is-accepted" : " is-proposed"}`} key={`meal-${slot.id}`}>
            <button
              className="planner-meal-stop"
              onClick={() => setInspector({ kind: "food", slotId: slot.id, candidateId: candidate.id })}
              type="button"
            >
              <time>{slot.displayTime}</time>
              <span className="planner-meal-dot" aria-hidden="true"><Icon name="fork" size={13} /></span>
              <span className="planner-stop-main">
                <small className="planner-filler-label"><Icon name="spark" size={10} />{accepted ? (locale === "ja" ? "旅程に追加済み" : "Added to this day") : text.mealIdeas}</small>
                <b>{candidate.name}</b>
                <small>{slot.kind === "lunch" ? text.lunchChip : text.dinnerChip} · {slot.window}{detourMinutes !== null ? ` · ${text.detourLine(detourMinutes)}` : ""}{impact ? ` · ${travelDeltaLine(impact.travelDeltaMinutes, locale)} · ${bufferDeltaLine(impact.bufferDeltaMinutes, locale)}` : ""}</small>
              </span>
            </button>
            <span className="planner-filler-actions">
              <button onClick={() => toggleMealSelection(slot.id, candidate.id)} type="button">
                {accepted ? (locale === "ja" ? "削除" : "Remove") : text.recoAccept}
              </button>
              <button onClick={() => setInspector({ kind: "food", slotId: slot.id, candidateId: candidate.id })} type="button">
                {text.recoAlternatives}
              </button>
            </span>
          </li>
        )];
      });
  }

  // DoD-PLAN-6: the unaccepted gap suggestion appears IN the timeline at its
  // slot position, styled as a Suggestion like the meal rows. One row per day
  // (the primary gap only — the existing cap), Copy Deck strings, the two
  // TC-048 impact metrics, and the accept goes through the history-integrated
  // addRouteRecommendation (undoable toast).
  //
  // A day offers as many proposals as it has room for, not one. The fit
  // assessment has always been able to say "these places fit in three days,
  // not four"; answering six free hours with a single cafe named the emptiness
  // and did nothing about it. Each row is still its own decision, and each
  // impact is measured against the plan as it stands — accepting one re-solves
  // the day and the rest are re-measured against the result.
  function gapSuggestionRows(): ReactNode[] {
    if (P0_CORE_ONLY || !day || !primaryRecommendationGap) return [];
    if (activeRouteRecommendationState.status !== "ready") return [];
    // TC-047: within-cap candidates lead (nearest fallback when everything is
    // beyond the cap, labeled with its real detour).
    const proposals = gapDetourPartition.autoDisplay
      // An accepted suggestion is a real stop now; its proposal row retires.
      .filter((entry) => !plannedStopIds.has(recommendationStopId(entry.id)))
      .slice(0, Math.max(1, activeDayRemainingFillerAllowance));
    return proposals.map((candidate, proposalIndex) => {
    const impact = gapImpactById[candidate.id] ?? null;
    const detourMinutes = gapOverCapIds.has(candidate.id) ? detourWalkingMinutes(candidate.routeDistanceMeters) : null;
    return (
      <li className="planner-meal-row is-proposed planner-gap-row" key={`gap-${primaryRecommendationGap.id}-${candidate.id}`}>
        <button
          className="planner-meal-stop"
          onClick={() => { setRouteAlternativesExpanded(false); setInspector({ kind: "recommendations", dayIndex: activeDay, candidateId: candidate.id }); }}
          type="button"
        >
          <time>{primaryRecommendationGap.startAt}</time>
          <span className="planner-meal-dot" aria-hidden="true"><Icon name="spark" size={13} /></span>
          <span className="planner-stop-main">
            <small className="planner-filler-label"><Icon name="spark" size={10} />{proposalIndex === 0 ? text.gapRecoLabel(primaryRecommendationGap.availableMinutes) : (locale === "ja" ? "ここも足せます" : "You could also add")}</small>
            <b>{candidate.name}</b>
            <small>{candidate.type}{detourMinutes !== null ? ` · ${text.detourLine(detourMinutes)}` : ""}{impact ? ` · ${travelDeltaLine(impact.travelDeltaMinutes, locale)} · ${bufferDeltaLine(impact.bufferDeltaMinutes, locale)}` : ""}</small>
          </span>
        </button>
        <span className="planner-filler-actions">
          <button onClick={() => addRouteRecommendation(candidate)} type="button">
            {text.recoAccept}
          </button>
          <button onClick={() => { setRouteAlternativesExpanded(true); setInspector({ kind: "recommendations", dayIndex: activeDay }); }} type="button">
            {text.recoAlternatives}
          </button>
        </span>
      </li>
    );
    });
  }

  // The row renders between the stops around the gap: after the stop the gap
  // follows, or (for a before-first-anchor gap) ahead of the first stop.
  function timelineRowsAfter(stopIndex: number) {
    const rows = mealRowsAfter(stopIndex);
    const gap = primaryRecommendationGap;
    if (gap && gap.kind !== "BEFORE_FIRST_ANCHOR" && day?.stops[stopIndex]?.stop.id === gap.previousAnchorId) {
      return [...rows, ...gapSuggestionRows()];
    }
    return rows;
  }

  function currentShareableTripInput(): ShareableTripInput {
    return {
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
    };
  }

  async function copyShareLink() {
    const scoped = buildScopedTripShare(currentShareableTripInput(), shareScope, locale);
    if (!scoped.code || scoped.blocked) return;
    const code = scoped.code;
    const url = `${window.location.origin}${locale === "ja" ? "/ja" : "/"}#t=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      trackMilestone("plan_saved_or_shared", { trip_day_count: tripDays });
      setShareCopied(true);
      setShareDialogOpen(false);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      window.prompt(text.share, url);
    }
  }

  function updateWishlistConstraint(
    placeIndex: number,
    patch: WishlistPlaceConstraintPatch,
    options: { keepReviewedPlaces?: boolean } = {},
  ) {
    const next = updateWishlistPlaceConstraints(itinerary, placeIndex, patch, locale);
    if (next === itinerary) return;
    setItinerary(next);
    setPlanReady(false);
    setComparisonAlternative(null);
    if (options.keepReviewedPlaces) {
      setReviewedInputSignature(JSON.stringify([next.trim(), locale, destinationChoice]));
    } else {
      setReviewedInputSignature("");
      setResolvedStops([]);
      setAmbiguousPlaces([]);
      setManualPlaceDrafts({});
      setManualAddressResolution({});
      setResolutionOverrides([]);
      setPreviewStops([]);
    }
  }

  // v1.1 TC-020: per-row removal on the Resolve list. The textarea stays the
  // single source of truth, so removal rewrites only that place's source line
  // (other lines survive byte-identical) and shifts every occurrence-scoped
  // record so the remaining rows keep their confirmations. Must/booked rows
  // go through the same explicit hard-edit confirmation the resolve flow uses
  // for continuing with an unresolved must — a protected place never vanishes
  // silently.
  function removeResolvePlace(placeIndex: number) {
    const row = reviewedPlaceRows.find((candidate) => candidate.placeIndex === placeIndex);
    if (!row) return;
    const apply = () => {
      const next = removeWishlistPlace(itinerary, placeIndex, locale);
      if (next === itinerary) return;
      setItinerary(next);
      setPlanReady(false);
      setComparisonAlternative(null);
      const shiftIndex = (index: number) => (index > placeIndex ? index - 1 : index);
      setResolvedStops((current) => current.flatMap((stop) => {
        if (stop.inputIndex === undefined) return [stop];
        if (stop.inputIndex === placeIndex) return [];
        return [{ ...stop, inputIndex: shiftIndex(stop.inputIndex) }];
      }));
      setPreviewStops((current) => current.flatMap((stop) => {
        const inputIndex = "inputIndex" in stop && typeof stop.inputIndex === "number" ? stop.inputIndex : undefined;
        if (inputIndex === undefined) return [stop];
        if (inputIndex === placeIndex) return [];
        return [{ ...stop, inputIndex: shiftIndex(inputIndex) }];
      }));
      setResolutionOverrides((current) => current.flatMap((override) => (
        override.inputIndex === placeIndex ? [] : [{ ...override, inputIndex: shiftIndex(override.inputIndex) }]
      )));
      setManualPlaceDrafts((current) => Object.fromEntries(Object.entries(current).flatMap(([key, draft]) => {
        const index = Number(key);
        return index === placeIndex ? [] : [[shiftIndex(index), draft] as const];
      })));
      setManualAddressResolution((current) => Object.fromEntries(Object.entries(current).flatMap(([key, status]) => {
        const index = Number(key);
        return index === placeIndex ? [] : [[shiftIndex(index), status] as const];
      })));
      setManualPinTarget((current) => current === null || current === placeIndex ? null : shiftIndex(current));
      // The remaining rows were already reviewed against the same provider
      // records; moving the review identity with the rewritten text keeps
      // their confirmed/ambiguous statuses instead of relabelling everything.
      setReviewedInputSignature(JSON.stringify([next.trim(), locale, destinationChoice]));
    };
    if (row.place.isReservation || row.place.priority === "must") {
      setPendingHardEdit({
        title: locale === "ja" ? `必須・予約の「${row.place.name}」を外しますか？` : `Remove booked or must-see “${row.place.name}”?`,
        conflicts: [locale === "ja"
          ? `外すと「${row.place.name}」は旅程に入りません。`
          : `“${row.place.name}” will be left out of the plan.`],
        cancelLabel: locale === "ja" ? "外さない" : "Keep it",
        confirmLabel: locale === "ja" ? "外す" : "Remove",
        apply,
      });
      return;
    }
    apply();
  }

  function switchDay(index: number) {
    setActiveDay(index);
    setInspector(null);
    setMapFocusedStopId(null);
    // A card focused via keyboard unmounts without blur on day switch; the
    // stale highlight must not survive onto the next day's map.
    mapHoverChannel.set(null);
  }

  // The meal-slot and route-gap search state lives in useFoodAndGaps (called
  // above, before the derived slot/candidate memos that read it). The
  // discovery actions and their debounce effects close over the derived plan,
  // day slots, gap and search keys, so their hook is called here, at the old
  // findFood position.
  const {
    findFood,
    openFoodSlot,
    findRouteRecommendations,
    openRouteRecommendations,
    selectRouteRecommendation,
    routeRecommendationRequestRef,
  } = useFoodAndGapDiscovery({
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
  });

  // Meal and gap acceptance were deliberately left with the guarded edits
  // until this phase: they rebuild a candidate plan too, but additionally
  // close over the derived day slots, planned-stop ids and the active
  // gap/search state — all computed above — so their hook is called here, at
  // the old addRouteRecommendation position.
  const { toggleMealSelection, addRouteRecommendation } = useRecommendationEdits({
    activeDay,
    activeDestination,
    activePlannerContext,
    activeRouteRecommendationState,
    commitPlannerEdit,
    day,
    dayOverrides,
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
    resolutionOverrides,
    resolvedStops,
    setFoodRecommendationNotice,
    setInspector,
    setRouteAlternativesExpanded,
    setRouteRecommendationNotice,
    showEditToast,
    text,
    tripDays,
    tripFit,
  });

  // The build pipeline state lives in usePlanBuild (called above, before the
  // planner-context memos its resolution state feeds). The pipeline actions
  // close over the derived review rows, the input signatures, the build
  // gates and the refs owned by the transit, hotel, persistence and
  // discovery hooks — all available only here — so their hook is called
  // here, at the old checkPlace position, with the state hook's whole
  // return spread in. It also writes each render's buildPlan into
  // buildPlanRef for the persistence forwarder above.
  const {
    requestBuildFromStart,
    chooseAmbiguousCandidate,
    rejectAmbiguousCandidates,
    continueFromResolve,
    confirmManualPlace,
    changeLocale,
    loadDemo,
    reviewWishlistPlaces,
    buildPlan,
    resetTrip,
    cancelBuild,
    checkPlace,
  } = usePlanBuildActions({
    ...planBuild,
    activeDestination,
    aiEnabledRef,
    arrivalAirport,
    arrivalTime,
    attachPlannerBase,
    attemptedLegKeysRef,
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
    hasPlan,
    hotelQuery,
    hotelRefreshAbortRef,
    itinerary,
    lastEntryTimes,
    legModeOverrides,
    locale,
    lockedOrderByDay,
    manualPlaceDrafts,
    maxTransfersPerLeg,
    maxWalkingMinutesPerLeg,
    mealPlan,
    pace,
    parsedPlaceCount,
    placesHaveBeenReviewed,
    placesInputRef,
    planReady,
    postBuildLegBudgetRef,
    removedStops,
    requestDestination,
    resetAnalyticsMilestones,
    reviewedPlaceRows,
    routeRecommendationRequestRef,
    selectedBuiltStop,
    setActiveDay,
    setArrivalAirport,
    setArrivalTime,
    setBuildMode,
    setComparisonAlternative,
    setDayEndTarget,
    setDayEndTimes,
    setDayOverrides,
    setDayStartDefault,
    setDayStartTimes,
    setDepartureAirport,
    setDepartureTime,
    setDestinationChoice,
    setDurationOverrides,
    setEarlyVisitStopIds,
    setEditHistory,
    setFlightKind,
    setFoodSearches,
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
    setPlanReady,
    setPrefetchGeometry,
    setPrefetchTransit,
    setPrefetchTransitAbsent,
    setPrefetchTransitSteps,
    setRemovedStops,
    setRouteGeometryByDay,
    setRouteRecommendationNotice,
    setRouteRecommendationSearches,
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
  });

  // Autocomplete for the start input. The panel is a leaf component, so the
  // paid lookup is owned here with the rest of the provider calls.
  const { placeSuggestions, requestSuggestionsFor } = usePlaceSuggestions({ locale, destination: destinationChoice });

  return (
    <main className={`trip-planner-app ${isBuilding ? "is-building" : hasPlan ? `is-result is-mobile-${mobileResultView}` : inputStep === "conditions" ? "is-conditions" : "is-places"}`}>
      {printMode && plan ? (
        <TripPrintSheet
          activeEssentials={activeEssentials}
          arrivalAirport={arrivalAirport}
          arrivalTime={arrivalTime}
          beforeYouGo={beforeYouGo}
          departureAirport={departureAirport}
          departureTime={departureTime}
          durationEvidenceByStopId={durationEvidenceByStopId}
          feasibilityResult={feasibilityResult}
          holidaysByDate={holidaysByDate}
          locale={locale}
          plan={plan}
          regionalCoverage={regionalCoverage}
          removedStops={removedStops}
          resultStateCopy={resultStateCopy}
          transferBufferMinutes={transferBufferMinutes}
          tripDateTouched={tripDateTouched}
          tripFit={tripFit}
          tripStartDate={tripStartDate}
          weatherByDay={weatherByDay}
        />
      ) : null}
      <header className="planner-topbar">
        <button className="planner-brand" onClick={resetTrip} type="button" aria-label="TripCheck home">
          <span className="planner-brand-mark" aria-hidden="true"><Icon name="mark" size={19} /></span>
          <b>TripCheck</b><small>{text.brandNote(activeDestination.id === "worldwide" ? "" : destinationName(activeDestination, locale))}</small>
        </button>
        <div className="planner-top-actions">
          <a aria-label={text.privacyTitle} className="planner-privacy" href="/privacy" title={text.privacyTitle}><i aria-hidden="true"><Icon name="check" size={10} /></i><span>{text.privacy}</span></a>
          <div className="planner-language" role="group" aria-label={text.language}>
            <button aria-pressed={locale === "ja"} className={locale === "ja" ? "is-active" : ""} onClick={() => changeLocale("ja")} type="button">日本語</button>
            <button aria-pressed={locale === "en"} className={locale === "en" ? "is-active" : ""} onClick={() => changeLocale("en")} type="button">EN</button>
          </div>
          {hasPlan ? <button className="planner-new-trip" onClick={resetTrip} type="button"><span aria-hidden="true"><Icon name="plus" size={14} /></span>{text.newTrip}</button> : null}
        </div>
      </header>

      <TripMap
        activeDay={activeDay}
        activeDestination={activeDestination}
        activeRouteRecommendationState={activeRouteRecommendationState}
        currentTransitConvergence={currentTransitConvergence}
        day={day}
        dayEndBase={dayEndBase}
        daySlots={daySlots}
        displayedMapBase={displayedMapBase}
        displayedMapStops={displayedMapStops}
        foodPins={foodPins}
        foodSearches={foodSearches}
        hasPlan={hasPlan}
        hotelPins={hotelPins}
        inputStep={inputStep}
        inspector={inspector}
        isBuilding={isBuilding}
        locale={locale}
        manualPinCoordinate={manualPinCoordinate}
        manualPinTarget={manualPinTarget}
        mapDayLayers={mapDayLayers}
        mapFocusedStopId={mapFocusedStopId}
        mapHoverChannel={mapHoverChannel}
        mapItemKinds={mapItemKinds}
        mapScope={mapScope}
        mapWarningStopIds={mapWarningStopIds}
        mapsApiKey={mapsApiKey}
        onChangeMapScope={setMapScope}
        onOpenFoodSlot={openFoodSlot}
        onOpenHotelInspector={() => setInspector({ kind: "hotel" })}
        onOpenRouteRecommendations={openRouteRecommendations}
        onPickCoordinate={(point) => {
          if (manualPinTarget === null) return;
          setManualPlaceDrafts((current) => ({
            ...current,
            [manualPinTarget]: {
              ...(current[manualPinTarget] ?? { address: "", latitude: "", longitude: "" }),
              latitude: point.latitude.toFixed(6),
              longitude: point.longitude.toFixed(6),
            },
          }));
        }}
        onRouteGeometry={handleRouteGeometry}
        onSelectDayStop={(dayIndex, stopId) => {
          setActiveDay(dayIndex);
          handleSelectStop(stopId);
        }}
        onSelectFood={handleSelectFoodPin}
        onSelectHotelCandidate={(candidateId) => {
          const candidate = hotelState.candidates.find((entry) => entry.id === candidateId);
          if (candidate) selectHotelCandidate(candidate);
        }}
        onSelectRecommendation={selectRouteRecommendation}
        onSelectStop={handleSelectStop}
        onSwitchDay={switchDay}
        onToggleHotelInspector={() => setInspector(inspector?.kind === "hotel" ? null : { kind: "hotel" })}
        plan={plan}
        primaryRecommendationGap={primaryRecommendationGap}
        recommendationPins={recommendationPins}
        routeBudgetKey={`${buildRunRef.current}:${transitConvergenceInputKey}`}
        routeDepartureTimes={routeDepartureTimes}
        routeModes={routeModes}
        routeTransitGeometry={routeTransitGeometry}
        selectedHotel={selectedHotel}
        hotelPending={hotelState.status === "loading"}
        hotelUnavailable={hotelState.status === "unavailable"}
        onRetryHotels={() => void refreshHotelRecommendations()}
        selectedRouteRecommendationId={selectedRouteRecommendation?.id ?? null}
        tripDateTouched={tripDateTouched}
      >
        {selectedBuiltStop ? (
          <StopInspector
            activeDay={activeDay}
            aiEnabled={aiEnabled}
            day={day}
            durationStatus={durationEvidenceByStopId[selectedBuiltStop.stop.id] ?? "estimated"}
            lastEntryTimes={lastEntryTimes}
            locale={locale}
            onCheckPlace={checkPlace}
            onClose={() => { setInspector(null); setRouteAlternativesExpanded(false); }}
            onCommitLastEntry={(stopId, value) => setLastEntryTime(stopId, value || null)}
            onCommitStayMinutes={(stopId, value) => setStayMinutes(stopId, value ? Number(value) : null)}
            onEnsureSourcePreviews={ensureSourcePreviews}
            onMoveStopToDay={moveStopToDay}
            onPhotoError={handlePhotoError}
            onRemoveStop={removeStopFromPlan}
            onToggleSheet={() => setInspectorSheetState((current) => current === "full" ? "half" : "full")}
            onToggleSheetPeek={() => setInspectorSheetState((current) => current === "peek" ? "half" : "peek")}
            panelRef={inspectorPanelRef}
            plan={plan}
            selectedBuiltStop={selectedBuiltStop}
            selectedCheckLoading={selectedCheckLoading}
            selectedCheckReady={selectedCheckReady}
            selectedCheckRetry={selectedCheckRetry}
            selectedFresh={selectedFresh}
            selectedIntel={selectedIntel}
            selectedStopIndex={selectedStopIndex}
            sheetState={inspectorSheetState}
            sourcePreviews={sourcePreviews}
            userStayMinutes={userStayMinutes}
          />
        ) : null}

        {inspector?.kind === "hotel" && selectedHotel ? (
          <HotelInspector
            bestHotelTravelMinutes={bestHotelTravelMinutes}
            hasRakutenHotelEvidence={hasRakutenHotelEvidence}
            hotelAxis={hotelAxis}
            hotelAxisLabels={hotelAxisLabels}
            hotelImpactById={hotelImpactById}
            hotelPlanDirty={hotelPlanDirty}
            hotelPriceLabel={hotelPriceLabel}
            hotelPurpose={hotelPurpose}
            hotelRefreshFailed={hotelRefreshFailed}
            hotelRefreshing={hotelRefreshing}
            hotelRouteContext={hotelRouteContext}
            hotelState={hotelState}
            hotelStayMode={hotelStayMode}
            hotelStyle={hotelStyle}
            hotelTravelMinutesById={hotelTravelMinutesById}
            hotelUsesRecommendations={hotelUsesRecommendations}
            locale={locale}
            nightlyHotels={nightlyHotels}
            onApplyHotelStyle={applyHotelStyle}
            onClose={() => setInspector(null)}
            onEnableNightly={() => void enableNightlyHotels()}
            onEnsureSourcePreviews={ensureSourcePreviews}
            onPhotoError={handlePhotoError}
            onRefreshHotels={() => void refreshHotelRecommendations()}
            onSelectHotelCandidate={selectHotelCandidate}
            onSelectNightCandidate={selectNightCandidate}
            onSelectStayModeSingle={() => setHotelStayMode("single")}
            onToggleSheet={() => setInspectorSheetState((current) => current === "full" ? "half" : "full")}
            onToggleSheetPeek={() => setInspectorSheetState((current) => current === "peek" ? "half" : "peek")}
            panelRef={inspectorPanelRef}
            plan={plan}
            selectedHotel={selectedHotel}
            sheetState={inspectorSheetState}
            sourcePreviews={sourcePreviews}
          />
        ) : null}

        {activeFoodSlot && activeFoodState ? (
          <MealInspector
            activeFoodSlot={activeFoodSlot}
            activeFoodState={activeFoodState}
            foodRecommendationNotice={foodRecommendationNotice}
            inspector={inspector}
            locale={locale}
            mealCandidatesBySlot={mealCandidatesBySlot}
            mealDetourBySlot={mealDetourBySlot}
            mealImpactBySlot={mealImpactBySlot}
            mealSelections={mealSelections}
            onClose={() => setInspector(null)}
            onPhotoError={handlePhotoError}
            onToggleMealSelection={toggleMealSelection}
            onToggleSheet={() => setInspectorSheetState((current) => current === "full" ? "half" : "full")}
            onToggleSheetPeek={() => setInspectorSheetState((current) => current === "peek" ? "half" : "peek")}
            panelRef={inspectorPanelRef}
            sheetState={inspectorSheetState}
          />
        ) : null}

        {inspector?.kind === "recommendations" && inspector.dayIndex === activeDay ? (
          <TripEnhancementPanel
            alternativesExpanded={routeAlternativesExpanded}
            dayLabel={day?.label}
            gap={primaryRecommendationGap}
            impactById={gapImpactById}
            locale={locale}
            notice={routeRecommendationNotice}
            onAddCandidate={addRouteRecommendation}
            onClose={() => { setInspector(null); setRouteAlternativesExpanded(false); }}
            onExpandAlternatives={() => setRouteAlternativesExpanded(true)}
            onPhotoError={handlePhotoError}
            onRetry={() => void findRouteRecommendations()}
            onSelectCandidate={selectRouteRecommendation}
            onToggleSheet={() => setInspectorSheetState((current) => current === "full" ? "half" : "full")}
            onToggleSheetPeek={() => setInspectorSheetState((current) => current === "peek" ? "half" : "peek")}
            orderedCandidates={orderedGapCandidates}
            overCapIds={gapOverCapIds}
            panelRef={inspectorPanelRef}
            plannedStopIds={plannedStopIds}
            remainingAllowance={activeDayRemainingFillerAllowance}
            selectedCandidateId={inspector.candidateId}
            sheetState={inspectorSheetState}
            slackMinutes={activeDaySlackMinutes}
            state={activeRouteRecommendationState}
          />
        ) : null}
      </TripMap>

      {/* Outside the sheet on purpose: the switch belongs to the map, and a
          sheet row would spend the first viewport's height on a control. */}
      {hasPlan && plan && day ? (
        <MobileResultToggle locale={locale} onChange={setMobileResultView} view={mobileResultView} />
      ) : null}

      <section className="planner-sheet">
        {isBuilding ? (
          <LoadingState
            activeIndex={activeBuildIndex}
            aiEnabled={aiEnabled}
            detail={activeBuildDetail}
            locale={locale}
            onCancel={cancelBuild}
            stages={visibleBuildStages}
          />
        ) : !hasPlan ? (
          <div className="planner-form-view">
            {/* v3.1 §6.1 asks the first screen to be understandable in five
                seconds, and the handoff's own Start mock carries no step rail.
                Hiding it here was tried and reverted: the mock also has no
                place-resolution step, so it is weak evidence that the rail is
                noise — and the rail is what tells a first-time visitor the flow
                is short. `tests/rendered-html.test.mjs` pins it, correctly. */}
            <StartStepper buildMode={buildMode} inputStep={inputStep} locale={locale} onStepSelect={setInputStep} />

            <StartIntro
              ambiguousReviewedCount={ambiguousReviewedCount}
              confirmedReviewedCount={confirmedReviewedCount}
              inputStep={inputStep}
              locale={locale}
              reviewedPlaceCount={reviewedPlaceRows.length}
              unresolvedReviewedCount={unresolvedReviewedCount}
            />

            {inputStep === "places" ? (
              <PlacesStep
                buildMode={buildMode}
                canNormalizeItinerary={canNormalizeItinerary}
                canReviewPlaces={canReviewPlaces}
                dayStartDefault={dayStartDefault}
                daysUndecided={daysUndecided}
                destinationChoice={destinationChoice}
                destinationComboOptions={destinationComboOptions}
                hotelQuery={hotelQuery}
                isBuilding={isBuilding}
                isResolvingPlaces={isResolvingPlaces}
                itinerary={itinerary}
                locale={locale}
                onDaysUndecided={() => setDaysUndecided(true)}
                onDestinationChange={(value) => {
                  const next = value as DestinationChoice;
                  setDestinationChoice(next);
                  if (next !== "auto") setDetectedDestinationId(null);
                  setReviewedInputSignature("");
                  setResolvedStops([]);
                  setAmbiguousPlaces([]);
                  setManualPlaceDrafts({});
                  setManualAddressResolution({});
                  setResolutionOverrides([]);
                  setPreviewStops([]);
                  setPlanReady(false);
                }}
                onFormatItinerary={() => {
                  setResolutionOverrides((current) => rebaseResolutionOverrides(itinerary, formattedItinerary, current));
                  setItinerary(formattedItinerary);
                  setReviewedInputSignature("");
                  setResolvedStops([]);
                  setAmbiguousPlaces([]);
                  setPreviewStops([]);
                }}
                onHotelQueryChange={(value) => { setHotelQuery(value); setPlanReady(false); }}
                onItineraryChange={(value) => {
                  if (!itinerary.trim() && value.trim()) trackMilestone("trip_input_started");
                  setResolutionOverrides((current) => rebaseResolutionOverrides(itinerary, value, current));
                  setItinerary(value);
                  setStartInputError("");
                  setReviewedInputSignature("");
                  setResolvedStops([]);
                  setAmbiguousPlaces([]);
                  setManualPlaceDrafts({});
                  setManualAddressResolution({});
                  setPreviewStops([]);
                  setPlanReady(false);
                  clearNightlyHotelResults();
                }}
                onLoadSample={() => loadDemo(destinationById("switzerland"))}
                onRequestBuild={requestBuildFromStart}
                onReviewPlaces={() => void reviewWishlistPlaces()}
                onActivePlaceChange={requestSuggestionsFor}
                onSelectPlaceCandidate={(inputIndex, providerRef) => {
                  setResolutionOverrides((current) => upsertResolutionOverride(current, { inputIndex, providerRef }));
                  setReviewedInputSignature("");
                  setResolvedStops([]);
                  setAmbiguousPlaces([]);
                  setPreviewStops([]);
                  setPlanReady(false);
                }}
                onSelectDayStart={setDayStartDefault}
                onSelectDays={(value) => { setDaysUndecided(false); changeTripDays(value); }}
                onSelectPace={setPace}
                onSelectTravelPreference={setTravelPreference}
                onToggleBuildMode={() => setBuildMode(buildMode === "custom" ? "automatic" : "custom")}
                onTripDateChange={(value) => { setTripStartDate(value); setTripDateTouched(true); }}
                onTripDateUndecided={() => setTripDateTouched(false)}
                onUpdateConstraint={updateWishlistConstraint}
                pace={pace}
                parsePreviewRows={parsePreviewRows}
                parsedPlaceCount={parsedPlaceCount}
                placeWarning={placeWarning}
                placesInputRef={placesInputRef}
                placeSuggestions={placeSuggestions}
                resolutionOverrides={resolutionOverrides}
                startInputError={startInputError}
                travelPreference={travelPreference}
                tripDateTouched={tripDateTouched}
                tripDays={tripDays}
                tripStartDate={tripStartDate}
              />
            ) : (
              <ResolveScreen
                airportComboOptions={airportComboOptions}
                ambiguousReviewedCount={ambiguousReviewedCount}
                arrivalAirport={arrivalAirport}
                arrivalAirportDestination={arrivalAirportDestination}
                arrivalTime={arrivalTime}
                canBuild={canBuild}
                confirmedReviewedCount={confirmedReviewedCount}
                dayEndTarget={dayEndTarget}
                dayStartDefault={dayStartDefault}
                departureAirport={departureAirport}
                departureAirportDestination={departureAirportDestination}
                departureTime={departureTime}
                destinationChoice={destinationChoice}
                destinationComboOptions={destinationComboOptions}
                mixedCountryCodes={mixedCountryCodes}
                flightKind={flightKind}
                hotelQuery={hotelQuery}
                isResolvingPlaces={isResolvingPlaces}
                locale={locale}
                manualAddressResolution={manualAddressResolution}
                manualPinCoordinate={manualPinCoordinate}
                manualPinTarget={manualPinTarget}
                manualPlaceDrafts={manualPlaceDrafts}
                maxTransfersPerLeg={maxTransfersPerLeg}
                maxWalkingMinutesPerLeg={maxWalkingMinutesPerLeg}
                onArrivalAirportChange={setArrivalAirport}
                onArrivalTimeChange={setArrivalTime}
                onChangeMaxTransfers={setMaxTransfersPerLeg}
                onChangeMaxWalking={setMaxWalkingMinutesPerLeg}
                onChangeTripDays={changeTripDays}
                onChooseCandidate={chooseAmbiguousCandidate}
                onRejectCandidates={rejectAmbiguousCandidates}
                onConfirmManualPlace={confirmManualPlace}
                onContinue={continueFromResolve}
                onDepartureAirportChange={setDepartureAirport}
                onDepartureTimeChange={setDepartureTime}
                onDestinationChange={(value) => {
                  const next = value as DestinationChoice;
                  setDestinationChoice(next);
                  setDetectedDestinationId(null);
                  setResolutionOverrides([]);
                  void reviewWishlistPlaces({ destinationOverride: next });
                }}
                onEditInput={() => { setManualPinTarget(null); setInputStep("places"); }}
                onEditPlaceName={() => { setManualPinTarget(null); setInputStep("places"); requestAnimationFrame(() => placesInputRef.current?.focus()); }}
                onHotelQueryChange={(value) => {
                  setHotelQuery(value);
                  setPlanReady(false);
                }}
                onManualDraftChange={(placeIndex, field, value) => setManualPlaceDrafts((current) => ({
                  ...current,
                  [placeIndex]: { ...(current[placeIndex] ?? { address: "", latitude: "", longitude: "" }), [field]: value },
                }))}
                onRemovePlace={removeResolvePlace}
                onSearchAgain={() => void reviewWishlistPlaces()}
                onSelectDayEnd={setDayEndTarget}
                onSelectDayStart={setDayStartDefault}
                onSelectFlightKind={setFlightKind}
                onSelectPace={setPace}
                onSelectTransferBuffer={setTransferBufferMinutes}
                onSelectTravelPreference={setTravelPreference}
                onToggleManualPin={(placeIndex) => setManualPinTarget((current) => current === placeIndex ? null : placeIndex)}
                onTripDateChange={(value) => { setTripStartDate(value); setTripDateTouched(true); }}
                onTripDateUndecided={() => setTripDateTouched(false)}
                onUpdateConstraint={(placeIndex, patch) => updateWishlistConstraint(placeIndex, patch, { keepReviewedPlaces: true })}
                onUseArrivalOption={(airportCode, time) => { setArrivalAirport(airportCode); setArrivalTime(time); }}
                onUseDepartureOption={(airportCode, time) => { setDepartureAirport(airportCode); setDepartureTime(time); }}
                pace={pace}
                resolveAttentionRanks={resolveAttentionRanks}
                resolvedStops={resolvedStops}
                reviewedPlaceRows={reviewedPlaceRows}
                transferBufferMinutes={transferBufferMinutes}
                travelPreference={travelPreference}
                tripDateTouched={tripDateTouched}
                tripDays={tripDays}
                tripStartDate={tripStartDate}
                unresolvedReviewedCount={unresolvedReviewedCount}
              />
            )}
            <RecentTrips
              isBuilding={isBuilding}
              locale={locale}
              onDeleteTrip={(entry) => void deleteRecentTrip(entry)}
              onOpenTrip={(entry) => void openRecentTrip(entry)}
              onReturnToPlan={() => setHasPlan(true)}
              planReady={planReady}
              recentTrips={recentTrips}
              tripStorePersistent={tripStorePersistent}
            />
          </div>
        ) : plan && day ? (
          <div className="planner-result-view">
            <ResultHeader
              canRedo={canRedoPlannerHistory(editHistory)}
              canUndo={canUndoPlannerHistory(editHistory)}
              dayTheme={day.theme}
              deferredAnchorCount={deferredAnchorStops.length}
              feasibilityResult={feasibilityResult}
              locale={locale}
              onEdit={() => { setHasPlan(false); setInputStep("conditions"); setInspector(null); }}
              onPrint={() => setPrintMode(true)}
              onRedo={redoPlannerEdit}
              onShare={() => setShareDialogOpen(true)}
              onUndo={undoPlannerEdit}
              resultStateCopy={resultStateCopy}
              scheduledStopCount={plan.scheduledStopCount}
              shareCopied={shareCopied}
              shareTriggerRef={shareTriggerRef}
              tripStats={tripStats}
            />
            <p aria-atomic="true" aria-live="polite" className="sr-only">{historyAnnouncement}</p>
            {shareDialogOpen ? (
              <ShareDialog
                dialogRef={shareDialogRef}
                locale={locale}
                onClose={() => setShareDialogOpen(false)}
                onCopy={() => void copyShareLink()}
                onScopeChange={(key, checked) => setShareScope((current) => ({ ...current, [key]: checked }))}
                preview={buildScopedTripShare(currentShareableTripInput(), shareScope, locale)}
                shareScope={shareScope}
              />
            ) : null}

            {feasibilityResult ? (
              <TripSummaryCard
                deferredAnchorStops={deferredAnchorStops}
                feasibilityResult={feasibilityResult}
                locale={locale}
                onReviewConditions={() => { setHasPlan(false); setInputStep("conditions"); setInspector(null); }}
                regionalCoverage={regionalCoverage}
                resultStateCopy={resultStateCopy}
                scopeWarnings={scopeWarnings}
              />
            ) : null}

            {P1_TRAVEL_ENRICHMENTS && beforeYouGo && (beforeYouGo.reservations.length > 0 || beforeYouGo.watchlist.length > 0 || activeEssentials || preTripItems.length > 0) ? (
              <BeforeYouGoChecklist
                activeDestination={activeDestination}
                activeEssentials={activeEssentials}
                beforeYouGo={beforeYouGo}
                locale={locale}
                onPassportCountryChange={setPassportCountry}
                onPassportExpiryChange={updatePassportExpiry}
                passportCountry={passportCountry}
                passportExpiry={passportExpiry}
                preTripItems={preTripItems}
              />
            ) : null}

            <ItineraryTimeline
              activeDay={activeDay}
              locale={locale}
              onSwitchDay={switchDay}
              plan={plan}
              tripDateTouched={tripDateTouched}
            >
              <DayTimeline
                day={day}
                dayTravelTotal={dayTravelTotal}
                durationEvidenceByStopId={durationEvidenceByStopId}
                fillerKindsByStopId={fillerKindsByStopId}
                fillerStopIds={fillerStopIds}
                fitDay={activeFitDay}
                holiday={tripDateTouched && day.date ? holidaysByDate[day.date] : undefined}
                leadingRows={!P0_CORE_ONLY && primaryRecommendationGap?.kind === "BEFORE_FIRST_ANCHOR" ? gapSuggestionRows() : null}
                locale={locale}
                mealRowsAfter={P0_CORE_ONLY ? undefined : timelineRowsAfter}
                onHoverLeg={handleTimelineHoverLeg}
                onHoverStop={handleTimelineHoverStop}
                onOpenHotel={() => setInspector({ kind: "hotel" })}
                onRemoveFiller={removeSystemFiller}
                onSelectStop={(stopId, isSelected) => {
                  setMapFocusedStopId(stopId);
                  setInspector(isSelected ? null : { kind: "stop", stopId });
                }}
                onSetLegMode={setLegMode}
                prefetchTransitSteps={prefetchTransitSteps}
                presentation={activeDayPresentation}
                selectedStopId={inspector?.kind === "stop" ? inspector.stopId : null}
                showHotelDepartLeg={Boolean(base)}
                showHotelReturnLeg={Boolean(dayEndBase)}
                showSundayClosingNote={Boolean(tripDateTouched && day.date && activeDestination.sundayClosing && weekdayInfo(day.date, locale)?.isSunday && !holidaysByDate[day.date])}
                showTonightHotel={hotelStayMode === "nightly"}
                travelPreference={travelPreference}
                tripDateTouched={tripDateTouched}
                weather={weatherByDay[activeDay]}
                weekdayLabel={day.date ? weekdayInfo(day.date, locale)?.label ?? null : null}
              />
            </ItineraryTimeline>

            {/* Planner first, report second: the things to check sit under the
                itinerary they are about. Above it, the card was 123px of the
                first viewport restating a count the headline already gives. */}
            {planIssueCount > 0 ? (
              <IssueCard
                ambiguousIssuePlaces={ambiguousIssuePlaces}
                computationLimited={feasibilityResult?.unknownCause === "COMPUTATION_LIMIT"}
                conflictingDestinations={conflictingDestinations}
                deferredAnchorStops={deferredAnchorStops}
                hotelUnavailable={hotelState.status === "unavailable"}
                locale={locale}
                onChooseCountry={(destinationId) => {
                  setDestinationChoice(destinationId);
                  setDetectedDestinationId(null);
                  setResolutionOverrides([]);
                  trackProductEvent("issue_resolved", { issue_type: "country_conflict" });
                  void buildPlan({ preserveEdits: true, destinationOverride: destinationId });
                }}
                onFixInput={() => { setHasPlan(false); setInputStep("places"); setInspector(null); }}
                onOpenStop={handleSelectStop}
                onPickAmbiguous={() => { setHasPlan(false); setInputStep("conditions"); setInspector(null); }}
                onRetryBuild={() => void buildPlan({ preserveEdits: true })}
                onRetryHotels={() => void refreshHotelRecommendations()}
                placeWarning={placeWarning}
                plan={plan}
                planIssueCount={planIssueCount}
                unknownHoursStops={unknownHoursStops}
              />
            ) : null}

            {feasibilityResult ? (
              <VerdictDetails
                activeDestination={activeDestination}
                comparisonAlternative={comparisonAlternative}
                confirmedRouteFactCount={confirmedRouteFactCount}
                feasibilityResult={feasibilityResult}
                firstStopArea={mapStops[0]?.area}
                hotelQuery={hotelQuery}
                hotelStateStatus={hotelState.status}
                locale={locale}
                onApplyAlternative={applyTripAlternative}
                onChangeTripDays={changeTripDays}
                onCompare={setComparisonAlternative}
                openingVerificationCount={openingVerificationCount}
                placeWarning={placeWarning}
                plan={plan}
                regionalCoverage={regionalCoverage}
                routeFactCount={routeFactCount}
                tripDays={tripDays}
                tripFit={tripFit}
              />
            ) : null}

            <details className="planner-day-settings planner-day-settings-after">
              <summary>{locale === "ja" ? "日程設定と移動データ" : "Day settings and route data"}</summary>
              {/* TC-032: the clock range and the planned/available/travel
                  totals relocated here from the day header, still read from
                  the DayPresentation single source. An invalid day withholds
                  them exactly like the header does. */}
              {activeDayPresentation && activeDayPresentation.consistency === "valid" ? (
                <div aria-label={text.dayBreakdownLabel} className="planner-day-window-facts" role="group">
                  <span><small>{text.dayWindowLabel}</small><b>{activeDayPresentation.startClock}—{activeDayPresentation.endClock}</b></span>
                  <span><small>{text.dayPlannedLabel}</small><b>{formatDuration(activeDayPresentation.usedMinutes, locale)}</b></span>
                  {activeDayPresentation.availableMinutes > 0
                    ? <span><small>{text.dayAvailableLabel}</small><b>{formatDuration(activeDayPresentation.availableMinutes, locale)}</b></span>
                    : null}
                  <span><small>{text.dayTravelLabel}</small><b>{formatDuration(activeDayPresentation.travelMinutes, locale)}</b></span>
                </div>
              ) : null}
              <div className="planner-day-time-controls">
                <label className="planner-day-start">
                  <span>{text.dayStart}</span>
                  <input
                    onChange={(event) => setDayStartTime(activeDay, event.target.value || null)}
                    type="time"
                    value={dayStartTimes[activeDay] ?? day.requestedStartTime}
                  />
                </label>
                <label className="planner-day-start">
                  <span>{text.dayEnd}</span>
                  <input
                    onChange={(event) => setDayEndTime(activeDay, event.target.value || null)}
                    type="time"
                    value={(dayEndTimes[activeDay] ?? dayEndTarget) || "22:00"}
                  />
                </label>
              </div>
              {day.deadlineOverrunMinutes > 0 && day.deadline
                ? <em>{day.deadlineKind === "curfew" ? text.curfewOver(day.deadline) : text.deadlineOver(day.deadline)}</em>
                : <small>{measuredRouteCount > 0
                  ? text.walkingSafety
                  // Copy Deck data.estimated is the visible headline; the
                  // provider mechanics stay as secondary text below it.
                  : <>{text.estimated}<span className="planner-estimate-detail">{text.estimatedDetail}</span></>}</small>}
            </details>

            {!hintDismissed ? <p className="planner-select-hint">{text.selectHint}</p> : null}

            {removedStops.length > 0 ? (
              <details className="planner-unknown planner-removed" open>
                <summary>{text.removedHeading} · {removedStops.length}</summary>
                <ul>
                  {removedStops.map((entry) => (
                    <li key={entry.id}>
                      {entry.name}
                      <button onClick={() => restoreRemovedStop(entry.id)} type="button">{text.restoreStop}</button>
                    </li>
                  ))}
                </ul>
                {hotelUsesRecommendations && hotelStayMode === "single" && hotelPlanDirty ? (
                  <div className="planner-removed-refresh">
                    <p>{text.hotelRefreshHint}</p>
                    <button className="planner-hotel-refresh" disabled={hotelRefreshing} onClick={() => void refreshHotelRecommendations()} type="button">
                      <Icon name="search" size={13} />
                      {hotelRefreshing ? text.hotelRefreshing : text.hotelRefreshChanged}
                    </button>
                    {hotelRefreshFailed ? <small role="status">{text.hotelRefreshFailed}</small> : null}
                  </div>
                ) : null}
              </details>
            ) : null}

            {plan.unknownEntries.length > 0 ? (
              <details className="planner-unknown">
                <summary>{text.unknown} · {plan.unknownEntries.length}</summary>
                <ul>{plan.unknownEntries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              </details>
            ) : null}
          </div>
        ) : (
          <ErrorState locale={locale} onEdit={() => setHasPlan(false)} unknownEntries={plan?.unknownEntries ?? []} />
        )}
      </section>
      {editToast ? (
        <div className="planner-edit-toast" role="status">
          <span>{editToast.message}{editToast.detail ? <small>{editToast.detail}</small> : null}</span>
          <button onClick={() => { setEditToast(null); undoPlannerEdit(); }} type="button">{locale === "ja" ? "元に戻す" : "Undo"}</button>
        </div>
      ) : null}
      <div className="sr-only">
        <p aria-atomic="true" aria-live="polite">{buildAnnouncement}</p>
        <p aria-atomic="true" aria-live="assertive">{hardViolationAnnouncement}</p>
      </div>
      {pendingHardEdit ? (
        <div className="planner-share-backdrop planner-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingHardEdit(null); }}>
          <section aria-describedby="planner-confirm-conflicts" aria-labelledby="planner-confirm-title" aria-modal="true" className="planner-confirm-dialog" role="alertdialog">
            <h2 id="planner-confirm-title">{pendingHardEdit.title}</h2>
            <ul id="planner-confirm-conflicts">
              {pendingHardEdit.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
            </ul>
            <footer>
              <button autoFocus onClick={() => setPendingHardEdit(null)} type="button">{pendingHardEdit.cancelLabel ?? (locale === "ja" ? "変更しない" : "Keep current plan")}</button>
              <button
                className="is-apply"
                onClick={() => {
                  const { apply } = pendingHardEdit;
                  setPendingHardEdit(null);
                  apply();
                }}
                type="button"
              >{pendingHardEdit.confirmLabel ?? (locale === "ja" ? "それでも変更" : "Change anyway")}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
