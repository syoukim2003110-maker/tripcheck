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
import { useCallback, useEffect, useRef, useState } from "react";
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
import BeforeYouGoChecklist from "./summary/BeforeYouGoChecklist";
import IssueCard from "./summary/IssueCard";
import ShareDialog from "./dialogs/ShareDialog";
import DayTimeline from "./timeline/DayTimeline";
import ItineraryTimeline from "./timeline/ItineraryTimeline";
import TripMap from "./map/TripMap";
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
import type { Pace } from "../../../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../../../lib/time-feasibility";
import {
  destinationById,
  destinationName,
  type DestinationChoice,
} from "../../../lib/destinations";
import { type ShareableTripInput } from "../../../lib/share-link";
import { buildScopedTripShare, type ShareScope } from "../../../lib/share-scope";
import {
  type AlternativePlan,
} from "../../../lib/feasibility-result";
import type { RouteRecommendationPoint } from "../../../lib/route-recommendations";
import { trackProductEvent, type ProductEventFields, type ProductEventName } from "../../../lib/product-analytics";
import { rotateTripRequestToken } from "../../../lib/trip-request-identity";
import { type AirportCode, type MealPlan, type VisitWindow } from "../../../lib/trip-builder";
import {
  updateWishlistPlaceConstraints,
  type WishlistPlaceConstraintPatch,
} from "../../../lib/wishlist-parser";
import {
  canRedoPlannerHistory,
  canUndoPlannerHistory,
} from "../../../lib/planner-history";
import {
  ui,
  type PlannerLocale,
} from "../../../lib/presentation/planner-copy";
import {
  weekdayInfo,
  safeRemovedStopLabels,
} from "../../../lib/presentation/trip-presentation";
import { recommendationStopId } from "../../../lib/presentation/recommendation-presentation";
import {
  P0_CORE_ONLY,
  P1_TRAVEL_ENRICHMENTS,
  defaultTripDate,
  shouldUseRecommendedHotel,
  type PlannerInputStep,
  type PlannerBuildMode,
  type MobileResultView,
  type PlannerMapScope,
  type Inspector,
  type ManualPlaceDraft,
} from "../../../lib/planner-app-state";
import { mealSlotsAfterStop } from "../../../lib/presentation/timeline-presentation";

