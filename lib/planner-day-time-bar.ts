import type { BuiltPlanDay } from "./trip-builder.ts";
import type { TripFitDay } from "./trip-scenarios.ts";

export type PlannerDayTimeBarLocale = "en" | "ja";

export type PlannerDayTimeBarDay = Pick<
  BuiltPlanDay,
  | "startTime"
  | "finishTime"
  | "stops"
  | "legs"
  | "hotelTravelMinutes"
  | "deadlineOverrunMinutes"
>;

export type PlannerDayTimeBarFit = Pick<
  TripFitDay,
  "availableMinutes" | "slackMinutes"
>;

export type PlannerDayTimeSegmentKind = "visit" | "travel" | "slack";

export type PlannerDayTimeSegment = {
  kind: PlannerDayTimeSegmentKind;
  minutes: number;
  percentage: number;
};

export type PlannerDayTimeMarker = {
  id: string;
  kind: "reservation" | "conflict";
  label: string;
  positionPercentage: number;
  stopIndex: number | null;
};

export type PlannerDayTimeBarModel = {
  availableMinutes: number;
  plannedMinutes: number;
  visitMinutes: number;
  travelMinutes: number;
  slackMinutes: number;
  overrunMinutes: number;
  segments: PlannerDayTimeSegment[];
  markers: PlannerDayTimeMarker[];
  isEmpty: boolean;
  hasConflict: boolean;
};

const MINUTES_PER_DAY = 24 * 60;
const MAX_VISIT_MINUTES = 12 * 60;
const conflictOpeningStatuses = new Set([
  "conflict",
  "closed_day",
  "last_entry_conflict",
]);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeMinutes(value: unknown, maximum = MINUTES_PER_DAY) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return clamp(Math.round(value), 0, maximum);
}

function safeSignedMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return clamp(Math.round(value), -MINUTES_PER_DAY, MINUTES_PER_DAY);
}

function clockMinutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function clockSpan(start: unknown, end: unknown) {
  const startMinutes = clockMinutes(start);
  const endMinutes = clockMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return 0;
  const difference = endMinutes >= startMinutes
    ? endMinutes - startMinutes
    : MINUTES_PER_DAY - startMinutes + endMinutes;
  return clamp(difference, 0, MAX_VISIT_MINUTES);
}

function roundedPercentages(values: readonly number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);

  let assigned = 0;
  return values.map((value, index) => {
    if (index === values.length - 1) return Number((100 - assigned).toFixed(3));
    const percentage = Number(((value / total) * 100).toFixed(3));
    assigned += percentage;
    return percentage;
  });
}

function elapsedFromStart(start: number, value: number) {
  return value >= start ? value - start : MINUTES_PER_DAY - start + value;
}

function markerPosition(
  day: PlannerDayTimeBarDay,
  clock: string | null,
  stopIndex: number,
  availableMinutes: number,
) {
  const start = clockMinutes(day.startTime) ?? clockMinutes(day.stops[0]?.arrival);
  const marker = clockMinutes(clock);
  if (start !== null && marker !== null && availableMinutes > 0) {
    return Number(clamp((elapsedFromStart(start, marker) / availableMinutes) * 100, 0, 100).toFixed(3));
  }

  // Invalid clock data must not remove a consequential marker. An evenly
  // distributed fallback stays finite and preserves the visit order.
  return Number((((stopIndex + 1) / (day.stops.length + 1)) * 100).toFixed(3));
}

/**
 * Converts one built day into visit, travel, and slack proportions. The fit
 * window remains authoritative for spare/overrun time; stop clocks and route
 * legs own visit/travel time.
 *
 * A small gap can exist between explicit legs and the fit engine's planned
 * duration because the engine also includes transfer buffers. That remainder
 * is assigned to travel so the bar represents the whole usable window without
 * inventing additional visit time.
 */
