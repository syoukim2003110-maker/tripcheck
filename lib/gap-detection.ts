import type { BuiltPlanDay } from "./trip-builder.ts";
import type { TripFitDay } from "./trip-scenarios.ts";

export type GapKind = "BEFORE_FIRST_ANCHOR" | "BETWEEN_ANCHORS" | "BEFORE_HOTEL_RETURN";
export type GapSizeBand = "BELOW_MINIMUM" | "SHORT_30_TO_59" | "MEDIUM_60_TO_119" | "LONG_120_PLUS";
/** ATTRACTION opens the normal tourist-spot categories; the spec grants it to the 120+ band only. */
export type GapSuggestionKind = "CAFE" | "BAKERY" | "PARK" | "LOOKOUT" | "SMALL_FACILITY" | "WALK" | "CAFE_AND_WALK" | "ATTRACTION";

export type GapCoordinate = Readonly<{ latitude: number; longitude: number }>;

export type GapScheduledAnchor = Readonly<{
  id: string;
  startAt: string;
  endAt: string;
  coordinate: GapCoordinate;
  /** Travel and wayfinding time already required immediately before this item. */
  travelFromPreviousMinutes: number;
}>;

export type GapDetectionDay = Readonly<{
  dayIndex: number;
  startAt: string;
  /** Used only when availableMinutes is absent and the day does not cross midnight. */
  usableUntil: string;
  /** Removes ambiguity for airport cutoffs and days that cross midnight. */
  availableMinutes?: number;
  startCoordinate: GapCoordinate | null;
  endCoordinate: GapCoordinate | null;
  returnTravelMinutes: number;
  anchors: readonly GapScheduledAnchor[];
}>;

export type ItineraryGap = Readonly<{
  id: string;
  dayIndex: number;
  kind: GapKind;
  sizeBand: Extract<GapSizeBand, "SHORT_30_TO_59" | "MEDIUM_60_TO_119" | "LONG_120_PLUS">;
  startAt: string;
  endAt: string;
  availableMinutes: number;
  previousAnchorId: string | null;
  nextAnchorId: string | null;
  routeSegment: Readonly<{ from: GapCoordinate | null; to: GapCoordinate | null }>;
  suggestionKinds: readonly GapSuggestionKind[];
}>;

export type BuiltDayGapOptions = Readonly<{
  dayIndex?: number;
  transferBufferMinutes?: number;
}>;

const shortSuggestions = Object.freeze(["CAFE", "BAKERY", "PARK", "LOOKOUT"] as const);
const mediumSuggestions = Object.freeze(["SMALL_FACILITY", "WALK", "CAFE_AND_WALK"] as const);
// Spec band table: at 120+ minutes the normal tourist-spot categories join
// the medium set (通常観光スポットも候補).
const longSuggestions = Object.freeze(["ATTRACTION", "SMALL_FACILITY", "WALK", "CAFE_AND_WALK"] as const);

/** Spec §gap bands: 30–59 / 60–119 / 120+. Exactly 120 belongs to the long band. */
export function classifyGapMinutes(minutes: number): GapSizeBand {
  if (!Number.isFinite(minutes) || minutes < 30) return "BELOW_MINIMUM";
  if (minutes < 60) return "SHORT_30_TO_59";
  if (minutes < 120) return "MEDIUM_60_TO_119";
  return "LONG_120_PLUS";
}

