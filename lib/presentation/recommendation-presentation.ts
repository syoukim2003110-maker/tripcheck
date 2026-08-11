// Recommendation presentation: the unified TripEnhancement model (refactor
// spec v2.1 section 5) plus the hotel shortlist/axis pickers and filler
// classification that feed it. Pure functions - no React.
import type { RouteRecommendation } from "../route-recommendations.ts";
import type { FillerKind } from "../itinerary-domain.ts";
import type { FoodCandidate } from "../google-food.ts";
import type { HotelCandidate } from "../google-hotels.ts";
import type { HotelStyleChoice } from "../planner-app-state.ts";

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

/* ---- Enhancement builders (spec v2.1 section 5) --------------------------
 * Total, deterministic mappings from the three domain candidate shapes onto
 * the unified Enhancement model. They never throw on partial input: every
 * numeric fact is checked before it is formatted, and absent facts simply
 * produce fewer evidence lines. */

function clampedMinutes(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function ratingEvidence(rating: number | null | undefined, userRatingCount: number | null | undefined) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  const count = typeof userRatingCount === "number" && Number.isFinite(userRatingCount)
    ? ` (${Math.max(0, Math.round(userRatingCount))})`
    : "";
  return `★ ${rating.toFixed(1)}${count}`;
}

/**
 * Hotel candidate as an Enhancement. `travelMinutes` is the whole-trip
 * travel-minute saving versus the alternative base (the caller computes the
 * delta); anything absent, negative or non-finite counts as 0 saved.
 */
export function hotelEnhancement(
  candidate: HotelCandidate,
  opts: { travelMinutes?: number | null; note?: string | null } = {},
): Enhancement {
  const evidence: string[] = [];
  const rating = ratingEvidence(candidate.rating, candidate.userRatingCount);
  if (rating !== null) evidence.push(rating);
  const rakuten = candidate.rakuten ?? null;
  if (rakuten && typeof rakuten.reviewAverage === "number" && Number.isFinite(rakuten.reviewAverage)) {
    const count = typeof rakuten.reviewCount === "number" && Number.isFinite(rakuten.reviewCount)
      ? ` (${Math.max(0, Math.round(rakuten.reviewCount))})`
      : "";
    evidence.push(`Rakuten ★ ${rakuten.reviewAverage.toFixed(1)}${count}`);
  }
  if (rakuten && typeof rakuten.minCharge === "number" && Number.isFinite(rakuten.minCharge)) {
    evidence.push(`¥${Math.max(0, Math.round(rakuten.minCharge))}~`);
  }
  return {
    type: "HOTEL",
    id: candidate.id,
    title: candidate.name,
    reason: opts.note ?? "",
    impact: { addedMinutes: 0, savedMinutes: clampedMinutes(opts.travelMinutes) },
    evidence,
  };
}

/** Meal candidate as an Enhancement; the detour is the added travel cost. */
export function mealEnhancement(
  candidate: FoodCandidate,
  opts: { slotKind: "lunch" | "dinner"; detourMinutes?: number | null; reason?: string | null },
): Enhancement {
  const evidence: string[] = [];
  const rating = ratingEvidence(candidate.rating, candidate.userRatingCount);
  if (rating !== null) evidence.push(rating);
  if (candidate.plannedOpen === true) evidence.push("open at the planned time");
  else if (candidate.plannedOpen == null && candidate.openNow === true) evidence.push("open now");
  const payment = Array.isArray(candidate.paymentEvidence) ? candidate.paymentEvidence[0] : undefined;
  if (payment && typeof payment.label === "string" && payment.label.length > 0) evidence.push(payment.label);
  return {
    type: "MEAL",
    id: `meal:${opts.slotKind}:${candidate.id}`,
    title: candidate.name,
    reason: opts.reason ?? "",
    impact: { addedMinutes: clampedMinutes(opts.detourMinutes), savedMinutes: 0 },
    evidence,
  };
}

/** Gap-filler candidate as an Enhancement, typed by its place classification. */
export function gapEnhancement(
  candidate: RouteRecommendation,
  opts: { addedMinutes?: number | null; reason?: string | null } = {},
): Enhancement {
  const evidence: string[] = [];
  const rating = ratingEvidence(candidate.rating, candidate.userRatingCount);
  if (rating !== null) evidence.push(rating);
  if (typeof candidate.routeDistanceMeters === "number" && Number.isFinite(candidate.routeDistanceMeters)) {
    evidence.push(`${Math.max(0, Math.round(candidate.routeDistanceMeters))}m off the route`);
  }
  return {
    type: routeRecommendationFillerKind(candidate) === "CAFE" ? "CAFE" : "MICRO_STOP",
    id: candidate.id,
    title: candidate.name,
    reason: opts.reason ?? "",
    impact: { addedMinutes: clampedMinutes(opts.addedMinutes), savedMinutes: 0 },
    evidence,
  };
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
