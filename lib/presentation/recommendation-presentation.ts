// Recommendation presentation: the unified TripEnhancement model (refactor
// spec v2.1 section 5) plus the hotel shortlist/axis pickers and filler
// classification that feed it. Pure functions - no React. The fact-line
// helpers below are the single home for the strings the recommendation
// surfaces render; the Enhancement builders emit exactly those strings as
// evidence, so the tested model and the rendered DOM cannot drift.
import type { RouteRecommendation } from "../route-recommendations.ts";
import type { FillerKind } from "../itinerary-domain.ts";
import type { FoodCandidate } from "../google-food.ts";
import type { HotelCandidate } from "../google-hotels.ts";
import type { HotelStyleChoice } from "../planner-app-state.ts";
import { ui, type PlannerLocale } from "./planner-copy.ts";
import { formatDuration } from "./trip-presentation.ts";

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

/* ---- Shared fact-line rules ----------------------------------------------
 * These produce the exact strings production renders. Components and the
 * Enhancement builders both call them, so each rule has one home. */

/**
 * The `★ x.x` rating fact exactly as the planner renders it. Production has
 * three shapes and each caller must keep its own: `dot` (`★ 4.2 · 5,400`) on
 * the meal/gap cards and the hotel hero facts, `compare-paren` on the hotel
 * comparison list (ja `★ 4.6（3,200）`, en `★ 4.6 (3,200)`) and
 * `ascii-paren` on the nightly shortlist (ASCII parentheses in both locales).
 * Absent ratings return null; an absent count renders as `—`.
 */
export function ratingFactLine(
  rating: number | null | undefined,
  userRatingCount: number | null | undefined,
  locale: PlannerLocale,
  style: "dot" | "compare-paren" | "ascii-paren" = "dot",
): string | null {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  const stars = `★ ${rating.toFixed(1)}`;
  const count = typeof userRatingCount === "number" && Number.isFinite(userRatingCount)
    ? userRatingCount.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")
    : "—";
  if (style === "dot") return `${stars} · ${count}`;
  if (style === "compare-paren" && locale === "ja") return `${stars}（${count}）`;
  return `${stars} (${count})`;
}

/** Planned-open beats open-now: a "listed open now" claim is only shown when
 * no planned-time verdict exists at all (plannedOpen === false stays silent). */
export function openStatusLabel(
  candidate: Pick<FoodCandidate, "plannedOpen" | "openNow">,
  locale: PlannerLocale,
): string | null {
  if (candidate.plannedOpen === true) return ui[locale].plannedOpen;
  if (candidate.plannedOpen == null && candidate.openNow === true) return ui[locale].openNow;
  return null;
}

/** The single payment fact a food card shows: the first evidence label. */
export function paymentEvidenceLabel(candidate: Pick<FoodCandidate, "paymentEvidence">): string | null {
  const first = Array.isArray(candidate.paymentEvidence) ? candidate.paymentEvidence[0] : undefined;
  return first && typeof first.label === "string" && first.label.length > 0 ? first.label : null;
}

/** Rakuten review fact (`Rakuten Travel ★4.3 (812)` / `楽天トラベル ★4.3（812件）`);
 * an absent review count renders as 0, matching the comparison card. */
export function rakutenReviewLine(
  rakuten: HotelCandidate["rakuten"] | undefined,
  locale: PlannerLocale,
): string | null {
  return rakuten?.reviewAverage
    ? ui[locale].rakutenTag(rakuten.reviewAverage, rakuten.reviewCount ?? 0)
    : null;
}

/** Rakuten dateless reference-minimum price fact (`¥18,000〜`). */
export function rakutenMinChargeLine(
  rakuten: HotelCandidate["rakuten"] | undefined,
  locale: PlannerLocale,
): string | null {
  return rakuten?.minCharge
    ? `¥${rakuten.minCharge.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}〜`
    : null;
}

