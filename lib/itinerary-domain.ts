/**
 * Product-level itinerary semantics.
 *
 * `RouteStop.isAnchor` predates the v0.3 product vocabulary and means
 * "preserve this relative order".  It must not be used to decide whether an
 * item came from the traveller.  This module keeps authorship, priority and
 * recommendation state on separate axes so the deterministic planner can be
 * adapted without changing its routing types.
 */

export type ItineraryItemKind = "ANCHOR" | "FILLER" | "CONSTRAINT";
export type FillerKind = "LUNCH" | "DINNER" | "CAFE" | "MICRO_STOP";
export type ItineraryItemSource = "USER" | "SYSTEM_RECOMMENDATION";
export type ItineraryPriority = "MUST" | "PREFER" | "OPTIONAL";
export type ItineraryConfidence = "VERIFIED" | "ESTIMATED" | "UNKNOWN";

type ItineraryItemBase = Readonly<{
  id: string;
  title: string;
  dayIndex: number;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  priority: ItineraryPriority;
  confidence: ItineraryConfidence;
  /** Runtime place identity. Persist provider-owned display fields separately. */
  placeId?: string;
}>;

export type AnchorItineraryItem = ItineraryItemBase & Readonly<{
  kind: "ANCHOR";
  source: "USER";
}>;

export type FillerItineraryItem = ItineraryItemBase & Readonly<{
  kind: "FILLER";
  fillerKind: FillerKind;
  source: "SYSTEM_RECOMMENDATION";
  /** System fillers can be preferred or optional, but never silently become Must. */
  priority: Exclude<ItineraryPriority, "MUST">;
  recommendationId: string;
}>;

export type ConstraintItineraryItem = ItineraryItemBase & Readonly<{
  kind: "CONSTRAINT";
  source: ItineraryItemSource;
}>;

export type ItineraryItem = AnchorItineraryItem | FillerItineraryItem | ConstraintItineraryItem;

export type UserAnchorInput = Omit<AnchorItineraryItem, "kind" | "source">;
export type SystemFillerInput = Omit<FillerItineraryItem, "kind" | "source">;

/** Every place explicitly supplied by the traveller is an Anchor, even when Optional. */
export function createUserAnchor(input: UserAnchorInput): AnchorItineraryItem {
  return Object.freeze({ ...input, kind: "ANCHOR", source: "USER" });
}

export function createSystemFiller(input: SystemFillerInput): FillerItineraryItem {
  return Object.freeze({ ...input, kind: "FILLER", source: "SYSTEM_RECOMMENDATION" });
}

export type RecommendationType = "HOTEL" | "MEAL" | "CAFE" | "MICRO_STOP";
export type RecommendationStatus = "PROPOSED" | "ACCEPTED" | "REJECTED" | "REPLACED";

export type RecommendationScore = Readonly<{
  total: number;
  detour: number;
  timeFit: number;
  qualityConfidence: number;
  preferenceFit: number;
  priceFit?: number;
  diversity?: number;
}>;

export type Recommendation = Readonly<{
  id: string;
  type: RecommendationType;
  /** Stable provider/local identity, not a persisted provider display name. */
  placeId: string;
  fillerKind?: FillerKind;
  /** Lunch slot id or Gap id; candidates with the same value are alternatives. */
  slotId?: string;
  proposedDayIndex?: number;
  proposedStartAt?: string;
  addedTravelMinutes: number;
  score: RecommendationScore;
  reasons: readonly string[];
  evidenceIds: readonly string[];
  status: RecommendationStatus;
}>;

export type RecommendationInput = Omit<Recommendation, "score" | "reasons" | "evidenceIds" | "status"> & Readonly<{
  score: RecommendationScore;
  reasons?: readonly string[];
  evidenceIds?: readonly string[];
  status?: RecommendationStatus;
}>;

function boundedScore(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

export function normalizeRecommendationScore(score: RecommendationScore): RecommendationScore {
  return Object.freeze({
    total: boundedScore(score.total),
    detour: boundedScore(score.detour),
    timeFit: boundedScore(score.timeFit),
    qualityConfidence: boundedScore(score.qualityConfidence),
    preferenceFit: boundedScore(score.preferenceFit),
    ...(score.priceFit === undefined ? {} : { priceFit: boundedScore(score.priceFit) }),
    ...(score.diversity === undefined ? {} : { diversity: boundedScore(score.diversity) }),
  });
}

function uniqueBoundedStrings(values: readonly string[] | undefined, maximumItems: number) {
  const result: string[] = [];
  for (const value of values ?? []) {
    const normalized = value.trim();
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= maximumItems) break;
  }
  return Object.freeze(result);
}

/** Constructs the bounded, explainable recommendation object used by every recommender. */
export function createRecommendation(input: RecommendationInput): Recommendation {
  return Object.freeze({
    ...input,
    addedTravelMinutes: Number.isFinite(input.addedTravelMinutes)
      ? Math.max(0, Math.round(input.addedTravelMinutes))
      : 0,
    score: normalizeRecommendationScore(input.score),
    reasons: uniqueBoundedStrings(input.reasons, 3),
    evidenceIds: uniqueBoundedStrings(input.evidenceIds, 24),
    status: input.status ?? "PROPOSED",
  });
}

export function isAnchorItem(item: ItineraryItem): item is AnchorItineraryItem {
  return item.kind === "ANCHOR";
}

export function isFillerItem(item: ItineraryItem): item is FillerItineraryItem {
  return item.kind === "FILLER";
}
