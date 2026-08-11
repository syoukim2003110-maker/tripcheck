"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type FoodPin,
  type HotelPin,
  type PlannerMapDayLayer,
  type RecommendationPin,
} from "./PlannerGoogleMap";
import PlannerDayTimeBar from "./PlannerDayTimeBar";
import Icon, { type IconName } from "./PlannerIcons";
import { type SearchableOption } from "./SearchableCombobox";
import { feasibilityStateIcon, modeIcon, weatherIconByKind } from "./components/planner/icon-maps";
import ErrorState from "./components/planner/states/ErrorState";
import LoadingState from "./components/planner/states/LoadingState";
import StartStepper from "./components/planner/start/StartStepper";
import StartIntro from "./components/planner/start/StartIntro";
import PlacesStep from "./components/planner/start/PlacesStep";
import ResolveScreen from "./components/planner/start/ResolveScreen";
import RecentTrips from "./components/planner/start/RecentTrips";
import TripPrintSheet from "./components/planner/summary/TripPrintSheet";
import ResultHeader from "./components/planner/summary/ResultHeader";
import TripSummaryCard from "./components/planner/summary/TripSummaryCard";
import BeforeYouGoChecklist from "./components/planner/summary/BeforeYouGoChecklist";
import IssueCard from "./components/planner/summary/IssueCard";
import ShareDialog from "./components/planner/dialogs/ShareDialog";
import DayTimeline from "./components/planner/timeline/DayTimeline";
import ItineraryTimeline from "./components/planner/timeline/ItineraryTimeline";
import TripMap from "./components/planner/map/TripMap";
import TripEnhancementPanel from "./components/planner/recommendation/TripEnhancementPanel";
import StopInspector from "./components/planner/inspector/StopInspector";
import HotelInspector from "./components/planner/inspector/HotelInspector";
import MealInspector from "./components/planner/inspector/MealInspector";
import { useTripEnrichments } from "./components/planner/hooks/useTripEnrichments";
import { useTripPersistence } from "./components/planner/hooks/useTripPersistence";
import { usePostBuildLegPrefetching, useTransitEvidence } from "./components/planner/hooks/useTransitEvidence";
import {
  FoodRecommendationsError,
  foodCandidateReason,
  foodRecommendationRequestKey,
  requestFoodRecommendations,
  requestFoodRanking,
} from "../lib/food-recommendations-client";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "../lib/google-food";
import { bayesianWeightedRating, restaurantRatingPrior } from "../lib/rating-confidence";
import { requestHotelRecommendations, requestHotelRanking } from "../lib/hotel-recommendations-client";
import { placeTypesIncludeLodging, type HotelCandidate, type HotelPriceLevel } from "../lib/google-hotels";
import { fullTripDemo } from "../lib/mock-trip";
import { requestFreshVoices, requestPlaceIntelligence, PlaceIntelligenceError } from "../lib/place-intelligence-client";
import type { FreshVoicesResult } from "../lib/fresh-voices";
import type { PlaceIntelligenceResult } from "../lib/place-intelligence";
import { googleCurrentOpeningWindowsForDate, googleOpeningWindowsForDate } from "../lib/google-opening-hours";
import { areaFromAddress } from "../lib/google-place-resolver";
import { deriveStopPlanningEvidence } from "../lib/planning-evidence";
import {
  buildSelectedTransitLegRequests,
  type PlanningTransitLegRequest,
} from "../lib/planning-live-routes-client";
import { PlaceResolutionError, placeReviewInputSignature, placeReviewStatus, requestPlaceResolution, type AmbiguousPlaceResolution } from "../lib/place-resolution-client";
import { PLANNING_BUDGET, takeWithinPlanningBudget } from "../lib/planning-budget";
import type { TransitStepSummary } from "../lib/google-routes";

