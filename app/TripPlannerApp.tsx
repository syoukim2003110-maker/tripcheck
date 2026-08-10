"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import PlannerGoogleMap, {
  type FoodPin,
  type HotelPin,
  type PlannerMapDayLayer,
  type RecommendationPin,
} from "./PlannerGoogleMap";
import PlannerDayTimeBar from "./PlannerDayTimeBar";
import Icon, { type IconName } from "./PlannerIcons";
import AirportOptionComparison from "./AirportOptionComparison";
import SearchableCombobox, { type SearchableOption } from "./SearchableCombobox";
import {
  FoodRecommendationsError,
  foodCandidateReason,
  foodRecommendationRequestKey,
  foodSearchLinks,
  requestFoodRecommendations,
  requestFoodRanking,
} from "../lib/food-recommendations-client";
import { requestLinkPreview } from "../lib/link-preview-client";
import { defaultFoodDiscoveryQuery, type FoodCandidate } from "../lib/google-food";
import { requestHotelRecommendations } from "../lib/hotel-recommendations-client";
import { placeTypesIncludeLodging, type HotelCandidate, type HotelPriceLevel, type HotelStyle } from "../lib/google-hotels";
import { fullTripDemo } from "../lib/mock-trip";
import { requestFreshVoices, requestPlaceIntelligence, PlaceIntelligenceError } from "../lib/place-intelligence-client";
import { requestAiStatus } from "../lib/ai-status-client";
import type { FreshVoicesResult } from "../lib/fresh-voices";
import type { PlaceIntelligenceResult } from "../lib/place-intelligence";
import { googleCurrentOpeningWindowsForDate, googleOpeningWindowsForDate } from "../lib/google-opening-hours";
import { areaFromAddress } from "../lib/google-place-resolver";
import { deriveStopPlanningEvidence } from "../lib/planning-evidence";
import {
  buildPlanningRouteLegs,
  buildPlanningTransitIteration,
  buildSelectedTransitLegRequests,
  fetchPlanningTransitEvidence,
  planningRouteRequestKey,
  prefetchPlanningRouteDurations,
  type PlanningTransitLegRequest,
} from "../lib/planning-live-routes-client";
import { PlaceResolutionError, placeReviewInputSignature, placeReviewStatus, requestPlaceResolution, type AmbiguousPlaceResolution } from "../lib/place-resolution-client";
import { PLANNING_BUDGET, takeWithinPlanningBudget } from "../lib/planning-budget";
import { poiAccessPolicyForStop } from "../lib/poi-access";
import { resolveKnownStops, straightLineDistanceKm, type ResolvedInputStop, type RouteStop } from "../lib/route-optimizer";
import type { Pace } from "../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../lib/time-feasibility";
import {
  destinationById,
  destinationEntryAuthority,
  destinationEssentials,
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
import { decodeTripShare, encodeTripShare, type ShareableResolutionOverride, type ShareableTripInput } from "../lib/share-link";
import { buildScopedTripShare, type ShareScope } from "../lib/share-scope";
import { buildWeatherPayload, requestWeatherPayload } from "../lib/weather-client";
import type { TripWeatherDay, WeatherKind } from "../lib/weather";
import { buildHolidaysPayload, requestHolidays } from "../lib/holidays-client";
import type { TripHoliday } from "../lib/holidays";
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
import { createTripStore, type StoredTripRecord, type TripStore } from "../lib/trip-store";
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
import {
  convergeTransitPlan,
  type TransitConvergenceStopReason,
} from "../lib/transit-convergence";
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

type PlannerLocale = "en" | "ja";
type PlannerInputStep = "places" | "conditions";
type PlannerBuildMode = "automatic" | "custom";
type MobileResultView = "timeline" | "map" | "compact";
type PlannerMapScope = "all" | "day";
type PassportCountry = "unset" | "JP" | "other";
type TransitConvergenceState = {
  inputKey: string;
  status: "idle" | "loading" | "complete";
  eventCount: number;
  iterations: number;
  nonConverged: boolean;
  stopReason: TransitConvergenceStopReason | null;
};
const emptyTransitConvergenceState: TransitConvergenceState = {
  inputKey: "",
  status: "idle",
  eventCount: 0,
  iterations: 0,
  nonConverged: false,
  stopReason: null,
};
const plannerDayColors = ["#e2634e", "#356f9f", "#4b8060", "#7656a8"] as const;
const TRIPCHECK_FILLER_PREFIX = "TripCheck recommendation";

function fillerOccurrenceLine(index: number, kind: "micro" | "lunch" | "dinner" = "micro", atTime?: string) {
  return `${TRIPCHECK_FILLER_PREFIX} ${kind} ${index + 1} — optional${/^\d{2}:\d{2}$/.test(atTime ?? "") ? ` — ${atTime}` : ""}`;
}

function recommendationStopId(providerRef: string) {
  return providerRef.startsWith("google-") ? providerRef : `google-${providerRef}`;
}

function routeRecommendationFillerKind(candidate: RouteRecommendation): FillerKind {
  const types = new Set(candidate.placeTypes);
  return types.has("cafe") || types.has("coffee_shop") || types.has("bakery") || types.has("tea_house")
    ? "CAFE"
    : "MICRO_STOP";
}

function boundedRecommendationScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function upsertResolutionOverride(
  current: readonly ShareableResolutionOverride[],
  next: ShareableResolutionOverride,
) {
  return [...current.filter((entry) => entry.inputIndex !== next.inputIndex), next]
    .sort((left, right) => left.inputIndex - right.inputIndex)
    .slice(0, 12);
}

function manualStopFromResolutionOverride(
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

function withManualResolutionOverrides(
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

function safeRemovedStopLabels(
  removed: readonly { id: string; name: string }[],
  raw: string,
  locale: PlannerLocale,
) {
  const authoredNames = new Set(parsedWishlistPlaces(raw).map((place) => place.name));
  const fallback = locale === "ja" ? "除外した場所" : "Removed place";
  return removed.map((entry) => ({
    id: entry.id,
    name: authoredNames.has(entry.name) ? entry.name : fallback,
  }));
}
type FoodState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  /** Why an unavailable state happened; "quota" = daily allowance exhausted. */
  reason?: "quota";
  requestKey: string;
  query: string;
  candidates: FoodCandidate[];
  fetchedAt?: string;
  notes: Record<string, { reason: string; tag: string }>;
  fresh: Record<string, FreshState>;
};
type IntelligenceState = {
  status: "loading" | "ready" | "unavailable";
  result: PlaceIntelligenceResult | null;
};
type FreshState = {
  status: "idle" | "loading" | "ready" | "unavailable" | "paused";
  result: FreshVoicesResult | null;
};
type HotelState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  candidates: HotelCandidate[];
  selectedId: string | null;
  fresh: FreshState;
};
type HotelStayMode = "single" | "nightly";
type HotelStyleChoice = "recommended" | HotelStyle;
type HotelPurpose = "balanced" | "nearest" | "rated" | "value" | "picked";
type NightlyHotelNight = {
  area: string;
  fetchedAt: string;
  candidates: HotelCandidate[];
  selectedId: string | null;
};
type NightlyHotelState = {
  status: "idle" | "loading" | "ready" | "unavailable";
  nights: NightlyHotelNight[];
};
type RouteRecommendationState = {
  status: "idle" | "loading" | "ready" | "unavailable" | "rate_limited";
  fetchedAt: string | null;
  candidates: RouteRecommendation[];
};
type BuildStage = "resolving" | "hotel" | "reviews" | "scheduling";
type BuildProgress = {
  stage: BuildStage;
  current: number;
  total: number;
  reviewCount: number;
  publicCount: number;
  socialCount: number;
};
type Inspector =
  | { kind: "stop"; stopId: string }
  | { kind: "food"; slotId: string; candidateId?: string }
  | { kind: "hotel" }
  | { kind: "recommendations"; dayIndex: number; candidateId?: string }
  | null;
type SourcePreviewState = { status: "loading" | "ready" | "failed"; imageUrl: string | null };
type ManualPlaceDraft = { address: string; latitude: string; longitude: string };

const emptyFreshState: FreshState = { status: "idle", result: null };
const emptyHotelState: HotelState = { status: "idle", candidates: [], selectedId: null, fresh: emptyFreshState };
const emptyNightlyHotelState: NightlyHotelState = { status: "idle", nights: [] };
const emptyRouteRecommendationState: RouteRecommendationState = { status: "idle", fetchedAt: null, candidates: [] };

const weatherIconByKind: Record<WeatherKind, IconName> = {
  clear: "sun",
  partly: "sun",
  cloudy: "cloud",
  fog: "fog",
  rain: "rain",
  snow: "snow",
  storm: "storm",
};

const priceLevelOrder: HotelPriceLevel[] = ["inexpensive", "moderate", "expensive", "very_expensive"];

/* Google's price level is a relative band, so it is rendered in the local
 * currency's glyph rather than a fixed yen sign. */
function priceBand(level: HotelPriceLevel | null, destination: Destination) {
  if (level === null) return null;
  return priceBandSymbols(destination)[priceLevelOrder.indexOf(level)] ?? null;
}

function styledBestCandidate(candidates: HotelCandidate[], style: HotelStyleChoice) {
  if (style === "recommended") return candidates[0] ?? null;
  // A dateless reference minimum or a relative price band cannot establish
  // live value. Keep the value style unavailable until a dated, comparable
  // availability source exists.
  if (style === "value") return null;
  return candidates.find((candidate) => candidate.styles.includes(style)) ?? null;
}

const weekdayNames = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
} as const;

function weekdayInfo(date: string | null | undefined, locale: PlannerLocale) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = parsed.getUTCDay();
  return { label: weekdayNames[locale][day], isWeekend: day === 0 || day === 6, isSunday: day === 0 };
}

function addCalendarDays(date: string, dayOffset: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + dayOffset);
  return parsed.toISOString().slice(0, 10);
}

function clampTripDays(value: number) {
  return Math.min(14, Math.max(1, Math.round(value)));
}

function formatDistanceMeters(meters: number) {
  return meters < 950 ? `${Math.max(10, Math.round(meters / 10) * 10)}m` : `${(meters / 1000).toFixed(1)}km`;
}

function placeCandidateLabel(candidate: ResolvedInputStop, anchors: ResolvedInputStop[], locale: PlannerLocale) {
  const nearest = anchors
    .filter((anchor) => anchor.id !== candidate.id)
    .map((anchor) => straightLineDistanceKm(candidate, anchor))
    .sort((left, right) => left - right)[0];
  const type = candidate.placeTypes?.[0]?.replaceAll("_", " ");
  const parts = [
    candidate.address || candidate.area,
    candidate.countryCode,
    type,
    typeof nearest === "number" && Number.isFinite(nearest)
      ? locale === "ja" ? `他の場所から約${nearest.toFixed(nearest < 10 ? 1 : 0)}km` : `about ${nearest.toFixed(nearest < 10 ? 1 : 0)} km from another stop`
      : null,
  ].filter(Boolean);
  return `${candidate.name} — ${parts.join(" · ")}`;
}

function resolvedStopAddress(stop: RouteStop | ResolvedInputStop | null | undefined) {
  if (!stop) return "";
  return "address" in stop && typeof stop.address === "string" && stop.address ? stop.address : stop.area;
}

function storedTripShareCode(entry: StoredTripRecord) {
  const direct = entry.payload.input.shareCode;
  if (typeof direct === "string") return direct;
  const legacy = entry.payload.input.legacyShareCode;
  return typeof legacy === "string" ? legacy : null;
}

function storedTripInput(entry: StoredTripRecord) {
  const code = storedTripShareCode(entry);
  return code ? decodeTripShare(code) : null;
}

function newDeviceTripId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* Axis winners are asserted only against comparable facts. Dateless reference
 * minimums remain display facts, never a "best value" ranking. */
function hotelAxisWinners(candidates: HotelCandidate[]) {
  if (candidates.length < 2) return { nearestId: null as string | null, topRatedId: null as string | null, valueId: null as string | null };
  let nearest = candidates[0];
  let topRated: HotelCandidate | null = null;
  for (const candidate of candidates) {
    if (
      candidate.routeBurdenMeters < nearest.routeBurdenMeters
      || (candidate.routeBurdenMeters === nearest.routeBurdenMeters && candidate.routeWorstDistanceMeters < nearest.routeWorstDistanceMeters)
    ) nearest = candidate;
    const count = candidate.userRatingCount ?? 0;
    if (candidate.rating !== null && count >= 50) {
      const bestRating = topRated?.rating ?? -1;
      const bestCount = topRated?.userRatingCount ?? 0;
      if (candidate.rating > bestRating || (candidate.rating === bestRating && count > bestCount)) topRated = candidate;
    }
  }
  return { nearestId: nearest.id, topRatedId: topRated?.id ?? null, valueId: null as string | null };
}

/** Keep the current choice visible, then protect price and satisfaction axes. */
function hotelShortlist(candidates: HotelCandidate[], selectedId?: string | null) {
  const axes = hotelAxisWinners(candidates);
  const ids = (selectedId
    ? [selectedId, axes.valueId, axes.topRatedId, axes.nearestId, candidates[0]?.id]
    : [axes.nearestId, axes.valueId, axes.topRatedId, candidates[0]?.id])
    .filter((id): id is string => Boolean(id));
  const ordered = [...new Set(ids)]
    .flatMap((id) => candidates.find((candidate) => candidate.id === id) ?? []);
  for (const candidate of candidates) {
    if (ordered.length >= 3) break;
    if (!ordered.some((entry) => entry.id === candidate.id)) ordered.push(candidate);
  }
  return ordered.slice(0, 3);
}

function builtPlanTravelMinutes(plan: BuiltTripPlan) {
  return plan.days.reduce((sum, planDay) => (
    sum
    + (planDay.hotelOutboundMinutes ?? 0)
    + (planDay.hotelInboundMinutes ?? 0)
    + planDay.legs.reduce((legSum, leg) => legSum + leg.comparison.recommended.minutes, 0)
  ), 0);
}

