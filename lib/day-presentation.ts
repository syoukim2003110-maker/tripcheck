import {
  buildPlannerDayTimeBarModel,
  type PlannerDayTimeBarDay,
  type PlannerDayTimeBarFit,
} from "./planner-day-time-bar.ts";

/**
 * Single presentation source for one built day (v1.1 spec §4.1 / TC-001).
 *
 * Every user-facing rendering of the day's clock range and used/free minutes
 * must read this model instead of recomputing from raw plan pieces, so the
 * header, summary metrics, print sheet and timeline can never disagree. When
 * the underlying numbers contradict each other the model reports
 * `consistency: "invalid"` with a diagnostic id, and callers must show the
 * fallback instead of presenting contradictory times as a normal itinerary.
 */
export type DayPresentation = {
  startClock: string;
  endClock: string;
  /** Last stop departure, when it exists; header end otherwise. */
  finalTimelineClock: string;
  usedMinutes: number;
  availableMinutes: number;
  travelMinutes: number;
  visitMinutes: number;
  slackMinutes: number;
  overrunMinutes: number;
  stopCount: number;
  isEmpty: boolean;
  consistency: "valid" | "invalid";
  /** Stable machine-readable reason codes behind an invalid verdict. */
  issues: DayPresentationIssue[];
  /** Compact id for logs and the user-facing fallback card. */
  diagnosticId: string | null;
};

export type DayPresentationIssue =
  | "zero_span_with_stops"
  | "used_exceeds_available_without_overrun"
  | "timeline_ends_after_header"
  | "invalid_clock";

const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;
const MINUTES_PER_DAY = 24 * 60;

function clockMinutes(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = CLOCK_PATTERN.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function forwardSpan(start: number, end: number) {
  return end >= start ? end - start : MINUTES_PER_DAY - start + end;
}

export function buildDayPresentation(
  day: PlannerDayTimeBarDay,
  fit: PlannerDayTimeBarFit | null | undefined,
  options: { dayIndex?: number } = {},
): DayPresentation {
  const model = buildPlannerDayTimeBarModel(day, fit ?? null);
  const issues: DayPresentationIssue[] = [];

  const startClock = day.startTime;
  const endClock = day.finishTime;
  const lastStop = day.stops[day.stops.length - 1] ?? null;
  const finalTimelineClock = lastStop?.departure ?? endClock;

  const startMinutes = clockMinutes(startClock);
  const endMinutes = clockMinutes(endClock);
  const finalMinutes = clockMinutes(finalTimelineClock);

  if (startMinutes === null || endMinutes === null) {
    issues.push("invalid_clock");
  }

  // SHOT-P0-01: a day that claims 09:00–09:00 while listing visits.
  if (
    day.stops.length > 0
    && startMinutes !== null
    && endMinutes !== null
    && forwardSpan(startMinutes, endMinutes) === 0
  ) {
    issues.push("zero_span_with_stops");
  }

  // Used time larger than the whole window while claiming spare time left.
  if (
    model.availableMinutes > 0
    && model.plannedMinutes > model.availableMinutes
    && model.overrunMinutes === 0
  ) {
    issues.push("used_exceeds_available_without_overrun");
  }

  // The visible timeline must not continue past the advertised day end while
  // the day still claims to fit. A declared overrun is consistent — the plan
  // admits it runs long — so only the silent contradiction is flagged.
  if (
    startMinutes !== null
    && endMinutes !== null
    && finalMinutes !== null
    && day.stops.length > 0
    && model.overrunMinutes === 0
    && forwardSpan(startMinutes, finalMinutes) > forwardSpan(startMinutes, endMinutes)
  ) {
    issues.push("timeline_ends_after_header");
  }

  const consistency = issues.length === 0 ? "valid" : "invalid";
  const dayNumber = (options.dayIndex ?? 0) + 1;
  return {
    startClock,
    endClock,
    finalTimelineClock,
    usedMinutes: model.plannedMinutes,
    availableMinutes: model.availableMinutes,
    travelMinutes: model.travelMinutes,
    visitMinutes: model.visitMinutes,
    slackMinutes: model.slackMinutes,
    overrunMinutes: model.overrunMinutes,
    stopCount: day.stops.length,
    isEmpty: model.isEmpty,
    consistency,
    issues,
    diagnosticId: consistency === "valid"
      ? null
      : `TC-TIME-D${dayNumber}-${issues.map((issue) => issue.split("_").map((part) => part[0]).join("").toUpperCase()).join(".")}`,
  };
}

export function dayPresentationFallbackCopy(
  presentation: DayPresentation,
  locale: "en" | "ja",
) {
  const id = presentation.diagnosticId ?? "TC-TIME";
  return locale === "ja"
    ? {
      title: "この日の時刻表示に内部矛盾があります",
      body: `矛盾した時刻をそのまま表示しないため、この日の時間表示を止めています。予定の内容と地図は引き続き使えます。診断ID: ${id}`,
    }
    : {
      title: "This day's times are internally inconsistent",
      body: `The time display for this day is withheld instead of showing contradictory numbers. The stops and map remain usable. Diagnostic id: ${id}`,
    };
}
