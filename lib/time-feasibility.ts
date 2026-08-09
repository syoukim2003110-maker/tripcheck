import type { MobilityProfile } from "./destinations.ts";
import { straightLineDistanceKm, type RouteStop } from "./route-optimizer.ts";

export type TransportMode = "walk" | "transit" | "taxi";
/** "auto" recommends the fastest sane mode; "car" plans the trip around a rental car. */
export type TravelPreference = "auto" | "car";

export type ModeEstimate = { mode: TransportMode; minutes: number; source?: "estimate" | "live" };
export type ModeComparison = {
  options: ModeEstimate[];
  fastest: ModeEstimate;
  recommended: ModeEstimate;
};

function roundUpFive(value: number) {
  return Math.ceil(value / 5) * 5;
}

/*
 * Straight-line km → door-to-door minutes, tiered so long legs use the fast
 * networks that actually exist (rapid/limited-express rail, expressways)
 * instead of extrapolating a city crawl. Each tier's slope is min/km for the
 * kilometres that fall inside it.
 */
function tieredMinutes(distanceKm: number, overhead: number, tiers: Array<[limitKm: number, minutesPerKm: number]>) {
  let minutes = overhead;
  let covered = 0;
  for (const [limitKm, minutesPerKm] of tiers) {
    const span = Math.min(distanceKm, limitKm) - covered;
    if (span <= 0) break;
    minutes += span * minutesPerKm;
    covered = limitKm;
  }
  return minutes;
}

function transitEstimate(distanceKm: number) {
  // 12 min access/wait; ~11 km/h short hop, ~26 km/h urban rail, ~48 km/h
  // regional, ~83 km/h limited express, ~170 km/h shinkansen-class beyond.
  const minutes = tieredMinutes(distanceKm, 12, [[3, 5.5], [15, 2.3], [60, 1.25], [150, 0.72], [Infinity, 0.35]]);
  return Math.max(10, roundUpFive(minutes));
}

function driveEstimate(distanceKm: number) {
  // 8 min pickup/parking; ~20 km/h city, ~30 km/h arterial, ~50 km/h open
  // road, ~75 km/h expressway.
  const minutes = tieredMinutes(distanceKm, 8, [[5, 3], [15, 2], [60, 1.2], [Infinity, 0.8]]);
  return Math.max(8, roundUpFive(minutes));
}

/*
 * The default recommendation is the shortest sane door-to-door option: walk
 * when it is genuinely short (or outright fastest), otherwise transit or a car
 * depending on which one the destination actually rewards. Where rail is dense
 * (Japan, Switzerland) the train wins once waiting, parking and cost are real;
 * where it is thin (Iceland, most of the USA) a bus connection that only exists
 * on paper should not be presented as the plan. With a rental car, every leg is
 * driven unless walking is quicker than moving the car.
 */
function pickRecommended(
  options: ModeEstimate[],
  preference: TravelPreference,
  mobility: MobilityProfile,
): ModeEstimate {
  const walk = options.find((option) => option.mode === "walk")!;
  const transit = options.find((option) => option.mode === "transit")!;
  const taxi = options.find((option) => option.mode === "taxi")!;
  if (preference === "car") return walk.minutes <= Math.min(10, taxi.minutes) ? walk : taxi;
  if (walk.minutes <= 25 || (walk.minutes <= transit.minutes && walk.minutes <= taxi.minutes)) return walk;
  // How many minutes slower transit may be and still be the better answer.
  // `transit_first` keeps the long-standing +10: waiting, parking and cost
  // make a marginally slower train the better plan where rail is dense.
  const transitAllowance = mobility === "transit_first" ? 10 : mobility === "balanced" ? 5 : -15;
  if (transit.minutes <= taxi.minutes + transitAllowance) return transit;
  return taxi;
}

function finalizeComparison(
  options: ModeEstimate[],
  preference: TravelPreference,
  mobility: MobilityProfile,
): ModeComparison {
  const fastest = options.reduce((best, option) => option.minutes < best.minutes ? option : best);
  return { options, fastest, recommended: pickRecommended(options, preference, mobility) };
}

export function estimateTravelOptions(
  from: RouteStop,
  to: RouteStop,
  preference: TravelPreference = "auto",
  mobility: MobilityProfile = "transit_first",
): ModeComparison {
  const distanceKm = straightLineDistanceKm(from, to);
  const options: ModeEstimate[] = [
    { mode: "walk", minutes: Math.max(5, roundUpFive(5 + distanceKm / 4.5 * 60)) },
    { mode: "transit", minutes: transitEstimate(distanceKm) },
    { mode: "taxi", minutes: driveEstimate(distanceKm) },
  ];
  return finalizeComparison(options, preference, mobility);
}

export function applyLiveTransitMinutes(
  comparison: ModeComparison,
  minutes?: number,
  walkingMinutes?: number,
  drivingMinutes?: number,
  preference: TravelPreference = "auto",
  mobility: MobilityProfile = "transit_first",
) {
  const hasTransit = typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0;
  const hasWalking = typeof walkingMinutes === "number" && Number.isFinite(walkingMinutes) && walkingMinutes > 0;
  const hasDriving = typeof drivingMinutes === "number" && Number.isFinite(drivingMinutes) && drivingMinutes > 0;
  if (!hasTransit && !hasWalking && !hasDriving) return finalizeComparison(comparison.options, preference, mobility);
  const options = comparison.options.map((option): ModeEstimate => {
    if (option.mode === "transit" && hasTransit) return { ...option, minutes: Math.round(minutes!), source: "live" };
    if (option.mode === "walk" && hasWalking) return { ...option, minutes: Math.round(walkingMinutes!), source: "live" };
    if (option.mode === "taxi" && hasDriving) return { ...option, minutes: Math.round(drivingMinutes!), source: "live" };
    return { ...option, source: option.source ?? "estimate" };
  });
  return finalizeComparison(options, preference, mobility);
}
