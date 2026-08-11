// Shared, framework-free candidate simulation for recommendation accepts
// (v1.1 TC-048 / TC-050). The accept actions and the pre-accept impact
// metrics on the cards must describe the SAME candidate plan, so both build
// it through these helpers: the same synthesized wishlist line, the same
// resolved stop, the same planner context. The impact metrics (travel delta
// and buffer/余裕 delta) are measured on that really built plan — never
// estimated from distances.
import { buildTripFromWishlist, type BuiltTripPlan, type FoodRecommendationSlot, type TripPlannerContext } from "./trip-builder.ts";
import type { Pace } from "./trip-builder.ts";
import type { ResolvedInputStop } from "./route-optimizer.ts";
import type { FoodCandidate } from "./google-food.ts";
import type { RouteRecommendation } from "./route-recommendations.ts";
import type { ItineraryGap } from "./gap-detection.ts";
import type { Destination } from "./destinations.ts";
import type { PlannerLocale } from "./presentation/planner-copy.ts";
import { areaFromAddress } from "./google-place-resolver.ts";
import { estimateStayMinutes } from "./stay-estimates.ts";
import { parsedWishlistPlaces } from "./wishlist-parser.ts";
import { fillerOccurrenceLine, recommendationStopId } from "./presentation/recommendation-presentation.ts";
import { builtPlanTravelMinutes } from "./planner-app-state.ts";
import { totalPlanBufferMinutes } from "./trip-scenarios.ts";

export type AcceptSimulation = {
  resolved: ResolvedInputStop;
  candidateItinerary: string;
  candidateContext: TripPlannerContext;
  candidatePlan: BuiltTripPlan;
};

/**
 * The candidate plan a meal accept would commit: the filler wishlist line,
 * the provider-resolved stop pinned to the slot's day, and the plan built
 * from them. `currentStopId` is the currently accepted stop in the same slot
 * (it leaves via excludedStopIds exactly as the accept removes it).
 */
export function mealAcceptSimulation(input: {
  itinerary: string;
  tripDays: number;
  pace: Pace;
  locale: PlannerLocale;
  context: TripPlannerContext;
  resolvedStops: ResolvedInputStop[];
  slot: FoodRecommendationSlot;
  candidate: FoodCandidate;
  fetchedAt: string | undefined;
  destination: Destination;
  currentStopId?: string | null;
}): AcceptSimulation | null {
  const { slot, candidate } = input;
  if (typeof candidate.latitude !== "number" || typeof candidate.longitude !== "number") return null;
  const fillerKind = slot.kind === "lunch" ? "lunch" as const : "dinner" as const;
  const inputIndex = parsedWishlistPlaces(input.itinerary).length;
  const line = fillerOccurrenceLine(inputIndex, fillerKind, slot.displayTime);
  const resolved: ResolvedInputStop = {
    id: recommendationStopId(candidate.id),
    input: line,
    inputIndex,
    name: candidate.name,
    address: candidate.address,
    area: areaFromAddress(candidate.address, candidate.name, input.destination),
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    sourceUrl: candidate.googleMapsUrl,
    verifiedAt: input.fetchedAt?.slice(0, 10) ?? "",
    confidence: "medium",
    planningDurationMinutes: slot.kind === "lunch" ? 60 : 75,
    isAnchor: false,
    isUserEntered: false,
    placeTypes: [candidate.type],
    providerRef: candidate.id,
  };
  const candidateItinerary = `${input.itinerary.trimEnd()}\n${line}`.trimStart();
  const excluded = input.currentStopId
    ? [...new Set([...(input.context.excludedStopIds ?? []), input.currentStopId])]
    : [...(input.context.excludedStopIds ?? [])];
  const candidateContext: TripPlannerContext = {
    ...input.context,
    resolvedStops: [...input.resolvedStops.filter((stop) => stop.inputIndex !== inputIndex), resolved],
    dayOverrides: { ...(input.context.dayOverrides ?? {}), [resolved.id]: slot.dayIndex + 1 },
    excludedStopIds: excluded,
  };
  return {
    resolved,
    candidateItinerary,
    candidateContext,
    candidatePlan: buildTripFromWishlist(candidateItinerary, input.tripDays, input.pace, input.locale, candidateContext),
  };
}

/** The candidate plan a gap (route recommendation) accept would commit. */
export function gapAcceptSimulation(input: {
  itinerary: string;
  tripDays: number;
  pace: Pace;
  locale: PlannerLocale;
  context: TripPlannerContext;
  resolvedStops: ResolvedInputStop[];
  candidate: RouteRecommendation;
  gap: ItineraryGap;
  activeDay: number;
  checkedAt: string;
  destination: Destination;
}): AcceptSimulation {
  const { candidate, gap } = input;
  const inputIndex = parsedWishlistPlaces(input.itinerary).length;
  const line = fillerOccurrenceLine(inputIndex, "micro", gap.startAt);
  const resolved: ResolvedInputStop = {
    id: recommendationStopId(candidate.id),
    input: line,
    inputIndex,
    name: candidate.name,
    address: candidate.address,
    area: areaFromAddress(candidate.address, candidate.name, input.destination),
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    sourceUrl: candidate.googleMapsUrl,
    verifiedAt: input.checkedAt,
    confidence: "medium",
    planningDurationMinutes: Math.min(
      estimateStayMinutes(candidate.name, candidate.placeTypes, 90),
      Math.max(20, gap.availableMinutes - 10),
    ),
    isAnchor: false,
    isUserEntered: false,
    placeTypes: candidate.placeTypes,
    providerRef: candidate.providerRef,
  };
  const candidateItinerary = `${input.itinerary.trimEnd()}\n${line}`.trimStart();
  const candidateContext: TripPlannerContext = {
    ...input.context,
    resolvedStops: [...input.resolvedStops.filter((stop) => stop.inputIndex !== inputIndex), resolved],
    dayOverrides: { ...(input.context.dayOverrides ?? {}), [resolved.id]: input.activeDay + 1 },
  };
  return {
    resolved,
    candidateItinerary,
    candidateContext,
    candidatePlan: buildTripFromWishlist(candidateItinerary, input.tripDays, input.pace, input.locale, candidateContext),
  };
}

export type PlanImpactMetrics = {
  /** Positive = the candidate plan travels longer than the current plan. */
  travelDeltaMinutes: number;
  /** Positive = the candidate plan leaves MORE buffer (余裕) than today. */
  bufferDeltaMinutes: number;
};

/** Both metrics come from the really simulated candidate plan (no guesses). */
export function planImpactMetrics(input: {
  plan: BuiltTripPlan;
  context: TripPlannerContext;
  candidatePlan: BuiltTripPlan;
  candidateContext: TripPlannerContext;
}): PlanImpactMetrics {
  return {
    travelDeltaMinutes: builtPlanTravelMinutes(input.candidatePlan) - builtPlanTravelMinutes(input.plan),
    bufferDeltaMinutes: totalPlanBufferMinutes(input.candidatePlan, input.candidateContext)
      - totalPlanBufferMinutes(input.plan, input.context),
  };
}