/**
 * Hotel candidate as an Enhancement. `travelMinutes` is the whole-trip
 * travel-minute saving versus the alternative base (the caller computes the
 * delta); anything absent, negative or non-finite counts as 0 saved. The
 * evidence lines are the comparison-list facts, verbatim.
 */
export function hotelEnhancement(
  candidate: HotelCandidate,
  opts: { travelMinutes?: number | null; note?: string | null; locale?: PlannerLocale } = {},
): Enhancement {
  const locale = opts.locale ?? "en";
  const evidence: string[] = [];
  const rating = ratingFactLine(candidate.rating, candidate.userRatingCount, locale, "compare-paren");
  if (rating !== null) evidence.push(rating);
  const review = rakutenReviewLine(candidate.rakuten, locale);
  if (review !== null) evidence.push(review);
  const price = rakutenMinChargeLine(candidate.rakuten, locale);
  if (price !== null) evidence.push(price);
  return {
    type: "HOTEL",
    id: candidate.id,
    title: candidate.name,
    reason: opts.note ?? "",
    impact: { addedMinutes: 0, savedMinutes: clampedMinutes(opts.travelMinutes) },
    evidence,
  };
}

/** Meal candidate as an Enhancement; the detour is the added travel cost.
 * The evidence lines are the meal-card stat entries, verbatim. */
export function mealEnhancement(
  candidate: FoodCandidate,
  opts: { slotKind: "lunch" | "dinner"; detourMinutes?: number | null; reason?: string | null; locale?: PlannerLocale },
): Enhancement {
  const locale = opts.locale ?? "en";
  const evidence: string[] = [];
  const rating = ratingFactLine(candidate.rating, candidate.userRatingCount, locale);
  if (rating !== null) evidence.push(rating);
  const openStatus = openStatusLabel(candidate, locale);
  if (openStatus !== null) evidence.push(openStatus);
  const payment = paymentEvidenceLabel(candidate);
  if (payment !== null) evidence.push(payment);
  return {
    type: "MEAL",
    id: `meal:${opts.slotKind}:${candidate.id}`,
    title: candidate.name,
    reason: opts.reason ?? "",
    impact: { addedMinutes: clampedMinutes(opts.detourMinutes), savedMinutes: 0 },
    evidence,
  };
}

/** Gap-filler candidate as an Enhancement, typed by its place classification.
 * The evidence lines are the gap-card fact entries, verbatim. */
export function gapEnhancement(
  candidate: RouteRecommendation,
  opts: { addedMinutes?: number | null; reason?: string | null; locale?: PlannerLocale } = {},
): Enhancement {
  const locale = opts.locale ?? "en";
  const evidence: string[] = [];
  const rating = ratingFactLine(candidate.rating, candidate.userRatingCount, locale);
  if (rating !== null) evidence.push(rating);
  if (typeof candidate.routeDistanceMeters === "number" && Number.isFinite(candidate.routeDistanceMeters)) {
    evidence.push(ui[locale].routeIdeasDistance(candidate.routeDistanceMeters));
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

/**
 * What the day still has room for, in the traveller's terms.
 *
 * The fit assessment has always been able to say "this wishlist needs three
 * days, not four". Until now that was the end of the sentence: the trip totals
 * line reported the spare day and the product offered one cafe for it. This is
 * the other half — the day states how much of it is free and how many more
 * places it can take, so "you have a spare day" turns into "you can add these".
 *
 * `remaining` is the allowance minus what the traveller has already accepted,
 * so the line counts down as the day fills and stops inviting when it is full.
 */
export function spareCapacityLine(
  slackMinutes: number,
  remaining: number,
  locale: "ja" | "en",
): string {
  const free = formatDuration(Math.max(0, slackMinutes), locale);
  if (remaining <= 0) {
    return locale === "ja"
      ? "この日に足せるおすすめは埋まりました。"
      : "This day has taken all the suggestions it has room for.";
  }
  if (locale === "ja") {
    return `この日は${free}空いています。あと${remaining}か所まで足せます。`;
  }
  return `${free} of this day is free — room for ${remaining} more ${remaining === 1 ? "stop" : "stops"}.`;
}