export default function TripPlannerShell({ initialLocale = "en", mapsApiKey = "" }: { initialLocale?: PlannerLocale; mapsApiKey?: string }) {
  const [locale, setLocale] = useState<PlannerLocale>(initialLocale);
  // "auto" is the honest default: the first resolved place names the country,
  // so a wishlist works without asking where the trip is before it exists.
  const [destinationChoice, setDestinationChoice] = useState<DestinationChoice>("auto");
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
    buildAnnouncement,
    previewStops,
    setPreviewStops,
    buildProgress,
    buildRunRef,
    placeReviewAbortRef,
    buildPlanRef,
  } = planBuild;
  const [itinerary, setItinerary] = useState("");
  const [inputStep, setInputStep] = useState<PlannerInputStep>("places");
  const [buildMode, setBuildMode] = useState<PlannerBuildMode>("automatic");
  const [mobileResultView, setMobileResultView] = useState<MobileResultView>("timeline");
  const [mapScope, setMapScope] = useState<PlannerMapScope>("day");
  const [tripDays, setTripDays] = useState(3);
  // v1.1 LIVE-P1-03: "how many days" may stay undecided. TripCheck then
  // proposes the deterministic minimum-day answer during the build.
  const [daysUndecided, setDaysUndecided] = useState(false);
  const [tripStartDate, setTripStartDate] = useState(() => defaultTripDate());
  const [tripDateTouched, setTripDateTouched] = useState(false);
  const [hotelQuery, setHotelQuery] = useState("");
  const [pace, setPace] = useState<Pace>("balanced");
  const [mealPlan, setMealPlan] = useState<MealPlan>("all");
  const [arrivalAirport, setArrivalAirport] = useState<AirportCode>("none");
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureAirport, setDepartureAirport] = useState<AirportCode>("none");
  const [departureTime, setDepartureTime] = useState("");
  const [flightKind, setFlightKind] = useState<"international" | "domestic">("international");
  const [printMode, setPrintMode] = useState(false);
  const [manualPlaceDrafts, setManualPlaceDrafts] = useState<Record<number, ManualPlaceDraft>>({});
  const [manualPinTarget, setManualPinTarget] = useState<number | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [inspector, setInspector] = useState<Inspector>(null);
  const [mapFocusedStopId, setMapFocusedStopId] = useState<string | null>(null);
  const [travelPreference, setTravelPreference] = useState<TravelPreference>("auto");
  const [legModeOverrides, setLegModeOverrides] = useState<Record<string, TransportMode>>({});
  const [dayOverrides, setDayOverrides] = useState<Record<string, number>>({});
  const [lockedOrderByDay, setLockedOrderByDay] = useState<Record<number, string[]>>({});
  const [mealSelections, setMealSelections] = useState<Record<string, string>>({});
  const [dayStartDefault, setDayStartDefault] = useState("09:00");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>({ dates: true, hotel: false, airports: false, reservations: false });
  // Once a plan is built it stays available: "back to input" must never force
  // a full (paid, slow) rebuild just to peek at the form again.
  const [planReady, setPlanReady] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [dayEndTarget, setDayEndTarget] = useState("");
  const [transferBufferMinutes, setTransferBufferMinutes] = useState<0 | 10 | 20 | 30>(10);
  const [maxWalkingMinutesPerLeg, setMaxWalkingMinutesPerLeg] = useState<number | null>(null);
  const [maxTransfersPerLeg, setMaxTransfersPerLeg] = useState<number | null>(null);
  const [removedStops, setRemovedStops] = useState<Array<{ id: string; name: string }>>([]);
  const [openingWindowsByDay, setOpeningWindowsByDay] = useState<Record<string, Record<number, VisitWindow[]>>>({});
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
  const [routeGeometryByDay, setRouteGeometryByDay] = useState<Record<string, RouteRecommendationPoint[]>>({});
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [userStayMinutes, setUserStayMinutes] = useState<Record<string, number>>({});
  const [lastEntryTimes, setLastEntryTimes] = useState<Record<string, string>>({});
  const [earlyVisitStopIds, setEarlyVisitStopIds] = useState<string[]>([]);
  const [dayStartTimes, setDayStartTimes] = useState<Record<number, string>>({});
  const [dayEndTimes, setDayEndTimes] = useState<Record<number, string>>({});
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
  });
  const placesInputRef = useRef<HTMLTextAreaElement | null>(null);
  // v1.1 §9.3: on phones the detail panel is a bottom sheet (half height by
  // default, full on request via an explicit button, never drag-only).
  const [inspectorSheetExpanded, setInspectorSheetExpanded] = useState(false);
  const [comparisonAlternative, setComparisonAlternative] = useState<AlternativePlan | null>(null);
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
  }, [inspectorOpen]);

  // An airport that the newly chosen country does not serve is not a plan;
  // clearing it beats silently squeezing the wrong day. While the country is
  // still unknown, every gateway is on offer and nothing is cleared.
  useEffect(() => {
    if (activeDestination.id === "worldwide") return;
    const offered = new Set(activeDestination.airports.map((airport) => airport.code));
    if (arrivalAirport !== "none" && !offered.has(arrivalAirport)) setArrivalAirport("none");
    if (departureAirport !== "none" && !offered.has(departureAirport)) setDepartureAirport("none");
  }, [activeDestination, arrivalAirport, departureAirport]);

  // Until the traveller edits the date themselves, keep it as "tomorrow where
  // the trip happens" — Auckland's tomorrow is not Zurich's.
  useEffect(() => {
    if (tripDateTouched) return;
    setTripStartDate(defaultTripDate(activeDestination));
  }, [activeDestination, tripDateTouched]);

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
  }, [locale]);

  useEffect(() => {
    if (inspector !== null) setHintDismissed(true);
  }, [inspector]);

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
  }, [shareDialogOpen]);

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
  }, [printMode]);

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
    buildRunRef,
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
    setResolvedBase,
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
  }, [hasPlan, inputStep]);
  const autoBumpedDaysRef = useRef(0);
  useEffect(() => {
    if (maxParsedDay <= tripDays || maxParsedDay > 14) return;
    if (autoBumpedDaysRef.current === maxParsedDay) return;
    autoBumpedDaysRef.current = maxParsedDay;
    setTripDays(maxParsedDay);
  }, [maxParsedDay, tripDays]);
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
  }, [routeGeometryKey]);

  useEffect(() => {
    // A newly opened panel always starts at the half-height sheet state.
    setInspectorSheetExpanded(false);
    // v1.1 §15.1: panel opens are funnel signals (no content fields).
    if (inspector?.kind === "hotel") trackProductEvent("hotel_opened", {});
    else if (inspector?.kind === "food") trackProductEvent("meal_opened", {});
    else if (inspector?.kind === "recommendations") trackProductEvent("gap_opened", {});
  }, [inspector]);

  const handleSelectStop = useCallback((stopId: string | null) => {
    setMapFocusedStopId(stopId);
    setInspector(stopId ? { kind: "stop", stopId } : null);
    if (stopId && typeof document !== "undefined") {
      const target = document.querySelector<HTMLElement>(`[data-planner-stop-id="${CSS.escape(stopId)}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

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
  }, [activeDay, hasPlan, plan?.days]);

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
  }, []);

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
        if (state?.status !== "ready") return [(
          <li className={`planner-meal-row is-proposed${state?.status === "unavailable" ? "" : " is-pending"}`} key={`meal-${slot.id}`}>
            <span className="planner-meal-stop">
              <time>{slot.displayTime}</time>
              <span className="planner-meal-dot" aria-hidden="true"><Icon name="fork" size={13} /></span>
              <span className="planner-stop-main">
                <small className="planner-filler-label"><Icon name="spark" size={10} />{locale === "ja" ? "おすすめ枠" : "Recommendation slot"}</small>
                <b>{state?.status === "unavailable"
                  ? slot.kind === "lunch" ? (locale === "ja" ? "昼食候補を取得できませんでした" : "Lunch suggestions did not load") : (locale === "ja" ? "夕食候補を取得できませんでした" : "Dinner suggestions did not load")
                  : slot.kind === "lunch" ? (locale === "ja" ? "動線上の昼食を確認中" : "Checking lunch along the route") : (locale === "ja" ? "帰路の夕食を確認中" : "Checking dinner on the way back")}</b>
                <small>{state?.status === "unavailable"
                  ? state.reason === "quota"
                    ? locale === "ja" ? "候補取得が本日の上限に達しました。旅程はそのまま使えます。時間をおいてお試しください。" : "The suggestion allowance is used up for now. The itinerary still works; try again later."
                    : locale === "ja" ? "旅程はそのまま使えます。あとで再試行できます。" : "The itinerary still works without one. You can retry later."
                  : locale === "ja" ? "営業時間と動線を確認してから候補を表示します。" : "A candidate appears only after its route and hours are checked."}</small>
              </span>
            </span>
            <span className="planner-filler-actions">
              <button disabled={state?.status === "loading"} onClick={() => void findFood(slot, { reveal: true })} type="button">
                {state?.status === "loading" ? (locale === "ja" ? "確認中" : "Checking") : state?.status === "unavailable" ? (locale === "ja" ? "再試行" : "Retry") : (locale === "ja" ? "候補を見る" : "Find options")}
              </button>
            </span>
          </li>
        )];
        const selectedId = mealSelections[slot.id];
        const eligibleCandidates = mealCandidatesBySlot[slot.id] ?? [];
        const candidate = eligibleCandidates.find((entry) => entry.id === selectedId) ?? eligibleCandidates[0];
        if (!candidate) return [];
        if (selectedId && plannedStopIds.has(recommendationStopId(selectedId))) return [];
        const accepted = selectedId === candidate.id;
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
                <small className="planner-filler-label"><Icon name="spark" size={10} />{accepted ? (locale === "ja" ? "旅程に追加済み" : "Added to this day") : (locale === "ja" ? "おすすめ" : "Recommended")}</small>
                <b>{candidate.name}</b>
                <small>{slot.kind === "lunch" ? text.lunchChip : text.dinnerChip} · {slot.window}{candidate.distanceMeters !== null ? ` · ${locale === "ja" ? `動線から約${Math.max(1, Math.round(candidate.distanceMeters / 80))}分` : `~${Math.max(1, Math.round(candidate.distanceMeters / 80))} min from the route`}` : ""}</small>
              </span>
            </button>
            <span className="planner-filler-actions">
              <button onClick={() => toggleMealSelection(slot.id, candidate.id)} type="button">
                {accepted ? (locale === "ja" ? "削除" : "Remove") : (locale === "ja" ? "ここにする" : "Add")}
              </button>
              <button onClick={() => setInspector({ kind: "food", slotId: slot.id, candidateId: candidate.id })} type="button">
                {locale === "ja" ? "他を見る" : "See alternatives"}
              </button>
            </span>
          </li>
        )];
      });
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
      setResolutionOverrides([]);
      setPreviewStops([]);
    }
  }

  function switchDay(index: number) {
    setActiveDay(index);
    setInspector(null);
    setMapFocusedStopId(null);
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
    hotelStyleRef,
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
    selectHotelCandidate,
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
          <a aria-label={locale === "ja" ? "プライバシー方針" : "Privacy policy"} className="planner-privacy" href="/privacy" title={locale === "ja" ? "プライバシー方針" : "Privacy policy"}><i aria-hidden="true"><Icon name="check" size={10} /></i><span>{text.privacy}</span></a>
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
        selectedRouteRecommendationId={selectedRouteRecommendation?.id ?? null}
        tripDateTouched={tripDateTouched}
      >
        {selectedBuiltStop ? (
          <StopInspector
            activeDay={activeDay}
            aiEnabled={aiEnabled}
            day={day}
            lastEntryTimes={lastEntryTimes}
            locale={locale}
            onCheckPlace={checkPlace}
            onClose={() => { setInspector(null); setRouteAlternativesExpanded(false); }}
            onCommitLastEntry={(stopId, value) => {
              const next = { ...lastEntryTimes };
              if (!value) delete next[stopId];
              else next[stopId] = value;
              commitPlannerEdit({ lastEntryTimes: next });
            }}
            onCommitStayMinutes={(stopId, value) => {
              // Only the user's own edits live here; clearing back to auto
              // re-exposes the evidence buffer kept in durationOverrides.
              const next = { ...userStayMinutes };
              if (!value) delete next[stopId];
              else next[stopId] = Number(value);
              commitPlannerEdit({ userStayMinutes: next });
            }}
            onEnsureSourcePreviews={ensureSourcePreviews}
            onMoveStopToDay={moveStopToDay}
            onPhotoError={handlePhotoError}
            onRemoveStop={removeStopFromPlan}
            onToggleSheet={() => setInspectorSheetExpanded((current) => !current)}
            panelRef={inspectorPanelRef}
            plan={plan}
            selectedBuiltStop={selectedBuiltStop}
            selectedCheckLoading={selectedCheckLoading}
            selectedCheckReady={selectedCheckReady}
            selectedCheckRetry={selectedCheckRetry}
            selectedFresh={selectedFresh}
            selectedIntel={selectedIntel}
            selectedStopIndex={selectedStopIndex}
            sheetExpanded={inspectorSheetExpanded}
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
            onToggleSheet={() => setInspectorSheetExpanded((current) => !current)}
            panelRef={inspectorPanelRef}
            plan={plan}
            selectedHotel={selectedHotel}
            sheetExpanded={inspectorSheetExpanded}
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
            mealSelections={mealSelections}
            onClose={() => setInspector(null)}
            onPhotoError={handlePhotoError}
            onToggleMealSelection={toggleMealSelection}
            onToggleSheet={() => setInspectorSheetExpanded((current) => !current)}
            panelRef={inspectorPanelRef}
            sheetExpanded={inspectorSheetExpanded}
          />
        ) : null}

        {inspector?.kind === "recommendations" && inspector.dayIndex === activeDay ? (
          <TripEnhancementPanel
            alternativesExpanded={routeAlternativesExpanded}
            dayLabel={day?.label}
            gap={primaryRecommendationGap}
            locale={locale}
            notice={routeRecommendationNotice}
            onAddCandidate={addRouteRecommendation}
            onClose={() => { setInspector(null); setRouteAlternativesExpanded(false); }}
            onExpandAlternatives={() => setRouteAlternativesExpanded(true)}
            onPhotoError={handlePhotoError}
            onRetry={() => void findRouteRecommendations()}
            onSelectCandidate={selectRouteRecommendation}
            onToggleSheet={() => setInspectorSheetExpanded((current) => !current)}
            panelRef={inspectorPanelRef}
            plannedStopIds={plannedStopIds}
            selectedCandidateId={inspector.candidateId}
            sheetExpanded={inspectorSheetExpanded}
            state={activeRouteRecommendationState}
          />
        ) : null}
      </TripMap>

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
                  setResolutionOverrides([]);
                  setPreviewStops([]);
                  setPlanReady(false);
                }}
                onFormatItinerary={() => {
                  setItinerary(formattedItinerary);
                  setResolutionOverrides([]);
                  setReviewedInputSignature("");
                  setResolvedStops([]);
                  setAmbiguousPlaces([]);
                  setPreviewStops([]);
                }}
                onHotelQueryChange={(value) => { setHotelQuery(value); setPlanReady(false); }}
                onItineraryChange={(value) => {
                  if (!itinerary.trim() && value.trim()) trackMilestone("trip_input_started");
                  setItinerary(value);
                  setStartInputError("");
                  setReviewedInputSignature("");
                  setResolvedStops([]);
                  setAmbiguousPlaces([]);
                  setManualPlaceDrafts({});
                  setResolutionOverrides([]);
                  setPreviewStops([]);
                  setPlanReady(false);
                  clearNightlyHotelResults();
                }}
                onLoadSample={() => loadDemo(destinationById("switzerland"))}
                onRequestBuild={requestBuildFromStart}
                onReviewPlaces={() => void reviewWishlistPlaces()}
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
                flightKind={flightKind}
                hotelQuery={hotelQuery}
                isResolvingPlaces={isResolvingPlaces}
                locale={locale}
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
                onConfirmManualPlace={confirmManualPlace}
                onContinue={continueFromResolve}
                onDepartureAirportChange={setDepartureAirport}
                onDepartureTimeChange={setDepartureTime}
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
              mobileResultView={mobileResultView}
              onEdit={() => { setHasPlan(false); setInputStep("conditions"); setInspector(null); }}
              onMobileResultView={setMobileResultView}
              onPrint={() => setPrintMode(true)}
              onRedo={redoPlannerEdit}
              onShare={() => setShareDialogOpen(true)}
              onUndo={undoPlannerEdit}
              planIssueCount={planIssueCount}
              resultStateCopy={resultStateCopy}
              scheduledStopCount={plan.scheduledStopCount}
              shareCopied={shareCopied}
              shareTriggerRef={shareTriggerRef}
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
                activeDestination={activeDestination}
                comparisonAlternative={comparisonAlternative}
                confirmedRouteFactCount={confirmedRouteFactCount}
                deferredAnchorStops={deferredAnchorStops}
                feasibilityResult={feasibilityResult}
                firstStopArea={mapStops[0]?.area}
                hotelQuery={hotelQuery}
                hotelStateStatus={hotelState.status}
                locale={locale}
                onApplyAlternative={applyTripAlternative}
                onChangeTripDays={changeTripDays}
                onCompare={setComparisonAlternative}
                onReviewConditions={() => { setHasPlan(false); setInputStep("conditions"); setInspector(null); }}
                openingVerificationCount={openingVerificationCount}
                placeWarning={placeWarning}
                plan={plan}
                regionalCoverage={regionalCoverage}
                resultStateCopy={resultStateCopy}
                routeFactCount={routeFactCount}
                tripDays={tripDays}
                tripFit={tripFit}
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

            {planIssueCount > 0 ? (
              <IssueCard
                ambiguousIssuePlaces={ambiguousIssuePlaces}
                conflictingDestinations={conflictingDestinations}
                deferredAnchorStops={deferredAnchorStops}
                locale={locale}
                onChooseCountry={(destinationId) => {
                  setDestinationChoice(destinationId);
                  setDetectedDestinationId(null);
                  trackProductEvent("issue_resolved", { issue_type: "country_conflict" });
                  void buildPlan({ preserveEdits: true });
                }}
                onFixInput={() => { setHasPlan(false); setInputStep("places"); setInspector(null); }}
                onOpenStop={handleSelectStop}
                onPickAmbiguous={() => { setHasPlan(false); setInputStep("conditions"); setInspector(null); }}
                onRetryBuild={() => void buildPlan({ preserveEdits: true })}
                placeWarning={placeWarning}
                plan={plan}
                planIssueCount={planIssueCount}
                unknownHoursStops={unknownHoursStops}
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
                locale={locale}
                mealRowsAfter={P0_CORE_ONLY ? undefined : mealRowsAfter}
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

            <details className="planner-day-settings planner-day-settings-after">
              <summary>{locale === "ja" ? "日程設定と移動データ" : "Day settings and route data"}</summary>
              <div className="planner-day-time-controls">
                <label className="planner-day-start">
                  <span>{text.dayStart}</span>
                  <input
                    onChange={(event) => {
                      const value = event.target.value;
                      const next = { ...dayStartTimes };
                      if (value) next[activeDay] = value;
                      else delete next[activeDay];
                      commitPlannerEdit({ dayStartTimes: next });
                    }}
                    type="time"
                    value={dayStartTimes[activeDay] ?? day.requestedStartTime}
                  />
                </label>
                <label className="planner-day-start">
                  <span>{text.dayEnd}</span>
                  <input
                    onChange={(event) => {
                      const value = event.target.value;
                      const next = { ...dayEndTimes };
                      if (value) next[activeDay] = value;
                      else delete next[activeDay];
                      commitPlannerEdit({ dayEndTimes: next });
                    }}
                    type="time"
                    value={(dayEndTimes[activeDay] ?? dayEndTarget) || "22:00"}
                  />
                </label>
              </div>
              {day.deadlineOverrunMinutes > 0 && day.deadline
                ? <em>{day.deadlineKind === "curfew" ? text.curfewOver(day.deadline) : text.deadlineOver(day.deadline)}</em>
                : <small>{measuredRouteCount > 0 ? text.walkingSafety : text.estimated}</small>}
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