function clockToMinutes(value: string) {
  const match = /^(?:([01]?\d|2[0-3])):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clockRangeContainsVisit(range: string, arrival: string, departure: string) {
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

type ParsePreviewRow =
  | { type: "day"; day: number }
  | { type: "warn"; raw: string }
  | { type: "place"; place: ParsedWishlistPlace; showDay: boolean; placeIndex: number };

type PlannerEditState = {
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
};

// Product / UX specification v0.3 promotes route-aware hotels, meals and one
// useful gap-filler per day into the core completion experience.  Keep the
// switch explicit so a provider incident can still be isolated without
// weakening the deterministic feasibility engine.
const P0_CORE_ONLY = false;
const P1_TRAVEL_ENRICHMENTS = false;
const initialBuildProgress: BuildProgress = {
  stage: "resolving",
  current: 0,
  total: 0,
  reviewCount: 0,
  publicCount: 0,
  socialCount: 0,
};

/* "Tomorrow" means tomorrow where the trip happens. Until a destination is
 * known, the traveller's own clock is the least surprising answer. */
function plannerTimeZone(destination: Destination) {
  if (destination.id !== "worldwide") return destination.timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function defaultTripDate(destination: Destination = destinationById("worldwide")) {
  return localDateIn(plannerTimeZone(destination), new Date(Date.now() + 86_400_000));
}

async function mapWithConcurrency<T, R>(
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

type AirportGroup = { label: string | null; options: Array<{ value: AirportCode; label: string }> };

function legModeLabel(mode: TransportMode, locale: PlannerLocale) {
  return ui[locale].move[mode];
}

function printTransferCopy(
  leg: BuiltTripPlan["days"][number]["legs"][number],
  maxTransfers: number,
  locale: PlannerLocale,
) {
  if (leg.comparison.recommended.mode !== "transit") return "";
  if (leg.transferCount === null) return locale === "ja" ? " · 乗換回数 未確認" : " · transfers unverified";
  const count = locale === "ja"
    ? `乗換${leg.transferCount}回`
    : `${leg.transferCount} transfer${leg.transferCount === 1 ? "" : "s"}`;
  const excess = Math.max(0, leg.transferCount - maxTransfers);
  if (excess === 0) return ` · ${count}`;
  return locale === "ja" ? ` · ${count}（上限+${excess}回）` : ` · ${count} (limit +${excess})`;
}

function airportOptionsFor(locale: PlannerLocale, destination: Destination): AirportGroup[] {
  const gateways = (candidate: Destination) => candidate.airports.map((airport) => ({
    value: airport.code as AirportCode,
    label: `${airport.code} · ${locale === "ja" ? airport.names.ja : airport.names.en}`,
  }));
  const empty: AirportGroup = { label: null, options: [{ value: "none", label: locale === "ja" ? "未指定" : "Not specified" }] };
  if (destination.id !== "worldwide") return [empty, { label: null, options: gateways(destination) }];
  // Before a country is known, offer every gateway grouped by country: a
  // traveller should be able to enter their flight before the first build.
  return [
    empty,
    ...destinations
      .filter((candidate) => candidate.airports.length > 0)
      .map((candidate) => ({ label: destinationName(candidate, locale), options: gateways(candidate) }))
      .sort((left, right) => left.label.localeCompare(right.label, locale === "ja" ? "ja" : "en")),
  ];
}

function airportComparisonDestination(active: Destination, airportCode: AirportCode) {
  if (active.id !== "worldwide" || airportCode === "none") return active;
  return destinations.find((candidate) => candidate.airports.some((airport) => airport.code === airportCode)) ?? active;
}

function formatDuration(minutes: number, locale: PlannerLocale) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (locale === "ja") return hours > 0 ? `${hours}時間${remainder > 0 ? `${remainder}分` : ""}` : `${remainder}分`;
  return hours > 0 ? `${hours}h${remainder > 0 ? ` ${remainder}m` : ""}` : `${remainder}m`;
}

function feasibilityStateCopy(state: FeasibilityState, locale: PlannerLocale, days: number, stops: number) {
  if (locale === "ja") {
    if (state === "VERIFIED_FEASIBLE") return { label: `全${stops}か所`, headline: `${days}日なら回れます` };
    if (state === "PROVISIONAL_FEASIBLE") return { label: `全${stops}か所`, headline: `${days}日で回れそうです` };
    if (state === "FEASIBLE_IF_ASSUMPTIONS") return { label: "確認が必要", headline: `${days}日案は確認が必要です` };
    if (state === "INFEASIBLE_HARD_CONFLICT") return { label: "要修正", headline: "このままでは回れません" };
    return { label: "判定保留", headline: "場所を確認すると判定できます" };
  }
  if (state === "VERIFIED_FEASIBLE") return { label: `${stops} places`, headline: `${days} day${days === 1 ? "" : "s"} works` };
  if (state === "PROVISIONAL_FEASIBLE") return { label: `${stops} places`, headline: `${days} day${days === 1 ? "" : "s"} should work` };
  if (state === "FEASIBLE_IF_ASSUMPTIONS") return { label: "Check needed", headline: `Confirm a few details for this ${days}-day plan` };
  if (state === "INFEASIBLE_HARD_CONFLICT") return { label: "Needs a change", headline: "This plan will not work as it is" };
  return { label: "Not decided", headline: "Confirm the places to finish the plan" };
}

function feasibilityStateIcon(state: FeasibilityState): IconName {
  if (state === "VERIFIED_FEASIBLE") return "check";
  if (state === "PROVISIONAL_FEASIBLE") return "signal";
  if (state === "FEASIBLE_IF_ASSUMPTIONS") return "spark";
  if (state === "INFEASIBLE_HARD_CONFLICT") return "close";
  return "search";
}

function conflictCopy(conflict: Conflict, locale: PlannerLocale) {
  const item = conflict.affectedItems[0] ?? (locale === "ja" ? "この予定" : "This plan");
  const minutes = conflict.overrunMinutes ?? 0;
  if (locale === "ja") {
    if (conflict.code === "AIRPORT_CUTOFF") return `${item}を含む日程が、空港へ向かう締切を${minutes}分超えます。`;
    if (conflict.code === "FIXED_BOOKING_LATE") return `${item}の予約時刻に約${minutes}分遅れます。`;
    if (conflict.code === "CLOSED_ON_FIXED_DAY") return `${item}は固定した日に営業していない可能性があります。`;
    if (conflict.code === "OPENING_HOURS_CONFLICT") return `${item}の営業時間内に滞在を収められません。`;
    if (conflict.code === "LAST_ENTRY_CONFLICT") return `${item}の到着が、指定した最終入場時刻を過ぎます。`;
    if (conflict.code === "PLACE_UNAVAILABLE") return `${item}を現在の日付・営業時間では配置できません。`;
    if (conflict.code === "DAY_END_OVERRUN") return `${item}の日程が終了時刻を${minutes}分超えます。`;
    return `${item}の日程が利用できる時間を${minutes}分超えます。`;
  }
  if (conflict.code === "AIRPORT_CUTOFF") return `The day containing ${item} runs ${minutes} minutes past the airport cutoff.`;
  if (conflict.code === "FIXED_BOOKING_LATE") return `The plan reaches ${item} about ${minutes} minutes after its booking time.`;
  if (conflict.code === "CLOSED_ON_FIXED_DAY") return `${item} may be closed on its fixed day.`;
  if (conflict.code === "OPENING_HOURS_CONFLICT") return `${item} cannot fit inside its available opening window.`;
  if (conflict.code === "LAST_ENTRY_CONFLICT") return `The plan reaches ${item} after its specified last-entry cutoff.`;
  if (conflict.code === "PLACE_UNAVAILABLE") return `${item} could not be placed on any available day.`;
  if (conflict.code === "DAY_END_OVERRUN") return `The day containing ${item} runs ${minutes} minutes past its end time.`;
  return `The day containing ${item} exceeds its usable time by ${minutes} minutes.`;
}

function attentionCopy(attention: Attention, locale: PlannerLocale) {
  if (attention.code === "TRANSIT_NON_CONVERGED") return locale === "ja"
    ? "公共交通の時刻を反映した再計算が上限内に安定しませんでした。観測した最長時間を使った条件付き日程です。"
    : "The transit-timed replan did not stabilize within the safety limit. This conditional schedule uses the longest observed durations.";
  if (attention.code === "WALKING_LIMIT_EXCEEDED") return locale === "ja"
    ? `${attention.affectedItems.join(" → ")}の徒歩が設定上限を${attention.minutes ?? 0}分超えます。移動手段を変更してください。`
    : `Walking ${attention.affectedItems.join(" → ")} exceeds your per-leg limit by ${attention.minutes ?? 0} minutes. Choose another mode.`;
  if (attention.code === "TRANSFER_LIMIT_EXCEEDED") return locale === "ja"
    ? `${attention.affectedItems.join(" → ")}は乗換${attention.transferCount ?? "?"}回で、設定上限${attention.transferLimit ?? "?"}回を超えます。固定条件を守ったまま、別の移動手段も比較してください。`
    : `${attention.affectedItems.join(" → ")} needs ${attention.transferCount ?? "?"} transfers, above your limit of ${attention.transferLimit ?? "?"}. Compare another mode without silently changing a locked choice.`;
  if (attention.code === "LOW_BUFFER") return locale === "ja"
    ? `${attention.affectedItems[0]}の余白は${attention.minutes ?? 0}分です。遅れが出ると次の予定へ影響します。`
    : `${attention.affectedItems[0]} has ${attention.minutes ?? 0} minutes of buffer. A delay can affect the next stop.`;
  return locale === "ja"
    ? `営業時間・拠点など、未確認の重要情報が${attention.affectedItems.length}件あります。`
    : `${attention.affectedItems.length} critical facts, such as hours or the base, are still unverified.`;
}

function assumptionCopy(assumption: Assumption, locale: PlannerLocale) {
  const labels = locale === "ja" ? {
    DATE_PROVISIONAL: "旅行日は仮の日付",
    BASE_UNKNOWN: "ホテル・拠点は未指定",
    DAY_START_DEFAULT: "各日の開始時刻は初期値を使用",
    DAY_END_DEFAULT: "1日の終了は22:00と仮定",
    STAY_DURATION_ESTIMATED: `滞在時間${assumption.count}件は推定`,
    ROUTE_ESTIMATED: `移動${assumption.count}区間は推定`,
    OPENING_HOURS_UNKNOWN: `営業時間${assumption.count}件は未確認`,
    LAST_ENTRY_ESTIMATED: `最終入場${assumption.count}件は推定`,
    AIRPORT_TRANSFER_ESTIMATED: `空港の手続き・市内移動${assumption.count}件は推定`,
    TRANSFER_BUFFER: "各移動後に選択した乗換・道迷い余白を加算",
    WALKING_LIMIT_DEFAULT: "1区間の徒歩上限は標準30分を使用",
    TRANSFER_LIMIT_DEFAULT: "1区間の乗換上限は標準2回を使用",
    TRANSFER_COUNT_UNKNOWN: `乗換回数${assumption.count}区間は提供元から未取得`,
    TRANSIT_NON_CONVERGED: "時刻別の公共交通経路データを反映した日程が反復上限内に安定せず、取得できた最長時間を使用",
  } : {
    DATE_PROVISIONAL: "The trip date is provisional",
    BASE_UNKNOWN: "No hotel or base is confirmed",
    DAY_START_DEFAULT: "Day start times use the current default",
    DAY_END_DEFAULT: "Days are assumed to end at 22:00",
    STAY_DURATION_ESTIMATED: `${assumption.count} stay durations are estimated`,
    ROUTE_ESTIMATED: `${assumption.count} route legs are estimated`,
    OPENING_HOURS_UNKNOWN: `${assumption.count} opening-hour facts are unverified`,
    LAST_ENTRY_ESTIMATED: `${assumption.count} last-entry cutoffs are estimated`,
    AIRPORT_TRANSFER_ESTIMATED: `${assumption.count} airport processing or transfer times are estimated`,
    TRANSFER_BUFFER: "The selected wayfinding buffer is added after every travelled leg",
    WALKING_LIMIT_DEFAULT: "The standard 30-minute per-leg walking limit is used",
    TRANSFER_LIMIT_DEFAULT: "The standard limit of 2 transfers per leg is used",
    TRANSFER_COUNT_UNKNOWN: `Transfer counts are unavailable for ${assumption.count} route legs`,
    TRANSIT_NON_CONVERGED: "The transit-timed itinerary did not stabilize within the bounded loop, so it uses the longest observed durations",
  };
  return labels[assumption.code];
}

function alternativeCopy(alternative: AlternativePlan, locale: PlannerLocale) {
  const improvement = [
    alternative.improvement.hardConflictsRemoved > 0
      ? locale === "ja" ? `固定衝突-${alternative.improvement.hardConflictsRemoved}` : `${alternative.improvement.hardConflictsRemoved} hard conflict${alternative.improvement.hardConflictsRemoved === 1 ? "" : "s"} removed`
      : null,
    alternative.improvement.overrunMinutesReduced > 0
      ? locale === "ja" ? `超過-${alternative.improvement.overrunMinutesReduced}分` : `${alternative.improvement.overrunMinutesReduced} min less overrun`
      : null,
    (alternative.improvement.slackMinutesGained ?? 0) > 0
      ? locale === "ja" ? `最小余白+${alternative.improvement.slackMinutesGained}分` : `+${alternative.improvement.slackMinutesGained} min minimum slack`
      : null,
    alternative.improvement.travelMinutesReduced > 0
      ? locale === "ja" ? `移動-${alternative.improvement.travelMinutesReduced}分` : `${alternative.improvement.travelMinutesReduced} min less travel`
      : null,
  ].filter(Boolean).join(" · ");
  if (alternative.kind === "CHANGE_DAYS") {
    const days = alternative.change.days ?? alternative.after.dayCount;
    const dayDelta = alternative.change.dayDelta ?? days - alternative.before.dayCount;
    return locale === "ja"
      ? { title: `${days}日案を比較`, detail: `${dayDelta > 0 ? `${dayDelta}日追加` : `${Math.abs(dayDelta)}日短縮`}${improvement ? ` · ${improvement}` : ""}` }
      : { title: `Compare a ${days}-day plan`, detail: `${dayDelta > 0 ? `Add ${dayDelta} day${dayDelta === 1 ? "" : "s"}` : `Use ${Math.abs(dayDelta)} fewer day${Math.abs(dayDelta) === 1 ? "" : "s"}`}${improvement ? ` · ${improvement}` : ""}` };
  }
  if (alternative.kind === "START_EARLIER") return locale === "ja"
    ? { title: `${alternative.change.minutes ?? 60}分早く始める`, detail: improvement }
    : { title: `Start ${alternative.change.minutes ?? 60} minutes earlier`, detail: improvement };
  if (alternative.kind === "END_LATER") return locale === "ja"
    ? { title: `${alternative.change.minutes ?? 60}分遅く終える`, detail: improvement }
    : { title: `Finish ${alternative.change.minutes ?? 60} minutes later`, detail: improvement };
  if (alternative.kind === "CHANGE_BASE") return locale === "ja"
    ? { title: `拠点を${alternative.change.baseName ?? "候補"}に変更`, detail: improvement }
    : { title: `Use ${alternative.change.baseName ?? "the suggested base"}`, detail: improvement };
  if (alternative.kind === "CHANGE_MODE") {
    const from = alternative.change.fromName ?? (locale === "ja" ? "出発地" : "the first stop");
    const to = alternative.change.toName ?? (locale === "ja" ? "到着地" : "the next stop");
    const mode = alternative.change.mode
      ? locale === "ja"
        ? { walk: "徒歩", transit: "公共交通", taxi: "タクシー" }[alternative.change.mode]
        : { walk: "walking", transit: "transit", taxi: "taxi" }[alternative.change.mode]
      : locale === "ja" ? "別の移動手段" : "another mode";
    const tradeoff = alternative.change.mode === "taxi"
      ? locale === "ja" ? "所要時間を短縮できますが、運賃が増えます" : "Saves time but adds a fare"
      : alternative.change.mode === "walk"
        ? locale === "ja" ? "運賃を抑えられますが、歩行負荷が増えます" : "Avoids a fare but adds walking effort"
        : locale === "ja" ? "乗換や待ち時間が発生する場合があります" : "May add transfers or waiting time";
    return locale === "ja"
      ? { title: `${from} → ${to}を${mode}に変更`, detail: `${tradeoff}${improvement ? ` · ${improvement}` : ""}` }
      : { title: `Use ${mode} from ${from} to ${to}`, detail: `${tradeoff}${improvement ? ` · ${improvement}` : ""}` };
  }
  if (alternative.kind === "OPTIMIZE_ORDER") return locale === "ja"
    ? { title: "日ごとの移動を減らす順番にする", detail: `元の日別割当と固定条件を守り、行順だけを解放${improvement ? ` · ${improvement}` : ""}` }
    : { title: "Use a lower-travel order", detail: `Keeps day assignments and fixed constraints, while releasing pasted line order${improvement ? ` · ${improvement}` : ""}` };
  const stopName = alternative.change.stopName ?? alternative.loss?.stopName ?? "Optional";
  const stayMinutes = alternative.loss?.stayMinutes ?? 0;
  return locale === "ja"
    ? { title: `${stopName}を外して比較`, detail: `失うもの: ${stopName}（滞在${stayMinutes}分）${improvement ? ` · ${improvement}` : ""}` }
    : { title: `Compare without ${stopName}`, detail: `Trade-off: lose ${stopName} (${stayMinutes} min)${improvement ? ` · ${improvement}` : ""}` };
}

function alternativeLossCopy(alternative: AlternativePlan, locale: PlannerLocale) {
  if (!alternative.loss) return null;
  if (alternative.loss.kind === "ORIGINAL_ORDER") return locale === "ja"
    ? "失うもの: 入力した行順。日別割当、予約、固定時刻、固定した移動手段は維持します。"
    : "Trade-off: release the pasted line order. Day assignments, bookings, fixed times and locked modes stay protected.";
  if (alternative.loss.kind === "TRANSPORT_TRADEOFF") {
    const mode = alternative.loss.mode
      ? locale === "ja"
        ? { walk: "徒歩", transit: "公共交通", taxi: "タクシー" }[alternative.loss.mode]
        : { walk: "walking", transit: "transit", taxi: "taxi" }[alternative.loss.mode]
      : locale === "ja" ? "別の移動手段" : "another mode";
    return locale === "ja"
      ? `交換条件: ${mode}に固定すると、費用・歩行・乗換の負担が変わります。`
      : `Trade-off: locking ${mode} changes fare, walking effort, or transfer load.`;
  }
  const stopName = alternative.loss.stopName ?? alternative.change.stopName ?? "Optional";
  return locale === "ja" ? `失うもの: ${stopName}` : `Trade-off: remove ${stopName}`;
}

function minimumDaysCopy(result: FeasibilityResult, locale: PlannerLocale) {
  if (result.minimumDays === null) {
    // Name the actual blocker instead of reciting every theoretical cause.
    const unresolved = result.unresolvedPlaceNames;
    if (unresolved.length > 0) {
      const names = unresolved.slice(0, 2).join(locale === "ja" ? "・" : ", ")
        + (unresolved.length > 2 ? (locale === "ja" ? ` 他${unresolved.length - 2}件` : ` +${unresolved.length - 2} more`) : "");
      if (result.partialMinimumDays !== null) {
        return locale === "ja"
          ? `「${names}」が未確定のため判定を保留しています。確定済みの場所だけなら最短${result.partialMinimumDays}日です。上の「確認する」から場所を確定してください。`
          : `On hold because “${names}” is not settled yet. The confirmed places alone need at least ${result.partialMinimumDays} day${result.partialMinimumDays === 1 ? "" : "s"}. Use “Confirm” above to settle the place.`;
      }
      return locale === "ja"
        ? `「${names}」が未確定のため、最短日数はまだ判定できません。上の「確認する」から場所を確定するか、入力を直してください。`
        : `Minimum days are withheld because “${names}” is not settled. Use “Confirm” above to pick the place, or edit the input.`;
    }
    if (result.searchedThroughDays > 0) return locale === "ja"
      ? `${result.searchedThroughDays}日まで探索しましたが、重要な事実が足りないか固定条件が競合しています。`
      : `Searched through ${result.searchedThroughDays} days; critical evidence is missing or a fixed constraint conflicts.`;
    return locale === "ja"
      ? "未解決の場所・対応範囲外の日指定・または計算上限のため、最短日数はまだ判定していません。"
      : "Minimum days are withheld until unresolved places, unsupported day pins, or the solve limit are cleared.";
  }
  const assumptions = result.minimumDaysAssumptions;
  const windows = assumptions.dayWindows.map((window) => `${window.start}–${window.end}`);
  const uniqueWindows = [...new Set(windows)];
  const windowCopy = uniqueWindows.length === 1
    ? uniqueWindows[0]
    : locale === "ja" ? `${windows.length}日それぞれの時間枠` : `the ${windows.length} per-day time windows`;
  const base = assumptions.base.name ?? (locale === "ja" ? "仮の拠点" : "the provisional base");
  const stayCount = assumptions.stayDurations.length;
  return locale === "ja"
    ? `${windowCopy}・拠点「${base}」・${stayCount}件の滞在時間・移動ごと${assumptions.transferBufferMinutes}分の余白では、最短${result.minimumDays}日です。`
    : `With ${windowCopy}, base “${base}”, ${stayCount} stay durations and ${assumptions.transferBufferMinutes}-minute leg buffers, the minimum is ${result.minimumDays} day${result.minimumDays === 1 ? "" : "s"}.`;
}

const ui = {
  ja: {
    brandNote: (place: string) => place ? `${place}の旅プランナー` : "旅のプランナー",
    destination: "行き先の国",
    destinationSearch: "国名を入力して選択",
    airportSearch: "空港名・都市・3レターコードで検索",
    noMatchingOption: "一致する候補がありません",
    optionCount: (count: number) => `${count}件の候補`,
    localNotes: (place: string) => `${place}で予定が崩れやすいところ`,
    newTrip: "新しい旅",
    headline: "どこへ行きたい？",
    subhead: "行きたい場所を、思いつくまま入れてください。近い場所を同じ日にまとめて、地図に一日の流れを描きます。",
    inputLabel: "行きたい場所",
    placeholder: "例）\n1日目\n浅草寺\nチームラボプラネッツ 15:30 予約\n2日目\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば",
    sample: "サンプルを見る",
    swissDemo: "スイスデモ",
    parseHint: "改行のほか「・」「／」「,」でまとめて貼っても、場所ごとに分けます。「1日目」、時刻、予約、必須、滞在時間も読み取ります。地名は現地表記でも英語でも大丈夫です。",
    previewHeading: (count: number) => `${count}か所として読み取り`,
    previewFormat: "1件ずつに整える",
    previewCheck: "違う場所があれば、上の入力欄で直せます",
    previewDay: (day: number) => `${day}日目`,
    previewUnparsed: "場所名として読み取れない行",
    previewStay: (minutes: number) => `滞在${minutes}分`,
    days: "日数",
    date: "初日",
    hotel: "ホテル名・泊まりたいエリア",
    hotelPlaceholder: "例：中央駅の近く（未定でもOK）",
    details: "空港・ペース・食事の設定",
    arrival: "到着空港",
    arrivalTime: "到着時刻",
    departure: "出発空港",
    departureTime: "出発時刻",
    pace: "旅のペース",
    meal: "食事の提案",
    travelHeading: "移動手段",
    travelAuto: "おまかせ（効率重視）",
    travelCar: "レンタカー・車",
    moveCar: "車",
    timebandHeading: "1日の時間帯",
    timebandEarly: "朝型 8:00〜",
    timebandNormal: "標準 9:00〜",
    timebandLate: "ゆっくり 10:30〜",
    dayEndHeading: "1日の終わり",
    dayEndNone: "標準 22:00",
    curfewOver: (time: string) => `${time} までに収まっていません`,
    conceptLabel: "コンセプトから作る",
    conceptPlaceholder: "例：大阪 食い倒れ 2泊3日",
    conceptRun: "たたき台を出す",
    conceptRunning: "候補を考えています…",
    conceptNote: "この文章は候補作成時だけAnthropicへ送信されます。個人情報は書かないでください。候補の実在はGoogleで確認します。",
    conceptUnavailable: "いまは提案を作れませんでした。少し待って再試行してください。",
    conceptNotConfigured: "AI提案は一時停止中、または未設定です。",
    conceptRateLimited: "提案の回数上限に達しました。しばらくしてからどうぞ。",
    recentHeading: "最近の旅程",
    recentNote: "この端末の中だけに保存されます",
    recentDays: (days: number) => `${days}日間`,
    recentDelete: "削除",
    moveDay: "日を移動",
    mealChoose: "この店にする",
    mealChosen: "行程に入れました",
    share: "共有リンク",
    shareCopied: "コピーしました",
    shareTitle: "この旅程を同じ設定で開けるリンクをコピーします。内容はリンクの中だけに入り、サーバには保存されません。",
    relaxed: "ゆったり",
    balanced: "標準",
    fast: "たくさん回る",
    allMeals: "昼・夜",
    dinner: "夜だけ",
    noMeals: "表示しない",
    build: "地図にする",
    building: "場所を確認しています…",
    buildingTitle: "予定をつくっています",
    buildingBody: "場所・営業時間・拠点を確認し、固定条件を破らない予定を計算します。",
    buildingBodyNoSocial: "場所・営業時間・拠点を確認し、固定条件を破らない予定を計算します。経路データは表示後に反映します。",
    buildingCancel: "入力にもどる",
    buildSteps: {
      resolving: "場所を地図で確認",
      hotel: "実在するホテルを比較",
      reviews: "最終地点の営業時間を確認",
      scheduling: "固定条件と時刻を計算",
    },
    progressPlaces: (current: number, total: number) => `${current}/${total}か所を確認`,
    progressReviews: (count: number) => { void count; return "取得できた営業時間だけを反映します"; },
    progressScheduling: "予約・空港・営業時間・終了時刻を照合します",
    mapReady: "Googleマップ",
    mapEmpty: "行き先を入れると、ここに旅が描かれます",
    routeIdeasChip: "今日の予定の近く",
    routeIdeasTitle: "今日の予定の近くなら、ここも寄れます",
    routeIdeasSubtitle: "今日の実経路と予定地点の周辺から、評価の裏付けがある場所だけを探しました。",
    routeIdeasLoading: "動線上の候補を探しています…",
    routeIdeasUnavailable: "いまは動線上の候補を取得できませんでした。予定そのものはそのまま使えます。",
    routeIdeasRateLimited: "今日の無料検索枠に達しました。予定そのものはそのまま使えます。",
    routeIdeasEmpty: "評価と近さの両方を満たす候補は見つかりませんでした。無理に場所を足していません。",
    routeIdeasDistance: (meters: number) => meters < 1_000 ? `予定経路から約${meters}m` : `予定経路から約${(meters / 1_000).toFixed(1)}km`,
    routeIdeasAdd: "この日に追加して再計算",
    routeIdeasAdded: "追加済み",
    routeIdeasNote: "評価はGoogle Maps、近さは取得できたGoogle実経路（未取得区間は予定地点）への概算距離です。追加後の順番と移動時間はTripCheckが再計算します。自動では追加しません。",
    edit: "入力にもどる",
    planSummary: (days: number, stops: number) => `${days}日間 · ${stops}か所`,
    openMaps: "Google Mapsで開く",
    stay: "滞在",
    removeStop: "この行き先を予定から外す",
    removedHeading: "自分で外した場所",
    restoreStop: "もどす",
    backToPlan: "作成した計画にもどる",
    hotelDepartRow: (mode: string, minutes: number) => `ホテルから ${mode} 約${minutes}分`,
    hotelReturnRow: (mode: string, minutes: number) => `ホテルへ ${mode} 約${minutes}分`,
    travelTotal: (minutes: number) => `移動 合計約${minutes}分`,
    precipitation: (percent: number) => `降水${percent}%`,
    forecastNote: "Open-Meteo予報",
    holidayBadge: "祝",
    holidayNote: (name: string) => `祝日「${name}」— 美術館・商店は休業・短縮営業の可能性。営業時間の再確認を`,
    holidayRegional: "（一部地域のみ）",
    sundayClosingNote: "日曜 — 閉店法で商店・スーパーはほぼ休業（駅ナカ店舗は例外が多い）",
    flightKindHeading: "フライトの種類",
    flightInternational: "国際線",
    flightDomestic: "国内線",
    essentialsHeading: (place: string) => `${place}の基本情報`,
    essentialsPlug: "電源プラグ",
    essentialsTipping: "チップ",
    essentialsWater: "水道水",
    essentialsEmergency: "緊急通報",
    essentialsEntry: "入国（日本のパスポート）",
    essentialsPass: "交通パス",
    essentialsOfficial: "公式情報",
    essentialsMoney: "支払い",
    essentialsTransit: "交通の注意",
    beforeStrike: "スト・運休の確認",
    beforeMedication: "薬の持ち込み",
    beforeMedicationNote: "常用薬は元の箱・説明書きのまま携行（一包化は中身不明扱いのリスク）。向精神薬成分や多量の持込みは事前手続きが必要な国がある。米国はFDA未認可薬だと処方箋があっても没収されることがある。",
    essentialsFx: "為替の目安",
    essentialsFxLine: (unit: number, code: string, yen: string, asOf: string) => `${unit} ${code} ≈ ${yen}円（${asOf}時点・参考レート）`,
    essentialsDcc: "会計・ATMで「日本円で払うか」と聞かれたら必ず現地通貨を選ぶ（円建て＝DCCは3〜10%割高）。日本発行カードは海外事務手数料〜2.2%が別途。",
    essentialsDisclaimer: "一般的な目安です。制度は変わるため、出発前に必ず公式情報を確認してください。",
    beforeHeading: "出発前チェック",
    beforeOverdue: "要対応",
    beforeDueSoon: "期限接近",
    beforePassportLabel: "パスポートの有効期限",
    beforePassportHint: "残存期間チェック用。この端末にのみ保存されます。",
    passportCountry: "パスポートの国",
    passportUnset: "未選択（入国判定を表示しない）",
    passportJapan: "日本",
    passportOther: "その他",
    passportUnsupported: "現在の個別入国判定は日本のパスポートのみ対応。その他は目的地の公式情報を確認してください。",
    beforeBooked: "予約済みとして計画 — バウチャーと入場方法を確認",
    beforeBookedAt: (time: string) => `${time}に予約済みとして計画 — バウチャーと入場方法を確認`,
    beforeWatch: "売り切れ・行列の報告あり — 事前予約か朝イチを検討",
    print: "印刷 / PDF",
    printTitle: "全日程を1枚にして印刷・PDF保存（オフライン用）",
    printBooked: "予約",
    printFooter: "時間は計画用の目安です。移動と営業時間は現地で最終確認してください。 · Weather by Open-Meteo",
    legModes: "この区間の移動手段。タップで固定、もう一度タップで自動に戻す",
    move: { walk: "徒歩", transit: "電車", taxi: "タクシー" },
    minutes: (value: number) => `${value}分`,
    legLive: "Google Maps経路",
    unknown: "地図に出せなかった場所",
    placeFallback: "見つからなかった場所があります。確認できた場所だけで組み立てています。",
    noDays: "地図に置ける場所がまだありません。名前を少し変えると見つかることがあります。",
    openDay: "この日はまだ予定がありません",
    selectHint: "ピンや行き先をタップすると、詳しい情報が開きます",
    mealIdeas: "この土地なら、まずこれ",
    lunchChip: "昼ごはん",
    dinnerChip: "夜ごはん",
    foodLoading: "近くのお店を探しています…",
    foodUnavailable: "お店を取得できませんでした。Google Mapsで同じ条件を開けます。",
    maps: "地図で見る",
    foodNote: "Googleの評価・口コミ量・距離・営業表示をロジックで比較。公開SNSは引用できた情報だけを補足しています。",
    foodFresh: (count: number) => `最近の公開情報 ${count}件`,
    hotelChip: "ホテル",
    hotelCandidate: "おすすめのホテル",
    hotelAlternatives: "ほかの候補",
    hotelNoAvailability: "料金・空室は宿泊サイトで最終確認してください。",
    hotelUnavailable: "ホテル候補を取得できませんでした。",
    hotelSearch: "Google Mapsでホテルを探す",
    hotelRefresh: "ホテルを再検索",
    hotelRefreshChanged: "変更後の行程でホテルを再検索",
    hotelRefreshing: "ホテルを探し直しています…",
    hotelRefreshHint: "行き先が変わったため、ホテル候補も更新できます。",
    hotelRefreshFailed: "再検索できませんでした。今のホテルはそのまま残しています。",
    stayModeHeading: "泊まり方",
    staySame: "同じホテルで通す",
    stayNightly: "日ごとに変える",
    nightLabel: (night: number) => `${night}泊目`,
    nightlyLoading: "夜ごとの候補を探しています…",
    nightlyUnavailable: "日ごとの候補を取得できませんでした。共通のホテルのまま計画しています。",
    nightlyNightMissing: "この夜は候補を取得できず、共通のホテルのままです。",
    styleRecommended: "おすすめ",
    styleLuxury: "ラグジュアリー",
    styleValue: "参考価格あり",
    styleNote: "参考価格は日付・空室未指定のため、コスパ順位には使いません。",
    hotelRankNote: "各日の行き先を1日1票で比較し、直線距離の平均と最も遠い日の負担が小さいホテルを優先。そこへGoogle評価と口コミ量を加えて総合順位を決めます。実際の所要時間は地図の経路で確認します。",
    hotelCompareHeading: "候補を比べる（タップで切り替え）",
    priceUnlisted: "価格未掲載",
    rakutenTag: (average: number, count: number) => `楽天トラベル ★${average.toFixed(1)}（${count.toLocaleString("ja-JP")}件）`,
    hotelPriceNote: "¥価格は楽天トラベル掲載の参考最安（日付未指定）です。",
    hotelReasonTop: "全日程への行きやすさ・評価・口コミ量の合計で1位の候補です。",
    hotelReasonNearest: "各日の行き先への距離負担が最も小さい候補です。",
    hotelReasonRated: "十分な口コミ数がある候補の中で、Google評価が最も高いホテルです。",
    hotelReasonValue: "参考価格は表示しますが、日付と空室が未確認のためコスパ1位とは判定しません。",
    hotelReasonSpecified: "入力したホテル名に一致した候補です。行程の出発・帰着地点にも反映しています。",
    hotelReasonPicked: "切り替えて選んだ候補です。",
    hotelPurposeHeading: "何を優先する？",
    hotelPurposeBalanced: "総合",
    hotelPurposeNearest: "移動を少なく",
    hotelPurposeRated: "評価重視",
    hotelPurposeValue: "価格比較は準備中",
    hotelPurposeHelp: "総移動時間と評価を比較します。価格・空室は予約サイトで確認してください。",
    axisNearest: "全日程に行きやすい目安",
    axisTopRated: "最高評価",
    distanceFrom: (distance: string) => `各日の中心へ直線平均約${distance}`,
    hotelWideTrip: "行き先が広範囲です。1つのホテルでは長距離移動が残るため、日ごとに変える方が楽です。",
    useThisHotel: "このホテルに切り替え",
    tonightHotel: (name: string) => `今夜の宿 · ${name}`,
    publicSources: "公開SNS・記事の出典",
    reviewReport: "口コミでの支払い報告",
    reservation: "予約",
    timePinned: "時間指定",
    lateBy: (minutes: number) => `指定時刻に約${minutes}分間に合わない見込み`,
    lateShort: (minutes: number) => `${minutes}分遅れ`,
    must: "必須",
    optional: "任意",
    stayLabel: "滞在時間",
    stayAuto: "自動",
    dayStart: "開始時刻",
    dayEnd: "終了時刻",
    estimated: "移動時間は目安。Google Maps経路データを取得できた区間だけ自動で更新します。",
    openingAdjusted: "営業時間に合わせて訪問時刻を調整",
    openingConflict: "営業時間と予約時刻を再確認",
    openingClosedDay: "この日は休業の可能性 — 日の移動を検討",
    openingUnknown: "営業時間 未確認",
    excludedHeading: "予定から外した場所",
    excludedClosed: "休業・営業時間が合わない",
    excludedPace: "ペースに収まらない任意の場所",
    overCapacity: "1日に収まりきらない日があります。日数を増やすか、任意の場所を減らすと現実的になります。",
    fitHeading: "この旅は入る？",
    fitSelectedDays: "日数を変えて再計算",
    fitDaysValue: (days: number) => `${days}日間`,
    fitDaysDecrease: "旅行を1日短くする",
    fitDaysIncrease: "旅行を1日長くする",
    fitNeedsMore: (minimum: number, extra: number) => `全部回るなら最低${minimum}日。いまの設定よりあと${extra}日必要です。`,
    fitNoSolution: (limit: number) => `${limit}日まで比較しても、固定時刻とペースを守った全件案は作れませんでした。`,
    fitConflict: "選んだ日程には固定時刻・予約・営業時間の衝突があります。該当日の条件を見直してください。",
    fitIncompleteHeadline: "確認できない場所があるため、必要日数はまだ確定できません。",
    fitFits: (minimum: number) => `現在の前提では成立します。最短日数は${minimum}日です。`,
    fitExact: "選んだ日数で、確認できた行き先はすべて収まります。",
    fitTight: "一応収まりますが、余白が1時間未満の日があります。",
    fitIncomplete: "未確認または休業日の場所を除いた判定です。場所を確認すると必要日数が変わることがあります。",
    fitUseDays: (days: number) => `${days}日案にする`,
    fitUsable: "実質使える時間",
    fitPlanned: (minutes: string) => `予定 ${minutes}`,
    fitWindow: (start: string, end: string) => `${start}—${end}`,
    fitOver: (minutes: string) => `${minutes}不足`,
    fitScheduleConflict: "固定時刻・予約・営業時間が衝突",
    fitCutHeading: (count: number) => `日数を増やさないなら、少なくとも${count}か所を見直す`,
    fitCutNote: "Must・予約・時刻固定は候補から外しています。通常優先の場所は、こちらで勝手に削除しません。",
    fitRemove: "予定から外す",
    fitAssumption: (time: string) => `1日の終了指定がない場合は${time}までとして比較。AIや追加APIは使わず、同じ経路・滞在データを決定論的に再計算しています。`,
    publicEvidenceFound: (count: number, social: number) => social > 0 ? `公開情報 ${count}件（SNS ${social}件）` : `公開情報 ${count}件・SNS投稿は見つからず`,
    publicEvidenceMissing: "公開情報チェックは各場所から必要な時だけ実行",
    routeEvidenceFound: (count: number) => `経路データ取得済み ${count}区間`,
    routeEvidenceMissing: "移動は推定値。日付・経路を要確認",
    assumptionsHeading: "この結果の前提",
    assumptionDate: (date: string) => `${date}出発として曜日・営業時間を判定`,
    assumptionDateDefault: (date: string) => `日付未指定のため、仮に${date}出発として判定`,
    assumptionDateShifted: (arrivalDate: string, activityDate: string) => `${arrivalDate}の深夜到着後、市内で動ける初日を${activityDate}として曜日・営業時間を判定`,
    assumptionHotel: (name: string) => `${name}を移動拠点として計算`,
    assumptionHotelAutomatic: (name: string) => `ホテル未指定のため、${name}を仮の移動拠点として計算`,
    assumptionNoHotel: "ホテル未指定・候補未取得のため、ホテル往復は計算外",
    assumptionNoArrival: "到着便未入力：初日は朝から使える前提",
    assumptionNoDeparture: "出発便未入力：最終日は夜まで使える前提",
    assumptionArrival: (airport: string, flight: string, airportMinutes: number, transferMinutes: number, city: string, nextDay: boolean) =>
      `${airport} ${flight}着 → 空港内${airportMinutes}分 + 市街地移動約${transferMinutes}分 → 初日は${nextDay ? "翌日" : ""}${city}から行動できる推定`,
    assumptionDeparture: (airport: string, flight: string, airportMinutes: number, transferMinutes: number, city: string, previousDay: boolean) =>
      `${airport} ${flight}発 → 空港へ${airportMinutes}分前 + 市街地移動約${transferMinutes}分 → ${previousDay ? "前日" : ""}${city}に市街地を出る推定`,
    walkingSafety: "徒歩経路はベータ版。安全状況は現地で確認してください。",
    deadlineOver: (time: string) => `空港へ向かう目安 ${time} を超えています`,
    language: "言語",
    privacy: "アカウント不要 · 最近の予定はこの端末に保存",
    fieldCheck: "最新の公開情報も確認",
    fieldChecking: "確認中…",
    fieldChecked: "公開情報も確認済み",
    fieldRetry: "再試行",
    fieldUnavailable: "現地情報を取得できませんでした。出発前に公式情報の確認を。",
    fieldEvidence: "いまの現地シグナル",
    openNow: "営業中の表示",
    plannedOpen: "食事時間に営業予定",
    closedNow: "営業時間外の表示",
    hoursUnknown: "営業時間は不明",
    dayHours: (value: string) => `この日の営業 ${value}`,
    dayClosed: "この日は休業の表示",
    cashOnly: "現金のみ",
    cardsAccepted: "カード可",
    noWebsite: "公式サイト未掲載",
    photoLabel: "写真:",
    recentVoices: "最近の口コミ（生の声）",
    freshHeading: "ネットの近況",
    freshLoading: "公開情報を探しています…",
    freshEmpty: "90日以内と確認できる公開情報は見つかりませんでした。日付不明の情報も無理に最新扱いしません。",
    freshUnavailable: "いまは最新情報を確認できませんでした。Google Mapsや公式情報も確認してください。",
    freshPaused: "公開SNSチェックはいま休止中です。Googleの営業情報・口コミだけで表示しています。",
    freshSource: { social: "SNS", news: "ニュース", blog: "体験記", web: "公開情報" },
    freshAgeUnknown: "更新日不明",
    freshCheckedAt: "確認",
    freshAiRole: "Claudeが公開の投稿・記事だけを検索して要約します（非公開・ログイン限定の投稿は対象外）。日程と移動はルール計算です。",
    official: "公式サイト",
    latestX: "Xで最新の声",
    instagram: "Instagramで探す",
    aiAudited: "Claudeが根拠だけを要約",
    rulesAudited: "取得情報を自動整理",
    crowd: { quiet: "静かめ", moderate: "ふつう", busy: "混みやすい", veryBusy: "かなり混む" },
    crowdWeekend: "・週末",
    crowdForecast: "（予測）",
    close: "閉じる",
  },
  en: {
    brandNote: (place: string) => place ? `${place} trip planner` : "Trip planner",
    destination: "Country",
    destinationSearch: "Type a country to choose",
    airportSearch: "Search airport, city or IATA code",
    noMatchingOption: "No matching option",
    optionCount: (count: number) => `${count} option${count === 1 ? "" : "s"}`,
    localNotes: (place: string) => `What tends to break a plan in ${place}`,
    newTrip: "New trip",
    headline: "Where do you want to go?",
    subhead: "Drop in places as they come to mind. We group what's near, then draw each day on the map.",
    inputLabel: "Places you want to visit",
    placeholder: "Example\nDay 1\nSenso-ji\nteamLab Planets 15:30 booked\nDay 2\nGhibli Museum must\nShibuya Sky optional",
    sample: "Try a sample",
    swissDemo: "Swiss demo",
    parseHint: "Paste one per line, or use commas, slashes and middle dots; we separate the places. Day headings, times, booked / must / optional and stay length are also read. Local-language names are fine.",
    previewHeading: (count: number) => `Read as ${count} place${count === 1 ? "" : "s"}`,
    previewFormat: "Make one per line",
    previewCheck: "If anything looks wrong, edit the field above",
    previewDay: (day: number) => `Day ${day}`,
    previewUnparsed: "Can't read this line as a place",
    previewStay: (minutes: number) => `Stay ${minutes} min`,
    days: "Days",
    date: "First day",
    hotel: "Hotel or preferred area",
    hotelPlaceholder: "e.g. near the main station (optional)",
    details: "Airports, pace and meals",
    arrival: "Arrival airport",
    arrivalTime: "Arrival time",
    departure: "Departure airport",
    departureTime: "Departure time",
    pace: "Pace",
    meal: "Food ideas",
    travelHeading: "Getting around",
    travelAuto: "Recommended · efficient",
    travelCar: "Rental car",
    moveCar: "Drive",
    timebandHeading: "Day rhythm",
    timebandEarly: "Early 8:00",
    timebandNormal: "Standard 9:00",
    timebandLate: "Slow 10:30",
    dayEndHeading: "Day ends by",
    dayEndNone: "Standard 22:00",
    curfewOver: (time: string) => `Runs past your ${time} target`,
    conceptLabel: "Start from a concept",
    conceptPlaceholder: "e.g. Osaka street food, 3 days",
    conceptRun: "Draft a list",
    conceptRunning: "Thinking…",
    conceptNote: "This text is sent to Anthropic only when you draft suggestions. Do not include personal information. Places are then checked on Google.",
    conceptUnavailable: "Couldn't draft ideas right now. Try again shortly.",
    conceptNotConfigured: "AI drafts are paused or not configured.",
    conceptRateLimited: "Draft limit reached — try again later.",
    recentHeading: "Recent trips",
    recentNote: "Stored only on this device",
    recentDays: (days: number) => `${days} days`,
    recentDelete: "Remove",
    moveDay: "Move to day",
    mealChoose: "Pick this place",
    mealChosen: "Added to the day",
    share: "Copy share link",
    shareCopied: "Copied",
    shareTitle: "Copies a link that reopens this trip with the same inputs. Everything lives in the link itself; nothing is stored.",
    relaxed: "Relaxed",
    balanced: "Balanced",
    fast: "See more",
    allMeals: "Lunch + dinner",
    dinner: "Dinner only",
    noMeals: "Hide",
    build: "Put it on the map",
    building: "Checking your places…",
    buildingTitle: "Building your trip",
    buildingBody: "We confirm places, hours and the base, then calculate a plan that keeps every hard constraint.",
    buildingBodyNoSocial: "We confirm places, hours and the base, then calculate every hard constraint. Route data blends in after the result appears.",
    buildingCancel: "Back to input",
    buildSteps: {
      resolving: "Confirm every place on the map",
      hotel: "Compare real hotels",
      reviews: "Check final-stop opening hours",
      scheduling: "Calculate constraints and clocks",
    },
    progressPlaces: (current: number, total: number) => `${current}/${total} places confirmed`,
    progressReviews: (count: number) => { void count; return "Only retrieved opening hours are applied"; },
    progressScheduling: "Cross-checking bookings, airports, hours and day endings",
    mapReady: "Google Maps",
    mapEmpty: "Your trip will appear here",
    routeIdeasChip: "Near today's plan",
    routeIdeasTitle: "Worthwhile places near today's plan",
    routeIdeasSubtitle: "We searched around today's live route and planned stops, then kept only places backed by ratings.",
    routeIdeasLoading: "Finding worthwhile stops along this route…",
    routeIdeasUnavailable: "Route ideas are unavailable right now. Your plan still works as-is.",
    routeIdeasRateLimited: "Today's free search allowance has been used. Your plan still works as-is.",
    routeIdeasEmpty: "Nothing met both the rating and proximity bar, so we did not pad the day with a weak suggestion.",
    routeIdeasDistance: (meters: number) => meters < 1_000 ? `About ${meters}m from the route` : `About ${(meters / 1_000).toFixed(1)}km from the route`,
    routeIdeasAdd: "Add to this day & reroute",
    routeIdeasAdded: "Already added",
    routeIdeasNote: "Ratings are from Google Maps. Proximity is an approximate distance from available Google route geometry, falling back to planned stops for any missing leg. TripCheck reroutes after you add one; nothing is added automatically.",
    edit: "Back to input",
    planSummary: (days: number, stops: number) => `${days} days · ${stops} places`,
    openMaps: "Open in Google Maps",
    stay: "Stay",
    removeStop: "Remove from the plan",
    removedHeading: "Removed by you",
    restoreStop: "Put back",
    backToPlan: "Back to your plan",
    hotelDepartRow: (mode: string, minutes: number) => `From hotel · ${mode} ~${minutes} min`,
    hotelReturnRow: (mode: string, minutes: number) => `To hotel · ${mode} ~${minutes} min`,
    travelTotal: (minutes: number) => `~${minutes} min total travel`,
    precipitation: (percent: number) => `${percent}% rain`,
    forecastNote: "Open-Meteo forecast",
    holidayBadge: "PH",
    holidayNote: (name: string) => `Public holiday “${name}” — museums and shops may close or shorten hours; re-check opening times`,
    holidayRegional: " (some regions only)",
    sundayClosingNote: "Sunday — most shops and supermarkets are closed by law (station shops are the usual exception)",
    flightKindHeading: "Flight type",
    flightInternational: "International",
    flightDomestic: "Domestic",
    essentialsHeading: (place: string) => `${place} basics`,
    essentialsPlug: "Power plug",
    essentialsTipping: "Tipping",
    essentialsWater: "Tap water",
    essentialsEmergency: "Emergency",
    essentialsEntry: "Entry (Japan passport)",
    essentialsPass: "Transit pass",
    essentialsOfficial: "Official info",
    essentialsMoney: "Payments",
    essentialsTransit: "Transit traps",
    beforeStrike: "Strike / disruption check",
    beforeMedication: "Medication rules",
    beforeMedicationNote: "Carry medicines in their original packaging with documentation. Some countries require advance permits for psychotropic ingredients or large quantities; the US can confiscate non-FDA-approved drugs even with a prescription.",
    essentialsFx: "Exchange rate",
    essentialsFxLine: (unit: number, code: string, yen: string, asOf: string) => `${unit} ${code} ≈ ¥${yen} (reference, ${asOf})`,
    essentialsDcc: "When a terminal or ATM offers to charge in yen, always pick the local currency — DCC adds 3–10%. Japan-issued cards add a ~2.2% foreign-use fee.",
    essentialsDisclaimer: "General guidance only. Rules change — always verify official sources before departure.",
    beforeHeading: "Before you go",
    beforeOverdue: "Action needed",
    beforeDueSoon: "Due soon",
    beforePassportLabel: "Passport expiry date",
    beforePassportHint: "Used for the validity check. Stored on this device only.",
    passportCountry: "Passport country",
    passportUnset: "Not set (hide personalised entry checks)",
    passportJapan: "Japan",
    passportOther: "Other",
    passportUnsupported: "Personalised entry checks currently support Japanese passports only. For other passports, use the destination's official guidance.",
    beforeBooked: "Planned as booked — check your voucher and entry method",
    beforeBookedAt: (time: string) => `Planned as booked for ${time} — check your voucher and entry method`,
    beforeWatch: "Sell-outs or queues reported — consider booking ahead or going first thing",
    print: "Print / PDF",
    printTitle: "Print or save the whole trip as one page (for offline use)",
    printBooked: "booked",
    printFooter: "Times are planning estimates. Reconfirm travel and opening hours locally. · Weather by Open-Meteo",
    legModes: "Travel mode for this leg. Tap to pin, tap again for automatic",
    move: { walk: "Walk", transit: "Train", taxi: "Taxi" },
    minutes: (value: number) => `${value} min`,
    legLive: "Google route",
    unknown: "Not shown on the map",
    placeFallback: "Some places could not be found. The plan uses only the ones we could confirm.",
    noDays: "Nothing could be placed on the map yet. A slightly different name often helps.",
    openDay: "Nothing planned for this day yet",
    selectHint: "Tap a pin or a stop to open details",
    mealIdeas: "Start with these local picks",
    lunchChip: "Lunch",
    dinnerChip: "Dinner",
    foodLoading: "Finding nearby places…",
    foodUnavailable: "Places did not load. Open the same search in Google Maps instead.",
    maps: "View on map",
    foodNote: "Ranked by Google rating strength, review volume, distance and open status. Public social evidence is shown only when a cited page was found.",
    foodFresh: (count: number) => `${count} recent public signals`,
    hotelChip: "Hotel",
    hotelCandidate: "Recommended hotel",
    hotelAlternatives: "Other options",
    hotelNoAvailability: "Confirm price and availability with a booking provider.",
    hotelUnavailable: "Hotel options didn't load.",
    hotelSearch: "Search hotels on Google Maps",
    hotelRefresh: "Search hotels again",
    hotelRefreshChanged: "Re-search for the changed itinerary",
    hotelRefreshing: "Searching for a better base…",
    hotelRefreshHint: "Your destinations changed, so the hotel options can be updated too.",
    hotelRefreshFailed: "The re-search failed. Your current hotel has been kept.",
    stayModeHeading: "Stay style",
    staySame: "One hotel",
    stayNightly: "Change nightly",
    nightLabel: (night: number) => `Night ${night}`,
    nightlyLoading: "Finding hotels for each night…",
    nightlyUnavailable: "Nightly options didn't load. The plan keeps one hotel.",
    nightlyNightMissing: "No option loaded for this night — the shared hotel stays.",
    styleRecommended: "Best match",
    styleLuxury: "Luxury",
    styleValue: "Reference price available",
    styleNote: "Reference prices are dateless and availability is unknown, so they do not determine a value winner.",
    hotelRankNote: "Every day gets one equal vote. Hotels with a lower average and worst-day straight-line distance rank higher, then Google rating and review strength are added. Confirm actual travel time on the mapped routes.",
    hotelCompareHeading: "Compare picks — tap to switch",
    priceUnlisted: "No listed price",
    rakutenTag: (average: number, count: number) => `Rakuten Travel ★${average.toFixed(1)} (${count.toLocaleString("en-US")})`,
    hotelPriceNote: "¥ prices are Rakuten Travel's reference minimum (dateless).",
    hotelReasonTop: "Top combined score for whole-trip access, rating and review strength.",
    hotelReasonNearest: "Lowest distance burden across each day's destinations.",
    hotelReasonRated: "Highest Google rating among candidates backed by at least 50 reviews.",
    hotelReasonValue: "A reference price is shown, but TripCheck does not call it best value without dated availability.",
    hotelReasonSpecified: "This matches the hotel you entered and is also used as the route's start and end base.",
    hotelReasonPicked: "Your pick from the alternatives.",
    hotelPurposeHeading: "What matters most?",
    hotelPurposeBalanced: "Overall",
    hotelPurposeNearest: "Less travel",
    hotelPurposeRated: "Top rated",
    hotelPurposeValue: "Price comparison pending",
    hotelPurposeHelp: "Compare total travel and rating here; confirm price and availability with a booking provider.",
    axisNearest: "Best access estimate",
    axisTopRated: "Top rated",
    distanceFrom: (distance: string) => `~${distance} straight-line average`,
    hotelWideTrip: "Your destinations cover a wide area. One hotel still leaves a long travel day; changing hotels nightly will be easier.",
    useThisHotel: "Switch to this hotel",
    tonightHotel: (name: string) => `Tonight · ${name}`,
    publicSources: "Public social and article sources",
    reviewReport: "Payment reported in a review",
    reservation: "Booked",
    timePinned: "Timed",
    lateBy: (minutes: number) => `Runs about ${minutes} min past the set time`,
    lateShort: (minutes: number) => `${minutes} min late`,
    must: "Must",
    optional: "Optional",
    stayLabel: "Stay",
    stayAuto: "Auto",
    dayStart: "Start time",
    dayEnd: "End time",
    estimated: "Times are estimates. Legs update only when Google Maps route data is available.",
    openingAdjusted: "Timed to verified opening hours",
    openingConflict: "Recheck opening hours and booking time",
    openingClosedDay: "Likely closed this day — consider moving it",
    openingUnknown: "Hours unverified",
    excludedHeading: "Left out of this plan",
    excludedClosed: "closed or hours don't fit",
    excludedPace: "optional stop beyond this pace",
    overCapacity: "Some days hold more than this pace fits. Add a day or trim optional stops.",
    fitHeading: "Does this trip fit?",
    fitSelectedDays: "Change days and recalculate",
    fitDaysValue: (days: number) => `${days} day${days === 1 ? "" : "s"}`,
    fitDaysDecrease: "Make this trip one day shorter",
    fitDaysIncrease: "Add one day to this trip",
    fitNeedsMore: (minimum: number, extra: number) => `To keep every place, you need at least ${minimum} days — ${extra} more than selected.`,
    fitNoSolution: (limit: number) => `No all-in plan could keep the fixed times and pace within ${limit} days.`,
    fitConflict: "The selected schedule still has a fixed-time, booking or opening-hours conflict. Review the flagged day.",
    fitIncompleteHeadline: "Some places could not be confirmed, so the required day count is not final yet.",
    fitFits: (minimum: number) => `The plan is feasible under the current assumptions. The minimum is ${minimum} days.`,
    fitExact: "Every confirmed place fits in the days you selected.",
    fitTight: "It fits, but at least one day has under an hour of breathing room.",
    fitIncomplete: "This result excludes unresolved or unavailable places. Confirming them can change the day count.",
    fitUseDays: (days: number) => `Use ${days} days`,
    fitUsable: "Usable trip time",
    fitPlanned: (minutes: string) => `${minutes} planned`,
    fitWindow: (start: string, end: string) => `${start}—${end}`,
    fitOver: (minutes: string) => `${minutes} short`,
    fitScheduleConflict: "Fixed time, booking or opening-hours conflict",
    fitCutHeading: (count: number) => `Or review at least ${count} place${count === 1 ? "" : "s"}`,
    fitCutNote: "Must-do, booked and fixed-time places are protected. We never silently choose between your normal-priority places.",
    fitRemove: "Remove",
    fitAssumption: (time: string) => `When no day end is set, scenarios assume sightseeing ends by ${time}. This uses the same route and stay data with deterministic code — no extra AI or provider call.`,
    publicEvidenceFound: (count: number, social: number) => social > 0 ? `${count} public sources · ${social} social` : `${count} public sources · no social post found`,
    publicEvidenceMissing: "Public-source checks run only when you request one for a place",
    routeEvidenceFound: (count: number) => `${count} route legs retrieved`,
    routeEvidenceMissing: "Travel uses estimates · recheck date and route",
    assumptionsHeading: "Assumptions in this result",
    assumptionDate: (date: string) => `Weekdays and opening hours use a ${date} trip start`,
    assumptionDateDefault: (date: string) => `No date was chosen, so ${date} is used provisionally`,
    assumptionDateShifted: (arrivalDate: string, activityDate: string) => `After the late ${arrivalDate} arrival, the first usable activity date is ${activityDate}; weekdays and opening hours use that date`,
    assumptionHotel: (name: string) => `${name} is used as the routing base`,
    assumptionHotelAutomatic: (name: string) => `No hotel was entered; ${name} is a provisional routing base`,
    assumptionNoHotel: "No hotel base was available, so hotel round trips are excluded",
    assumptionNoArrival: "No arrival flight: Day 1 is treated as available from the morning",
    assumptionNoDeparture: "No departure flight: the final day is treated as available through the evening",
    assumptionArrival: (airport: string, flight: string, airportMinutes: number, transferMinutes: number, city: string, nextDay: boolean) =>
      `${airport} arrival ${flight} + ${airportMinutes} min airport process + ~${transferMinutes} min city transfer → Day 1 starts ${nextDay ? "next day at " : "at "}${city} (estimate)`,
    assumptionDeparture: (airport: string, flight: string, airportMinutes: number, transferMinutes: number, city: string, previousDay: boolean) =>
      `${airport} departure ${flight} − ${airportMinutes} min airport buffer − ~${transferMinutes} min city transfer → leave the city ${previousDay ? "the previous day at " : "at "}${city} (estimate)`,
    walkingSafety: "Walking routes are beta. Check real-world safety conditions.",
    deadlineOver: (time: string) => `Runs past the ${time} airport cutoff`,
    language: "Language",
    privacy: "No account · recent plans stay on this device",
    fieldCheck: "Check recent public sources too",
    fieldChecking: "Checking…",
    fieldChecked: "Public sources checked",
    fieldRetry: "Try again",
    fieldUnavailable: "Live info did not load. Recheck the official source before you go.",
    fieldEvidence: "On-the-ground signals",
    openNow: "Listed open now",
    plannedOpen: "Open for this meal time",
    closedNow: "Listed closed now",
    hoursUnknown: "Hours unknown",
    dayHours: (value: string) => `Hours this day: ${value}`,
    dayClosed: "Listed closed on this day",
    cashOnly: "Cash only",
    cardsAccepted: "Cards accepted",
    noWebsite: "No official site",
    photoLabel: "Photo:",
    recentVoices: "Recent reviews — real voices",
    freshHeading: "Latest public signals",
    freshLoading: "Searching public sources…",
    freshEmpty: "No public source could be verified as updated within 90 days. Undated pages are not presented as recent.",
    freshUnavailable: "Fresh sources are unavailable right now. Recheck Google Maps and the official source.",
    freshPaused: "Public social checks are paused for now. Showing Google hours and reviews only.",
    freshSource: { social: "Social", news: "News", blog: "Firsthand", web: "Web" },
    freshAgeUnknown: "Date unknown",
    freshCheckedAt: "Checked",
    freshAiRole: "Claude searches and summarizes public posts only — private or login-only posts can't be read. Schedule and routing stay rule-based.",
    official: "Official site",
    latestX: "Latest on X",
    instagram: "Search Instagram",
    aiAudited: "Evidence summarized by Claude",
    rulesAudited: "Evidence organized automatically",
    crowd: { quiet: "Quiet", moderate: "Steady", busy: "Busy", veryBusy: "Very busy" },
    crowdWeekend: " · weekend",
    crowdForecast: " · forecast",
    close: "Close",
  },
} as const;

function formatWindowClock(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(normalized / 60)}:${String(normalized % 60).padStart(2, "0")}`;
}

function shiftPlannerClock(value: string, minutes: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const total = Number(match[1]) * 60 + Number(match[2]);
  if (!Number.isFinite(total)) return value;
  const shifted = Math.max(0, Math.min(23 * 60 + 59, total + minutes));
  return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
}

function modeIcon(mode: "walk" | "transit" | "taxi", carMode: boolean) {
  return <Icon name={mode === "transit" ? "train" : mode === "taxi" && carMode ? "car" : mode} size={14} />;
}

function googleMapsSearchUrl(stop: RouteStop) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.name} ${stop.area}`)}`;
}

function formatCheckedAt(value: string, locale: PlannerLocale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function paymentLabel(intel: PlaceIntelligenceResult, locale: PlannerLocale) {
  const payment = intel.place.payment;
  if (payment.cashOnly === true) return locale === "ja" ? "現金のみ（Google掲載）" : "Cash only · Google listing";
  if (payment.creditCards === true) return locale === "ja" ? "カード可（Google掲載）" : "Cards accepted · Google listing";
  const observations = payment.observations;
  if (observations.length === 0) return null;
  const hasConflict = observations.some((item) => item.method === "card" && item.accepted)
    && observations.some((item) => item.method === "card" && !item.accepted);
  if (hasConflict) return locale === "ja" ? "支払いの口コミが分かれています" : "Payment reports conflict";
  const observation = observations[0];
  if (observation.method === "cash") return locale === "ja" ? "口コミ: 現金のみとの報告" : "Review: cash only reported";
  if (observation.method === "card" && !observation.accepted) return locale === "ja" ? "口コミ: カード不可との報告" : "Review: cards not accepted";
  if (observation.method === "qr") return observation.accepted
    ? (locale === "ja" ? "口コミ: コード決済の利用報告" : "Review: code payment reported")
    : (locale === "ja" ? "口コミ: コード決済不可との報告" : "Review: code payment not accepted");
  if (observation.method === "transport_ic") return observation.accepted
    ? (locale === "ja" ? "口コミ: 交通系ICの利用報告" : "Review: transit IC reported")
    : (locale === "ja" ? "口コミ: 交通系IC不可との報告" : "Review: transit IC not accepted");
  return locale === "ja" ? "口コミ: カード利用の報告" : "Review: card payment reported";
}

function hotelAsResolvedBase(candidate: HotelCandidate, input: string, area: string, verifiedAt: string): ResolvedInputStop {
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

function provisionalBaseAsResolved(base: TripBase): ResolvedInputStop {
  return {
    ...base,
    input: base.query || base.name,
    address: base.area,
  };
}

function normalizeHotelName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function isAreaLikeHotelQuery(value: string) {
  const query = value.normalize("NFKC").trim().toLowerCase();
  if (!query) return true;
  return /(?:周辺|近く|近辺|付近|エリア|界隈|あたり|駅前|駅のそば|のホテル|で泊まりたい|near\b|around\b|\barea\b|hotels?\s+(?:in|near)|(?:near|around)\s+.+\s+hotels?)/iu.test(query);
}

function shouldUseRecommendedHotel(query: string) {
  return !query.trim() || isAreaLikeHotelQuery(query);
}

function matchingHotelCandidate(resolved: ResolvedInputStop, candidates: HotelCandidate[]) {
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
const buildStageOrder: BuildStage[] = P0_CORE_ONLY
  ? ["resolving", "reviews", "scheduling"]
  : ["resolving", "hotel", "reviews", "scheduling"];

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
  const [weatherByDay, setWeatherByDay] = useState<Record<number, TripWeatherDay>>({});
  const [holidaysByDate, setHolidaysByDate] = useState<Record<string, TripHoliday>>({});
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
  const [liveTransit, setLiveTransit] = useState<Record<string, number>>({});
  // Transit minutes measured by the post-build prefetch. Kept apart from the
  // convergence-owned liveTransit so the convergence effect's resets cannot
  // erase evidence the prefetch already paid Google for; the two records merge
  // (convergence wins per key) where the planner context is assembled.
  const [prefetchTransit, setPrefetchTransit] = useState<Record<string, number>>({});
  // Legs where the provider answered "no transit route" — negative live
  // evidence, split by owner exactly like the positive measurements above.
  const [liveTransitAbsent, setLiveTransitAbsent] = useState<Record<string, boolean>>({});
  const [prefetchTransitAbsent, setPrefetchTransitAbsent] = useState<Record<string, boolean>>({});
  const [liveTransitTransferCounts, setLiveTransitTransferCounts] = useState<Record<string, number>>({});
  const [liveWalking, setLiveWalking] = useState<Record<string, number>>({});
  const [liveDriving, setLiveDriving] = useState<Record<string, number>>({});
  const [liveRouteEvidence, setLiveRouteEvidence] = useState<Record<string, RouteFactEvidence>>({});
  const [transitConvergence, setTransitConvergence] = useState<TransitConvergenceState>(emptyTransitConvergenceState);
  const [travelPreference, setTravelPreference] = useState<TravelPreference>("auto");
  const [legModeOverrides, setLegModeOverrides] = useState<Record<string, TransportMode>>({});
  const [dayOverrides, setDayOverrides] = useState<Record<string, number>>({});
  const [lockedOrderByDay, setLockedOrderByDay] = useState<Record<number, string[]>>({});
  const [mealSelections, setMealSelections] = useState<Record<string, string>>({});
  const [dayStartDefault, setDayStartDefault] = useState("09:00");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>({ dates: true, hotel: false, airports: false, reservations: false });
  const [pendingSharedBuild, setPendingSharedBuild] = useState(false);
  // Once a plan is built it stays available: "back to input" must never force
  // a full (paid, slow) rebuild just to peek at the form again.
  const [planReady, setPlanReady] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [dayEndTarget, setDayEndTarget] = useState("");
  const [transferBufferMinutes, setTransferBufferMinutes] = useState<0 | 10 | 20 | 30>(10);
  const [maxWalkingMinutesPerLeg, setMaxWalkingMinutesPerLeg] = useState<number | null>(null);
  const [maxTransfersPerLeg, setMaxTransfersPerLeg] = useState<number | null>(null);
  const [recentTrips, setRecentTrips] = useState<StoredTripRecord[]>([]);
  const [tripStorePersistent, setTripStorePersistent] = useState<boolean | null>(null);
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
  // Passport expiry never leaves the device: it exists only to turn "6 months
  // remaining required" into a personal yes/no before the airport does it.
  const [passportExpiry, setPassportExpiry] = useState("");
  const [passportCountry, setPassportCountry] = useState<PassportCountry>("unset");
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
  const [comparisonAlternative, setComparisonAlternative] = useState<AlternativePlan | null>(null);
  const [sourcePreviews, setSourcePreviews] = useState<Record<string, SourcePreviewState>>({});
  const [previewStops, setPreviewStops] = useState<RouteStop[]>([]);
  const [buildProgress, setBuildProgress] = useState<BuildProgress>(initialBuildProgress);
  // Whether the server accepts Claude-backed requests. While paused, the AI
  // surfaces (concept drafts, social checks) are hidden instead of failing.
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiEnabledRef = useRef(false);
  const buildRunRef = useRef(0);
  const transitConvergenceRunRef = useRef(0);
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
  const tripStoreRef = useRef<TripStore | null>(null);
  const analyticsMilestonesRef = useRef<Set<ProductEventName>>(new Set());
  const currentStoredTripIdRef = useRef<string | null>(null);
  // Mode, place-pair and departure-time keys already requested from Google,
  // plus a small post-build
  // allowance so hotel switches and nightly bases can still get measured legs.
  const attemptedLegKeysRef = useRef<Set<string>>(new Set());
  const postBuildLegBudgetRef = useRef(0);
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

  function commitPlannerEdit(patch: Partial<PlannerEditState>) {
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

  // Device-local history is user-authored input only. IndexedDB stores up to
  // ten trips; provider responses and the derived BuiltTripPlan are rebuilt.
  // If private mode blocks IndexedDB, the store remains usable for this tab
  // and the UI says explicitly that it is not persistent.
  const sharedHydrationRef = useRef(false);
  useEffect(() => {
    if (sharedHydrationRef.current) return;
    sharedHydrationRef.current = true;
    try {
      // One-time cleanup for the removed airfare experiment. Airport choices
      // inside an actual recent trip remain; the obsolete standalone origin does not.
      window.localStorage.removeItem("tripcheck.airfareOrigin");
    } catch { /* private-mode storage stays optional */ }
    void createTripStore().then(async (store) => {
      tripStoreRef.current = store;
      setTripStorePersistent(store.status.persistent);
      setRecentTrips(await store.list());
    }).catch(() => {
      setTripStorePersistent(false);
    });
    const match = window.location.hash.match(/^#t=([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const shared = decodeTripShare(match[1]);
    if (!shared) return;
    applySharedTripInput(shared);
  }, [applySharedTripInput]);

  useEffect(() => {
    if (!pendingSharedBuild) return;
    setPendingSharedBuild(false);
    void buildPlan({ preserveEdits: true });
    // buildPlan reads the freshly hydrated state from this render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSharedBuild]);

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
    if (P0_CORE_ONLY) return;
    let cancelled = false;
    void requestAiStatus().then((enabled) => {
      if (cancelled) return;
      aiEnabledRef.current = enabled;
      setAiEnabled(enabled);
    });
    return () => { cancelled = true; };
  }, []);

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

  const plannerContextWithoutTransit = useMemo<TripPlannerContext>(() => ({
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
    liveWalkingMinutes: liveWalking,
    liveDrivingMinutes: liveDriving,
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
  }), [arrivalAirport, arrivalTime, dayEndTarget, dayEndTimes, dayOverrides, dayStartDefault, dayStartTimes, departureAirport, departureTime, destinationChoice, durationOverrides, earlyVisitStopIds, flightKind, hotelQuery, lastEntryTimes, legModeOverrides, liveDriving, liveWalking, lockedOrderByDay, maxTransfersPerLeg, maxWalkingMinutesPerLeg, mealPlan, nightBases, openingWindowsByDay, removedStops, resolvedBase, resolvedStops, transferBufferMinutes, travelPreference, tripStartDate, userStayMinutes]);
  const activePlannerContext = useMemo<TripPlannerContext>(() => ({
    ...plannerContextWithoutTransit,
    liveTransitMinutes: { ...prefetchTransit, ...liveTransit },
    liveTransitAbsentLegs: { ...prefetchTransitAbsent, ...liveTransitAbsent },
    liveTransitTransferCounts,
  }), [liveTransit, liveTransitAbsent, liveTransitTransferCounts, plannerContextWithoutTransit, prefetchTransit, prefetchTransitAbsent]);
  const transitConvergenceInputKey = useMemo(() => JSON.stringify([
    itinerary,
    tripDays,
    pace,
    locale,
    plannerContextWithoutTransit,
  ]), [itinerary, locale, pace, plannerContextWithoutTransit, tripDays]);

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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("tripcheck.passportExpiry");
      if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) setPassportExpiry(stored);
    } catch { /* storage unavailable (private mode) — the field just starts empty */ }
  }, []);
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

  // Per-day forecast, keyed on the coordinate-only payload itself: the fetch
  // re-runs only when a day's date or centroid actually changes, not on every
  // unrelated plan tweak. Weather never gates the plan — failures just leave
  // the chips off.
  const weatherSignature = useMemo(() => {
    if (!plan) return "";
    const payload = buildWeatherPayload(plan);
    return payload ? JSON.stringify(payload) : "";
  }, [plan]);
  useEffect(() => {
    if (!P1_TRAVEL_ENRICHMENTS) {
      setWeatherByDay({});
      return;
    }
    if (!weatherSignature) {
      setWeatherByDay({});
      return;
    }
    let stale = false;
    void requestWeatherPayload(JSON.parse(weatherSignature)).then((result) => {
      if (!stale) setWeatherByDay(result);
    });
    return () => { stale = true; };
  }, [weatherSignature]);

  // Holiday overlay, same contract as the forecast: country code + bare dates
  // in, per-date warnings out, failures leave the plan untouched. This exists
  // because Google's weekly opening patterns are silently wrong on public
  // holidays and its dated hours only cover the next 7 days.
  const holidaysSignature = useMemo(() => {
    if (!plan) return "";
    const payload = buildHolidaysPayload(plan, activeDestination.countryCodes[0] ?? null);
    return payload ? JSON.stringify(payload) : "";
  }, [plan, activeDestination]);
  useEffect(() => {
    if (!P1_TRAVEL_ENRICHMENTS) {
      setHolidaysByDate({});
      return;
    }
    if (!holidaysSignature) {
      setHolidaysByDate({});
      return;
    }
    let stale = false;
    void requestHolidays(JSON.parse(holidaysSignature)).then((result) => {
      if (!stale) setHolidaysByDate(result);
    });
    return () => { stale = true; };
  }, [holidaysSignature]);

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

  // Save meaningful user-authored changes after a short quiet period. The
  // encoded input contains no fetched place, route, review or hours payload;
  // reopening deliberately resolves those facts again.
  useEffect(() => {
    if (!planReady || !localTripCode || tripStorePersistent === null) return;
    const timer = window.setTimeout(() => {
      const store = tripStoreRef.current;
      if (!store) return;
      const id = currentStoredTripIdRef.current ?? newDeviceTripId();
      currentStoredTripIdRef.current = id;
      void store.save({
        id,
        title: localTripTitle.slice(0, 160),
        payload: {
          input: { shareCode: localTripCode, tripDays, tripStartDate },
          edits: { schemaVersion: 1 },
        },
      }).then(async () => {
        // This is automatic recovery storage, not evidence that the traveller
        // accepted the plan. The adoption funnel records only an explicit share.
        setTripStorePersistent(store.status.persistent);
        setRecentTrips(await store.list());
      }).catch(() => {
        setTripStorePersistent(false);
      });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [localTripCode, localTripTitle, planReady, tripDays, tripStartDate, tripStorePersistent]);

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
      return routeEvidenceByFactId[factId]?.routeGeometry?.points ?? null;
    });
  }, [base, day, dayEndBase, mapStops, routeEvidenceByFactId]);

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
  const hotelAxisLabels = useCallback((candidate: HotelCandidate) => [
    ...(candidate.id === hotelAxis.nearestId ? [text.axisNearest] : []),
    ...(candidate.id === hotelAxis.topRatedId ? [text.axisTopRated] : []),
  ], [hotelAxis, text]);
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
    ? feasibilityStateCopy(feasibilityResult.state, locale, plan?.requestedDays ?? tripDays, plan?.scheduledStopCount ?? 0)
    : null;
  const deferredAnchorStops = useMemo(() => plan
    ? [...plan.deferredUnavailableStops, ...plan.deferredOptionalStops]
    : [], [plan]);
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

  // Open Graph thumbnails for public-source cards, fetched lazily when the
  // source list is opened and cached for the session. Failures fall back to
  // the media-kind badge that is always rendered.
  const requestedSourcePreviewsRef = useRef<Set<string>>(new Set());
  const ensureSourcePreviews = useCallback((urls: string[]) => {
    const missing = urls.filter((url) => url.startsWith("https://") && !requestedSourcePreviewsRef.current.has(url)).slice(0, 3);
    if (missing.length === 0) return;
    for (const url of missing) requestedSourcePreviewsRef.current.add(url);
    setSourcePreviews((state) => ({
      ...state,
      ...Object.fromEntries(missing.map((url) => [url, { status: "loading", imageUrl: null } satisfies SourcePreviewState])),
    }));
    for (const url of missing) {
      void requestLinkPreview(url)
        .then((preview) => {
          setSourcePreviews((state) => ({ ...state, [url]: { status: "ready", imageUrl: preview.imageUrl } }));
        })
        .catch(() => {
          setSourcePreviews((state) => ({ ...state, [url]: { status: "failed", imageUrl: null } }));
        });
    }
  }, []);

  const handleSelectFoodPin = useCallback((slotId: string, candidateId: string) => {
    setInspector({ kind: "food", slotId, candidateId });
  }, []);

  // Transit is schedule-dependent: query only the physical transit legs the
  // deterministic planner selected, rebuild with exact consumed values, and
  // repeat until its order/times stabilize. The bounded coordinator owns both
  // the three-pass limit and the twenty-event trip budget.
  useEffect(() => {
    if (!hasPlan || isBuilding) return;
    const runId = ++transitConvergenceRunRef.current;
    const controller = new AbortController();
    if (!tripDateTouched) {
      setLiveTransit({});
      setLiveTransitAbsent({});
      setLiveTransitTransferCounts({});
      setLiveRouteEvidence({});
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: 0,
        iterations: 0,
        nonConverged: false,
        stopReason: null,
      });
      return () => controller.abort();
    }
    setTransitConvergence({
      inputKey: transitConvergenceInputKey,
      status: "loading",
      eventCount: 0,
      iterations: 0,
      nonConverged: false,
      stopReason: null,
    });
    setLiveTransit({});
    setLiveTransitAbsent({});
    setLiveTransitTransferCounts({});
    setLiveRouteEvidence({});

    let initialPlan: BuiltTripPlan;
    try {
      initialPlan = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContextWithoutTransit);
    } catch {
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: 0,
        iterations: 0,
        nonConverged: true,
        stopReason: "max_iterations",
      });
      return () => controller.abort();
    }

    void convergeTransitPlan<BuiltTripPlan, PlanningTransitLegRequest>({
      initial: buildPlanningTransitIteration(initialPlan),
      fetchLegs: (requests) => fetchPlanningTransitEvidence(requests, locale, {
        concurrency: 2,
        signal: controller.signal,
      }),
      rebuild: ({ conservativeEvidenceByLeg }) => {
        const measured = Object.fromEntries(Object.entries(conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
          evidence.status === "verified" && evidence.durationMinutes !== null
            ? [[legId, evidence.durationMinutes] as const]
            : []
        )));
        const transferCounts = Object.fromEntries(Object.entries(conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
          evidence.status === "verified" && evidence.transferCount !== null
            ? [[legId, evidence.transferCount] as const]
            : []
        )));
        const absent = Object.fromEntries(Object.entries(conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
          evidence.status === "unknown" ? [[legId, true] as const] : []
        )));
        const rebuilt = buildTripFromWishlist(itinerary, tripDays, pace, locale, {
          ...plannerContextWithoutTransit,
          liveTransitMinutes: measured,
          liveTransitAbsentLegs: absent,
          liveTransitTransferCounts: transferCounts,
        });
        return buildPlanningTransitIteration(rebuilt);
      },
    }).then((result) => {
      if (controller.signal.aborted || transitConvergenceRunRef.current !== runId) return;
      const measured = Object.fromEntries(Object.entries(result.conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
        evidence.status === "verified" && evidence.durationMinutes !== null
          ? [[legId, evidence.durationMinutes] as const]
          : []
      )));
      const transferCounts = Object.fromEntries(Object.entries(result.conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
        evidence.status === "verified" && evidence.transferCount !== null
          ? [[legId, evidence.transferCount] as const]
          : []
      )));
      const evidenceByRequest = Object.fromEntries(result.observations.map((evidence) => [
        evidence.provenance.requestKey,
        {
          legId: evidence.legId,
          mode: evidence.provenance.mode,
          departureBucket: evidence.provenance.departureBucket,
          requestKey: evidence.provenance.requestKey,
          status: evidence.status,
          fetchedAt: evidence.provenance.fetchedAt,
          providerRef: evidence.provenance.providerRef,
          minutes: evidence.durationMinutes,
          transferCount: evidence.transferCount,
          reason: evidence.reason,
          routeGeometry: evidence.routeGeometry,
        } satisfies RouteFactEvidence,
      ]));
      setLiveTransit(measured);
      setLiveTransitAbsent(Object.fromEntries(Object.entries(result.conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
        evidence.status === "unknown" ? [[legId, true] as const] : []
      ))));
      setLiveTransitTransferCounts(transferCounts);
      setLiveRouteEvidence(evidenceByRequest);
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: result.eventCount,
        iterations: result.iterations,
        nonConverged: result.nonConverged,
        stopReason: result.stopReason,
      });
    }).catch(() => {
      if (controller.signal.aborted || transitConvergenceRunRef.current !== runId) return;
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: 0,
        iterations: 0,
        nonConverged: true,
        stopReason: "max_iterations",
      });
    });
    return () => controller.abort();
  }, [hasPlan, isBuilding, itinerary, locale, pace, plannerContextWithoutTransit, transitConvergenceInputKey, tripDateTouched, tripDays]);

  // When a plan change introduces legs Google has not measured yet (switching
  // hotels, nightly bases), fetch just those legs within a small post-build
  // budget. Keys are place-pair based, so ordinary edits refetch nothing.
  useEffect(() => {
    // P0 uses the visible map as the single live-route gateway. Keeping the
    // legacy background prefetch on would double-request the same journey.
    if (P0_CORE_ONLY) return;
    if (!hasPlan || isBuilding || !plan || postBuildLegBudgetRef.current <= 0) return;
    let missingCount = 0;
    try {
      missingCount = buildPlanningRouteLegs(plan)
        .filter((leg) => !attemptedLegKeysRef.current.has(planningRouteRequestKey(leg))).length;
    } catch {
      return;
    }
    if (missingCount === 0) return;
    const runId = buildRunRef.current;
    const timer = window.setTimeout(() => {
      const excludeKeys = new Set(attemptedLegKeysRef.current);
      const budget = Math.min(postBuildLegBudgetRef.current, 12);
      // Marked as attempted up-front so a failing leg is never retried in a loop.
      let marked: string[] = [];
      try {
        marked = buildPlanningRouteLegs(plan)
          .filter((leg) => !excludeKeys.has(planningRouteRequestKey(leg)))
          .slice(0, budget)
          .map(planningRouteRequestKey);
      } catch {
        return;
      }
      for (const key of marked) attemptedLegKeysRef.current.add(key);
      postBuildLegBudgetRef.current = Math.max(0, postBuildLegBudgetRef.current - marked.length);
      void prefetchPlanningRouteDurations(plan, locale, { concurrency: 2, maxLegs: budget, excludeKeys })
        .then((measured) => {
          if (buildRunRef.current !== runId) return;
          if (Object.keys(measured.transitMinutes).length > 0) {
            setPrefetchTransit((current) => ({ ...current, ...measured.transitMinutes }));
          }
          const absent = Object.fromEntries(measured.legs.flatMap((leg) => (
            leg.mode === "transit" && leg.status === "unavailable" ? [[leg.id, true] as const] : []
          )));
          if (Object.keys(absent).length > 0) {
            setPrefetchTransitAbsent((current) => ({ ...current, ...absent }));
          }
          if (Object.keys(measured.walkingMinutes).length > 0) {
            setLiveWalking((current) => ({ ...current, ...measured.walkingMinutes }));
          }
          if (Object.keys(measured.drivingMinutes).length > 0) {
            setLiveDriving((current) => ({ ...current, ...measured.drivingMinutes }));
          }
        })
        .catch(() => { /* Estimates stay in place and are labeled as such. */ });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hasPlan, isBuilding, locale, plan]);

  function selectHotelCandidate(candidate: HotelCandidate, purpose: HotelPurpose = "picked") {
    const changed = hotelState.selectedId !== candidate.id;
    if (changed) hotelRefreshAbortRef.current?.abort();
    setHotelState((current) => ({
      ...current,
      selectedId: candidate.id,
      ...(changed ? { fresh: { status: "loading", result: null } satisfies FreshState } : {}),
    }));
    setHotelPurpose(purpose);
    // The displayed hotel and the routing base must never diverge.
    setResolvedBase(hotelAsResolvedBase(candidate, hotelQuery, candidate.address.slice(0, 100) || candidate.name, new Date().toISOString()));
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
      setHotelState({
        status: "ready",
        candidates: hotelShortlist(rankedCandidates, selected.id),
        selectedId: selected.id,
        fresh: { status: "loading", result: null },
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
    } catch {
      if (!controller.signal.aborted) setHotelRefreshFailed(true);
    } finally {
      if (hotelRefreshAbortRef.current === controller) {
        hotelRefreshAbortRef.current = null;
        setHotelRefreshing(false);
      }
    }
  }

  async function openRecentTrip(entry: StoredTripRecord) {
    const code = storedTripShareCode(entry);
    const shared = code ? decodeTripShare(code) : null;
    if (!shared) {
      const store = tripStoreRef.current;
      if (store) {
        await store.delete(entry.id);
        setRecentTrips(await store.list());
      }
      return;
    }
    currentStoredTripIdRef.current = entry.id;
    applySharedTripInput(shared);
  }

  async function deleteRecentTrip(entry: StoredTripRecord) {
    const store = tripStoreRef.current;
    if (!store) return;
    await store.delete(entry.id);
    if (currentStoredTripIdRef.current === entry.id) currentStoredTripIdRef.current = null;
    setRecentTrips(await store.list());
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
    commitPlannerEdit({ removedStops: [...removedStops, { id: stop.id, name: authoredName }] });
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
    if (dayIndex === activeDay) {
      // Tapping the current day releases the stop back to automatic placement.
      if (!(stopId in dayOverrides)) return;
      const next = { ...dayOverrides };
      delete next[stopId];
      commitPlannerEdit({ dayOverrides: next });
      return;
    }
    commitPlannerEdit({ dayOverrides: { ...dayOverrides, [stopId]: dayIndex + 1 } });
    setActiveDay(dayIndex);
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
                {locale === "ja" ? "変更" : "Change"}
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
      (candidate.rating === null ? 60 : candidate.rating / 5 * 82)
      + Math.min(18, Math.log10(Math.max(1, candidate.userRatingCount ?? 1)) * 6),
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
    setMealSelections((current) => ({ ...current, [slotId]: candidate.id }));
    setFoodRecommendationNotice(evaluation.decision === "CONDITIONAL"
      ? (locale === "ja" ? "旅程に追加しました。営業時間は未確認として表示します。" : "Added; opening hours remain unverified.")
      : "");
    postBuildLegBudgetRef.current = Math.max(postBuildLegBudgetRef.current, 6);
  }

  function renderHotelComparison() {
    if (!selectedHotel || hotelState.candidates.length <= 1) return null;
    const comparisonCandidates = hotelShortlist(hotelState.candidates, selectedHotel.id);
    return (
      <section className="planner-hotel-compare">
        <header><span>{text.hotelCompareHeading}</span><small>{comparisonCandidates.length}</small></header>
        <div className="planner-hotel-compare-list">
          {comparisonCandidates.map((candidate) => {
            const tags = [
              ...hotelAxisLabels(candidate),
              ...(candidate.styles.includes("luxury") ? [text.styleLuxury] : []),
            ];
            return (
              <article className={`planner-hotel-card${candidate.id === selectedHotel.id ? " is-selected" : ""}`} key={candidate.id}>
                <button aria-pressed={candidate.id === selectedHotel.id} onClick={() => selectHotelCandidate(candidate)} title={text.useThisHotel} type="button">
                  <span className="planner-hotel-card-image">
                    {candidate.photo ? <>
                      {/* Google photo names are fetched at request time and never persisted. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={candidate.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photo.name)}`} />
                    </> : <span aria-hidden="true"><Icon name="bed" size={22} /></span>}
                    <em>{hotelPriceLabel(candidate)}</em>
                  </span>
                  <span className="planner-hotel-card-copy">
                    <b>{candidate.name}</b>
                    <small>
                      {[
                        candidate.rating !== null ? `★ ${candidate.rating.toFixed(1)}（${candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}）` : null,
                        hotelTravelMinutesById[candidate.id] !== undefined
                          ? locale === "ja"
                            ? `全日程の移動 約${hotelTravelMinutesById[candidate.id]}分${Number.isFinite(bestHotelTravelMinutes) && hotelTravelMinutesById[candidate.id] > bestHotelTravelMinutes ? `（最短比 +${hotelTravelMinutesById[candidate.id] - bestHotelTravelMinutes}分）` : ""}`
                            : `~${hotelTravelMinutesById[candidate.id]} min total travel${Number.isFinite(bestHotelTravelMinutes) && hotelTravelMinutesById[candidate.id] > bestHotelTravelMinutes ? ` (+${hotelTravelMinutesById[candidate.id] - bestHotelTravelMinutes} vs best)` : ""}`
                          : text.distanceFrom(formatDistanceMeters(candidate.routeAverageDistanceMeters)),
                      ].filter(Boolean).join(" · ")}
                    </small>
                    {tags.length > 0 ? (
                      <span className="planner-hotel-card-tags">
                        {tags.map((tag) => <i key={tag}>{tag}</i>)}
                      </span>
                    ) : null}
                    {candidate.rakuten?.reviewAverage ? (
                      <small className="is-rakuten-line">{text.rakutenTag(candidate.rakuten.reviewAverage, candidate.rakuten.reviewCount ?? 0)}</small>
                    ) : null}
                  </span>
                </button>
                <footer>
                  {candidate.photo?.attribution
                    ? <a href={candidate.photo.attribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {candidate.photo.attribution.name}</a>
                    : <span />}
                  <a href={candidate.rakuten?.url ?? candidate.googleMapsUrl} rel="noreferrer" target="_blank">{candidate.rakuten ? "Rakuten" : "Maps"} ↗</a>
                </footer>
              </article>
            );
          })}
        </div>
      </section>
    );
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
    commitPlannerEdit({ tripDays: nextDays, dayStartTimes: nextStartTimes, dayEndTimes: nextEndTimes });
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
      const center = balancedGeoCenter(boundaryStops);
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
    rotateTripRequestToken();
    resetAnalyticsMilestones();
    currentStoredTripIdRef.current = null;
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    hotelRefreshAbortRef.current?.abort();
    hotelRefreshAbortRef.current = null;
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
    setLiveTransit({});
    setLiveTransitTransferCounts({});
    setLiveWalking({});
    setLiveDriving({});
    setPrefetchTransit({});
    setLiveTransitAbsent({});
    setPrefetchTransitAbsent({});
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
  }

  async function reviewWishlistPlaces() {
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
      setInputStep("conditions");
    } finally {
      if (placeReviewAbortRef.current === controller) {
        placeReviewAbortRef.current = null;
        setIsResolvingPlaces(false);
      }
    }
  }

  async function buildPlan(options: { preserveEdits?: boolean } = {}) {
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
      setLiveTransit({});
      setLiveTransitTransferCounts({});
      setLiveWalking({});
      setLiveDriving({});
      setPrefetchTransit({});
      setLiveTransitAbsent({});
      setPrefetchTransitAbsent({});
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

    const canReusePlaceReview = placesHaveBeenReviewed && reviewedInputSignature === currentInputSignature;
    let places: ResolvedInputStop[] = canReusePlaceReview
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
    let draft = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContext(resolvedHotel));
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
    // A placeholder date must not consume an Enterprise-hours call or turn an
    // arbitrary weekday into a hard closure. The result stays explicit and
    // conditional until the traveller confirms a date.
    const preHotelEvidenceStops = !tripDateTouched
      ? []
      : takeWithinPlanningBudget(preHotelStops, PLANNING_BUDGET.openingHours);
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
    let localHotelState: HotelState = { status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState };
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
              tripDays,
              pace,
              locale,
              plannerContext(hotelAsResolvedBase(candidate, hotelQuery, hotelAnchor.area, hotelResponse.fetchedAt)),
            )),
          }))
          .sort((left, right) => left.travelMinutes - right.travelMinutes
            || right.candidate.score - left.candidate.score
            || left.candidate.id.localeCompare(right.candidate.id));
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
        localHotelState = { status: "ready", candidates: hotelShortlist(candidates, selected?.id), selectedId: selected?.id ?? null, fresh: emptyFreshState };
      } catch {
        localHotelState = { status: "unavailable", candidates: [], selectedId: null, fresh: emptyFreshState };
      }
    }
    if (cancelled()) return;
    if (!commit(() => {
      setHotelState(localHotelState);
      setHotelPurpose(useRecommendedHotelForBuild ? "balanced" : "picked");
      setResolvedBase(effectiveBase);
      setBuildProgress((current) => ({ ...current, current: 1, total: 1 }));
    })) return;

    draft = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContext(effectiveBase));
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
        tripDays,
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
    draft = buildTripFromWishlist(itinerary, tripDays, pace, locale, plannerContext(effectiveBase, {}, [], appliedOpeningWindows));

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
      tripDays,
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
    setLiveTransit({});
    setLiveTransitTransferCounts({});
    setLiveWalking({});
    setLiveDriving({});
    setPrefetchTransit({});
    setLiveTransitAbsent({});
    setPrefetchTransitAbsent({});
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
    setLiveTransit({});
    setLiveTransitTransferCounts({});
    setLiveWalking({});
    setLiveDriving({});
    setPrefetchTransit({});
    setLiveTransitAbsent({});
    setPrefetchTransitAbsent({});
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
      const response = await requestFoodRecommendations(slot, locale, { destination: requestDestination });
      if (stale()) return;
      const next: FoodState = { status: "ready", requestKey, query, candidates: response.candidates.slice(0, 3), fetchedAt: response.fetchedAt, notes: {}, fresh: {} };
      setFoodSearches((current) => ({ ...current, [slot.id]: next }));
      // Google evidence owns the order. Claude runs behind the instant result
      // only to add compact comparison copy for the supplied candidates.
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
  }, [locale, requestDestination]);

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
        <section className="planner-print-sheet">
          <header className="planner-print-header">
            <p>
              TripCheck · {tripDateTouched
                ? tripStartDate
                : locale === "ja" ? "日付未定" : "Date not decided"}
              {locale === "ja" ? ` · ${plan.requestedDays}日間` : ` · ${plan.requestedDays} days`}
            </p>
            <h1>{resultStateCopy?.headline ?? plan.days[0]?.theme ?? "Trip plan"}</h1>
            {feasibilityResult ? (
              <div className="planner-print-verdict">
                <b>{resultStateCopy?.label}</b>
                <span>
                  {locale === "ja"
                    ? `重要情報: 確認済み ${feasibilityResult.criticalFacts.verified} / 推定 ${feasibilityResult.criticalFacts.estimated} / 未確認 ${feasibilityResult.criticalFacts.unknown}`
                    : `Critical facts: ${feasibilityResult.criticalFacts.verified} confirmed / ${feasibilityResult.criticalFacts.estimated} estimated / ${feasibilityResult.criticalFacts.unknown} unknown`}
                </span>
                <span>
                  {feasibilityResult.minimumDays === null
                    ? locale === "ja" ? "最短日数は未確定です。" : "Minimum days are not yet determined."
                    : locale === "ja" ? `同じ条件での最短日数: ${feasibilityResult.minimumDays}日` : `Minimum under the same conditions: ${feasibilityResult.minimumDays} day${feasibilityResult.minimumDays === 1 ? "" : "s"}`}
                </span>
              </div>
            ) : null}
          </header>
          {feasibilityResult?.conflicts.length ? (
            <section className="planner-print-alert is-conflict">
              <h2>{locale === "ja" ? "変更が必要な条件" : "Conflicts that need a change"}</h2>
              <ul>{feasibilityResult.conflicts.map((conflict, index) => <li key={`${conflict.code}-${index}`}>{conflictCopy(conflict, locale)}</li>)}</ul>
            </section>
          ) : feasibilityResult?.primaryAttention ? (
            <section className="planner-print-alert">
              <h2>{locale === "ja" ? "最大の注意点" : "Biggest attention"}</h2>
              <p>{attentionCopy(feasibilityResult.primaryAttention, locale)}</p>
            </section>
          ) : null}
          {feasibilityResult ? (
            <section className="planner-print-assumptions">
              <h2>{locale === "ja" ? "この判定の前提" : "Assumptions behind this verdict"}</h2>
              {feasibilityResult.assumptions.length ? (
                <ul>{feasibilityResult.assumptions.map((assumption) => <li key={assumption.code}>{assumptionCopy(assumption, locale)}</li>)}</ul>
              ) : <p>{locale === "ja" ? "重要な前提はすべて確認済みです。" : "All critical assumptions are confirmed."}</p>}
            </section>
          ) : null}
          <section className="planner-print-conditions">
            <h2>{locale === "ja" ? "旅の条件" : "Trip conditions"}</h2>
            <dl>
              <div><dt>{locale === "ja" ? "拠点" : "Base"}</dt><dd>{plan.selectedBase ? `${plan.selectedBase.name} · ${resolvedStopAddress(plan.selectedBase)}` : locale === "ja" ? "未指定" : "Not specified"}</dd></div>
              <div><dt>{locale === "ja" ? "到着" : "Arrival"}</dt><dd>{arrivalAirport === "none" ? (locale === "ja" ? "指定なし" : "Not specified") : `${arrivalAirport} · ${arrivalTime || "—"}`}</dd></div>
              <div><dt>{locale === "ja" ? "出発" : "Departure"}</dt><dd>{departureAirport === "none" ? (locale === "ja" ? "指定なし" : "Not specified") : `${departureAirport} · ${departureTime || "—"}`}</dd></div>
              <div><dt>{locale === "ja" ? "移動余白" : "Leg buffer"}</dt><dd>{transferBufferMinutes}{locale === "ja" ? "分" : " min"}</dd></div>
              <div><dt>{locale === "ja" ? "徒歩上限" : "Walking limit"}</dt><dd>{plan.mobilityPolicy.maxWalkingMinutesPerLeg}{locale === "ja" ? "分/区間" : " min/leg"}</dd></div>
              <div><dt>{locale === "ja" ? "乗換上限" : "Transfer limit"}</dt><dd>{plan.mobilityPolicy.maxTransfersPerLeg}{locale === "ja" ? "回/区間" : "/leg"}</dd></div>
            </dl>
          </section>
          {!P0_CORE_ONLY && activeEssentials ? (
            <p className="planner-print-essentials">
              {text.essentialsPlug}: {activeEssentials.plug} · {text.essentialsEmergency}: {locale === "ja" ? activeEssentials.emergency.ja : activeEssentials.emergency.en}
              {" · "}{locale === "ja" ? activeEssentials.tipping.ja : activeEssentials.tipping.en}
            </p>
          ) : null}
          {beforeYouGo && (beforeYouGo.reservations.length > 0 || beforeYouGo.watchlist.length > 0) ? (
            <p className="planner-print-essentials">
              {beforeYouGo.reservations.map((entry) => `✓ ${entry.name}${entry.time ? ` ${entry.time}` : ""}`).join(" · ")}
              {beforeYouGo.reservations.length > 0 && beforeYouGo.watchlist.length > 0 ? " · " : ""}
              {beforeYouGo.watchlist.map((name) => `! ${name}`).join(" · ")}
            </p>
          ) : null}
          {plan.unknownEntries.length > 0 || plan.deferredUnavailableStops.length > 0 || plan.deferredOptionalStops.length > 0 || removedStops.length > 0 ? (
            <section className="planner-print-alert planner-print-omissions">
              <h2>{locale === "ja" ? "旅程に入っていない場所" : "Places not in the schedule"}</h2>
              <ul>
                {plan.deferredUnavailableStops.map((stop) => (
                  <li key={`unavailable-${stop.id}`}><b>{stop.name}</b><small>{locale === "ja" ? "休業または営業時間が合いません" : "Closed or outside usable opening hours"}</small></li>
                ))}
                {plan.deferredOptionalStops.map((stop) => (
                  <li key={`optional-${stop.id}`}><b>{stop.name}</b><small>{locale === "ja" ? "選んだ日数・ペースでは収まりません" : "Does not fit the selected days and pace"}</small></li>
                ))}
                {plan.unknownEntries.map((entry, index) => (
                  <li key={`unknown-${index}-${entry}`}><b>{entry}</b><small>{locale === "ja" ? "場所を解決できないため未判定です" : "Unresolved, so it was not evaluated"}</small></li>
                ))}
                {removedStops.map((entry) => (
                  <li key={`removed-${entry.id}`}><b>{entry.name}</b><small>{locale === "ja" ? "旅行者が旅程から外しました" : "Removed from the plan by the traveller"}</small></li>
                ))}
              </ul>
            </section>
          ) : null}
          {plan.days.map((printDay, printIndex) => (
            <article key={printDay.label}>
              <h2>
                {printIndex + 1} · {tripDateTouched ? printDay.date ?? printDay.label : printDay.label} · {printDay.startTime}—{printDay.finishTime}
                {printDay.deadline ? ` · ${locale === "ja" ? "締切" : "cutoff"} ${printDay.deadline}${printDay.deadlineOverrunMinutes > 0 ? ` (+${printDay.deadlineOverrunMinutes}${locale === "ja" ? "分" : " min"})` : ""}` : ""}
                {weatherByDay[printIndex]
                  ? ` · ${weatherByDay[printIndex].temperatureMaxC}°/${weatherByDay[printIndex].temperatureMinC}°${weatherByDay[printIndex].precipitationPercent !== null ? ` ${text.precipitation(weatherByDay[printIndex].precipitationPercent!)}` : ""}`
                  : ""}
                {tripDateTouched && printDay.date && holidaysByDate[printDay.date]
                  ? ` · ${text.holidayBadge} ${holidaysByDate[printDay.date].localName}`
                  : ""}
              </h2>
              <ol>
                {printDay.stops.map((built, stopIndex) => {
                  const leg = printDay.legs[stopIndex];
                  const durationStatus = durationEvidenceByStopId[built.stop.id] ?? "estimated";
                  const durationSource = durationStatus === "user_provided"
                    ? (locale === "ja" ? "ユーザー指定" : "user-set")
                    : durationStatus === "verified"
                      ? (locale === "ja" ? "確認済み" : "confirmed")
                      : (locale === "ja" ? "推定" : "estimated");
                  return (
                    <li key={`${built.stop.id}-${stopIndex}`}>
                      <b>{built.arrival}–{built.departure}</b> {built.stop.name}
                      <small> · {resolvedStopAddress(built.stop)} · {built.stop.planningDurationMinutes}{locale === "ja" ? "分滞在" : " min stay"} ({durationSource}){built.isReservation ? ` · ${text.printBooked}${built.fixedTime ? ` ${built.fixedTime}` : ""}` : built.fixedTime ? ` · ${locale === "ja" ? "固定" : "fixed"} ${built.fixedTime}` : ""}</small>
                      {built.reservationLateMinutes > 0 ? <strong>{locale === "ja" ? `予約に${built.reservationLateMinutes}分遅れ` : `${built.reservationLateMinutes} min late for booking`}</strong> : null}
                      {built.openingStatus === "conflict" ? <strong>{text.openingConflict}</strong> : null}
                      {built.openingStatus === "closed_day" ? <strong>{text.openingClosedDay}</strong> : null}
                      {built.openingStatus === "last_entry_conflict" ? <strong>{locale === "ja" ? "最終入場に間に合いません" : "Misses last entry"}</strong> : null}
                      {built.openingStatus === "unknown" ? <strong className="is-unknown">{locale === "ja" ? "営業時間は未確認" : "Opening hours unverified"}</strong> : null}
                      {leg ? <em> ↓ {leg.comparison.recommended.minutes}{locale === "ja" ? "分" : " min"} ({legModeLabel(leg.comparison.recommended.mode, locale)}){leg.comparison.recommended.source === "live" ? ` · ${locale === "ja" ? "取得済み" : "retrieved"}` : ` · ${locale === "ja" ? "推定" : "estimated"}`}{printTransferCopy(leg, plan.mobilityPolicy.maxTransfersPerLeg, locale)}{leg.walkingLimitExceededMinutes > 0 ? ` · ${locale === "ja" ? `徒歩上限+${leg.walkingLimitExceededMinutes}分` : `walking limit +${leg.walkingLimitExceededMinutes} min`}` : ""}</em> : null}
                    </li>
                  );
                })}
              </ol>
            </article>
          ))}
          {regionalCoverage ? (
            <section className="planner-print-coverage">
              <h2>{locale === "ja" ? "地域別の対応品質" : "Regional coverage"}</h2>
              <p>{regionalCoverage.label[locale]} · Routes {regionalCoverage.grades.routes} · Places {regionalCoverage.grades.poi} · Hours {regionalCoverage.grades.hours} · Transit {regionalCoverage.grades.transit}</p>
              <p>{coveragePublicCopy(regionalCoverage, locale)}</p>
            </section>
          ) : null}
          <p className="planner-print-essentials">{text.printFooter}</p>
        </section>
      ) : null}
      <header className="planner-topbar">
        <button className="planner-brand" onClick={resetTrip} type="button" aria-label="TripCheck home">
          <span className="planner-brand-mark" aria-hidden="true"><Icon name="mark" size={19} /></span>
          <b>TripCheck</b><small>{text.brandNote(activeDestination.id === "worldwide" ? "" : destinationName(activeDestination, locale))}</small>
        </button>
        <div className="planner-top-actions">
          <a aria-label={locale === "ja" ? "プライバシー方針" : "Privacy policy"} className="planner-privacy" href="/privacy" title={locale === "ja" ? "プライバシー方針" : "Privacy policy"}><i aria-hidden="true"><Icon name="check" size={10} /></i><span>{text.privacy}</span></a>
          <div className="planner-language" aria-label={text.language}>
            <button aria-pressed={locale === "ja"} className={locale === "ja" ? "is-active" : ""} onClick={() => changeLocale("ja")} type="button">日本語</button>
            <button aria-pressed={locale === "en"} className={locale === "en" ? "is-active" : ""} onClick={() => changeLocale("en")} type="button">EN</button>
          </div>
          {hasPlan ? <button className="planner-new-trip" onClick={resetTrip} type="button"><span aria-hidden="true"><Icon name="plus" size={14} /></span>{text.newTrip}</button> : null}
        </div>
      </header>

      <div className={`planner-map-canvas${displayedMapStops.length > 8 ? " is-dense" : ""}`} aria-label={text.mapReady}>
        {hasPlan ? (
          <div className="planner-map-scope" role="group" aria-label={locale === "ja" ? "地図に表示する日程" : "Days shown on map"}>
            <button aria-pressed={mapScope === "all"} className={mapScope === "all" ? "is-active" : ""} onClick={() => setMapScope("all")} type="button">{locale === "ja" ? "全日程" : "All days"}</button>
            <button aria-pressed={mapScope === "day"} className={mapScope === "day" ? "is-active" : ""} onClick={() => setMapScope("day")} type="button">{locale === "ja" ? "この日" : "This day"}</button>
          </div>
        ) : null}
        {hasPlan && plan && plan.days.length > 1 ? (
          <div className="planner-map-day-legend" aria-label={locale === "ja" ? "日別ルートの色" : "Route colours by day"}>
            {plan.days.map((planDay, index) => (
              <button
                aria-label={locale === "ja" ? `${index + 1}日目を選択` : `Select Day ${index + 1}`}
                aria-pressed={index === activeDay}
                className={index === activeDay ? "is-active" : ""}
                key={planDay.label}
                onClick={() => switchDay(index)}
                style={{ "--planner-day-color": plannerDayColors[index % plannerDayColors.length] } as CSSProperties}
                type="button"
              ><i aria-hidden="true" />{locale === "ja" ? `${index + 1}日` : `D${index + 1}`}</button>
            ))}
          </div>
        ) : null}
        {inputStep !== "places" || hasPlan || isBuilding ? <PlannerGoogleMap
          apiKey={mapsApiKey}
          base={displayedMapBase}
          endBase={hasPlan ? dayEndBase : null}
          departureTimes={routeDepartureTimes}
          destination={activeDestination}
          drawRoute={hasPlan}
          foodPins={P0_CORE_ONLY ? [] : foodPins}
          hotelPins={P0_CORE_ONLY ? [] : hotelPins}
          recommendationPins={P0_CORE_ONLY ? [] : recommendationPins}
          routeBudgetKey={`${buildRunRef.current}:${transitConvergenceInputKey}`}
          routeBudgetUsed={currentTransitConvergence?.eventCount ?? 0}
          routeRequestsPaused={!tripDateTouched || Boolean(plan && !currentTransitConvergence)}
          routePauseReason={!tripDateTouched ? "date_required" : plan && !currentTransitConvergence ? "checking" : null}
          transitGeometry={routeTransitGeometry}
          coordinatePickActive={!hasPlan && inputStep === "conditions" && manualPinTarget !== null}
          coordinatePick={manualPinCoordinate}
          inspectorOpen={Boolean(inspector)}
          dayActive
          dayColor={plannerDayColors[activeDay % plannerDayColors.length]}
          dayIndex={activeDay}
          dayLayers={mapScope === "all" ? mapDayLayers : []}
          itemKinds={mapItemKinds}
          locale={locale}
          onRouteGeometry={handleRouteGeometry}
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
          onSelectFood={handleSelectFoodPin}
          onSelectHotel={selectedHotel ? () => setInspector({ kind: "hotel" }) : undefined}
          onSelectHotelCandidate={(candidateId) => {
            const candidate = hotelState.candidates.find((entry) => entry.id === candidateId);
            if (candidate) selectHotelCandidate(candidate);
          }}
          onSelectRecommendation={selectRouteRecommendation}
          onSelectDayStop={(dayIndex, stopId) => {
            setActiveDay(dayIndex);
            handleSelectStop(stopId);
          }}
          onSelectStop={handleSelectStop}
          routeModes={routeModes}
          selectedFoodPinId={inspector?.kind === "food" ? inspector.candidateId ?? null : null}
          selectedHotelPinId={selectedHotel?.id ?? null}
          selectedRecommendationPinId={selectedRouteRecommendation?.id ?? null}
          selectedStopId={inspector?.kind === "stop" ? inspector.stopId : inspector?.kind === "hotel" ? displayedMapBase?.id ?? null : mapFocusedStopId}
          stops={displayedMapStops}
          warningStopIds={mapWarningStopIds}
        /> : null}

        {!day && !hasPlan && !isBuilding && displayedMapStops.length === 0 ? <div className="planner-map-empty"><span aria-hidden="true"><Icon name="pin" size={16} /></span><p>{text.mapEmpty}</p></div> : null}

        {day ? (
          <div className="planner-map-bottom">
            {!P0_CORE_ONLY && selectedHotel ? (
              <button
                className={`planner-hotel-chip${inspector?.kind === "hotel" ? " is-active" : ""}`}
                onClick={() => setInspector(inspector?.kind === "hotel" ? null : { kind: "hotel" })}
                type="button"
              >
                <span aria-hidden="true"><Icon name="bed" size={15} /></span>{text.hotelChip}
              </button>
            ) : null}
            {!P0_CORE_ONLY ? daySlots.map((slot) => {
              const slotState = foodSearches[slot.id];
              return (
                <button
                  className={`planner-meal-chip is-${slot.kind}${inspector?.kind === "food" && inspector.slotId === slot.id ? " is-active" : ""}`}
                  key={slot.id}
                  onClick={() => openFoodSlot(slot)}
                  type="button"
                >
                  <span aria-hidden="true"><Icon name={slot.kind === "lunch" ? "sun" : "moon"} size={15} /></span>
                  {slot.kind === "lunch" ? text.lunchChip : text.dinnerChip}
                  {slotState?.status === "ready" && slotState.candidates.length > 0 ? <b>{slotState.candidates.length}</b> : null}
                </button>
              );
            }) : null}
            {!P0_CORE_ONLY && primaryRecommendationGap ? (
              <button
                className={`planner-recommendation-chip${inspector?.kind === "recommendations" ? " is-active" : ""}`}
                onClick={openRouteRecommendations}
                type="button"
              >
                <span aria-hidden="true"><Icon name="spark" size={14} /></span>
                {text.routeIdeasChip}
                {activeRouteRecommendationState.status === "ready" && activeRouteRecommendationState.candidates.length > 0
                  ? <b>{activeRouteRecommendationState.candidates.length}</b>
                  : null}
              </button>
            ) : null}
            {day.googleMapsUrl ? (
              <a className="planner-open-maps" href={day.googleMapsUrl} rel="noreferrer" target="_blank">
                {text.openMaps}<span aria-hidden="true"><Icon name="external" size={14} /></span>
              </a>
            ) : null}
          </div>
        ) : null}

        {selectedBuiltStop ? (
          <aside
            aria-labelledby="planner-stop-inspector-title"
            className="planner-inspector"
            ref={inspectorPanelRef}
            role="dialog"
            tabIndex={-1}
          >
            <button className="planner-inspector-close" onClick={() => { setInspector(null); setRouteAlternativesExpanded(false); }} type="button" aria-label={text.close}><Icon name="close" size={13} /></button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num">{selectedStopIndex + 1}</span>
              <div>
                <h2 id="planner-stop-inspector-title">{selectedBuiltStop.stop.name}</h2>
                <p>{selectedBuiltStop.stop.area}</p>
              </div>
            </header>
            <div className="planner-inspector-meta">
              <span>{selectedBuiltStop.arrival}–{selectedBuiltStop.departure}</span>
              {selectedBuiltStop.fixedTime ? <span className="is-booked">{selectedBuiltStop.isReservation ? text.reservation : text.timePinned} {selectedBuiltStop.fixedTime}</span> : null}
              {selectedBuiltStop.reservationLateMinutes > 0 ? <span className="is-booked">{text.lateBy(selectedBuiltStop.reservationLateMinutes)}</span> : null}
              {selectedBuiltStop.priority === "must" ? <span className="is-must">{text.must}</span> : null}
              {selectedBuiltStop.priority === "optional" ? <span className="is-optional">{text.optional}</span> : null}
              {selectedBuiltStop.openingStatus === "verified_open" ? <span>{text.openingAdjusted}</span> : null}
              {selectedBuiltStop.openingStatus === "conflict" ? <span className="is-booked">{text.openingConflict}</span> : null}
              {selectedBuiltStop.openingStatus === "closed_day" ? <span className="is-booked">{text.openingClosedDay}</span> : null}
              {selectedBuiltStop.openingStatus === "last_entry_conflict" ? <span className="is-booked">{locale === "ja" ? "最終入場に間に合いません" : "Misses last entry"}</span> : null}
              {selectedBuiltStop.crowd ? (
                <span className="is-crowd">
                  {text.crowd[selectedBuiltStop.crowd.level]}{selectedBuiltStop.crowd.isWeekend ? text.crowdWeekend : ""}{text.crowdForecast}
                </span>
              ) : null}
            </div>
            <label className="planner-stay-edit">
              <span>{text.stayLabel}</span>
              <select
                onChange={(event) => {
                  const value = event.target.value;
                  const stopId = selectedBuiltStop.stop.id;
                  // Only the user's own edits live here; clearing back to auto
                  // re-exposes the evidence buffer kept in durationOverrides.
                  const next = { ...userStayMinutes };
                  if (!value) delete next[stopId];
                  else next[stopId] = Number(value);
                  commitPlannerEdit({ userStayMinutes: next });
                }}
                value={String(userStayMinutes[selectedBuiltStop.stop.id] ?? "")}
              >
                <option value="">
                  {userStayMinutes[selectedBuiltStop.stop.id] == null
                    ? `${text.stayAuto} · ${text.minutes(selectedBuiltStop.stop.planningDurationMinutes)}`
                    : text.stayAuto}
                </option>
                {[30, 45, 60, 90, 120, 150, 180, 240].map((minutes) => (
                  <option key={minutes} value={minutes}>{text.minutes(minutes)}</option>
                ))}
              </select>
            </label>
            <label className="planner-stay-edit">
              <span>{locale === "ja" ? "最終入場（分かる場合）" : "Last entry (if known)"}</span>
              <input
                aria-describedby="planner-last-entry-note"
                onChange={(event) => {
                  const value = event.target.value;
                  const stopId = selectedBuiltStop.stop.id;
                  const next = { ...lastEntryTimes };
                  if (!value) delete next[stopId];
                  else next[stopId] = value;
                  commitPlannerEdit({ lastEntryTimes: next });
                }}
                type="time"
                value={lastEntryTimes[selectedBuiltStop.stop.id] ?? ""}
              />
              <small id="planner-last-entry-note">{locale === "ja" ? "閉館時刻とは別の入場締切です。入力した値はあなたが確認した条件として扱います。" : "This is the admission cutoff, not closing time. It is treated as a condition you supplied."}</small>
            </label>
            {plan && plan.days.length > 1 ? (
              <div className="planner-day-move" role="group" aria-label={text.moveDay}>
                <span>{text.moveDay}</span>
                <div>
                  {plan.days.map((_, dayIndex) => (
                    <button
                      aria-pressed={dayIndex === activeDay}
                      className={dayIndex === activeDay ? "is-active" : ""}
                      key={dayIndex}
                      onClick={() => moveStopToDay(selectedBuiltStop.stop.id, dayIndex)}
                      title={text.previewDay(dayIndex + 1)}
                      type="button"
                    >
                      {dayIndex + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button className="planner-remove-stop" onClick={() => removeStopFromPlan(selectedBuiltStop.stop)} type="button">
              <Icon name="close" size={11} />{text.removeStop}
            </button>
            {selectedIntel?.status === "loading" ? (
              <section className="planner-intel-card is-loading" aria-live="polite">
                <header><h3>{text.fieldEvidence}</h3></header>
                <p className="planner-fresh-status"><i aria-hidden="true" />{text.fieldChecking}</p>
              </section>
            ) : null}
            {selectedIntel?.status === "unavailable" ? <p className="planner-intel-unavailable" role="status">{text.fieldUnavailable}</p> : null}
            {selectedIntel?.status === "ready" && selectedIntel.result ? (() => {
              const intel = selectedIntel.result;
              const listedPayment = P0_CORE_ONLY ? null : paymentLabel(intel, locale);
              const currentDayWindows = day?.date
                ? googleCurrentOpeningWindowsForDate({
                  businessStatus: intel.place.businessStatus,
                  currentOpeningPeriods: intel.place.currentOpeningPeriods,
                  currentSpecialDays: intel.place.currentSpecialDays,
                }, day.date)
                : null;
              const dayWindows = currentDayWindows ?? (day?.date
                ? googleOpeningWindowsForDate({
                  businessStatus: intel.place.businessStatus,
                  regularOpeningPeriods: intel.place.regularOpeningPeriods,
                }, day.date)
                : null);
              const dayHoursText = dayWindows && dayWindows.length > 0
                ? dayWindows.map((window) => `${formatWindowClock(window.openMinutes)}–${formatWindowClock(window.closeMinutes)}`).join(" / ")
                : null;
              return (
                <section className="planner-intel-card" aria-label={`${selectedBuiltStop.stop.name} · ${text.fieldEvidence}`}>
                  <header>
                    <h3>{text.fieldEvidence}</h3>
                    <small>{intel.analyzedBy === "anthropic" ? text.aiAudited : text.rulesAudited}</small>
                  </header>
                  {!P0_CORE_ONLY && intel.place.photoName ? (
                    <a className="planner-intel-hero" href={intel.place.googleMapsUrl} key={intel.place.photoName} rel="noreferrer" target="_blank">
                      {/* Google place photos are proxied at request time and are not stored. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={intel.place.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(intel.place.photoName)}`} />
                    </a>
                  ) : null}
                  {!P0_CORE_ONLY && intel.place.photoAttribution ? (
                    <a className="planner-photo-credit" href={intel.place.photoAttribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {intel.place.photoAttribution.name}</a>
                  ) : null}
                  <div className="planner-intel-facts">
                    <span className={intel.place.openNow === false ? "is-warning" : ""}>
                      {intel.place.openNow === true ? text.openNow : intel.place.openNow === false ? text.closedNow : text.hoursUnknown}
                    </span>
                    {dayWindows !== null ? (
                      dayHoursText
                        ? <span>{text.dayHours(dayHoursText)}</span>
                        : <span className="is-warning">{text.dayClosed}</span>
                    ) : null}
                    {listedPayment ? <span className={intel.place.payment.cashOnly === true ? "is-warning" : ""}>{listedPayment}</span> : null}
                    {intel.place.websiteUrl === null ? <span className="is-warning">{text.noWebsite}</span> : null}
                    {!P0_CORE_ONLY && intel.place.rating !== null ? (
                      <span>★ {intel.place.rating.toFixed(1)} · {intel.place.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span>
                    ) : null}
                  </div>
                  <small className="planner-evidence-provenance">
                    Google Places · {formatCheckedAt(intel.checkedAt, locale)} · {currentDayWindows !== null
                      ? (locale === "ja" ? "指定日を含む現在の営業時間" : "current hours covering this date")
                      : (locale === "ja" ? "通常週の営業時間（祝日・臨時変更は未確認）" : "regular weekly hours; holidays and exceptions unverified")}
                  </small>
                  {intel.place.address ? <p className="planner-intel-address">{intel.place.address}</p> : null}
                  {!P0_CORE_ONLY ? <p className="planner-intel-summary">{intel.analysis.summary}</p> : null}
                  {!P0_CORE_ONLY && intel.analysis.signals.length > 0 ? (
                    <ul className="planner-intel-signals">
                      {intel.analysis.signals.slice(0, 2).map((signal, signalIndex) => (
                        <li className={`is-${signal.severity}`} key={`${signal.kind}-${signalIndex}`}>
                          <i aria-hidden="true" />
                          <div><b>{signal.title}</b><p>{signal.detail}</p><small>{signal.evidence}</small></div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!P0_CORE_ONLY && intel.reviews.length > 0 ? (
                    <div className="planner-intel-reviews">
                      <h4>{text.recentVoices}</h4>
                      {intel.reviews.slice(0, 1).map((review, reviewIndex) => (
                        <blockquote key={`${review.authorName}-${reviewIndex}`}>
                          <p>{review.text}</p>
                          <footer>
                            <span>{review.rating !== null ? `★ ${review.rating}` : ""} {review.relativeTime}</span>
                            <a href={review.authorUri ?? review.googleMapsUri ?? intel.place.googleMapsUrl} rel="noreferrer" target="_blank">{review.authorName} ↗</a>
                          </footer>
                        </blockquote>
                      ))}
                    </div>
                  ) : null}
                  <div className="planner-intel-links">
                    {!P0_CORE_ONLY ? <a href={intel.links.x} rel="noreferrer" target="_blank">{text.latestX} ↗</a> : null}
                    {!P0_CORE_ONLY ? <a href={intel.links.instagram} rel="noreferrer" target="_blank">{text.instagram} ↗</a> : null}
                    {intel.place.websiteUrl ? <a href={intel.place.websiteUrl} rel="noreferrer" target="_blank">{text.official} ↗</a> : null}
                    <a href={intel.place.googleMapsUrl} rel="noreferrer" target="_blank">Google Maps ↗</a>
                  </div>
                </section>
              );
            })() : null}

            <div className="planner-inspector-actions">
              {aiEnabled ? (
                <button
                  className="planner-check-button"
                  disabled={selectedCheckLoading || selectedCheckReady}
                  onClick={() => checkPlace(selectedBuiltStop.stop)}
                  type="button"
                >
                  <i aria-hidden="true" />{selectedCheckLoading ? text.fieldChecking : selectedCheckReady ? text.fieldChecked : selectedCheckRetry ? text.fieldRetry : text.fieldCheck}
                </button>
              ) : null}
              <a href={googleMapsSearchUrl(selectedBuiltStop.stop)} rel="noreferrer" target="_blank">Google Maps ↗</a>
            </div>

            {selectedFresh?.status === "loading" ? (
              <section className="planner-fresh-card is-loading" aria-live="polite">
                <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
                <p className="planner-fresh-status"><i aria-hidden="true" />{text.freshLoading}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "unavailable" ? (
              <section className="planner-fresh-card" aria-live="polite">
                <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3><small>{text.freshAiRole}</small></div></header>
                <p className="planner-fresh-empty">{text.freshUnavailable}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "paused" ? (
              <section className="planner-fresh-card">
                <header><span aria-hidden="true"><Icon name="signal" size={15} /></span><div><h3>{text.freshHeading}</h3></div></header>
                <p className="planner-fresh-empty">{text.freshPaused}</p>
              </section>
            ) : null}

            {selectedFresh?.status === "ready" && selectedFresh.result ? (() => {
              const fresh = selectedFresh.result;
              return (
                <details
                  className="planner-evidence-sources"
                  aria-label={`${selectedBuiltStop.stop.name} · ${text.freshHeading}`}
                  key={selectedBuiltStop.stop.id}
                  onToggle={(event) => {
                    if ((event.target as HTMLDetailsElement).open) ensureSourcePreviews(fresh.findings.slice(0, 3).map((finding) => finding.url));
                  }}
                >
                  <summary>{text.publicSources} · {fresh.findings.length} <small>{formatCheckedAt(fresh.checkedAt, locale)}</small></summary>
                  {fresh.findings.length > 0 ? (
                    <div className="planner-fresh-list">
                      {fresh.findings.slice(0, 3).map((finding) => (
                        <a href={finding.url} key={finding.url} rel="noreferrer" target="_blank">
                          <div>
                            <span className={`is-${finding.sourceKind}`}>{text.freshSource[finding.sourceKind]}</span>
                            <small>{finding.age ?? text.freshAgeUnknown}</small>
                          </div>
                          <b>{finding.title}</b>
                          <p>{finding.note}</p>
                          {sourcePreviews[finding.url]?.imageUrl ? <>
                            {/* Open Graph preview from the cited page itself; broken images fall back to the media badge. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt="" className="planner-fresh-thumb" loading="lazy" onError={handlePhotoError} referrerPolicy="no-referrer" src={sourcePreviews[finding.url].imageUrl ?? undefined} />
                          </> : null}
                          <i aria-hidden="true">↗</i>
                        </a>
                      ))}
                    </div>
                  ) : <p className="planner-fresh-empty">{text.freshEmpty}</p>}
                </details>
              );
            })() : null}
          </aside>
        ) : null}

        {inspector?.kind === "hotel" && selectedHotel ? (
          <aside
            aria-labelledby="planner-hotel-inspector-title"
            className="planner-inspector is-hotel"
            ref={inspectorPanelRef}
            role="dialog"
            tabIndex={-1}
          >
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}><Icon name="close" size={13} /></button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num is-hotel" aria-hidden="true"><Icon name="bed" size={17} /></span>
              <div>
                <h2 id="planner-hotel-inspector-title">{hotelStayMode === "nightly" ? text.stayNightly : selectedHotel.name}</h2>
                <p>{text.hotelCandidate}</p>
              </div>
            </header>
            {hotelUsesRecommendations && hotelStayMode === "single" ? (
              <div className={`planner-hotel-refresh-wrap${hotelPlanDirty ? " is-dirty" : ""}`}>
                {hotelPlanDirty ? <p>{text.hotelRefreshHint}</p> : null}
                <button className="planner-hotel-refresh" disabled={hotelRefreshing || !plan} onClick={() => void refreshHotelRecommendations()} type="button">
                  <Icon name="search" size={14} />
                  {hotelRefreshing ? text.hotelRefreshing : hotelPlanDirty ? text.hotelRefreshChanged : text.hotelRefresh}
                </button>
                {hotelRefreshFailed ? <small role="status">{text.hotelRefreshFailed}</small> : null}
              </div>
            ) : null}
            {hotelRouteContext && hotelRouteContext.spreadKm >= 70 ? (
              <div className="planner-hotel-wide-note">
                <Icon name="train" size={15} />
                <p>{text.hotelWideTrip}</p>
                <button onClick={() => void enableNightlyHotels()} type="button">{text.stayNightly}</button>
              </div>
            ) : null}
            {plan && plan.days.length >= 2 ? (
              <div className="planner-stay-mode" role="group" aria-label={text.stayModeHeading}>
                <button
                  aria-pressed={hotelStayMode === "single"}
                  className={hotelStayMode === "single" ? "is-active" : ""}
                  onClick={() => setHotelStayMode("single")}
                  type="button"
                >
                  {text.staySame}
                </button>
                <button
                  aria-pressed={hotelStayMode === "nightly"}
                  className={hotelStayMode === "nightly" ? "is-active" : ""}
                  onClick={() => void enableNightlyHotels()}
                  type="button"
                >
                  {text.stayNightly}
                </button>
              </div>
            ) : null}
            {(() => {
              if (hotelStayMode !== "nightly") return null;
              const nightCandidates = nightlyHotels.status === "ready" ? nightlyHotels.nights.flatMap((night) => night.candidates) : [];
              const styleAvailable = (style: HotelStyle) => style === "value"
                ? false
                : hotelState.candidates.some((candidate) => candidate.styles.includes(style))
                  || nightCandidates.some((candidate) => candidate.styles.includes(style));
              if (!styleAvailable("luxury") && !styleAvailable("value")) return null;
              const choices: Array<{ value: HotelStyleChoice; label: string; enabled: boolean }> = [
                { value: "recommended", label: text.styleRecommended, enabled: true },
                { value: "luxury", label: text.styleLuxury, enabled: styleAvailable("luxury") },
              ];
              return (
                <div className="planner-hotel-styles" role="group" aria-label={text.styleNote}>
                  {choices.map((choice) => (
                    <button
                      aria-pressed={hotelStyle === choice.value}
                      className={hotelStyle === choice.value ? "is-active" : ""}
                      disabled={!choice.enabled}
                      key={choice.value}
                      onClick={() => applyHotelStyle(choice.value)}
                      type="button"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              );
            })()}
            {hotelStayMode === "nightly" ? (
              <div className="planner-night-list">
                {nightlyHotels.status === "loading" ? <p className="planner-food-status" role="status">{text.nightlyLoading}</p> : null}
                {nightlyHotels.status === "unavailable" ? <p className="planner-food-status">{text.nightlyUnavailable}</p> : null}
                {nightlyHotels.status === "ready" ? nightlyHotels.nights.map((night, nightIndex) => {
                  const selected = night.candidates.find((candidate) => candidate.id === night.selectedId) ?? null;
                  const shortlist = hotelShortlist(night.candidates, night.selectedId);
                  const nightAxes = hotelAxisWinners(night.candidates);
                  return (
                    <section className="planner-night" key={`night-${nightIndex}`}>
                      <header><b>{text.nightLabel(nightIndex + 1)}</b><small>{night.area}</small></header>
                      {selected ? (
                        <div className="planner-night-options">
                          {shortlist.map((candidate) => (
                            <article className={`planner-hotel-card${candidate.id === selected.id ? " is-selected" : ""}`} key={candidate.id}>
                              <button
                                aria-pressed={candidate.id === selected.id}
                                onClick={() => selectNightCandidate(nightIndex, candidate.id)}
                                title={text.useThisHotel}
                                type="button"
                              >
                                <span className="planner-hotel-card-image">
                                  {candidate.photo ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt={candidate.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photo.name)}`} />
                                  ) : <span aria-hidden="true"><Icon name="bed" size={22} /></span>}
                                  <em>{hotelPriceLabel(candidate)}</em>
                                </span>
                                <span className="planner-hotel-card-copy">
                                  <b>{candidate.name}</b>
                                  <small>{[
                                    candidate.rating !== null ? `★ ${candidate.rating.toFixed(1)} (${candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"})` : null,
                                    text.distanceFrom(formatDistanceMeters(candidate.routeAverageDistanceMeters)),
                                  ].filter(Boolean).join(" · ")}</small>
                                  <span className="planner-hotel-card-tags">
                                    {candidate.id === night.candidates[0]?.id ? <i>{text.hotelPurposeBalanced}</i> : null}
                                    {candidate.id === nightAxes.nearestId ? <i>{text.hotelPurposeNearest}</i> : null}
                                    {candidate.id === nightAxes.topRatedId ? <i>{text.hotelPurposeRated}</i> : null}
                                    {candidate.styles.includes("luxury") ? <i>{text.styleLuxury}</i> : null}
                                  </span>
                                </span>
                              </button>
                              <footer>
                                {candidate.photo?.attribution
                                  ? <a href={candidate.photo.attribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {candidate.photo.attribution.name}</a>
                                  : <span />}
                                <a href={candidate.rakuten?.url ?? candidate.googleMapsUrl} rel="noreferrer" target="_blank">{candidate.rakuten ? "Rakuten" : "Maps"} ↗</a>
                              </footer>
                            </article>
                          ))}
                        </div>
                      ) : <p className="planner-food-status">{text.nightlyNightMissing}</p>}
                    </section>
                  );
                }) : null}
                <p className="planner-food-note">{text.hotelRankNote} {text.styleNote} {text.hotelNoAvailability}</p>
              </div>
            ) : (<>
            {hotelUsesRecommendations ? <div className="planner-hotel-purpose">
              <b>{text.hotelPurposeHeading}</b>
              <div role="group" aria-label={text.hotelPurposeHeading}>
                {([
                  { purpose: "balanced" as const, label: text.hotelPurposeBalanced, id: hotelState.candidates[0]?.id ?? null },
                  { purpose: "nearest" as const, label: text.hotelPurposeNearest, id: hotelAxis.nearestId },
                  { purpose: "rated" as const, label: text.hotelPurposeRated, id: hotelAxis.topRatedId },
                ]).map((choice) => {
                  const candidate = choice.id ? hotelState.candidates.find((item) => item.id === choice.id) ?? null : null;
                  return (
                    <button
                      aria-pressed={hotelPurpose === choice.purpose}
                      className={hotelPurpose === choice.purpose ? "is-active" : ""}
                      disabled={!candidate}
                      key={choice.purpose}
                      onClick={() => candidate && selectHotelCandidate(candidate, choice.purpose)}
                      type="button"
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
              <small>{text.hotelPurposeHelp}</small>
            </div> : null}
            {renderHotelComparison()}
            <p className="planner-hotel-reason">
              {!hotelUsesRecommendations ? text.hotelReasonSpecified
                : hotelPurpose === "nearest" ? text.hotelReasonNearest
                : hotelPurpose === "rated" ? text.hotelReasonRated
                  : hotelPurpose === "value" ? text.hotelReasonValue
                    : hotelPurpose === "balanced" ? text.hotelReasonTop
                      : text.hotelReasonPicked}
            </p>
            <a className="planner-hotel-hero" href={selectedHotel.googleMapsUrl} key={selectedHotel.id} rel="noreferrer" target="_blank">
              {selectedHotel.photo ? <>
                {/* Google place photos are proxied at request time and are not stored. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={selectedHotel.name} onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(selectedHotel.photo.name)}`} />
              </> : <span aria-hidden="true"><Icon name="bed" size={26} /></span>}
              <i>{hotelPriceLabel(selectedHotel)}</i>
            </a>
            {selectedHotel.photo?.attribution ? <a className="planner-photo-credit" href={selectedHotel.photo.attribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {selectedHotel.photo.attribution.name} ↗</a> : null}
            <div className="planner-hotel-facts">
              {selectedHotel.rating !== null ? <span className="is-rating">★ {selectedHotel.rating.toFixed(1)} · {selectedHotel.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span> : null}
              <span className={selectedHotel.rakuten?.minCharge ? "is-price" : ""}>{hotelPriceLabel(selectedHotel)}</span>
              <span>{text.distanceFrom(formatDistanceMeters(selectedHotel.routeAverageDistanceMeters))}</span>
              {hotelAxisLabels(selectedHotel).map((label) => <span className="is-axis" key={label}>{label}</span>)}
              {selectedHotel.styles.includes("luxury") ? <span>{text.styleLuxury}</span> : null}
              {selectedHotel.rakuten?.reviewAverage ? (
                <a className="is-rakuten" href={selectedHotel.rakuten.url} rel="noreferrer" target="_blank">
                  {text.rakutenTag(selectedHotel.rakuten.reviewAverage, selectedHotel.rakuten.reviewCount ?? 0)} ↗
                </a>
              ) : null}
              {selectedHotel.payment?.cashOnly === true ? <span>{text.cashOnly}</span> : null}
              {selectedHotel.payment?.acceptedMethods.includes("credit_card") ? <span>{text.cardsAccepted}</span> : null}
              {hotelState.fresh.result?.findings.length ? <span>{text.foodFresh(hotelState.fresh.result.findings.length)}</span> : null}
            </div>
            <p className="planner-hotel-address">{selectedHotel.address}</p>
            {selectedHotel.reviews?.[0] ? (
              <blockquote className="planner-hotel-review">
                <p>“{selectedHotel.reviews[0].text}”</p>
                <footer>
                  <span>{selectedHotel.reviews[0].rating !== null ? `★ ${selectedHotel.reviews[0].rating}` : ""} {selectedHotel.reviews[0].relativeTime ?? ""}</span>
                  <a href={selectedHotel.reviews[0].googleMapsUrl ?? selectedHotel.googleMapsUrl} rel="noreferrer" target="_blank">{selectedHotel.reviews[0].authorName ?? "Google Maps"} ↗</a>
                </footer>
              </blockquote>
            ) : null}
            <div className="planner-inspector-actions">
              <a href={selectedHotel.googleMapsUrl} rel="noreferrer" target="_blank">Google Maps ↗</a>
              {selectedHotel.websiteUrl ? <a href={selectedHotel.websiteUrl} rel="noreferrer" target="_blank">{text.official} ↗</a> : null}
            </div>
            {hotelState.fresh.result?.findings.length ? (
              <details
                className="planner-evidence-sources"
                onToggle={(event) => {
                  if ((event.target as HTMLDetailsElement).open) ensureSourcePreviews((hotelState.fresh.result?.findings ?? []).slice(0, 3).map((finding) => finding.url));
                }}
              >
                <summary>{text.publicSources} · {hotelState.fresh.result.findings.length}</summary>
                <div className="planner-fresh-list">
                  {hotelState.fresh.result.findings.map((finding) => (
                    <a href={finding.url} key={finding.url} rel="noreferrer" target="_blank">
                      <div><span className={`is-${finding.sourceKind}`}>{text.freshSource[finding.sourceKind]}</span><small>{finding.age ?? text.freshAgeUnknown}</small></div>
                      <b>{finding.title}</b><p>{finding.note}</p>
                      {sourcePreviews[finding.url]?.imageUrl ? <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt="" className="planner-fresh-thumb" loading="lazy" onError={handlePhotoError} referrerPolicy="no-referrer" src={sourcePreviews[finding.url].imageUrl ?? undefined} />
                      </> : null}
                      <i aria-hidden="true">↗</i>
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
            <p className="planner-food-note">
              {text.hotelRankNote} {hasRakutenHotelEvidence ? `${text.hotelPriceNote} ` : ""}{text.styleNote} {text.hotelNoAvailability}
            </p>
            </>)}
          </aside>
        ) : null}

        {activeFoodSlot && activeFoodState ? (
          <aside
            aria-labelledby="planner-food-inspector-title"
            className="planner-inspector is-food"
            ref={inspectorPanelRef}
            role="dialog"
            tabIndex={-1}
          >
            <button className="planner-inspector-close" onClick={() => setInspector(null)} type="button" aria-label={text.close}><Icon name="close" size={13} /></button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num is-food" aria-hidden="true"><Icon name={activeFoodSlot.kind === "lunch" ? "sun" : "moon"} size={17} /></span>
              <div>
                <h2 id="planner-food-inspector-title">{text.mealIdeas}</h2>
                <p>{activeFoodSlot.area} · {activeFoodSlot.window}</p>
              </div>
            </header>
            <p className="planner-food-rationale">{activeFoodSlot.rationale}</p>
            {foodRecommendationNotice ? <p className="planner-route-ideas-feedback" role="status">{foodRecommendationNotice}</p> : null}
            {activeFoodState.status === "loading" ? <p className="planner-food-status" role="status">{text.foodLoading}</p> : null}
            {activeFoodState.status === "unavailable" ? (
              <p className="planner-food-status">
                {text.foodUnavailable}{" "}
                <a href={foodSearchLinks(activeFoodState.query, activeFoodSlot.area, locale).googleMaps} rel="noreferrer" target="_blank">Google Maps ↗</a>
              </p>
            ) : null}
            {activeFoodState.status === "ready" ? (
              <div className="planner-food-results">
                {(mealCandidatesBySlot[activeFoodSlot.id] ?? []).map((candidate, index) => {
                  const note = activeFoodState.notes[candidate.id];
                  const foodFresh = activeFoodState.fresh[candidate.id]?.result;
                  return (
                    <article
                      className={inspector?.kind === "food" && inspector.candidateId === candidate.id ? "is-selected" : undefined}
                      data-food-candidate={candidate.id}
                      key={candidate.id}
                    >
                      <a className="planner-food-image" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">
                        {candidate.photoName ? <>
                          {/* Google place photos are short-lived, server-proxied URLs and cannot use a static Next image allowlist. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt={candidate.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
                        </> : <span aria-hidden="true"><Icon name="fork" size={20} /></span>}
                        <i className="planner-food-badge">{index + 1}</i>
                      </a>
                      <div>
                        <small>{note?.tag ?? (index === 0 ? (locale === "ja" ? "この土地なら、まずここ" : "Start here") : candidate.type)}</small>
                        <h3>{candidate.name}</h3>
                        <p>{note?.reason ?? foodCandidateReason(candidate, locale)}</p>
                        <div className="planner-food-stats">
                          {candidate.rating !== null ? <span className="is-rating">★ {candidate.rating.toFixed(1)} · {candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</span> : null}
                          {candidate.plannedOpen === true ? <span>{text.plannedOpen}</span> : candidate.plannedOpen == null && candidate.openNow === true ? <span>{text.openNow}</span> : null}
                          {candidate.paymentEvidence[0] ? <span>{candidate.paymentEvidence[0].label}</span> : null}
                          {foodFresh?.findings.length ? <span className="is-fresh">{text.foodFresh(foodFresh.findings.length)}</span> : null}
                        </div>
                        <button
                          className={`planner-meal-choose${mealSelections[activeFoodSlot.id] === candidate.id ? " is-active" : ""}`}
                          onClick={() => toggleMealSelection(activeFoodSlot.id, candidate.id)}
                          type="button"
                        >
                          {mealSelections[activeFoodSlot.id] === candidate.id ? (<><Icon name="check" size={11} />{text.mealChosen}</>) : text.mealChoose}
                        </button>
                        {candidate.reviewSnippets[0] ? <p className="planner-food-proof">“{candidate.reviewSnippets[0].text}” <a href={candidate.reviewSnippets[0].googleMapsUrl ?? candidate.googleMapsUrl} rel="noreferrer" target="_blank">{candidate.reviewSnippets[0].authorName} · {candidate.reviewSnippets[0].relativeTime} ↗</a></p> : null}
                        {candidate.photoAttribution ? (
                          <a className="planner-photo-credit" href={candidate.photoAttribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {candidate.photoAttribution.name}</a>
                        ) : null}
                        {foodFresh?.findings[0] ? <a className="planner-photo-credit" href={foodFresh.findings[0].url} rel="noreferrer" target="_blank">{text.freshSource[foodFresh.findings[0].sourceKind]} · {foodFresh.findings[0].title} ↗</a> : null}
                      </div>
                      <a className="planner-food-map" href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">{text.maps}<span aria-hidden="true">↗</span></a>
                    </article>
                  );
                })}
                <p className="planner-food-note">{text.foodNote}</p>
              </div>
            ) : null}
          </aside>
        ) : null}

        {inspector?.kind === "recommendations" && inspector.dayIndex === activeDay ? (
          <aside
            aria-labelledby="planner-route-ideas-title"
            className="planner-inspector is-recommendations"
            ref={inspectorPanelRef}
            role="dialog"
            tabIndex={-1}
          >
            <button className="planner-inspector-close" onClick={() => { setInspector(null); setRouteAlternativesExpanded(false); }} type="button" aria-label={text.close}><Icon name="close" size={13} /></button>
            <header className="planner-inspector-head">
              <span className="planner-inspector-num is-recommendation" aria-hidden="true"><Icon name="spark" size={17} /></span>
              <div>
                <h2 id="planner-route-ideas-title">{text.routeIdeasTitle}</h2>
                <p>{day?.label}{activeRouteRecommendationState.fetchedAt ? ` · ${formatCheckedAt(activeRouteRecommendationState.fetchedAt, locale)}` : ""}</p>
              </div>
            </header>
            <p className="planner-route-ideas-intro">{text.routeIdeasSubtitle}</p>
            {primaryRecommendationGap ? (
              <p className="planner-route-gap-note">
                {locale === "ja"
                  ? `${primaryRecommendationGap.startAt}〜${primaryRecommendationGap.endAt}の${primaryRecommendationGap.availableMinutes}分に収まる候補です。`
                  : `Fits the ${primaryRecommendationGap.availableMinutes}-minute gap from ${primaryRecommendationGap.startAt} to ${primaryRecommendationGap.endAt}.`}
              </p>
            ) : null}
            {routeRecommendationNotice ? <p className="planner-route-ideas-feedback" role="status">{routeRecommendationNotice}</p> : null}
            {activeRouteRecommendationState.status === "loading" ? (
              <p className="planner-route-ideas-status" role="status"><i aria-hidden="true" />{text.routeIdeasLoading}</p>
            ) : null}
            {activeRouteRecommendationState.status === "unavailable" ? (
              <div className="planner-route-ideas-empty" role="status">
                <p>{text.routeIdeasUnavailable}</p>
                <button onClick={() => void findRouteRecommendations()} type="button">{text.routeIdeasChip}</button>
              </div>
            ) : null}
            {activeRouteRecommendationState.status === "rate_limited" ? (
              <p className="planner-route-ideas-empty" role="status">{text.routeIdeasRateLimited}</p>
            ) : null}
            {activeRouteRecommendationState.status === "ready" && activeRouteRecommendationState.candidates.length === 0 ? (
              <p className="planner-route-ideas-empty" role="status">{text.routeIdeasEmpty}</p>
            ) : null}
            {activeRouteRecommendationState.status === "ready" && activeRouteRecommendationState.candidates.length > 0 ? (
              <div className="planner-route-ideas-list">
                {activeRouteRecommendationState.candidates.slice(0, routeAlternativesExpanded ? 3 : 1).map((candidate, index) => {
                  const added = plannedStopIds.has(recommendationStopId(candidate.id));
                  const selected = inspector.candidateId === candidate.id;
                  return (
                    <article className={selected ? "is-selected" : undefined} key={candidate.id}>
                      <button
                        aria-pressed={selected}
                        className="planner-route-idea-main"
                        onClick={() => selectRouteRecommendation(candidate.id)}
                        type="button"
                      >
                        <span className="planner-route-idea-image">
                          {candidate.photoName ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt={candidate.name} loading="lazy" onError={handlePhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
                          ) : <span aria-hidden="true"><Icon name="pin" size={20} /></span>}
                          <i>{index + 1}</i>
                        </span>
                        <span className="planner-route-idea-copy">
                          <small>{candidate.type}</small>
                          <b>{candidate.name}</b>
                          <span>
                            {candidate.rating !== null ? <em>★ {candidate.rating.toFixed(1)} · {candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</em> : null}
                            <em>{text.routeIdeasDistance(candidate.routeDistanceMeters)}</em>
                          </span>
                        </span>
                      </button>
                      <footer>
                        <button disabled={added} onClick={() => addRouteRecommendation(candidate)} type="button">
                          {added ? <><Icon name="check" size={12} />{text.routeIdeasAdded}</> : <><Icon name="plus" size={12} />{text.routeIdeasAdd}</>}
                        </button>
                        <a href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">Maps ↗</a>
                      </footer>
                      {candidate.photoAttribution ? (
                        <a className="planner-photo-credit" href={candidate.photoAttribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {candidate.photoAttribution.name}</a>
                      ) : null}
                    </article>
                  );
                })}
                {!routeAlternativesExpanded && activeRouteRecommendationState.candidates.length > 1 ? (
                  <button className="planner-route-alternatives" onClick={() => setRouteAlternativesExpanded(true)} type="button">
                    {locale === "ja" ? `他の候補を2件見る` : `See ${Math.min(2, activeRouteRecommendationState.candidates.length - 1)} alternatives`}
                  </button>
                ) : null}
                <p className="planner-route-ideas-note">{text.routeIdeasNote}</p>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      <section className="planner-sheet">
        {isBuilding ? (
          <div className="planner-building-view" aria-live="polite">
            <header className="planner-building-head">
              <span className="planner-building-orbit" aria-hidden="true" />
              <div><h1>{text.buildingTitle}</h1><p>{aiEnabled ? text.buildingBody : text.buildingBodyNoSocial}</p></div>
            </header>
            <ol className="planner-building-steps">
              {visibleBuildStages.map((stage, index) => {
                const state = index < activeBuildIndex ? "is-complete" : index === activeBuildIndex ? "is-active" : "";
                return (
                  <li className={state} key={stage}>
                    <span className="planner-building-step-dot" aria-hidden="true">{index < activeBuildIndex ? <Icon name="check" size={11} /> : index + 1}</span>
                    <span className="planner-building-step-copy">
                      <b>{text.buildSteps[stage]}</b>
                      {index === activeBuildIndex ? <small>{activeBuildDetail}</small> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="planner-building-live"><i aria-hidden="true" />{activeBuildDetail}</p>
            <button className="planner-building-cancel" onClick={cancelBuild} type="button">{text.buildingCancel}</button>
          </div>
        ) : !hasPlan ? (
          <div className="planner-form-view">
            <nav className={`planner-input-progress${inputStep === "places" && buildMode === "automatic" ? " is-compact" : ""}`} aria-label={locale === "ja" ? "入力の進み具合" : "Planning progress"}>
              <button aria-current={inputStep === "places" ? "step" : undefined} className={inputStep === "places" ? "is-active" : "is-complete"} onClick={() => setInputStep("places")} type="button">
                <i aria-hidden="true">{inputStep === "conditions" ? <Icon name="check" size={11} /> : 1}</i><span>{locale === "ja" ? "場所と日数" : "Places & days"}</span>
              </button>
              <span aria-hidden="true" />
              {inputStep === "conditions" || buildMode === "custom" ? <>
                <div aria-current={inputStep === "conditions" ? "step" : undefined} className={inputStep === "conditions" ? "is-active" : ""}>
                  <i aria-hidden="true">2</i><span>{locale === "ja" ? "詳細" : "Details"}</span>
                </div>
                <span aria-hidden="true" />
                <div><i aria-hidden="true">3</i><span>{locale === "ja" ? "旅程" : "Itinerary"}</span></div>
              </> : <div><i aria-hidden="true">2</i><span>{locale === "ja" ? "旅程" : "Itinerary"}</span></div>}
            </nav>

            <div className="planner-intro">
              <h1>{inputStep === "places"
                ? locale === "ja" ? "行きたい場所を入れるだけ。" : "Add the places you want to visit."
                : locale === "ja" ? "場所を確認して、旅の条件を決める。" : "Confirm the places. Set the limits."}</h1>
              <p>{inputStep === "places"
                ? locale === "ja" ? "日ごとの組み合わせ、順番、移動、ホテル、食事まで一つの旅程につなげます。" : "Get the days, order, routes, a practical base and meal stops in one usable itinerary."
                : locale === "ja" ? "未解決の場所は推測せず残します。日数・拠点・空港・使える時間を設定してください。" : "Unresolved places stay explicit. Add the days, base, airports, and time you can actually use."}</p>
            </div>

            {inputStep === "places" ? (
              <div className="planner-place-step">
                <label className="planner-composer">
                  <span>{text.inputLabel}</span>
                  <textarea
                    autoFocus
                    id="trip-input"
                    onChange={(event) => {
                      if (!itinerary.trim() && event.target.value.trim()) trackMilestone("trip_input_started");
                      setItinerary(event.target.value);
                      setReviewedInputSignature("");
                      setResolvedStops([]);
                      setAmbiguousPlaces([]);
                      setResolutionOverrides([]);
                      setPreviewStops([]);
                      setPlanReady(false);
                      clearNightlyHotelResults();
                    }}
                    placeholder={text.placeholder}
                    value={itinerary}
                  />
                  <div className="planner-composer-actions">
                    <button onClick={() => loadDemo()} type="button"><span aria-hidden="true"><Icon name="spark" size={13} /></span>{text.sample}</button>
                    <button className="is-temporary-demo" onClick={() => loadDemo(destinationById("switzerland"))} type="button"><span aria-hidden="true"><Icon name="pin" size={13} /></span>{text.swissDemo}</button>
                  </div>
                </label>
                <p className="planner-parse-hint">{text.parseHint}</p>

                {parsePreviewRows.length > 0 ? (
                  <div className="planner-parse-preview" aria-live="polite">
                    <div className="planner-parse-head">
                      <span className="planner-parse-title">{text.previewHeading(parsedPlaceCount)}</span>
                      {canNormalizeItinerary ? <button onClick={() => {
                        setItinerary(formattedItinerary);
                        setResolutionOverrides([]);
                        setReviewedInputSignature("");
                        setResolvedStops([]);
                        setAmbiguousPlaces([]);
                        setPreviewStops([]);
                      }} type="button">{text.previewFormat}</button> : null}
                    </div>
                    <ul>
                      {parsePreviewRows.slice(0, 30).map((row, index) => row.type === "day" ? (
                        <li className="is-day" key={`row-${index}`}><b>{text.previewDay(row.day)}</b></li>
                      ) : row.type === "warn" ? (
                        <li className="is-warn" key={`row-${index}`}><span>{row.raw}</span><small>{text.previewUnparsed}</small></li>
                      ) : (
                        <li key={`row-${index}`}>
                          <span>{row.place.name}</span>
                          <span className="planner-parse-chips">
                            {row.showDay && row.place.day !== null ? <i>{text.previewDay(row.place.day)}</i> : null}
                            {row.place.time ? <i className="is-time">{row.place.time}{row.place.isReservation ? ` ${text.reservation}` : ""}</i> : row.place.isReservation ? <i className="is-time">{text.reservation}</i> : null}
                            {row.place.stayMinutes !== null ? <i>{text.previewStay(row.place.stayMinutes)}</i> : null}
                            <span aria-label={locale === "ja" ? `${row.place.name}の優先度` : `${row.place.name} priority`} className="planner-parse-priority" role="group">
                              {(["normal", "must", "optional"] as const).map((priority) => (
                                <button
                                  aria-pressed={row.place.priority === priority}
                                  className={row.place.priority === priority ? `is-${priority}` : ""}
                                  key={priority}
                                  onClick={() => updateWishlistConstraint(row.placeIndex, { priority })}
                                  type="button"
                                >{locale === "ja"
                                  ? { normal: "通常", must: "必須", optional: "任意" }[priority]
                                  : { normal: "Normal", must: "Must", optional: "Optional" }[priority]}</button>
                              ))}
                            </span>
                          </span>
                          <details className="planner-parse-edit">
                            <summary>{locale === "ja" ? "時刻・予約・滞在を編集" : "Edit time, booking and stay"}</summary>
                            <div>
                              <label>
                                <span>{locale === "ja" ? "固定時刻" : "Fixed time"}</span>
                                <input
                                  aria-label={locale === "ja" ? `${row.place.name}の固定時刻` : `${row.place.name} fixed time`}
                                  onChange={(event) => updateWishlistConstraint(row.placeIndex, { time: event.target.value || null })}
                                  type="time"
                                  value={row.place.time ?? ""}
                                />
                              </label>
                              <label className="planner-parse-booking">
                                <input
                                  checked={row.place.isReservation}
                                  onChange={(event) => updateWishlistConstraint(row.placeIndex, { isReservation: event.target.checked })}
                                  type="checkbox"
                                />
                                <span>{locale === "ja" ? "予約済み" : "Booked"}</span>
                              </label>
                              <label>
                                <span>{locale === "ja" ? "滞在（分）" : "Stay (minutes)"}</span>
                                <input
                                  inputMode="numeric"
                                  max="480"
                                  min="15"
                                  onChange={(event) => updateWishlistConstraint(row.placeIndex, { stayMinutes: event.target.value ? Number(event.target.value) : null })}
                                  placeholder={locale === "ja" ? "未入力は推定" : "Estimated if blank"}
                                  type="number"
                                  value={row.place.stayMinutes ?? ""}
                                />
                              </label>
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {parsedPlaceCount > 12 ? (
                  <p className="planner-inline-status is-warning" role="alert">
                    {locale === "ja"
                      ? `${parsedPlaceCount}件あります。現在は1回最大12件です。場所を黙って切り捨てないため、12件以下のまとまりに分けてください。`
                      : `${parsedPlaceCount} places were found. This alpha checks up to 12 at a time. Split the list into groups of 12 or fewer so no place is silently omitted.`}
                  </p>
                ) : null}

                <div className="planner-destination-field planner-field planner-place-country">
                  <label htmlFor="planner-destination"><span>{text.destination}</span></label>
                  <SearchableCombobox
                    ariaLabel={text.destination}
                    id="planner-destination"
                    noResultsLabel={text.noMatchingOption}
                    onChange={(value) => {
                      const next = value as DestinationChoice;
                      setDestinationChoice(next);
                      if (next !== "auto") setDetectedDestinationId(null);
                      setReviewedInputSignature("");
                      setResolvedStops([]);
                      setAmbiguousPlaces([]);
                      setResolutionOverrides([]);
                      setPreviewStops([]);
                      setPlanReady(false);
                    }}
                    options={destinationComboOptions}
                    placeholder={text.destinationSearch}
                    resultCountLabel={text.optionCount}
                    value={destinationChoice}
                  />
                </div>

                <section className="planner-quick-conditions" aria-labelledby="planner-quick-conditions-title">
                  <header>
                    <span>{locale === "ja" ? "旅行の日数" : "Trip length"}</span>
                    <b id="planner-quick-conditions-title">{locale === "ja" ? "いつ・何日行きますか？" : "When and for how long?"}</b>
                  </header>
                  <div className="planner-primary-fields">
                    <label>
                      <span>{text.days}</span>
                      <select onChange={(event) => changeTripDays(Number(event.target.value))} value={tripDays}>
                        {Array.from({ length: 14 }, (_, index) => index + 1).map((value) => (
                          <option key={value} value={value}>{locale === "ja" ? `${value}日` : `${value} day${value === 1 ? "" : "s"}`}</option>
                        ))}
                      </select>
                    </label>
                    <div className="planner-date-field">
                      <label htmlFor="planner-quick-trip-date">
                        <span>{text.date}</span>
                        <input id="planner-quick-trip-date" onChange={(event) => { setTripStartDate(event.target.value); setTripDateTouched(true); }} type="date" value={tripStartDate} />
                      </label>
                      <button aria-pressed={!tripDateTouched} onClick={() => setTripDateTouched(false)} type="button">
                        {locale === "ja" ? "日付はまだ未定" : "Date not decided yet"}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="planner-build-mode" aria-labelledby="planner-build-mode-title">
                  <header>
                    <span>{locale === "ja" ? "作り方" : "Planning mode"}</span>
                    <b id="planner-build-mode-title">{locale === "ja" ? "どこまで自分で決めますか？" : "How much do you want to set?"}</b>
                  </header>
                  <div role="group" aria-label={locale === "ja" ? "旅程の作り方" : "Itinerary planning mode"}>
                    <button aria-pressed={buildMode === "automatic"} className={buildMode === "automatic" ? "is-active" : ""} onClick={() => setBuildMode("automatic")} type="button">
                      <Icon name="spark" size={14} /><span><b>{locale === "ja" ? "おまかせで作る" : "Build it for me"}</b><small>{locale === "ja" ? "移動・食事・ホテルも自動で提案" : "Routes, meals and a practical base included"}</small></span>
                    </button>
                    <button aria-pressed={buildMode === "custom"} className={buildMode === "custom" ? "is-active" : ""} onClick={() => setBuildMode("custom")} type="button">
                      <Icon name="mark" size={14} /><span><b>{locale === "ja" ? "こだわって調整" : "Fine-tune it"}</b><small>{locale === "ja" ? "ホテル・ペース・移動条件を指定" : "Set the hotel, pace and travel limits"}</small></span>
                    </button>
                  </div>
                </section>

                {buildMode === "custom" ? (
                  <div className="planner-quick-advanced">
                    <label className="planner-hotel-field"><span>{text.hotel}</span><input onChange={(event) => { setHotelQuery(event.target.value); setPlanReady(false); }} placeholder={text.hotelPlaceholder} value={hotelQuery} /></label>
                    <div className="planner-core-choices">
                      <div className="planner-choice"><span>{text.pace}</span><div className="planner-choice-chips" role="group" aria-label={text.pace}>{(["relaxed", "balanced", "fast"] as const).map((value) => <button aria-pressed={pace === value} className={pace === value ? "is-active" : ""} key={value} onClick={() => setPace(value)} type="button">{text[value]}</button>)}</div></div>
                      <div className="planner-choice"><span>{text.travelHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.travelHeading}>{([["auto", text.travelAuto], ["car", text.travelCar]] as const).map(([value, label]) => <button aria-pressed={travelPreference === value} className={travelPreference === value ? "is-active" : ""} key={value} onClick={() => setTravelPreference(value)} type="button">{label}</button>)}</div></div>
                      <div className="planner-choice"><span>{text.timebandHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.timebandHeading}>{([["08:00", text.timebandEarly], ["09:00", text.timebandNormal], ["10:30", text.timebandLate]] as const).map(([value, label]) => <button aria-pressed={dayStartDefault === value} className={dayStartDefault === value ? "is-active" : ""} key={value} onClick={() => setDayStartDefault(value)} type="button">{label}</button>)}</div></div>
                    </div>
                    <button className="planner-secondary-review" disabled={!canReviewPlaces} onClick={() => void reviewWishlistPlaces()} type="button">
                      {locale === "ja" ? "空港・予約・地点ごとの条件も設定" : "Set airports, bookings and per-place details"}
                    </button>
                  </div>
                ) : null}

                {placeWarning ? <p className="planner-inline-status is-warning" role="status">{placeWarning === "quota_exhausted"
                  ? locale === "ja" ? "本日の場所検索の上限に達しました。分かっている場所だけで続け、残りは未解決として表示します（上限は毎日リセットされます）。" : "Today's place-search allowance is used up. Known places continue; the rest stay unresolved (the allowance resets daily)."
                  : locale === "ja" ? "位置情報サービスに接続できませんでした。分かる場所だけで続け、残りは未解決として表示します。" : "Place lookup is unavailable. Known places will continue and the rest will stay unresolved."}</p> : null}
                <button className="planner-build-button planner-review-button" disabled={!canBuild} onClick={() => void buildPlan()} type="button">
                  <span>{isBuilding ? (locale === "ja" ? "旅程を作成中…" : "Building your itinerary…") : (locale === "ja" ? "旅程を作る" : "Build my itinerary")}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b>
                </button>
              </div>
            ) : (
              <div className="planner-conditions-step">
                <section className="planner-resolved-places" aria-labelledby="planner-reviewed-title">
                  <header>
                    <div><span>{locale === "ja" ? "確認した場所" : "Reviewed places"}</span><b id="planner-reviewed-title">{locale === "ja" ? `${reviewedPlaceRows.length}か所` : `${reviewedPlaceRows.length} places`}</b></div>
                    <button onClick={() => { setManualPinTarget(null); setInputStep("places"); }} type="button">{locale === "ja" ? "入力を直す" : "Edit input"}</button>
                  </header>
                  <ul>
                    {reviewedPlaceRows.map((row) => (
                      <li className={`is-${row.status}`} key={`${row.placeIndex}-${row.place.name}`}>
                        <span className="planner-place-status" aria-label={row.status === "confirmed" ? (locale === "ja" ? "確認済み" : "Confirmed") : row.status === "review" ? (locale === "ja" ? "候補を選択" : "Choose a match") : row.status === "parsed" ? (locale === "ja" ? "確認待ち" : "Pending review") : (locale === "ja" ? "未解決" : "Unresolved")}>
                          {row.status === "confirmed" ? <Icon name="check" size={11} /> : row.status === "review" ? "!" : row.status === "parsed" ? "…" : "×"}
                        </span>
                        <span>
                          <b>{row.resolved?.name ?? row.place.name}</b>
                          {row.status === "review" && row.ambiguity ? (
                            <select
                              aria-label={locale === "ja" ? `${row.place.name}の候補` : `Choose the correct ${row.place.name}`}
                              className="planner-place-candidates"
                              defaultValue=""
                              onChange={(event) => {
                                const selected = row.ambiguity?.candidates.find((candidate) => candidate.id === event.target.value);
                                if (!selected) return;
                                const occurrenceResolved = { ...selected, inputIndex: row.placeIndex };
                                setResolvedStops((current) => [
                                  ...current.filter((candidate) => candidate.inputIndex !== row.placeIndex),
                                  occurrenceResolved,
                                ]);
                                if (selected.providerRef) {
                                  setResolutionOverrides((current) => upsertResolutionOverride(current, {
                                    inputIndex: row.placeIndex,
                                    providerRef: selected.providerRef!,
                                  }));
                                }
                                setManualPinTarget((current) => current === row.placeIndex ? null : current);
                                setPreviewStops((current) => [
                                  ...current.filter((stop) => !("inputIndex" in stop) || stop.inputIndex !== row.placeIndex),
                                  occurrenceResolved,
                                ]);
                              }}
                            >
                              <option disabled value="">{locale === "ja" ? "住所・国・種別・距離で選ぶ…" : "Choose by address, country, type and distance…"}</option>
                              {row.ambiguity.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{placeCandidateLabel(candidate, resolvedStops, locale)}</option>)}
                            </select>
                          ) : row.status === "confirmed" ? <small>{resolvedStopAddress(row.resolved)}</small> : (
                            <details className="planner-manual-place">
                              <summary>{locale === "ja" ? "この1件だけ座標で修正" : "Fix only this place with coordinates"}</summary>
                              <label>
                                <span>{locale === "ja" ? "住所・目印（任意）" : "Address or landmark (optional)"}</span>
                                <input
                                  onChange={(event) => setManualPlaceDrafts((current) => ({
                                    ...current,
                                    [row.placeIndex]: { ...(current[row.placeIndex] ?? { address: "", latitude: "", longitude: "" }), address: event.target.value },
                                  }))}
                                  value={manualPlaceDrafts[row.placeIndex]?.address ?? ""}
                                />
                              </label>
                              <button
                                aria-pressed={manualPinTarget === row.placeIndex}
                                className="planner-map-pick-button"
                                onClick={() => setManualPinTarget((current) => current === row.placeIndex ? null : row.placeIndex)}
                                type="button"
                              >
                                {manualPinTarget === row.placeIndex
                                  ? (locale === "ja" ? "地図選択を終了" : "Stop picking on map")
                                  : (locale === "ja" ? "地図をクリックして選ぶ" : "Pick by clicking the map")}
                              </button>
                              {manualPinTarget === row.placeIndex ? (
                                <p aria-live="polite" className="planner-map-pick-status">
                                  {manualPinCoordinate
                                    ? (locale === "ja" ? "地図から座標を取得しました。内容を確認して「この地点を使う」を押してください。" : "Coordinates captured from the map. Review them, then choose Use this point.")
                                    : (locale === "ja" ? "右側の地図で地点をクリックしてください。地図が使えない場合は座標を直接入力できます。" : "Click a point on the map. You can still enter coordinates when the interactive map is unavailable.")}
                                </p>
                              ) : null}
                              <div>
                                <label><span>{locale === "ja" ? "緯度" : "Latitude"}</span><input inputMode="decimal" onChange={(event) => setManualPlaceDrafts((current) => ({ ...current, [row.placeIndex]: { ...(current[row.placeIndex] ?? { address: "", latitude: "", longitude: "" }), latitude: event.target.value } }))} placeholder="35.6812" value={manualPlaceDrafts[row.placeIndex]?.latitude ?? ""} /></label>
                                <label><span>{locale === "ja" ? "経度" : "Longitude"}</span><input inputMode="decimal" onChange={(event) => setManualPlaceDrafts((current) => ({ ...current, [row.placeIndex]: { ...(current[row.placeIndex] ?? { address: "", latitude: "", longitude: "" }), longitude: event.target.value } }))} placeholder="139.7671" value={manualPlaceDrafts[row.placeIndex]?.longitude ?? ""} /></label>
                              </div>
                              <button onClick={() => confirmManualPlace(row.placeIndex, row.place.name)} type="button">{locale === "ja" ? "この地点を使う" : "Use this point"}</button>
                              <small>{locale === "ja" ? "提供元の確認済み地点ではなく、あなたが指定した座標として表示します。" : "This stays labelled as traveller-supplied coordinates, not a provider-verified place."}</small>
                            </details>
                          )}
                          <details className="planner-place-constraints">
                            <summary>{locale === "ja" ? "予約・時刻・滞在を編集" : "Edit booking, time and stay"}</summary>
                            <div>
                              <label>
                                <span>{locale === "ja" ? "固定時刻" : "Fixed time"}</span>
                                <input
                                  aria-label={locale === "ja" ? `${row.place.name}の固定時刻` : `${row.place.name} fixed time`}
                                  onChange={(event) => updateWishlistConstraint(row.placeIndex, { time: event.target.value || null }, { keepReviewedPlaces: true })}
                                  type="time"
                                  value={row.place.time ?? ""}
                                />
                              </label>
                              <label className="planner-booking-toggle">
                                <input
                                  checked={row.place.isReservation}
                                  onChange={(event) => updateWishlistConstraint(row.placeIndex, { isReservation: event.target.checked }, { keepReviewedPlaces: true })}
                                  type="checkbox"
                                />
                                <span>{locale === "ja" ? "予約済み（Mustとして固定）" : "Booked (protect as Must)"}</span>
                              </label>
                              <label>
                                <span>{locale === "ja" ? "滞在時間（分）" : "Stay (minutes)"}</span>
                                <input
                                  inputMode="numeric"
                                  max="480"
                                  min="15"
                                  onChange={(event) => updateWishlistConstraint(row.placeIndex, { stayMinutes: event.target.value ? Number(event.target.value) : null }, { keepReviewedPlaces: true })}
                                  placeholder={locale === "ja" ? "未入力は推定" : "Estimated if blank"}
                                  type="number"
                                  value={row.place.stayMinutes ?? ""}
                                />
                              </label>
                            </div>
                          </details>
                        </span>
                        {row.place.isReservation ? (
                          <span className="planner-booked-badge">{locale === "ja" ? "予約・必須" : "Booked · Must"}</span>
                        ) : (
                          <div aria-label={locale === "ja" ? `${row.place.name}の優先度` : `${row.place.name} priority`} className="planner-priority-picker" role="group">
                            {(["normal", "must", "optional"] as const).map((priority) => (
                              <button
                                aria-pressed={row.place.priority === priority}
                                className={row.place.priority === priority ? `is-${priority}` : ""}
                                key={priority}
                                onClick={() => {
                                  updateWishlistConstraint(row.placeIndex, { priority }, { keepReviewedPlaces: true });
                                }}
                                type="button"
                              >{locale === "ja"
                                ? { normal: "通常", must: "必須", optional: "任意" }[priority]
                                : { normal: "Normal", must: "Must", optional: "Optional" }[priority]}</button>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {unresolvedReviewedCount > 0 ? <p className="planner-inline-status is-warning" role="status">{locale === "ja" ? `${unresolvedReviewedCount}件は未解決です。判定は保留または条件付きになります。` : `${unresolvedReviewedCount} place${unresolvedReviewedCount === 1 ? " is" : "s are"} unresolved. The verdict will remain conditional or unknown.`}</p> : null}
                  {ambiguousReviewedCount > 0 ? <p className="planner-inline-status is-warning" role="status">{locale === "ja" ? `${ambiguousReviewedCount}件は同名候補があります。住所を見て選んでください。` : `${ambiguousReviewedCount} place${ambiguousReviewedCount === 1 ? " has" : "s have"} same-name matches. Choose by address.`}</p> : null}
                </section>

                <div className="planner-primary-fields">
                  <label><span>{text.days}</span><select onChange={(event) => changeTripDays(Number(event.target.value))} value={tripDays}>{Array.from({ length: 14 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{locale === "ja" ? `${value}日` : `${value} day${value === 1 ? "" : "s"}`}</option>)}</select></label>
                  <div className="planner-date-field">
                    <label htmlFor="planner-trip-date"><span>{text.date}</span><input id="planner-trip-date" onChange={(event) => { setTripStartDate(event.target.value); setTripDateTouched(true); }} type="date" value={tripStartDate} /></label>
                    <button aria-pressed={!tripDateTouched} onClick={() => setTripDateTouched(false)} type="button">{locale === "ja" ? "日付はまだ未定" : "Date not decided yet"}</button>
                    {!tripDateTouched ? <small>{locale === "ja" ? "表示日は計算用の仮日付です。曜日・営業時間は確定条件に使いません。" : "The visible date is a planning placeholder. Weekday and opening hours will not be treated as confirmed constraints."}</small> : null}
                  </div>
                </div>

                <label className="planner-hotel-field"><span>{text.hotel}</span><input onChange={(event) => {
                  setHotelQuery(event.target.value);
                  setPlanReady(false);
                }} placeholder={text.hotelPlaceholder} value={hotelQuery} /></label>

                <div className="planner-core-choices">
                  <div className="planner-choice"><span>{text.pace}</span><div className="planner-choice-chips" role="group" aria-label={text.pace}>{(["relaxed", "balanced", "fast"] as const).map((value) => <button aria-pressed={pace === value} className={pace === value ? "is-active" : ""} key={value} onClick={() => setPace(value)} type="button">{text[value]}</button>)}</div></div>
                  <div className="planner-choice"><span>{text.travelHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.travelHeading}>{([["auto", text.travelAuto], ["car", text.travelCar]] as const).map(([value, label]) => <button aria-pressed={travelPreference === value} className={travelPreference === value ? "is-active" : ""} key={value} onClick={() => setTravelPreference(value)} type="button">{label}</button>)}</div></div>
                  <div className="planner-choice"><span>{text.timebandHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.timebandHeading}>{([["08:00", text.timebandEarly], ["09:00", text.timebandNormal], ["10:30", text.timebandLate]] as const).map(([value, label]) => <button aria-pressed={dayStartDefault === value} className={dayStartDefault === value ? "is-active" : ""} key={value} onClick={() => setDayStartDefault(value)} type="button">{label}</button>)}</div></div>
                  <div className="planner-choice"><span>{text.dayEndHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.dayEndHeading}>{([["", text.dayEndNone], ["19:30", "19:30"], ["21:30", "21:30"]] as const).map(([value, label]) => <button aria-pressed={dayEndTarget === value} className={dayEndTarget === value ? "is-active" : ""} key={value || "none"} onClick={() => setDayEndTarget(value)} type="button">{label}</button>)}</div></div>
                  <div className="planner-choice"><span>{locale === "ja" ? "移動ごとの余白" : "Buffer after each leg"}</span><div className="planner-choice-chips" role="group" aria-label={locale === "ja" ? "移動ごとの余白" : "Buffer after each leg"}>{([0, 10, 20, 30] as const).map((value) => <button aria-pressed={transferBufferMinutes === value} className={transferBufferMinutes === value ? "is-active" : ""} key={value} onClick={() => setTransferBufferMinutes(value)} type="button">{value}{locale === "ja" ? "分" : " min"}</button>)}</div></div>
                  <label className="planner-choice planner-number-choice">
                    <span>{locale === "ja" ? "1区間の徒歩上限（任意）" : "Max walking per leg (optional)"}</span>
                    <input max="180" min="5" onChange={(event) => setMaxWalkingMinutesPerLeg(event.target.value ? Number(event.target.value) : null)} placeholder={locale === "ja" ? "標準 30分" : "Default 30 min"} type="number" value={maxWalkingMinutesPerLeg ?? ""} />
                    <small>{locale === "ja" ? "超える徒歩は他の移動手段を優先します。" : "Longer walks are deprioritised when another mode is available."}</small>
                  </label>
                  <label className="planner-choice planner-number-choice">
                    <span>{locale === "ja" ? "1区間の乗換上限（任意）" : "Max transfers per leg (optional)"}</span>
                    <input max="8" min="0" onChange={(event) => setMaxTransfersPerLeg(event.target.value ? Number(event.target.value) : null)} placeholder={locale === "ja" ? "標準 2回" : "Default 2"} type="number" value={maxTransfersPerLeg ?? ""} />
                    <small>{locale === "ja" ? "乗換回数を取得できない区間は未確認と表示します。" : "A leg remains unverified when transfer-step data is unavailable."}</small>
                  </label>
                </div>

                <details className="planner-details">
                  <summary>{locale === "ja" ? "フライト・空港の条件" : "Flight and airport constraints"}<span aria-hidden="true"><Icon name="plus" size={15} /></span></summary>
                  <div className="planner-detail-grid">
                    <div className="planner-field"><label htmlFor="planner-arrival-airport"><span>{text.arrival}</span></label><SearchableCombobox ariaLabel={text.arrival} id="planner-arrival-airport" noResultsLabel={text.noMatchingOption} onChange={(value) => setArrivalAirport(value as AirportCode)} options={airportComboOptions} placeholder={text.airportSearch} resultCountLabel={text.optionCount} value={arrivalAirport} /></div>
                    <label><span>{text.arrivalTime}</span><input disabled={arrivalAirport === "none"} onChange={(event) => setArrivalTime(event.target.value)} type="time" value={arrivalTime} /></label>
                    <div className="planner-field"><label htmlFor="planner-departure-airport"><span>{text.departure}</span></label><SearchableCombobox ariaLabel={text.departure} id="planner-departure-airport" noResultsLabel={text.noMatchingOption} onChange={(value) => setDepartureAirport(value as AirportCode)} options={airportComboOptions} placeholder={text.airportSearch} resultCountLabel={text.optionCount} value={departureAirport} /></div>
                    <label><span>{text.departureTime}</span><input disabled={departureAirport === "none"} onChange={(event) => setDepartureTime(event.target.value)} type="time" value={departureTime} /></label>
                    {arrivalAirport !== "none" || departureAirport !== "none" ? <div className="planner-choice"><span>{text.flightKindHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.flightKindHeading}>{([["international", text.flightInternational], ["domestic", text.flightDomestic]] as const).map(([value, label]) => <button aria-pressed={flightKind === value} className={flightKind === value ? "is-active" : ""} key={value} onClick={() => setFlightKind(value)} type="button">{label}</button>)}</div></div> : null}
                    {arrivalAirport !== "none" ? <AirportOptionComparison destination={arrivalAirportDestination} direction="arrival" flightKind={flightKind} key={`${arrivalAirportDestination.id}-arrival`} locale={locale} onUse={(airportCode, time) => { setArrivalAirport(airportCode); setArrivalTime(time); }} selectedAirport={arrivalAirport} selectedTime={arrivalTime} /> : null}
                    {departureAirport !== "none" ? <AirportOptionComparison destination={departureAirportDestination} direction="departure" flightKind={flightKind} key={`${departureAirportDestination.id}-departure`} locale={locale} onUse={(airportCode, time) => { setDepartureAirport(airportCode); setDepartureTime(time); }} selectedAirport={departureAirport} selectedTime={departureTime} /> : null}
                  </div>
                </details>

                <button className="planner-build-button" disabled={!canBuild} onClick={() => void buildPlan()} type="button">
                  <span>{locale === "ja" ? "旅程を作る" : "Build my itinerary"}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b>
                </button>
              </div>
            )}
            {planReady && !isBuilding ? (
              <button className="planner-return-plan" onClick={() => setHasPlan(true)} type="button">
                {text.backToPlan}<Icon name="arrow" size={15} />
              </button>
            ) : null}

            {tripStorePersistent === false ? (
              <p className="planner-local-storage-warning" role="status">
                {locale === "ja" ? "このブラウザでは端末保存を利用できないため、最近の旅程はこのタブを閉じると消えます。" : "Device storage is unavailable in this browser. Recent trips will disappear when this tab closes."}
              </p>
            ) : null}
            {recentTrips.length > 0 ? (
              <div className="planner-recent">
                <span>{text.recentHeading}<small> · {text.recentNote}</small></span>
                <ul>
                  {recentTrips.map((entry) => {
                    const storedInput = storedTripInput(entry);
                    return (
                      <li key={entry.id}>
                        <button className="planner-recent-open" onClick={() => void openRecentTrip(entry)} type="button">
                          <b>{entry.title}</b>
                          <small>
                            {storedInput
                              ? storedInput.dateWasProvided
                                ? storedInput.tripStartDate
                                : locale === "ja" ? "日付未定" : "Date not decided"
                              : entry.updatedAt.slice(0, 10)}
                            {" · "}
                            {storedInput ? text.recentDays(storedInput.tripDays) : (locale === "ja" ? "入力を再確認" : "Review input")}
                          </small>
                        </button>
                        <button
                          aria-label={text.recentDelete}
                          className="planner-recent-remove"
                          onClick={() => void deleteRecentTrip(entry)}
                          type="button"
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : plan && day ? (
          <div className="planner-result-view">
            <div className="planner-mobile-result-toggle" role="group" aria-label={locale === "ja" ? "結果の表示" : "Result view"}>
              <button aria-pressed={mobileResultView === "timeline"} className={mobileResultView === "timeline" ? "is-active" : ""} onClick={() => setMobileResultView("timeline")} type="button">{locale === "ja" ? "旅程" : "Timeline"}</button>
              <button aria-pressed={mobileResultView === "map"} className={mobileResultView === "map" ? "is-active" : ""} onClick={() => setMobileResultView("map")} type="button">{locale === "ja" ? "地図" : "Map"}</button>
              <button aria-pressed={mobileResultView === "compact"} className={mobileResultView === "compact" ? "is-active" : ""} onClick={() => setMobileResultView("compact")} type="button">{locale === "ja" ? "地図を隠す" : "Hide map"}</button>
            </div>

            <header className="planner-result-header">
              <div>
                <span className={`planner-verdict-label${feasibilityResult ? ` is-${feasibilityResult.state.toLowerCase()}` : ""}`}>
                  {feasibilityResult ? <i aria-hidden="true"><Icon name={feasibilityStateIcon(feasibilityResult.state)} size={12} /></i> : null}
                  {deferredAnchorStops.length > 0 && plan
                    ? locale === "ja"
                      ? `${plan.scheduledStopCount}/${plan.scheduledStopCount + deferredAnchorStops.length}か所を日程化`
                      : `${plan.scheduledStopCount} of ${plan.scheduledStopCount + deferredAnchorStops.length} places planned`
                    : resultStateCopy?.label ?? (locale === "ja" ? "判定結果" : "Feasibility result")}
                </span>
                <h1>{resultStateCopy?.headline ?? day.theme}</h1>
              </div>
              <div className="planner-result-actions">
                <button onClick={() => { setHasPlan(false); setInputStep("conditions"); setInspector(null); }} type="button">{text.edit}</button>
                <details className="planner-result-menu">
                  <summary aria-label={locale === "ja" ? "その他の操作" : "More actions"}>•••</summary>
                  <div>
                    <button
                      className="planner-mobile-verdict-action"
                      onClick={(event) => {
                        const menu = event.currentTarget.closest("details") as HTMLDetailsElement | null;
                        if (menu) menu.open = false;
                        const details = document.querySelector(".planner-verdict-details") as HTMLDetailsElement | null;
                        if (!details) return;
                        details.open = true;
                        details.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      type="button"
                    >{locale === "ja" ? "判定の詳細" : "Verdict details"}</button>
                    <button aria-label={locale === "ja" ? "変更を取り消す" : "Undo change"} disabled={!canUndoPlannerHistory(editHistory)} onClick={undoPlannerEdit} title={locale === "ja" ? "取り消す (⌘/Ctrl+Z)" : "Undo (⌘/Ctrl+Z)"} type="button">↶ {locale === "ja" ? "元に戻す" : "Undo"}</button>
                    <button aria-label={locale === "ja" ? "変更をやり直す" : "Redo change"} disabled={!canRedoPlannerHistory(editHistory)} onClick={redoPlannerEdit} title={locale === "ja" ? "やり直す (⌘/Ctrl+Shift+Z)" : "Redo (⌘/Ctrl+Shift+Z)"} type="button">↷ {locale === "ja" ? "やり直す" : "Redo"}</button>
                    <button onClick={() => setPrintMode(true)} title={text.printTitle} type="button">{text.print}</button>
                    <button className={shareCopied ? "is-copied" : ""} onClick={() => setShareDialogOpen(true)} ref={shareTriggerRef} title={text.shareTitle} type="button">{shareCopied ? text.shareCopied : text.share}</button>
                  </div>
                </details>
              </div>
            </header>
            <p aria-atomic="true" aria-live="polite" className="sr-only">{historyAnnouncement}</p>
            {shareDialogOpen ? (() => {
              const preview = buildScopedTripShare(currentShareableTripInput(), shareScope, locale);
              return (
                <div className="planner-share-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareDialogOpen(false); }}>
                  <section aria-describedby="planner-share-description" aria-labelledby="planner-share-title" aria-modal="true" className="planner-share-dialog" ref={shareDialogRef} role="dialog" tabIndex={-1}>
                    <header>
                      <div><span>{locale === "ja" ? "共有する内容を選択" : "Choose what to share"}</span><h2 id="planner-share-title">{locale === "ja" ? "リンクに含める情報" : "Information in the link"}</h2></div>
                      <button aria-label={text.close} onClick={() => setShareDialogOpen(false)} type="button"><Icon name="close" size={13} /></button>
                    </header>
                    <p className="planner-share-warning" id="planner-share-description">{locale === "ja"
                      ? "このリンク自体が旅程データです。受信者、ブラウザ履歴、拡張機能から読めます。公開場所へ貼らないでください。"
                      : "The link itself contains the trip data. Recipients, browser history and extensions can read it. Do not post it publicly."}</p>
                    <fieldset>
                      <legend>{locale === "ja" ? "含める情報" : "Include"}</legend>
                      {([
                        ["dates", locale === "ja" ? "旅行日" : "Trip dates"],
                        ["hotel", locale === "ja" ? "ホテル・拠点" : "Hotel or base"],
                        ["airports", locale === "ja" ? "空港とフライト時刻" : "Airports and flight times"],
                        ["reservations", locale === "ja" ? "予約時刻・予約マーク" : "Booking times and reservation markers"],
                      ] as const).map(([key, label]) => (
                        <label key={key}><input checked={shareScope[key]} onChange={(event) => setShareScope((current) => ({ ...current, [key]: event.target.checked }))} type="checkbox" /><span>{label}</span></label>
                      ))}
                    </fieldset>
                    {preview.redactedReservationCount > 0 ? <p>{locale === "ja" ? `予約${preview.redactedReservationCount}件は場所だけ共有し、時刻を除外します。` : `${preview.redactedReservationCount} booking time${preview.redactedReservationCount === 1 ? " is" : "s are"} removed while keeping the places.`}</p> : null}
                    {preview.omittedUnparsedLines > 0 ? <p className="is-caution">{locale === "ja" ? `安全に判別できない${preview.omittedUnparsedLines}行はリンクから除外します。` : `${preview.omittedUnparsedLines} opaque line${preview.omittedUnparsedLines === 1 ? " is" : "s are"} omitted because they cannot be safely redacted.`}</p> : null}
                    {preview.warnings.includes("RESERVATION_DETAILS_INCLUDED") ? <p className="is-caution">{locale === "ja" ? "予約情報を含める設定です。予約番号や氏名が入力文にないか確認してください。" : "Booking details are enabled. Check that the pasted text contains no booking reference or personal name."}</p> : null}
                    {preview.blocked ? <p className="is-error">{preview.warnings.includes("LINK_TOO_LONG")
                      ? locale === "ja" ? "リンクが長すぎます。印刷/PDFまたは端末内保存を使ってください。" : "This trip is too long for a reliable URL. Use print/PDF or device storage instead."
                      : locale === "ja" ? "安全に共有できる地点がありません。入力を確認してください。" : "No safely shareable place remains. Review the input first."}</p> : null}
                    <footer>
                      <button onClick={() => setShareDialogOpen(false)} type="button">{locale === "ja" ? "キャンセル" : "Cancel"}</button>
                      <button className="is-primary" disabled={preview.blocked} onClick={() => void copyShareLink()} type="button">{locale === "ja" ? "この内容でリンクをコピー" : "Copy scoped link"}</button>
                    </footer>
                  </section>
                </div>
              );
            })() : null}

            {feasibilityResult ? (
              <>
              <p aria-atomic="true" aria-live="polite" className="sr-only">
                {resultStateCopy?.headline}. {feasibilityResult.criticalFacts.verified} of {feasibilityResult.criticalFacts.total} critical facts confirmed.
                {feasibilityResult.primaryConflict ? ` ${conflictCopy(feasibilityResult.primaryConflict, locale)}` : ""}
              </p>
              <section className={`planner-feasibility-card is-${feasibilityResult.state.toLowerCase()}`} aria-labelledby="planner-feasibility-title">
                <header className="planner-result-decision">
                  <div>
                    <span id="planner-feasibility-title">{locale === "ja" ? "旅程の結論" : "Plan result"}</span>
                    <small>{minimumDaysCopy(feasibilityResult, locale)}</small>
                  </div>
                  <button
                    onClick={() => {
                      if (feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT") {
                        document.getElementById("planner-alternatives-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        return;
                      }
                      if (feasibilityResult.state === "UNKNOWN" || feasibilityResult.state === "FEASIBLE_IF_ASSUMPTIONS") {
                        setHasPlan(false);
                        setInputStep("conditions");
                        setInspector(null);
                        return;
                      }
                      document.querySelector(".planner-day-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    type="button"
                  >{locale === "ja"
                    ? feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT" ? "直し方を見る" : feasibilityResult.state === "UNKNOWN" || feasibilityResult.state === "FEASIBLE_IF_ASSUMPTIONS" ? "確認する" : "このプランを見る"
                    : feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT" ? "See how to fix it" : feasibilityResult.state === "UNKNOWN" || feasibilityResult.state === "FEASIBLE_IF_ASSUMPTIONS" ? "Review details" : "View this plan"}</button>
                </header>

                {feasibilityResult.primaryConflict || deferredAnchorStops.length > 0 || feasibilityResult.primaryAttention ? (
                  <p className="planner-one-warning">
                    <Icon name="signal" size={14} />
                    <span>{feasibilityResult.primaryConflict
                      ? conflictCopy(feasibilityResult.primaryConflict, locale)
                      : deferredAnchorStops.length > 0
                        ? locale === "ja"
                          ? `${deferredAnchorStops.slice(0, 2).map((stop) => stop.name).join("、")}${deferredAnchorStops.length > 2 ? `ほか${deferredAnchorStops.length - 2}件` : ""}は、現在の条件では日程に入りません。`
                          : `${deferredAnchorStops.slice(0, 2).map((stop) => stop.name).join(", ")}${deferredAnchorStops.length > 2 ? ` and ${deferredAnchorStops.length - 2} more` : ""} do not fit the current plan.`
                      : attentionCopy(feasibilityResult.primaryAttention!, locale)}</span>
                  </p>
                ) : null}

                <details className="planner-verdict-details">
                  <summary>{locale === "ja" ? "判定の詳細" : "Verdict details"}</summary>
                  <div className="planner-verdict-details-body">

                <div className="planner-trip-days" role="group" aria-label={text.fitSelectedDays}>
                  <span>{text.fitSelectedDays}</span>
                  <div>
                    <button aria-label={text.fitDaysDecrease} disabled={tripDays <= Math.max(1, plan.minimumPinnedDay)} onClick={() => changeTripDays(tripDays - 1)} type="button">−</button>
                    <output aria-live="polite">{text.fitDaysValue(tripDays)}</output>
                    <button aria-label={text.fitDaysIncrease} disabled={tripDays >= 14} onClick={() => changeTripDays(tripDays + 1)} type="button">+</button>
                  </div>
                </div>

                <div className="planner-critical-facts" aria-label={locale === "ja" ? "重要情報の確認状況" : "Critical fact coverage"}>
                  <span><i className="is-verified" aria-hidden="true" /><b>{feasibilityResult.criticalFacts.verified}</b><small>{locale === "ja" ? "確認済み" : "confirmed"}</small></span>
                  <span><i className="is-estimated" aria-hidden="true" /><b>{feasibilityResult.criticalFacts.estimated}</b><small>{locale === "ja" ? "推定" : "estimated"}</small></span>
                  <span><i className="is-unknown" aria-hidden="true" /><b>{feasibilityResult.criticalFacts.unknown}</b><small>{locale === "ja" ? "未確認" : "unknown"}</small></span>
                </div>
                <p className="planner-route-coverage">
                  {locale === "ja"
                    ? `重要情報 ${feasibilityResult.criticalFacts.total}件中 ${feasibilityResult.criticalFacts.verified}件を確認。経路 ${confirmedRouteFactCount}/${routeFactCount}区間は取得済みです。`
                    : `${feasibilityResult.criticalFacts.verified} of ${feasibilityResult.criticalFacts.total} critical facts confirmed. ${confirmedRouteFactCount}/${routeFactCount} route legs retrieved.`}
                </p>
                {openingVerificationCount > 0 ? (
                  <p aria-live="polite" className="planner-progressive-status">
                    <i aria-hidden="true" />
                    {locale === "ja"
                      ? `暫定結果を表示中。最終旅程の営業時間をあと${openingVerificationCount}件確認しています。`
                      : `Showing a provisional result while ${openingVerificationCount} final-stop hour check${openingVerificationCount === 1 ? "" : "s"} continue in the background.`}
                  </p>
                ) : null}
                {regionalCoverage ? (
                  <details className="planner-regional-coverage">
                    <summary>
                      <span>{locale === "ja" ? "地域別の対応品質" : "Regional coverage"}</span>
                      <b>{regionalCoverage.label[locale]}</b>
                    </summary>
                    <div aria-label={locale === "ja" ? "地域別の機能評価" : "Regional capability grades"}>
                      {(["routes", "poi", "hours", "transit"] as const).map((dimension) => (
                        <span key={dimension}>
                          <small>{locale === "ja"
                            ? { routes: "経路", poi: "地点", hours: "営業時間", transit: "公共交通" }[dimension]
                            : { routes: "Routes", poi: "Places", hours: "Hours", transit: "Transit" }[dimension]}</small>
                          <b>{regionalCoverage.grades[dimension]}</b>
                        </span>
                      ))}
                    </div>
                    <p>{coveragePublicCopy(regionalCoverage, locale)}</p>
                    {regionalCoverage.lastValidatedAt ? <small>{locale === "ja" ? `地域評価: ${regionalCoverage.lastValidatedAt}` : `Regional review: ${regionalCoverage.lastValidatedAt}`}</small> : null}
                  </details>
                ) : null}

                {plan.inputMode === "existing_itinerary" ? (() => {
                  const shortest = feasibilityResult.alternatives.find((alternative) => alternative.kind === "OPTIMIZE_ORDER") ?? null;
                  const repairRank = (kind: AlternativePlan["kind"]) => ({
                    START_EARLIER: 0,
                    END_LATER: 1,
                    CHANGE_MODE: 2,
                    CHANGE_DAYS: 3,
                    CHANGE_BASE: 4,
                    REMOVE_OPTIONAL: 5,
                    OPTIMIZE_ORDER: 6,
                  })[kind];
                  const corrective = feasibilityResult.alternatives
                    .filter((alternative) => alternative.kind !== "OPTIMIZE_ORDER")
                    .sort((left, right) => repairRank(left.kind) - repairRank(right.kind) || left.id.localeCompare(right.id));
                  const completeRepair = corrective.find((alternative) => (
                    alternative.after.hardConflictCount === 0 && alternative.after.overrunMinutes === 0
                  )) ?? null;
                  const minimal = completeRepair ?? corrective[0] ?? null;
                  const minimalIsRepair = Boolean(completeRepair);
                  const populated = tripFit?.days.filter((fitDay) => fitDay.placeCount > 0) ?? [];
                  const currentMetrics = {
                    hardConflictCount: plan.scheduleConflictCount + plan.deferredUnavailableStops.length,
                    minimumSlackMinutes: populated.length > 0 ? Math.min(...populated.map((fitDay) => fitDay.slackMinutes)) : null,
                    travelMinutes: plan.days.reduce((total, planDay) => total
                      + planDay.legs.reduce((sum, leg) => sum + leg.comparison.recommended.minutes, 0)
                      + (planDay.hotelTravelMinutes ?? 0), 0),
                  };
                  const cards = [
                    {
                      key: "original",
                      label: locale === "ja" ? "元の案" : "Original",
                      detail: locale === "ja" ? "入力した日別割当と順番" : "Pasted days and order",
                      metrics: currentMetrics,
                      alternative: null,
                    },
                    {
                      key: "minimal",
                      label: minimalIsRepair
                        ? (locale === "ja" ? "最小修正版" : "Minimal revision")
                        : (locale === "ja" ? "最小の改善案" : "Smallest improvement"),
                      detail: minimal
                        ? alternativeCopy(minimal, locale).title
                        : currentMetrics.hardConflictCount === 0
                          ? (locale === "ja" ? "必要な修正はありません" : "No corrective change needed")
                          : (locale === "ja" ? "1回の変更で成立する案はまだありません" : "No one-change repair is available yet"),
                      metrics: minimal?.after ?? currentMetrics,
                      alternative: minimal,
                    },
                    {
                      key: "shortest",
                      label: locale === "ja" ? "移動を減らす案" : "Lower-travel order",
                      detail: shortest ? alternativeCopy(shortest, locale).title : (locale === "ja" ? "固定条件内で、より移動の少ない案は見つかりませんでした" : "No lower-travel alternative was found within the fixed constraints"),
                      metrics: shortest?.after ?? currentMetrics,
                      alternative: shortest,
                    },
                  ];
                  return (
                    <section className="planner-existing-comparison" aria-labelledby="planner-existing-comparison-title">
                      <header><span>{locale === "ja" ? "既存旅程モード" : "Existing itinerary mode"}</span><b id="planner-existing-comparison-title">{locale === "ja" ? "3つの見方を比較" : "Compare three views"}</b></header>
                      <div>
                        {cards.map((card) => (
                          <article className={card.key === "original" ? "is-current" : ""} key={card.key}>
                            <span>{card.label}</span><b>{card.detail}</b>
                            <dl>
                              <div><dt>{locale === "ja" ? "衝突" : "Conflicts"}</dt><dd>{card.metrics.hardConflictCount}</dd></div>
                              <div><dt>{locale === "ja" ? "移動" : "Travel"}</dt><dd>{card.metrics.travelMinutes}{locale === "ja" ? "分" : " min"}</dd></div>
                              <div><dt>{locale === "ja" ? "最小余白" : "Min slack"}</dt><dd>{card.metrics.minimumSlackMinutes === null ? "—" : `${card.metrics.minimumSlackMinutes}${locale === "ja" ? "分" : " min"}`}</dd></div>
                            </dl>
                            {card.alternative ? <button onClick={() => setComparisonAlternative(card.alternative)} type="button">{locale === "ja" ? "差分を見る" : "Review diff"}</button> : <small>{locale === "ja" ? "現在" : "Current"}</small>}
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })() : null}

                {feasibilityResult.alternatives.length > 0 ? (
                  <details className="planner-alternatives" open={comparisonAlternative ? true : undefined}>
                    <summary><span><b id="planner-alternatives-title">{locale === "ja" ? "比較できる変更案" : "Comparable changes"}</b><small>{locale === "ja" ? "差分を確認してから適用" : "Compare before applying"}</small></span><em>{feasibilityResult.alternatives.length}</em></summary>
                    <div>
                      {feasibilityResult.alternatives.map((alternative) => {
                        const copy = alternativeCopy(alternative, locale);
                        return (
                          <button
                            aria-pressed={comparisonAlternative?.id === alternative.id}
                            key={alternative.id}
                            onClick={() => setComparisonAlternative(alternative)}
                            type="button"
                          >
                            <span><b>{copy.title}</b><small>{copy.detail}</small></span><Icon name="arrow" size={14} />
                          </button>
                        );
                      })}
                    </div>
                    {comparisonAlternative ? (() => {
                      const copy = alternativeCopy(comparisonAlternative, locale);
                      const metric = (value: number | null, suffix = "") => value === null ? "—" : `${value}${suffix}`;
                      return (
                        <section aria-live="polite" className="planner-comparison" aria-labelledby="planner-comparison-title">
                          <header><span id="planner-comparison-title">{locale === "ja" ? "変更前と変更後" : "Before and after"}</span><b>{copy.title}</b></header>
                          <div>
                            {[
                              { label: locale === "ja" ? "現在の案" : "Current plan", metrics: comparisonAlternative.before },
                              { label: locale === "ja" ? "変更案" : "Proposed plan", metrics: comparisonAlternative.after },
                            ].map((column) => (
                              <article key={column.label}>
                                <h3>{column.label}</h3>
                                <dl>
                                  <div><dt>{locale === "ja" ? "重大な衝突" : "Hard conflicts"}</dt><dd>{column.metrics.hardConflictCount}</dd></div>
                                  <div><dt>{locale === "ja" ? "超過" : "Overrun"}</dt><dd>{metric(column.metrics.overrunMinutes, locale === "ja" ? "分" : " min")}</dd></div>
                                  <div><dt>{locale === "ja" ? "最小余白" : "Minimum slack"}</dt><dd>{metric(column.metrics.minimumSlackMinutes, locale === "ja" ? "分" : " min")}</dd></div>
                                  <div><dt>{locale === "ja" ? "訪問数 / 日数" : "Visits / days"}</dt><dd>{column.metrics.scheduledStopCount} / {column.metrics.dayCount}</dd></div>
                                  <div><dt>{locale === "ja" ? "移動" : "Travel"}</dt><dd>{metric(column.metrics.travelMinutes, locale === "ja" ? "分" : " min")}</dd></div>
                                </dl>
                              </article>
                            ))}
                          </div>
                          <p>{copy.detail}</p>
                          {comparisonAlternative.loss ? <p className="is-loss">{alternativeLossCopy(comparisonAlternative, locale)}</p> : null}
                          <footer>
                            <button onClick={() => setComparisonAlternative(null)} type="button">{locale === "ja" ? "戻る" : "Cancel"}</button>
                            <button className="is-apply" onClick={() => applyTripAlternative(comparisonAlternative)} type="button">{locale === "ja" ? "この変更を適用" : "Apply this change"}</button>
                          </footer>
                        </section>
                      );
                    })() : null}
                  </details>
                ) : null}

                <details className="planner-plan-assumptions">
                  <summary>{locale === "ja" ? `この判定の前提 ${feasibilityResult.assumptions.length}件` : `${feasibilityResult.assumptions.length} assumptions behind this verdict`}</summary>
                  <ul>
                    {feasibilityResult.assumptions.map((assumption) => <li key={assumption.code}>{assumptionCopy(assumption, locale)}</li>)}
                    {feasibilityResult.assumptions.length === 0 ? <li>{locale === "ja" ? "重要な前提はすべて確認済みです。" : "All critical assumptions are confirmed."}</li> : null}
                  </ul>
                </details>

                {placeWarning || (!P0_CORE_ONLY && hotelState.status === "unavailable") || plan.overCapacityCount > 0 || plan.deferredUnavailableStops.length > 0 || plan.deferredOptionalStops.length > 0 ? (
                  <details className="planner-plan-notices">
                    <summary>
                      <span aria-hidden="true">!</span>
                      {locale === "ja" ? "その他の注意" : "Other notices"}
                    </summary>
                    <div>
                      {placeWarning ? (
                        <p>
                          {plan.unknownEntries.length > 0
                            ? locale === "ja"
                              ? `${placeWarning === "quota_exhausted" ? "場所検索が本日の上限に達したため" : "位置情報サービスに接続できず"}、${plan.unknownEntries.length}件（${plan.unknownEntries.slice(0, 3).join("・")}${plan.unknownEntries.length > 3 ? " ほか" : ""}）が未解決のままです。時間をおいて作り直すか、入力にもどって確認してください。`
                              : `${placeWarning === "quota_exhausted" ? "Place search hit its allowance" : "Place lookup failed"}, so ${plan.unknownEntries.length} entr${plan.unknownEntries.length === 1 ? "y" : "ies"} (${plan.unknownEntries.slice(0, 3).join(", ")}${plan.unknownEntries.length > 3 ? ", …" : ""}) stayed unresolved. Rebuild later or go back to the input to settle them.`
                            : text.placeFallback}
                        </p>
                      ) : null}
                      {!P0_CORE_ONLY && hotelState.status === "unavailable" ? (
                        <p>{text.hotelUnavailable}{" "}<a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotelQuery.trim() || mapStops[0]?.area || destinationName(activeDestination, locale)} ${locale === "ja" ? "ホテル" : "hotels"}`)}`} rel="noreferrer" target="_blank">{text.hotelSearch} ↗</a></p>
                      ) : null}
                      {plan.overCapacityCount > 0 ? <p>{text.overCapacity}</p> : null}
                      {plan.deferredUnavailableStops.length > 0 || plan.deferredOptionalStops.length > 0 ? (
                        <div className="planner-excluded">
                          <b>{text.excludedHeading} · {plan.deferredUnavailableStops.length + plan.deferredOptionalStops.length}</b>
                          <ul>
                            {plan.deferredUnavailableStops.map((stop) => <li key={stop.id}><b>{stop.name}</b><small> — {text.excludedClosed}</small></li>)}
                            {plan.deferredOptionalStops.map((stop) => <li key={stop.id}><b>{stop.name}</b><small> — {text.excludedPace}</small></li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ) : null}

                  </div>
                </details>

              </section>
              </>
            ) : null}

            {P1_TRAVEL_ENRICHMENTS && beforeYouGo && (beforeYouGo.reservations.length > 0 || beforeYouGo.watchlist.length > 0 || activeEssentials || preTripItems.length > 0) ? (
              <details className="planner-warning planner-before-you-go">
                <summary><span aria-hidden="true"><Icon name="check" size={13} /></span>{text.beforeHeading}</summary>
                <label className="planner-passport-country">
                  <span>{text.passportCountry}</span>
                  <select onChange={(event) => setPassportCountry(event.target.value as PassportCountry)} value={passportCountry}>
                    <option value="unset">{text.passportUnset}</option>
                    <option value="JP">{text.passportJapan}</option>
                    <option value="other">{text.passportOther}</option>
                  </select>
                  {passportCountry !== "JP" ? <small>{text.passportUnsupported}</small> : null}
                </label>
                <ul>
                  {preTripItems.map((item) => (
                    <li className={item.urgency === "overdue" ? "is-overdue" : item.urgency === "due_soon" ? "is-due-soon" : ""} key={item.id}>
                      <b>
                        {item.urgency === "overdue" ? `${text.beforeOverdue} · ` : item.urgency === "due_soon" ? `${text.beforeDueSoon} · ` : ""}
                        {locale === "ja" ? item.label.ja : item.label.en}
                      </b>
                      <small> — {locale === "ja" ? item.detail.ja : item.detail.en}{" "}
                        {item.url ? <a href={item.url} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a> : null}
                      </small>
                    </li>
                  ))}
                  {activeEssentials?.strikeInfo ? (
                    <li key="strike">
                      <b>{text.beforeStrike}</b>
                      <small> — {locale === "ja" ? activeEssentials.strikeInfo.ja : activeEssentials.strikeInfo.en}{" "}
                        <a href={activeEssentials.strikeInfo.url} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
                      </small>
                    </li>
                  ) : null}
                  {activeDestination.id !== "japan" && activeDestination.id !== "worldwide" ? (
                    <li key="medication">
                      <b>{text.beforeMedication}</b>
                      <small> — {text.beforeMedicationNote}{" "}
                        <a href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iyakuhin/yakubuturanyou/index_00005.html" rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
                      </small>
                    </li>
                  ) : null}
                  {beforeYouGo.reservations.map((entry) => (
                    <li key={`booked-${entry.name}`}>
                      <b>{entry.name}</b>
                      <small> — {entry.time ? text.beforeBookedAt(entry.time) : text.beforeBooked}</small>
                    </li>
                  ))}
                  {beforeYouGo.watchlist.map((name) => (
                    <li key={`watch-${name}`}>
                      <b>{name}</b>
                      <small> — {text.beforeWatch}</small>
                    </li>
                  ))}
                  {passportCountry === "JP" && activeEssentials ? (
                    <li key="entry">
                      <b>{text.essentialsEntry}</b>
                      <small> — {locale === "ja" ? activeEssentials.entry.ja : activeEssentials.entry.en}{" "}
                        <a href={activeEssentials.entry.sourceUrl} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
                      </small>
                    </li>
                  ) : null}
                  {activeEssentials?.pass ? (
                    <li key="pass">
                      <b>{text.essentialsPass}</b>
                      <small> — {locale === "ja" ? activeEssentials.pass.ja : activeEssentials.pass.en}{" "}
                        <a href={activeEssentials.pass.url} rel="noreferrer" target="_blank">{text.essentialsOfficial} ↗</a>
                      </small>
                    </li>
                  ) : null}
                </ul>
                {passportCountry === "JP" && destinationPassportRule(activeDestination) ? (
                  <label className="planner-passport-check">
                    <span>{text.beforePassportLabel}</span>
                    <input
                      onChange={(event) => updatePassportExpiry(event.target.value)}
                      type="date"
                      value={passportExpiry}
                    />
                    <small>{text.beforePassportHint}</small>
                  </label>
                ) : null}
              </details>
            ) : null}

            <div className="planner-day-tabs" aria-label={locale === "ja" ? "日程を選ぶ" : "Choose a day"}>
              {plan.days.map((candidate, index) => {
                const weekday = tripDateTouched ? weekdayInfo(candidate.date, locale) : null;
                return (
                  <button
                    aria-pressed={activeDay === index}
                    className={`is-day-${index % 4 + 1}${activeDay === index ? " is-active" : ""}${weekday?.isWeekend ? " is-weekend" : ""}`}
                    key={candidate.label}
                    onClick={() => switchDay(index)}
                    type="button"
                  >
                    <b>{index + 1}</b>
                    <span>
                      {locale === "ja" ? `${index + 1}日目` : `Day ${index + 1}`}
                      {` · ${candidate.stops.length === 0
                        ? locale === "ja" ? "予定なし" : "empty"
                        : candidate.stops.length <= 2
                          ? locale === "ja" ? "ゆったり" : "easy"
                          : locale === "ja" ? `${candidate.stops.length}か所` : `${candidate.stops.length} stops`}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <section className="planner-day-summary">
              <div>
                <span>
                  {tripDateTouched && day.date
                    ? locale === "ja"
                      ? `${day.date}（${weekdayInfo(day.date, locale)?.label ?? ""}）`
                      : `${day.date} (${weekdayInfo(day.date, locale)?.label ?? ""})`
                    : day.label}
                </span>
                <b>{day.startTime}—{day.finishTime}</b>
                <PlannerDayTimeBar day={day} fit={activeFitDay} locale={locale} />
                {activeFitDay ? (
                  <div className="planner-day-metrics" aria-label={locale === "ja" ? "この日の時間内訳" : "Day time breakdown"}>
                    <span><small>{locale === "ja" ? "予定" : "Planned"}</small><b>{formatDuration(activeFitDay.plannedMinutes, locale)}</b></span>
                    <span><small>{locale === "ja" ? "余白" : "Spare"}</small><b>{formatDuration(Math.max(0, activeFitDay.slackMinutes), locale)}</b></span>
                  </div>
                ) : dayTravelTotal > 0 ? <small className="planner-day-total">{text.travelTotal(dayTravelTotal)}</small> : null}
                {weatherByDay[activeDay] ? (
                  <small className="planner-day-forecast">
                    <Icon name={weatherIconByKind[weatherByDay[activeDay].kind as WeatherKind] ?? "cloud"} size={12} />
                    {weatherByDay[activeDay].temperatureMaxC}° / {weatherByDay[activeDay].temperatureMinC}°
                    {weatherByDay[activeDay].precipitationPercent !== null
                      ? ` · ${text.precipitation(weatherByDay[activeDay].precipitationPercent!)}`
                      : ""}
                    <em>{text.forecastNote}</em>
                  </small>
                ) : null}
                {tripDateTouched && day.date && holidaysByDate[day.date] ? (
                  <small className="planner-day-caution">
                    {text.holidayNote(holidaysByDate[day.date].localName)}
                    {holidaysByDate[day.date].nationwide ? "" : text.holidayRegional}
                  </small>
                ) : null}
                {tripDateTouched && day.date && activeDestination.sundayClosing && weekdayInfo(day.date, locale)?.isSunday && !holidaysByDate[day.date] ? (
                  <small className="planner-day-caution">{text.sundayClosingNote}</small>
                ) : null}
              </div>
            </section>

            {hotelStayMode === "nightly" && day.endBase ? (
              <button className="planner-tonight" onClick={() => setInspector({ kind: "hotel" })} type="button">
                <span aria-hidden="true"><Icon name="bed" size={13} /></span>{text.tonightHotel(day.endBase.name)}
              </button>
            ) : null}

            {day.stops.length === 0 ? <p className="planner-open-day">{text.openDay}</p> : (
              <ol className="planner-timeline">
                {day.stops.map((builtStop, index) => {
                  const leg = index > 0 ? day.legs[index - 1] : null;
                  const recommended = leg?.comparison.recommended;
                  const isSelected = inspector?.kind === "stop" && inspector.stopId === builtStop.stop.id;
                  const durationStatus = durationEvidenceByStopId[builtStop.stop.id] ?? "estimated";
                  const accessPolicy = poiAccessPolicyForStop(builtStop.stop);
                  const isFiller = fillerStopIds.has(builtStop.stop.id);
                  const fillerKind = fillerKindsByStopId.get(builtStop.stop.id);
                  const isMealFiller = fillerKind === "lunch" || fillerKind === "dinner";
                  const durationSource = durationStatus === "user_provided"
                    ? (locale === "ja" ? "指定" : "set")
                    : durationStatus === "verified"
                      ? (locale === "ja" ? "確認" : "confirmed")
                      : (locale === "ja" ? "推定" : "estimated");
                  return (
                    <Fragment key={`${builtStop.stop.id}-${index}`}>
                    {index === 0 && base && day.hotelOutboundMinutes !== null ? (
                      <li className="planner-hotel-leg">
                        <span aria-hidden="true"><Icon name="bed" size={12} /></span>
                        <span>{text.hotelDepartRow(modeLabel(day.hotelOutboundMode), day.hotelOutboundMinutes)}</span>
                      </li>
                    ) : null}
                    <li className={isFiller ? `is-system-filler${isMealFiller ? " is-meal-filler" : ""}` : undefined}>
                      {leg && recommended ? (() => {
                        const legKey = routeLegKey(leg.from.id, leg.to.id);
                        const modeLabel = (mode: TransportMode) => mode === "taxi" && travelPreference === "car" ? text.moveCar : text.move[mode];
                        return (
                          <details className="planner-leg">
                            <summary>
                              <span>{modeIcon(recommended.mode, travelPreference === "car")}<b>{modeLabel(recommended.mode)} · {text.minutes(recommended.minutes)}</b></span>
                              <small>{locale === "ja" ? "変更" : "Change"}</small>
                            </summary>
                            <div className="planner-leg-modes" role="group" aria-label={`${leg.from.name} → ${leg.to.name} · ${text.legModes}`}>
                              {leg.comparison.options
                                .filter((option) => option.mode !== "walk" || option.minutes <= 90)
                                .map((option) => (
                                  <button
                                    aria-pressed={option.mode === recommended.mode}
                                    className={option.mode === recommended.mode ? "is-active" : ""}
                                    key={option.mode}
                                    onClick={() => setLegMode(legKey, option.mode)}
                                    title={`${modeLabel(option.mode)} · ${text.legModes}`}
                                    type="button"
                                  >
                                    {modeIcon(option.mode, travelPreference === "car")}
                                    <b>{text.minutes(option.minutes)}</b>
                                  </button>
                                ))}
                            </div>
                            <span className="planner-leg-evidence">
                              {recommended.source === "live" ? <em>{text.legLive}</em> : null}
                              {recommended.mode === "transit" && leg.transferCount !== null ? (
                                <em>{locale === "ja" ? `乗換${leg.transferCount}回` : `${leg.transferCount} transfer${leg.transferCount === 1 ? "" : "s"}`}</em>
                              ) : null}
                            </span>
                          </details>
                        );
                      })() : null}
                      <button
                        className={`planner-stop-row${isSelected ? " is-selected" : ""}${isFiller ? " is-filler" : ""}`}
                        data-planner-stop-id={builtStop.stop.id}
                        onClick={() => {
                          setMapFocusedStopId(builtStop.stop.id);
                          setInspector(isSelected ? null : { kind: "stop", stopId: builtStop.stop.id });
                        }}
                        type="button"
                      >
                        <time>{builtStop.arrival}</time>
                        <span className="planner-stop-dot">{isMealFiller ? <Icon name="fork" size={11} /> : isFiller ? <Icon name="spark" size={11} /> : index + 1}</span>
                        <span className="planner-stop-main">
                          {isFiller ? <small className="planner-filler-label"><Icon name={isMealFiller ? "fork" : "spark"} size={10} />{isMealFiller
                            ? fillerKind === "lunch" ? (locale === "ja" ? "昼食のおすすめ" : "Lunch recommendation") : (locale === "ja" ? "夕食のおすすめ" : "Dinner recommendation")
                            : locale === "ja" ? "おすすめ" : "Recommended"}</small> : null}
                          <b>{builtStop.stop.name}</b>
                          <small>{builtStop.stop.area} · {text.previewStay(builtStop.stop.planningDurationMinutes)} <i className={`planner-duration-source is-${durationStatus}`}>{durationSource}</i></small>
                          {accessPolicy ? <small className="planner-access-note"><Icon name="train" size={10} />{accessPolicy.note[locale]}</small> : null}
                        </span>
                        <span className="planner-stop-flags">
                          {builtStop.reservationLateMinutes > 0
                            ? <i className="is-booked">{text.lateShort(builtStop.reservationLateMinutes)}</i>
                            : builtStop.fixedTime
                              ? <i className="is-booked">{builtStop.fixedTime}</i>
                              : builtStop.priority === "must"
                                ? <i className="is-must">{text.must}</i>
                                : null}
                          {builtStop.openingStatus === "conflict"
                            ? <i className="is-booked">{text.openingConflict}</i>
                            : builtStop.openingStatus === "closed_day"
                              ? <i className="is-booked">{text.openingClosedDay}</i>
                              : builtStop.openingStatus === "last_entry_conflict"
                                ? <i className="is-booked">{locale === "ja" ? "最終入場後" : "after last entry"}</i>
                                : null}
                        </span>
                      </button>
                      {isFiller ? (
                        <button
                          className="planner-filler-remove"
                          onClick={() => removeSystemFiller(builtStop.stop)}
                          type="button"
                        >
                          <Icon name="close" size={10} />{locale === "ja" ? "おすすめを外す" : "Remove suggestion"}
                        </button>
                      ) : null}
                    </li>
                    {!P0_CORE_ONLY ? mealRowsAfter(index) : null}
                    {index === day.stops.length - 1 && dayEndBase && day.hotelInboundMinutes !== null ? (
                      <li className="planner-hotel-leg is-return">
                        <span aria-hidden="true"><Icon name="bed" size={12} /></span>
                        <span>{text.hotelReturnRow(modeLabel(day.hotelInboundMode), day.hotelInboundMinutes)}</span>
                      </li>
                    ) : null}
                    </Fragment>
                  );
                })}
              </ol>
            )}

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
          <div className="planner-result-view">
            <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.noDays}</p>
            {plan && plan.unknownEntries.length > 0 ? (
              <details className="planner-unknown" open>
                <summary>{text.unknown} · {plan.unknownEntries.length}</summary>
                <ul>{plan.unknownEntries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              </details>
            ) : null}
            <button className="planner-build-button" onClick={() => setHasPlan(false)} type="button"><span>{text.edit}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b></button>
          </div>
        )}
      </section>
    </main>
  );
}
