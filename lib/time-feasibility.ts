import type { Locale } from "./i18n.ts";
import { resolveKnownStops, straightLineDistanceKm, type RouteStop } from "./route-optimizer.ts";

export type TimeLegStatus = "conflict" | "tight" | "comfortable" | "unknown";
export type TravelEstimateMode = "walk" | "transit" | "unknown";
export type TransportMode = "walk" | "transit" | "taxi";

export type ModeEstimate = { mode: TransportMode; minutes: number; source?: "estimate" | "live" };
export type ModeComparison = {
  options: ModeEstimate[];
  fastest: ModeEstimate;
  recommended: ModeEstimate;
};

export type TimedStop = {
  time: string;
  timeMinutes: number;
  name: string;
  stayMinutes: number;
  stayIsCustom: boolean;
  isAnchor: boolean;
  knownStop: RouteStop | null;
};

export type TimeLeg = {
  from: TimedStop;
  to: TimedStop;
  availableMinutes: number;
  travelMinutes: number | null;
  travelMode: TravelEstimateMode;
  requiredMinutes: number;
  bufferMinutes: number;
  status: TimeLegStatus;
};

export type TimeFeasibilityDay = {
  label: string;
  stops: TimedStop[];
  legs: TimeLeg[];
  conflictCount: number;
  tightCount: number;
  daySpanMinutes: number;
  estimatedFinish: string;
};

export type TimeFeasibility = {
  timedStopCount: number;
  knownLegCount: number;
  conflictCount: number;
  tightCount: number;
  longestDayMinutes: number;
  days: TimeFeasibilityDay[];
};

function dayHeading(line: string) {
  return /^(?:day\s*\d+|\d+\s*日目|\d+\s*일차|第?\s*\d+\s*天)(?:\s*[-–—:].*)?$/i.test(line);
}

function defaultDay(locale: Locale) {
  if (locale === "ja") return "1日目";
  if (locale === "ko") return "1일차";
  if (locale === "zh") return "第1天";
  return "Day 1";
}

