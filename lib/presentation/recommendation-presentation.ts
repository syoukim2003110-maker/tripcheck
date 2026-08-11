// Recommendation presentation: the unified TripEnhancement model (refactor
// spec v2.1 section 5) plus the hotel shortlist/axis pickers and filler
// classification that feed it. Pure functions - no React.
import type { RouteRecommendation } from "../route-recommendations";
import type { FillerKind } from "../itinerary-domain";
import type { HotelCandidate } from "../google-hotels";
import type { HotelStyleChoice } from "../planner-app-state";

/** One unified "make the trip better" proposal (spec v2.1 section 5). */
export type EnhancementType = "HOTEL" | "MEAL" | "CAFE" | "MICRO_STOP";
export type Enhancement = {
  type: EnhancementType;
  id: string;
  title: string;
  reason: string;
  impact: { addedMinutes: number; savedMinutes: number };
  evidence: string[];
};

export const TRIPCHECK_FILLER_PREFIX = "TripCheck recommendation";

export function fillerOccurrenceLine(index: number, kind: "micro" | "lunch" | "dinner" = "micro", atTime?: string) {
  return `${TRIPCHECK_FILLER_PREFIX} ${kind} ${index + 1} — optional${/^\d{2}:\d{2}$/.test(atTime ?? "") ? ` — ${atTime}` : ""}`;
}

export function recommendationStopId(providerRef: string) {
  return providerRef.startsWith("google-") ? providerRef : `google-${providerRef}`;
}

export function routeRecommendationFillerKind(candidate: RouteRecommendation): FillerKind {
  const types = new Set(candidate.placeTypes);
  return types.has("cafe") || types.has("coffee_shop") || types.has("bakery") || types.has("tea_house")
    ? "CAFE"
    : "MICRO_STOP";
}

export function boundedRecommendationScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function styledBestCandidate(candidates: HotelCandidate[], style: HotelStyleChoice) {
  if (style === "recommended") return candidates[0] ?? null;
  // A dateless reference minimum or a relative price band cannot establish
  // live value. Keep the value style unavailable until a dated, comparable
  // availability source exists.
  if (style === "value") return null;
  return candidates.find((candidate) => candidate.styles.includes(style)) ?? null;
}

/* Axis winners are asserted only against comparable facts. Dateless reference
 * minimums remain display facts, never a "best value" ranking. */
export function hotelAxisWinners(candidates: HotelCandidate[]) {
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
export function hotelShortlist(candidates: HotelCandidate[], selectedId?: string | null) {
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