import { poiAccessPolicyForStop } from "../lib/poi-access";
import { resolveKnownStops, straightLineDistanceKm, type ResolvedInputStop, type RouteStop } from "../lib/route-optimizer";
import type { Pace } from "../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../lib/time-feasibility";
import {
  destinationById,
  destinationEntryAuthority,
  destinationEssentials,
  destinationForCountryCode,
  destinationName,
  destinationOptions,
  destinationPassportRule,
  destinations,
  localDateTimeWithOffset,
  localDateIn,
  priceBandSymbols,
  type Destination,
  type DestinationChoice,
  type DestinationId,
} from "../lib/destinations";
import { buildPreTripTimeline } from "../lib/pre-trip-timeline";
import { encodeTripShare, type ShareableResolutionOverride, type ShareableTripInput } from "../lib/share-link";
import { buildScopedTripShare, type ShareScope } from "../lib/share-scope";
import type { WeatherKind } from "../lib/weather";
import { assessTripFit, generateTripCounterfactuals } from "../lib/trip-scenarios";
import {
  createPlannerEvidenceSnapshot,
  deriveFeasibilityResult,
  type AlternativePlan,
  type Assumption,
  type Attention,
  type Conflict,
  type FeasibilityResult,
  type FeasibilityState,
  type RouteFactEvidence,
} from "../lib/feasibility-result";
import { estimateStayMinutes } from "../lib/stay-estimates";
import { detectGapsFromBuiltDay } from "../lib/gap-detection";
import { createRecommendation, type FillerKind } from "../lib/itinerary-domain";
import { evaluateRecommendationCandidate, recommendationPlaceAlreadyScheduled, recommendationPlanSnapshot, reserveDistinctRecommendationCandidates } from "../lib/recommendation-evaluator";
import { requestRouteRecommendations, RouteRecommendationsError } from "../lib/route-recommendations-client";
import type { RouteRecommendation, RouteRecommendationPoint } from "../lib/route-recommendations";
import { trackProductEvent, type ProductEventFields, type ProductEventName } from "../lib/product-analytics";
import { rotateTripRequestToken } from "../lib/trip-request-identity";
import { balancedGeoCenter, buildTripFromWishlist, hotelRouteContextForDraft, routeLegKey, type AirportCode, type BuiltTripPlan, type FoodRecommendationSlot, type MealPlan, type TripBase, type TripPlannerContext, type VisitWindow } from "../lib/trip-builder";
import {
  formatWishlistLines,
  parsedWishlistPlaces,
  parseWishlist,
  updateWishlistPlaceConstraints,
  type ParsedWishlistPlace,
  type WishlistPlaceConstraintPatch,
} from "../lib/wishlist-parser";
import { coverageProfileForLocation, coveragePublicCopy } from "../lib/coverage-profile";
import { PLANNER_MAP_DAY_COLORS } from "../lib/planner-map-model";
import { buildDayPresentation, dayPresentationFallbackCopy } from "../lib/day-presentation";
import {
  canRedoPlannerHistory,
  canUndoPlannerHistory,
  commitPlannerHistory,
  createPlannerHistory,
  plannerHistoryStateEqual,
  redoPlannerHistory,
  undoPlannerHistory,
  type PlannerHistory,
} from "../lib/planner-history";
import {
  ui,
  legModeLabel,
  printTransferCopy,
  feasibilityStateCopy,
  conflictCopy,
  attentionCopy,
  assumptionCopy,
  alternativeCopy,
  alternativeLossCopy,
  minimumDaysCopy,
  type PlannerLocale,
} from "../lib/presentation/planner-copy";
import {
  weekdayInfo,
  formatDuration,
  shiftPlannerClock,
  safeRemovedStopLabels,
  priceBand,
  airportOptionsFor,
  airportComparisonDestination,
} from "../lib/presentation/trip-presentation";
import {
  TRIPCHECK_FILLER_PREFIX,
  fillerOccurrenceLine,
  recommendationStopId,
  routeRecommendationFillerKind,
  boundedRecommendationScore,
  styledBestCandidate,
  hotelAxisWinners,
  hotelShortlist,
} from "../lib/presentation/recommendation-presentation";
import {
  P0_CORE_ONLY,
  P1_TRAVEL_ENRICHMENTS,
  initialBuildProgress,
  buildStageOrder,
  emptyTransitConvergenceState,
  emptyFreshState,
  emptyHotelAi,
  emptyHotelState,
  emptyNightlyHotelState,
  emptyRouteRecommendationState,
  upsertResolutionOverride,
  manualStopFromResolutionOverride,
  withManualResolutionOverrides,
  addCalendarDays,
  clampTripDays,
  builtPlanTravelMinutes,
  clockToMinutes,
  clockRangeContainsVisit,
  hotelPlanSignature,
  plannerTimeZone,
  defaultTripDate,
  mapWithConcurrency,
  hotelAsResolvedBase,
  provisionalBaseAsResolved,
  normalizeHotelName,
  isAreaLikeHotelQuery,
  shouldUseRecommendedHotel,
  matchingHotelCandidate,
  type PlannerInputStep,
  type PlannerBuildMode,
  type MobileResultView,
  type PlannerMapScope,
  type FoodState,
  type IntelligenceState,
  type FreshState,
  type HotelAiState,
  type HotelState,
  type HotelStayMode,
  type HotelStyleChoice,
  type HotelPurpose,
  type NightlyHotelNight,
  type NightlyHotelState,
  type RouteRecommendationState,
  type BuildStage,
  type BuildProgress,
  type Inspector,
  type ManualPlaceDraft,
  type ParsePreviewRow,
  type PlannerEditState,
} from "../lib/planner-app-state";

// One day palette for the timeline, day rail and map (v1.1 spec §7.1). The
// map model owns the tokens so a map polyline can never disagree with a tab.
const plannerDayColors = PLANNER_MAP_DAY_COLORS;