function parseClock(value: string) {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clockAt(absoluteMinutes: number) {
  const normalized = ((Math.round(absoluteMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function unwrapClock(value: string, notBefore: number) {
  const parsed = parseClock(value);
  if (parsed === null) return null;
  let result = parsed;
  while (result < notBefore) result += 1440;
  return result;
}

function boundedMinutes(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function gapId(
  dayIndex: number,
  kind: GapKind,
  previousAnchorId: string | null,
  nextAnchorId: string | null,
  start: number,
  end: number,
) {
  return `gap:${dayIndex}:${kind}:${previousAnchorId ?? "start"}:${nextAnchorId ?? "end"}:${start}:${end}`;
}

function buildGap(input: {
  dayIndex: number;
  kind: GapKind;
  start: number;
  end: number;
  previousAnchorId: string | null;
  nextAnchorId: string | null;
  from: GapCoordinate | null;
  to: GapCoordinate | null;
}): ItineraryGap | null {
  const availableMinutes = Math.max(0, Math.round(input.end - input.start));
  const sizeBand = classifyGapMinutes(availableMinutes);
  if (sizeBand === "BELOW_MINIMUM") return null;
  return Object.freeze({
    id: gapId(input.dayIndex, input.kind, input.previousAnchorId, input.nextAnchorId, input.start, input.end),
    dayIndex: input.dayIndex,
    kind: input.kind,
    sizeBand,
    startAt: clockAt(input.start),
    endAt: clockAt(input.end),
    availableMinutes,
    previousAnchorId: input.previousAnchorId,
    nextAnchorId: input.nextAnchorId,
    routeSegment: Object.freeze({ from: input.from, to: input.to }),
    suggestionKinds: sizeBand === "SHORT_30_TO_59"
      ? shortSuggestions
      : sizeBand === "MEDIUM_60_TO_119" ? mediumSuggestions : longSuggestions,
  });
}

/**
 * Finds every 30-minute-or-longer gap. The size band (30–59 / 60–119 / 120+)
 * decides which suggestion categories the recommendation search may use; the
 * 120+ band additionally opens the normal tourist-spot categories.
 */
export function detectItineraryGaps(day: GapDetectionDay): ItineraryGap[] {
  const dayStart = parseClock(day.startAt);
  if (dayStart === null || day.anchors.length === 0) return [];
  const parsedEnd = parseClock(day.usableUntil);
  const dayEnd = day.availableMinutes === undefined
    ? parsedEnd !== null && parsedEnd >= dayStart ? parsedEnd : dayStart
    : dayStart + boundedMinutes(day.availableMinutes);
  const gaps: ItineraryGap[] = [];
  let previousEnd = dayStart;
  let previousAnchor: GapScheduledAnchor | null = null;

  for (const anchor of day.anchors) {
    const arrival = unwrapClock(anchor.startAt, previousEnd);
    if (arrival === null) continue;
    const earliestArrival = previousEnd + boundedMinutes(anchor.travelFromPreviousMinutes);
    const gap = buildGap({
      dayIndex: day.dayIndex,
      kind: previousAnchor ? "BETWEEN_ANCHORS" : "BEFORE_FIRST_ANCHOR",
      start: earliestArrival,
      end: arrival,
      previousAnchorId: previousAnchor?.id ?? null,
      nextAnchorId: anchor.id,
      from: previousAnchor?.coordinate ?? day.startCoordinate,
      to: anchor.coordinate,
    });
    if (gap) gaps.push(gap);
    const departure = unwrapClock(anchor.endAt, arrival);
    previousEnd = departure ?? arrival;
    previousAnchor = anchor;
  }

  if (previousAnchor) {
    const latestReturnDeparture = dayEnd - boundedMinutes(day.returnTravelMinutes);
    const gap = buildGap({
      dayIndex: day.dayIndex,
      kind: "BEFORE_HOTEL_RETURN",
      start: previousEnd,
      end: latestReturnDeparture,
      previousAnchorId: previousAnchor.id,
      nextAnchorId: null,
      from: previousAnchor.coordinate,
      to: day.endCoordinate,
    });
    if (gap) gaps.push(gap);
  }

  // The builder supplies anchors in visit order, so insertion order is the
  // chronological order. Do not sort by display clocks: 00:15 follows 23:45
  // on an overnight day even though its wall-clock number is smaller.
  return gaps;
}

/**
 * The one gap a day is allowed to surface (the spec's per-day cap).
 *
 * This used to be `gaps[0]` — the first hole in visit order. That picks by
 * position rather than by what the traveller would notice: a day with a
 * 35-minute wait before its first stop and a 6-hour hole after its last one
 * offered a cafe for the 35 minutes and said nothing about the afternoon.
 * The biggest hole wins instead, and visit order only breaks ties, so the
 * choice stays deterministic and stable across rebuilds.
 */
export function primaryItineraryGap(gaps: readonly ItineraryGap[]): ItineraryGap | null {
  let best: ItineraryGap | null = null;
  for (const gap of gaps) {
    if (!best || gap.availableMinutes > best.availableMinutes) best = gap;
  }
  return best;
}

/** Thin adapter over the existing deterministic BuiltPlanDay/TripFitDay output. */
export function detectGapsFromBuiltDay(
  day: BuiltPlanDay,
  fitDay: TripFitDay,
  options: BuiltDayGapOptions = {},
) {
  const transferBufferMinutes = boundedMinutes(options.transferBufferMinutes ?? 10);
  return detectItineraryGaps({
    dayIndex: options.dayIndex ?? fitDay.dayIndex,
    startAt: day.startTime,
    usableUntil: fitDay.usableUntil,
    availableMinutes: fitDay.availableMinutes,
    startCoordinate: day.startBase
      ? { latitude: day.startBase.latitude, longitude: day.startBase.longitude }
      : null,
    endCoordinate: day.endBase
      ? { latitude: day.endBase.latitude, longitude: day.endBase.longitude }
      : null,
    returnTravelMinutes: day.hotelInboundMinutes ?? 0,
    anchors: day.stops.map((builtStop, index) => ({
      id: builtStop.stop.id,
      startAt: builtStop.arrival,
      endAt: builtStop.departure,
      coordinate: { latitude: builtStop.stop.latitude, longitude: builtStop.stop.longitude },
      travelFromPreviousMinutes: index === 0
        ? (day.hotelOutboundMinutes ?? 0) + (day.startBase ? transferBufferMinutes : 0)
        : day.legs[index - 1].comparison.recommended.minutes + transferBufferMinutes,
    })),
  });
}