function parseTime(line: string) {
  const match = line.match(/^(?:[-•]\s*)?(\d{1,2})(?::|\.)(\d{2})\s*(?:[-–—:]\s*)?(.+)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return {
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    timeMinutes: hour * 60 + minute,
    name: match[3].trim(),
  };
}

function customStayMinutes(line: string) {
  const patterns = [
    /\b(?:stay|duration)\s*[:=]?\s*(\d{1,3})\s*(?:m|min|mins|minutes)\b/i,
    /滞在\s*[:：]?\s*(\d{1,3})\s*分/,
    /(?:체류|관람)\s*[:：]?\s*(\d{1,3})\s*분/,
    /(?:停留|游览)\s*[:：]?\s*(\d{1,3})\s*分钟/,
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(line)?.[1];
    if (value) return Math.min(480, Math.max(10, Number(value)));
  }
  return null;
}

function roundUpFive(value: number) {
  return Math.ceil(value / 5) * 5;
}

export function estimateTravelMinutes(from: RouteStop, to: RouteStop) {
  const comparison = estimateTravelOptions(from, to);
  const recommended = comparison.recommended;
  return { minutes: recommended.minutes, mode: recommended.mode === "walk" ? "walk" as const : "transit" as const };
}

export function estimateTravelOptions(from: RouteStop, to: RouteStop): ModeComparison {
  const distanceKm = straightLineDistanceKm(from, to);
  const options: ModeEstimate[] = [
    { mode: "walk", minutes: Math.max(5, roundUpFive(5 + distanceKm / 4.5 * 60)) },
    { mode: "transit", minutes: Math.max(10, roundUpFive(12 + distanceKm * 2.8)) },
    { mode: "taxi", minutes: Math.max(8, roundUpFive(6 + distanceKm * 2.2)) },
  ];
  const fastest = options.reduce((best, option) => option.minutes < best.minutes ? option : best);
  const walk = options.find((option) => option.mode === "walk")!;
  const transit = options.find((option) => option.mode === "transit")!;
  const taxi = options.find((option) => option.mode === "taxi")!;
  const recommended = walk.minutes <= 25 ? walk : taxi.minutes + 15 < transit.minutes ? taxi : transit;
  return { options, fastest, recommended };
}

export function applyLiveTransitMinutes(comparison: ModeComparison, minutes?: number, walkingMinutes?: number) {
  const hasTransit = typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0;
  const hasWalking = typeof walkingMinutes === "number" && Number.isFinite(walkingMinutes) && walkingMinutes > 0;
  if (!hasTransit && !hasWalking) return comparison;
  const options = comparison.options.map((option): ModeEstimate => {
    if (option.mode === "transit" && hasTransit) return { ...option, minutes: Math.round(minutes!), source: "live" };
    if (option.mode === "walk" && hasWalking) return { ...option, minutes: Math.round(walkingMinutes!), source: "live" };
    return { ...option, source: option.source ?? "estimate" };
  });
  const fastest = options.reduce((best, option) => option.minutes < best.minutes ? option : best);
  const walk = options.find((option) => option.mode === "walk")!;
  const transit = options.find((option) => option.mode === "transit")!;
  const taxi = options.find((option) => option.mode === "taxi")!;
  const recommended = walk.minutes <= 25 ? walk : taxi.minutes + 15 < transit.minutes ? taxi : transit;
  return { options, fastest, recommended };
}

function formatMinutesAsTime(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function buildDay(label: string, stops: TimedStop[]): TimeFeasibilityDay {
  const legs = stops.slice(0, -1).map((from, index): TimeLeg => {
    const to = stops[index + 1];
    const availableMinutes = to.timeMinutes - from.timeMinutes;
    const estimate = from.knownStop && to.knownStop ? estimateTravelMinutes(from.knownStop, to.knownStop) : null;
    const travelMinutes = estimate?.minutes ?? null;
    const requiredMinutes = from.stayMinutes + (travelMinutes ?? 0);
    const bufferMinutes = availableMinutes - requiredMinutes;
    let status: TimeLegStatus;
    if (availableMinutes < 0 || bufferMinutes < 0) status = "conflict";
    else if (!estimate) status = "unknown";
    else if (bufferMinutes < 25) status = "tight";
    else status = "comfortable";
    return {
      from,
      to,
      availableMinutes,
      travelMinutes,
      travelMode: estimate?.mode ?? "unknown",
      requiredMinutes,
      bufferMinutes,
      status,
    };
  });

  const first = stops[0];
  const last = stops.at(-1)!;
  const finishMinutes = last.timeMinutes + last.stayMinutes;
  return {
    label,
    stops,
    legs,
    conflictCount: legs.filter((leg) => leg.status === "conflict").length,
    tightCount: legs.filter((leg) => leg.status === "tight").length,
    daySpanMinutes: Math.max(0, finishMinutes - first.timeMinutes),
    estimatedFinish: formatMinutesAsTime(finishMinutes),
  };
}

export function analyzeTimeFeasibility(raw: string, locale: Locale = "en"): TimeFeasibility {
  const parsedDays: Array<{ label: string; stops: TimedStop[] }> = [];
  let current = { label: defaultDay(locale), stops: [] as TimedStop[] };

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (dayHeading(line)) {
      if (current.stops.length > 0) parsedDays.push(current);
      current = { label: line.replace(/\s*[-–—:].*$/, ""), stops: [] };
      continue;
    }
    const parsed = parseTime(line);
    if (!parsed) continue;
    const knownStop = resolveKnownStops(parsed.name, locale)[0] ?? null;
    const customStay = customStayMinutes(parsed.name);
    current.stops.push({
      ...parsed,
      stayMinutes: customStay ?? knownStop?.planningDurationMinutes ?? 60,
      stayIsCustom: customStay !== null,
      isAnchor: knownStop?.isAnchor ?? false,
      knownStop,
    });
  }
  if (current.stops.length > 0) parsedDays.push(current);

  const days = parsedDays.filter((day) => day.stops.length >= 2).map((day) => buildDay(day.label, day.stops));
  return {
    timedStopCount: parsedDays.reduce((sum, day) => sum + day.stops.length, 0),
    knownLegCount: days.reduce((sum, day) => sum + day.legs.filter((leg) => leg.travelMinutes !== null).length, 0),
    conflictCount: days.reduce((sum, day) => sum + day.conflictCount, 0),
    tightCount: days.reduce((sum, day) => sum + day.tightCount, 0),
    longestDayMinutes: Math.max(0, ...days.map((day) => day.daySpanMinutes)),
    days,
  };
}