export default function TripPlannerApp({ initialLocale = "en", mapsApiKey = "" }: { initialLocale?: PlannerLocale; mapsApiKey?: string }) {
  const [locale, setLocale] = useState<PlannerLocale>(initialLocale);
  // "auto" is the honest default: the first resolved place names the country,
  // so a wishlist works without asking where the trip is before it exists.
  const [destinationChoice, setDestinationChoice] = useState<DestinationChoice>("auto");
  const [detectedDestinationId, setDetectedDestinationId] = useState<DestinationId | null>(null);
  const [itinerary, setItinerary] = useState("");
  const [inputStep, setInputStep] = useState<PlannerInputStep>("places");
  const [buildMode, setBuildMode] = useState<PlannerBuildMode>("automatic");
  const [isResolvingPlaces, setIsResolvingPlaces] = useState(false);
  const [reviewedInputSignature, setReviewedInputSignature] = useState("");
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
  const [resolvedStops, setResolvedStops] = useState<ResolvedInputStop[]>([]);
  const [ambiguousPlaces, setAmbiguousPlaces] = useState<AmbiguousPlaceResolution[]>([]);
  const [manualPlaceDrafts, setManualPlaceDrafts] = useState<Record<number, ManualPlaceDraft>>({});
  const [resolutionOverrides, setResolutionOverrides] = useState<ShareableResolutionOverride[]>([]);
  const [manualPinTarget, setManualPinTarget] = useState<number | null>(null);
  const [resolvedBase, setResolvedBase] = useState<ResolvedInputStop | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [placeWarning, setPlaceWarning] = useState<false | "unavailable" | "quota_exhausted">(false);
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
  const [foodSearches, setFoodSearches] = useState<Record<string, FoodState>>({});
  const [foodRecommendationNotice, setFoodRecommendationNotice] = useState("");
  const [intelligence, setIntelligence] = useState<Record<string, IntelligenceState>>({});
  const [freshVoices, setFreshVoices] = useState<Record<string, FreshState>>({});
  const [hotelState, setHotelState] = useState<HotelState>(emptyHotelState);
  const [hotelSearchSignature, setHotelSearchSignature] = useState("");
  const [hotelRefreshing, setHotelRefreshing] = useState(false);
  const [hotelRefreshFailed, setHotelRefreshFailed] = useState(false);
  const [hotelUsesRecommendations, setHotelUsesRecommendations] = useState(true);
  const [hotelStayMode, setHotelStayMode] = useState<HotelStayMode>("single");
  const [hotelStyle, setHotelStyle] = useState<HotelStyleChoice>("recommended");
  const [hotelPurpose, setHotelPurpose] = useState<HotelPurpose>("balanced");
  const [nightlyHotels, setNightlyHotels] = useState<NightlyHotelState>(emptyNightlyHotelState);
  const [routeRecommendationSearches, setRouteRecommendationSearches] = useState<Record<string, RouteRecommendationState>>({});
  const [routeRecommendationNotice, setRouteRecommendationNotice] = useState("");
  const [routeAlternativesExpanded, setRouteAlternativesExpanded] = useState(false);
  const [routeGeometryByDay, setRouteGeometryByDay] = useState<Record<string, RouteRecommendationPoint[]>>({});
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [userStayMinutes, setUserStayMinutes] = useState<Record<string, number>>({});
  const [lastEntryTimes, setLastEntryTimes] = useState<Record<string, string>>({});
  const [earlyVisitStopIds, setEarlyVisitStopIds] = useState<string[]>([]);
  const [dayStartTimes, setDayStartTimes] = useState<Record<number, string>>({});
  const [dayEndTimes, setDayEndTimes] = useState<Record<number, string>>({});
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
  const [pendingHardEdit, setPendingHardEdit] = useState<{
    title: string;
    conflicts: string[];
    apply: () => void;
    cancelLabel?: string;
    confirmLabel?: string;
  } | null>(null);
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
  const placesInputRef = useRef<HTMLTextAreaElement | null>(null);
  // v1.1 §8.1: ordinary edits apply instantly and answer with one 6-second
  // toast (≤2 metrics) plus Undo, instead of a confirmation dialog.
  const [editToast, setEditToast] = useState<{ message: string; detail: string | null } | null>(null);
  const editToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v1.1 §9.3: on phones the detail panel is a bottom sheet (half height by
  // default, full on request via an explicit button, never drag-only).
  const [inspectorSheetExpanded, setInspectorSheetExpanded] = useState(false);
  const [comparisonAlternative, setComparisonAlternative] = useState<AlternativePlan | null>(null);
  const [previewStops, setPreviewStops] = useState<RouteStop[]>([]);
  const [buildProgress, setBuildProgress] = useState<BuildProgress>(initialBuildProgress);
  const buildRunRef = useRef(0);
  const buildAbortRef = useRef<AbortController | null>(null);
  const placeReviewAbortRef = useRef<AbortController | null>(null);
  const hotelRefreshAbortRef = useRef<AbortController | null>(null);
  const nightlyHotelRequestRef = useRef(0);
  const routeRecommendationRequestRef = useRef(0);
  const foodInFlightRef = useRef<Set<string>>(new Set());
  const hotelStyleRef = useRef<HotelStyleChoice>("recommended");
  const intelligenceRef = useRef<Record<string, IntelligenceState>>({});
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const shareDialogRef = useRef<HTMLElement | null>(null);
  const shareTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hotelPlanSignatureRef = useRef("");
  const historyActionRef = useRef<{ undo: () => void; redo: () => void }>({ undo: () => {}, redo: () => {} });
  const analyticsMilestonesRef = useRef<Set<ProductEventName>>(new Set());
  const text = ui[locale];
  const activeDestination = useMemo(
    () => destinationById(destinationChoice === "auto" ? detectedDestinationId ?? "worldwide" : destinationChoice),
    [destinationChoice, detectedDestinationId],
  );
  // Everything downstream of the first resolution can use the detected
  // country even while the picker still says "auto".
  const requestDestination: DestinationChoice = destinationChoice !== "auto"
    ? destinationChoice
    : detectedDestinationId ?? "auto";

  function trackMilestone(event: ProductEventName, fields: ProductEventFields = {}) {
    if (analyticsMilestonesRef.current.has(event)) return;
    analyticsMilestonesRef.current.add(event);
    trackProductEvent(event, fields);
  }

  function resetAnalyticsMilestones() {
    analyticsMilestonesRef.current = new Set();
  }

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
  historyActionRef.current = { undo: undoPlannerEdit, redo: redoPlannerEdit };
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

  useEffect(() => {
    intelligenceRef.current = intelligence;
  }, [intelligence]);

  useEffect(() => {
    hotelStyleRef.current = hotelStyle;
  }, [hotelStyle]);

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

  useEffect(() => {
    if (inspector?.kind !== "food" || !inspector.candidateId) return;
    const frame = window.requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>("[data-food-candidate]")]
        .find((element) => element.dataset.foodCandidate === inspector.candidateId);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspector]);

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
    buildPlan,
  });
  const updatePassportExpiry = (value: string) => {
    setPassportExpiry(value);
    try {
      if (value) window.localStorage.setItem("tripcheck.passportExpiry", value);
      else window.localStorage.removeItem("tripcheck.passportExpiry");
    } catch { /* storage unavailable — the check still works for this session */ }
  };

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

  // The built plan is the authority on which country this trip is in — and a
  // plan with no curated country honestly clears the previous detection
  // instead of leaving another trip's flag on this one.
  useEffect(() => {
    if (plan) setDetectedDestinationId(plan.destination !== "worldwide" ? plan.destination : null);
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

  const currentHotelPlanSignature = useMemo(() => hotelPlanSignature(plan), [plan]);
  const hotelRouteContext = useMemo(() => plan ? hotelRouteContextForDraft(plan) : null, [plan]);
  const hotelPlanDirty = Boolean(
    currentHotelPlanSignature
    && hotelSearchSignature
    && currentHotelPlanSignature !== hotelSearchSignature,
  );
  useEffect(() => {
    hotelPlanSignatureRef.current = currentHotelPlanSignature;
  }, [currentHotelPlanSignature]);

  const day = plan?.days[activeDay] ?? null;
  const activeFitDay = tripFit?.days[activeDay] ?? null;
  // v1.1 TC-001: the single presentation source for the day's clocks and
  // used/free minutes. Header, metrics and print all read this model.
  const activeDayPresentation = useMemo(() => day
    ? buildDayPresentation(day, activeFitDay, { dayIndex: activeDay })
    : null, [activeDay, activeFitDay, day]);
  const base = day ? day.startBase ?? plan?.selectedBase ?? null : null;
  const dayEndBase = day ? day.endBase ?? base : null;
  const modeLabel = (mode: TransportMode | null) => mode === "taxi" && travelPreference === "car"
    ? text.moveCar
    : mode ? text.move[mode] : travelPreference === "car" ? text.moveCar : text.move.transit;
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
  const hotelAxis = useMemo(() => hotelAxisWinners(hotelState.candidates), [hotelState.candidates]);
  const hasRakutenHotelEvidence = hotelState.candidates.some((candidate) => candidate.rakuten !== null);
  const hotelPriceLabel = useCallback((candidate: HotelCandidate) => (
    candidate.rakuten?.minCharge
      ? `¥${candidate.rakuten.minCharge.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}〜`
      : priceBand(candidate.priceLevel, activeDestination) ?? text.priceUnlisted
  ), [activeDestination, locale, text]);
  // v1.1 TC-041: every shortlist slot names its itinerary-derived axis —
  // the overall pick, the least-travel base and the review leader. A price
  // axis stays out deliberately: reference minimum charges are dateless
  // display facts and must not be ranked as "best value".
  const hotelAxisLabels = useCallback((candidate: HotelCandidate) => [
    ...(candidate.id === (hotelState.ai.recommendedId ?? hotelState.candidates[0]?.id) ? [text.axisOverall] : []),
    ...(candidate.id === hotelAxis.nearestId ? [text.axisNearest] : []),
    ...(candidate.id === hotelAxis.topRatedId ? [text.axisTopRated] : []),
  ], [hotelAxis, hotelState.ai.recommendedId, hotelState.candidates, text]);
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
  useEffect(() => {
    if (inputStep !== "conditions" || hasPlan) setManualPinTarget(null);
  }, [hasPlan, inputStep]);
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
  const autoBumpedDaysRef = useRef(0);
  useEffect(() => {
    if (maxParsedDay <= tripDays || maxParsedDay > 14) return;
    if (autoBumpedDaysRef.current === maxParsedDay) return;
    autoBumpedDaysRef.current = maxParsedDay;
    setTripDays(maxParsedDay);
  }, [maxParsedDay, tripDays]);
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
  const resultStateCopy = feasibilityResult
    ? feasibilityStateCopy(
      feasibilityResult.state,
      locale,
      plan?.requestedDays ?? tripDays,
      plan?.scheduledStopCount ?? 0,
      plan ? plan.deferredUnavailableStops.length + plan.deferredOptionalStops.length : 0,
    )
    : null;
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
    + (placeWarning ? 1 : 0);
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

  function selectHotelCandidate(candidate: HotelCandidate, purpose: HotelPurpose = "picked") {
    const changed = hotelState.selectedId !== candidate.id;
    if (changed) trackProductEvent("hotel_accepted", { provider_name: "google" });
    if (changed) hotelRefreshAbortRef.current?.abort();
    setHotelState((current) => ({
      ...current,
      selectedId: candidate.id,
      ...(changed ? { fresh: { status: "loading", result: null } satisfies FreshState } : {}),
    }));
    setHotelPurpose(purpose);
    // The displayed hotel and the routing base must never diverge.
    setResolvedBase(hotelAsResolvedBase(candidate, hotelQuery, candidate.address.slice(0, 100) || candidate.name, new Date().toISOString()));
    // v1.1 §12.3: accepting a recommendation announces once, politely. Auto
    // selection during a build (planReady is still false there) stays silent.
    if (changed && planReady) {
      showEditToast(locale === "ja" ? `ホテルを「${candidate.name}」にしました` : `Hotel set to ${candidate.name}`);
    }
    if (!changed) return;
    if (!aiEnabledRef.current) {
      setHotelState((current) => current.selectedId === candidate.id
        ? { ...current, fresh: { status: "paused", result: null } }
        : current);
      return;
    }
    // Public evidence belongs to one hotel only. Switching a photo card or map
    // pin must never leave the previous hotel's findings attached to this one.
    void requestFreshVoices(
      { name: candidate.name, area: candidate.address.slice(0, 100) || candidate.name },
      locale,
      { intent: "hotel", depth: "quick", destination: requestDestination },
    ).then((result) => {
      setHotelState((current) => current.selectedId === candidate.id
        ? { ...current, fresh: { status: "ready", result } }
        : current);
    }).catch(() => {
      setHotelState((current) => current.selectedId === candidate.id
        ? { ...current, fresh: { status: "unavailable", result: null } }
        : current);
    });
  }

  async function refreshHotelRecommendations() {
    if (!plan || hotelRefreshing || hotelStayMode !== "single" || !hotelUsesRecommendations) return;
    const routeContext = hotelRouteContextForDraft(plan);
    if (!routeContext) return;
    const signatureAtStart = hotelPlanSignature(plan);
    const areaWasRequested = Boolean(hotelQuery.trim() && hotelUsesRecommendations);
    const searchAnchor = areaWasRequested && resolvedBase
      ? { latitude: resolvedBase.latitude, longitude: resolvedBase.longitude, area: hotelQuery.trim() }
      : routeContext;
    hotelRefreshAbortRef.current?.abort();
    const controller = new AbortController();
    hotelRefreshAbortRef.current = controller;
    setHotelRefreshing(true);
    setHotelRefreshFailed(false);
    try {
      const response = await requestHotelRecommendations({
        latitude: searchAnchor.latitude,
        longitude: searchAnchor.longitude,
        area: searchAnchor.area,
        routePoints: routeContext.routePoints,
      }, locale, requestDestination, controller.signal);
      if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
      const travelMinutesById = new Map<string, number>();
      const rankedCandidates = response.candidates
        .map((candidate) => ({
          candidate,
          travelMinutes: builtPlanTravelMinutes(buildTripFromWishlist(
            itinerary,
            tripDays,
            pace,
            locale,
            { ...activePlannerContext, resolvedBase: hotelAsResolvedBase(candidate, hotelQuery, searchAnchor.area, response.fetchedAt) },
          )),
        }))
        .map((entry) => {
          travelMinutesById.set(entry.candidate.id, entry.travelMinutes);
          return entry;
        })
        .sort((left, right) => left.travelMinutes - right.travelMinutes
          || right.candidate.score - left.candidate.score
          || left.candidate.id.localeCompare(right.candidate.id))
        .map(({ candidate }) => candidate);
      const axes = hotelAxisWinners(rankedCandidates);
      const selected = hotelStyle !== "recommended"
        ? styledBestCandidate(rankedCandidates, hotelStyle) ?? rankedCandidates[0] ?? null
        : hotelPurpose === "nearest"
          ? rankedCandidates.find((candidate) => candidate.id === axes.nearestId) ?? rankedCandidates[0] ?? null
          : hotelPurpose === "rated"
            ? rankedCandidates.find((candidate) => candidate.id === axes.topRatedId) ?? rankedCandidates[0] ?? null
            : hotelPurpose === "value"
              ? rankedCandidates.find((candidate) => candidate.id === axes.valueId) ?? rankedCandidates[0] ?? null
              : rankedCandidates[0] ?? null;
      if (!selected) throw new Error("no_hotel_candidates");
      const shortlist = hotelShortlist(rankedCandidates, selected.id);
      setHotelState({
        status: "ready",
        candidates: shortlist,
        selectedId: selected.id,
        fresh: { status: "loading", result: null },
        ai: { status: "idle", notes: {}, recommendedId: null },
      });
      setResolvedBase(hotelAsResolvedBase(selected, hotelQuery, selected.address.slice(0, 100) || searchAnchor.area, response.fetchedAt));
      setHotelSearchSignature(signatureAtStart);
      clearNightlyHotelResults();
      postBuildLegBudgetRef.current = Math.max(postBuildLegBudgetRef.current, 16);
      setInspector({ kind: "hotel" });

      if (!aiEnabledRef.current) {
        setHotelState((current) => current.selectedId === selected.id
          ? { ...current, fresh: { status: "paused", result: null } }
          : current);
        return;
      }
      // The route decision is deterministic; the optional public-source check
      // follows in the background and never blocks or changes the hotel rank.
      void requestFreshVoices(
        { name: selected.name, area: selected.address.slice(0, 100) || searchAnchor.area },
        locale,
        { intent: "hotel", depth: "quick", destination: requestDestination, signal: controller.signal },
      ).then((result) => {
        if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
        setHotelState((current) => current.selectedId === selected.id
          ? { ...current, fresh: { status: "ready", result } }
          : current);
      }).catch(() => {
        if (controller.signal.aborted) return;
        setHotelState((current) => current.selectedId === selected.id
          ? { ...current, fresh: { status: "unavailable", result: null } }
          : current);
      });
      // The deterministic order above is the instant answer. The AI selector
      // then researches the same shortlist (bounded web search) and may
      // promote a different base — but it can only choose among these ids,
      // and only while the user has not intervened.
      if (shortlist.length >= 2) {
        setHotelState((current) => ({ ...current, ai: { ...current.ai, status: "loading" } }));
        void requestHotelRanking({
          destination: locale === "ja" ? activeDestination.names.ja : activeDestination.names.en,
          area: searchAnchor.area,
          tripDays,
          purpose: hotelPurpose,
          candidates: shortlist.slice(0, 6).map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            area: candidate.address.slice(0, 100) || searchAnchor.area,
            rating: candidate.rating,
            reviewCount: candidate.userRatingCount,
            totalTravelMinutes: travelMinutesById.get(candidate.id) ?? null,
            styles: candidate.styles,
            priceHint: candidate.rakuten?.minCharge
              ? `~¥${candidate.rakuten.minCharge.toLocaleString("ja-JP")}/night`
              : null,
          })),
        }, locale, controller.signal).then((ai) => {
          if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
          let userUntouched = false;
          setHotelState((current) => {
            if (current.status !== "ready") return current;
            userUntouched = current.selectedId === selected.id;
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
          const pick = shortlist.find((candidate) => candidate.id === ai.recommendedId);
          if (pick && userUntouched && pick.id !== selected.id && hotelStyleRef.current === "recommended") {
            selectHotelCandidate(pick, "balanced");
          }
        }).catch(() => {
          if (controller.signal.aborted) return;
          setHotelState((current) => ({ ...current, ai: { ...current.ai, status: "unavailable" } }));
        });
      }
    } catch {
      if (!controller.signal.aborted) setHotelRefreshFailed(true);
    } finally {
      if (hotelRefreshAbortRef.current === controller) {
        hotelRefreshAbortRef.current = null;
        setHotelRefreshing(false);
      }
    }
  }

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

  function showEditToast(message: string, detail: string | null = null) {
    if (editToastTimerRef.current !== null) clearTimeout(editToastTimerRef.current);
    setEditToast({ message, detail });
    editToastTimerRef.current = setTimeout(() => setEditToast(null), 6_000);
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

  // Meal slots interleave with the stop rows by TIME: a slot renders after
  // the last stop the route has reached by the slot's clock, so a 12:45 lunch
  // can never appear below a 15:40 visit. The anchor id only drives the geo
  // query behind the recommendation.
  function mealRowsAfter(stopIndex: number) {
    if (!day) return [];
    const rowStops = day.stops;
    return daySlots
      .filter((slot) => {
        const slotMinutes = clockToMinutes(slot.displayTime);
        if (slotMinutes === null) return stopIndex === rowStops.length - 1;
        let insertAfter = 0;
        rowStops.forEach((candidate, index) => {
          const arrival = clockToMinutes(candidate.arrival);
          if (arrival !== null && arrival <= slotMinutes) insertAfter = index;
        });
        return insertAfter === stopIndex;
      })
      .sort((left, right) => (
        (clockToMinutes(left.displayTime) ?? 0) - (clockToMinutes(right.displayTime) ?? 0)
        || (left.kind === right.kind ? 0 : left.kind === "lunch" ? -1 : 1)
      ))
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

  function confirmManualPlace(inputIndex: number, inputName: string) {
    const draft = manualPlaceDrafts[inputIndex];
    const latitude = Number(draft?.latitude);
    const longitude = Number(draft?.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return;
    const address = draft?.address.trim() || (locale === "ja" ? "ユーザー指定の地点" : "Traveller-supplied coordinates");
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

  function clearNightlyHotelResults() {
    nightlyHotelRequestRef.current += 1;
    setHotelStayMode("single");
    setNightlyHotels({ status: "idle", nights: [] });
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

  function selectNightCandidate(nightIndex: number, candidateId: string) {
    setNightlyHotels((state) => state.status !== "ready" ? state : {
      ...state,
      nights: state.nights.map((night, index) => index === nightIndex ? { ...night, selectedId: candidateId } : night),
    });
  }

  function applyHotelStyle(style: HotelStyleChoice) {
    hotelStyleRef.current = style;
    setHotelStyle(style);
    const pick = styledBestCandidate(hotelState.candidates, style);
    if (pick && pick.id !== hotelState.selectedId) selectHotelCandidate(pick, style === "recommended" ? "balanced" : style === "value" ? "value" : "picked");
    setNightlyHotels((state) => state.status !== "ready" ? state : {
      ...state,
      nights: state.nights.map((night) => {
        const nightPick = styledBestCandidate(night.candidates, style);
        return nightPick ? { ...night, selectedId: nightPick.id } : night;
      }),
    });
  }

  async function enableNightlyHotels() {
    setHotelStayMode("nightly");
    if (nightlyHotels.status === "loading" || nightlyHotels.status === "ready") return;
    if (!plan || plan.days.length < 2) return;
    const runId = buildRunRef.current;
    const requestId = ++nightlyHotelRequestRef.current;
    const stale = () => buildRunRef.current !== runId || nightlyHotelRequestRef.current !== requestId;
    setNightlyHotels({ status: "loading", nights: [] });
    // Night N serves two boundaries: the last stop that evening and the first
    // stop next morning. Ranking against every stop in Day N made a midday
    // museum outweigh the actual hotel transfer.
    const anchors = plan.days.slice(0, -1).map((planDay, index) => {
      const evening = planDay.stops.at(-1)?.stop ?? null;
      const morning = plan.days[index + 1]?.stops[0]?.stop ?? null;
      const boundaryStops = [evening, morning].filter((stop): stop is RouteStop => Boolean(stop));
      const fallback = morning ?? evening ?? planDay.endBase ?? plan.selectedBase;
      if (boundaryStops.length === 0 && !fallback) return null;
      // Sleep where tomorrow starts: the night's hotel leans toward the next
      // morning's first stop (60/40) so the day does not begin with the long
      // transfer the traveller just complained about.
      const center = evening && morning
        ? {
          latitude: evening.latitude * 0.4 + morning.latitude * 0.6,
          longitude: evening.longitude * 0.4 + morning.longitude * 0.6,
        }
        : balancedGeoCenter(boundaryStops);
      const latitude = center?.latitude ?? fallback!.latitude;
      const longitude = center?.longitude ?? fallback!.longitude;
      const area = evening?.area ?? fallback?.area ?? destinationName(activeDestination, locale);
      return {
        latitude,
        longitude,
        area,
        routePoints: boundaryStops.length > 0
          ? boundaryStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude }))
          : fallback ? [{ latitude: fallback.latitude, longitude: fallback.longitude }] : [],
      };
    });
    const nights = await mapWithConcurrency(anchors, 2, async (anchor): Promise<NightlyHotelNight> => {
      if (!anchor) return { area: "", fetchedAt: "", candidates: [], selectedId: null };
      try {
        const response = await requestHotelRecommendations(anchor, locale, requestDestination);
        const pick = response.candidates[0] ?? null;
        return { area: anchor.area, fetchedAt: response.fetchedAt, candidates: hotelShortlist(response.candidates, pick?.id), selectedId: pick?.id ?? null };
      } catch {
        return { area: anchor.area, fetchedAt: "", candidates: [], selectedId: null };
      }
    }, undefined, stale);
    if (stale()) return;
    const styledNights = nights.map((night) => {
      const pick = styledBestCandidate(night.candidates, hotelStyleRef.current) ?? night.candidates[0] ?? null;
      return { ...night, selectedId: pick?.id ?? null };
    });
    if (styledNights.every((night) => night.candidates.length === 0)) {
      setNightlyHotels({ status: "unavailable", nights: [] });
      return;
    }
    setNightlyHotels({ status: "ready", nights: styledNights });
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
        setBuildProgress((current) => ({ ...current, current: places.length, total: Math.max(places.length, itinerary.split("\n").filter((line) => line.trim()).length) }));
      })) return;
    } catch (error) {
      if (cancelled()) return;
      if (!commit(() => {
        setResolvedStops(places);
        setAmbiguousPlaces([]);
        setManualPlaceDrafts({});
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
    let placeReviewCount = 0;
    const loadPlaceIntelligence = async (stop: RouteStop): Promise<readonly [string, IntelligenceState]> => {
      try {
        const result = await requestPlaceIntelligence(stop, locale, buildDestination, controller.signal);
        placeReviewCount += result.reviews.length;
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

    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "hotel", current: 0, total: 1 })))) return;
    // Every day gets one route point. A distant excursion no longer drags the
    // hotel halfway toward itself, and every returned candidate is measured
    // against the whole trip.
    const draftHotelContext = hotelRouteContextForDraft(draft);
    const hotelAnchor = resolvedHotel
      ?? draftHotelContext
      ?? draft.baseRecommendations[0]?.base
      ?? draft.days.flatMap((candidate) => candidate.stops.map(({ stop }) => stop))[0]
      ?? null;
    // P0 does not fetch hotels on the critical path, but omitting a base would
    // also omit two daily transfer legs and understate the required days. Use
    // the deterministic best area as an explicitly provisional routing base.
    // A provider outage must never make the planner silently omit both daily
    // hotel legs. The deterministic area recommendation remains a clearly
    // provisional routing base until a live hotel is selected.
    let effectiveBase = resolvedHotel
      ?? (draft.baseRecommendations[0]?.base
        ? provisionalBaseAsResolved(draft.baseRecommendations[0].base)
        : null);
    let localHotelState: HotelState = { status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState, ai: emptyHotelAi };
    const buildHotelTravelMinutes = new Map<string, number>();
    if (!P0_CORE_ONLY && hotelAnchor) {
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
          effectiveBase = hotelAsResolvedBase(selected, hotelQuery, hotelAnchor.area, hotelResponse.fetchedAt);
        }
        const candidates = selected
          ? [selected, ...rankedHotelCandidates.filter((candidate) => candidate.id !== selected.id)]
          : rankedHotelCandidates;
        localHotelState = { status: "ready", candidates: hotelShortlist(candidates, selected?.id), selectedId: selected?.id ?? null, fresh: emptyFreshState, ai: emptyHotelAi };
      } catch {
        localHotelState = { status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState, ai: emptyHotelAi };
      }
    }
    if (cancelled()) return;
    if (!commit(() => {
      setHotelState(localHotelState);
      setHotelPurpose(useRecommendedHotelForBuild ? "balanced" : "picked");
      setResolvedBase(effectiveBase);
      setBuildProgress((current) => ({ ...current, current: 1, total: 1 }));
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
      // The deterministic provisional plan is ready. Hours and time-dependent
      // routes continue in the background and refine this same result.
      setIsBuilding(false);
    })) return;
    trackMilestone("provisional_result_shown", {
      place_count: draft.scheduledStopCount,
      trip_day_count: draft.requestedDays,
      solver_time_ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - buildStartedAt,
    });

    const selectedHotelForBuild = localHotelState.selectedId
      ? localHotelState.candidates.find((candidate) => candidate.id === localHotelState.selectedId) ?? null
      : null;
    let reviewCount = selectedHotelForBuild?.reviews?.length ?? 0;
    if (!commit(() => setBuildProgress((current) => ({ ...current, stage: "reviews", current: 0, total: uniqueStops.length, reviewCount })))) return;
    const prefetchedEntries = await preHotelIntelligencePromise;
    if (cancelled()) return;
    reviewCount += placeReviewCount;
    const prefetchedById = new Map<string, IntelligenceState>(prefetchedEntries);
    const unrequestedStops = uniqueStops.filter((stop) => !prefetchedById.has(stop.id));
    const missingStops = !tripDateTouched
      ? []
      : takeWithinPlanningBudget(unrequestedStops, PLANNING_BUDGET.openingHours, prefetchedEntries.length);
    if (!commit(() => setBuildProgress((progress) => ({
      ...progress,
      current: uniqueStops.length - missingStops.length,
      total: uniqueStops.length,
      reviewCount,
    })))) return;
    const missingEntries = await mapWithConcurrency(missingStops, 4, loadPlaceIntelligence, (current) => {
      reviewCount = (selectedHotelForBuild?.reviews?.length ?? 0) + placeReviewCount;
      commit(() => setBuildProgress((progress) => ({
        ...progress,
        current: uniqueStops.length - missingStops.length + current,
        total: uniqueStops.length,
        reviewCount,
      })));
    }, cancelled);
    if (cancelled()) return;
    reviewCount = (selectedHotelForBuild?.reviews?.length ?? 0) + placeReviewCount;
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
    const publicCount = 0;
    const socialCount = 0;
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

    if (!commit(() => setBuildProgress((current) => ({
      ...current,
      stage: "scheduling",
      current: 0,
      total: 0,
      reviewCount,
      publicCount,
      socialCount,
    })))) return;

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
      setBuildProgress((current) => ({ ...current, stage: "scheduling", current: 0, total: 0, reviewCount, publicCount, socialCount }));
      setDurationOverrides(overrides);
      setEarlyVisitStopIds(earlyStops);
      setOpeningWindowsByDay(appliedOpeningWindows);
      setHotelSearchSignature(hotelPlanSignature(finalDraft));
      buildAbortRef.current = null;
    })) return;
  }

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

  function switchDay(index: number) {
    setActiveDay(index);
    setInspector(null);
    setMapFocusedStopId(null);
  }

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
      // Google evidence owns the order. Claude runs behind the instant result
      // only to add compact comparison copy for the supplied candidates.
      if (aiEnabledRef.current && next.candidates.length > 0) {
        void requestFoodRanking(slot, query, next.candidates, locale).then((ranking) => {
          if (stale()) return;
          const notes = Object.fromEntries(ranking.ranked.map((item) => [item.id, { reason: item.reason, tag: item.tag }]));
          // The AI chooses which candidate leads: its order becomes the
          // display order. Ids stay Google-verified — an id the AI did not
          // return keeps its Google position after the ranked ones.
          const order = new Map(ranking.ranked.map((item, index) => [item.id, index]));
          setFoodSearches((current) => {
            const entry = current[slot.id];
            if (!entry || entry.status !== "ready" || entry.requestKey !== requestKey) return current;
            const candidates = [...entry.candidates].sort((left, right) => (
              (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99)
            ));
            return { ...current, [slot.id]: { ...entry, candidates, notes, aiOrdered: order.size > 0 } };
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
  }, [locale, requestDestination, selectedStopForEvidence]);

  const selectedIntel = selectedBuiltStop ? intelligence[selectedBuiltStop.stop.id] : undefined;
  const selectedFresh = selectedBuiltStop ? freshVoices[selectedBuiltStop.stop.id] : undefined;
  const selectedCheckLoading = selectedIntel?.status === "loading" || selectedFresh?.status === "loading";
  // While social checks are paused, Google evidence alone completes a check.
  const selectedCheckReady = selectedIntel?.status === "ready" && (selectedFresh?.status === "ready" || selectedFresh?.status === "paused");
  const selectedCheckRetry = selectedIntel?.status === "unavailable" || selectedFresh?.status === "unavailable";
  const visibleBuildStages = buildStageOrder;
  const activeBuildIndex = visibleBuildStages.indexOf(buildProgress.stage);
  const activeBuildDetail = buildProgress.stage === "resolving"
    ? text.progressPlaces(buildProgress.current, buildProgress.total)
    : buildProgress.stage === "reviews"
      ? text.progressReviews(buildProgress.reviewCount)
      : buildProgress.stage === "scheduling"
        ? text.progressScheduling
        : selectedHotel?.name ?? (locale === "ja" ? "旅程に合うホテルを検索中" : "Searching hotels that fit the route");

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