export function buildPlannerDayTimeBarModel(
  day: PlannerDayTimeBarDay,
  fit?: PlannerDayTimeBarFit | null,
): PlannerDayTimeBarModel {
  const visitMinutes = clamp(day.stops.reduce(
    (sum, stop) => sum + clockSpan(stop.arrival, stop.departure),
    0,
  ), 0, MINUTES_PER_DAY);

  const explicitTravelMinutes = clamp(
    day.legs.reduce(
      (sum, leg) => sum + safeMinutes(leg.comparison?.recommended?.minutes),
      0,
    ) + safeMinutes(day.hotelTravelMinutes),
    0,
    MINUTES_PER_DAY,
  );

  const availableMinutes = safeMinutes(fit?.availableMinutes);
  const signedSlackMinutes = safeSignedMinutes(fit?.slackMinutes);
  const slackMinutes = availableMinutes > 0
    ? clamp(Math.max(0, signedSlackMinutes), 0, availableMinutes)
    : Math.max(0, signedSlackMinutes);
  const overrunMinutes = Math.max(0, -signedSlackMinutes);

  // available - slack is the deterministic engine's planned duration. It
  // includes route buffers that are not represented by an individual leg.
  const fitPlannedMinutes = availableMinutes > 0
    ? Math.max(0, availableMinutes - signedSlackMinutes)
    : 0;
  const travelMinutes = clamp(Math.max(
    explicitTravelMinutes,
    fitPlannedMinutes - visitMinutes,
  ), 0, MINUTES_PER_DAY);
  const plannedMinutes = clamp(visitMinutes + travelMinutes, 0, MINUTES_PER_DAY);

  const percentages = roundedPercentages([visitMinutes, travelMinutes, slackMinutes]);
  const segments: PlannerDayTimeSegment[] = (["visit", "travel", "slack"] as const).map((kind, index) => ({
    kind,
    minutes: [visitMinutes, travelMinutes, slackMinutes][index],
    percentage: percentages[index],
  }));

  const markers: PlannerDayTimeMarker[] = [];
  day.stops.forEach((stop, stopIndex) => {
    const positionClock = stop.fixedTime ?? stop.arrival;
    const positionPercentage = markerPosition(day, positionClock, stopIndex, availableMinutes || plannedMinutes + slackMinutes);
    if (stop.isReservation) {
      markers.push({
        id: `reservation-${stopIndex}`,
        kind: "reservation",
        label: stop.stop.name,
        positionPercentage,
        stopIndex,
      });
    }

    if (stop.reservationLateMinutes > 0 || conflictOpeningStatuses.has(stop.openingStatus)) {
      markers.push({
        id: `conflict-${stopIndex}`,
        kind: "conflict",
        label: stop.stop.name,
        positionPercentage,
        stopIndex,
      });
    }
  });

  if (safeMinutes(day.deadlineOverrunMinutes) > 0) {
    markers.push({
      id: "deadline-conflict",
      kind: "conflict",
      label: "deadline",
      positionPercentage: 100,
      stopIndex: null,
    });
  }

  return {
    availableMinutes,
    plannedMinutes,
    visitMinutes,
    travelMinutes,
    slackMinutes,
    overrunMinutes,
    segments,
    markers,
    isEmpty: visitMinutes + travelMinutes + slackMinutes === 0,
    hasConflict: markers.some((marker) => marker.kind === "conflict") || overrunMinutes > 0,
  };
}

export function formatPlannerDayTimeDuration(
  minutes: number,
  locale: PlannerDayTimeBarLocale,
) {
  const safe = safeMinutes(minutes);
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  if (locale === "ja") {
    if (hours === 0) return `${remainder}分`;
    return remainder === 0 ? `${hours}時間` : `${hours}時間${remainder}分`;
  }
  if (hours === 0) return `${remainder} min`;
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
}

export function plannerDayTimeBarAriaLabel(
  model: PlannerDayTimeBarModel,
  locale: PlannerDayTimeBarLocale,
) {
  const reservations = model.markers.filter((marker) => marker.kind === "reservation").length;
  const conflicts = model.markers.filter((marker) => marker.kind === "conflict").length;
  if (locale === "ja") {
    return [
      `1日の時間配分。訪問${formatPlannerDayTimeDuration(model.visitMinutes, locale)}`,
      `移動${formatPlannerDayTimeDuration(model.travelMinutes, locale)}`,
      `余裕${formatPlannerDayTimeDuration(model.slackMinutes, locale)}`,
      `利用可能${formatPlannerDayTimeDuration(model.availableMinutes, locale)}`,
      reservations > 0 ? `予約マーカー${reservations}件` : null,
      conflicts > 0 || model.overrunMinutes > 0
        ? `衝突${Math.max(conflicts, model.overrunMinutes > 0 ? 1 : 0)}件`
        : null,
    ].filter(Boolean).join("、") + "。";
  }
  const conflictCount = Math.max(conflicts, model.overrunMinutes > 0 ? 1 : 0);
  return [
    `Day time allocation: ${formatPlannerDayTimeDuration(model.visitMinutes, locale)} visiting`,
    `${formatPlannerDayTimeDuration(model.travelMinutes, locale)} travelling`,
    `${formatPlannerDayTimeDuration(model.slackMinutes, locale)} spare`,
    `${formatPlannerDayTimeDuration(model.availableMinutes, locale)} available`,
    reservations > 0 ? `${reservations} reservation marker${reservations === 1 ? "" : "s"}` : null,
    conflictCount > 0
      ? `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean).join(", ") + ".";
}
