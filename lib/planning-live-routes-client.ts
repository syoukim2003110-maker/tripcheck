import type { Locale } from "./i18n.ts";
import { destinationAirport, destinationById, localDateTimeWithOffset, type MobilityProfile } from "./destinations.ts";
import type { LiveRouteCoordinate, LiveRouteResult, LiveRouteTravelMode, TransitStepSummary } from "./google-routes.ts";
import { decodeGooglePolyline } from "./google-polyline.ts";
import { estimateTravelOptions, type TravelPreference } from "./time-feasibility.ts";
import { straightLineDistanceKm, type RouteStop } from "./route-optimizer.ts";
import {
  allowedTransportModesForLeg,
  routeAccessEndpointsForLeg,
  type PoiAccessAssumption,
} from "./poi-access.ts";
import { routeLegKey, type BuiltTripPlan } from "./trip-builder.ts";
import { PLANNING_BUDGET } from "./planning-budget.ts";
import { tripRequestHeaders } from "./trip-request-identity.ts";
import {
  transitDepartureBucket,
  transitRequestKey,
  type SelectedTransitLegRequest,
  type TransitPlanIteration,
  type TransitProviderObservation,
} from "./transit-convergence.ts";

export class LiveRoutesError extends Error {
  code: "missing_date" | "not_configured" | "invalid_or_out_of_range" | "unavailable";

  constructor(code: LiveRoutesError["code"]) {
    super(code);
    this.code = code;
  }
}

export type PlanningRouteMode = "transit" | "walk" | "drive";

export type PlanningRouteLeg = {
  id: string;
  origin: LiveRouteCoordinate;
  destination: LiveRouteCoordinate;
  departureTime: string;
  mode: PlanningRouteMode;
  /** Present only when the provider endpoint differs from the itinerary POI. */
  routingEndpointKey?: string;
  accessAssumptions?: readonly PoiAccessAssumption[];
};

export type PlanningRouteResult = LiveRouteResult & {
  mode: PlanningRouteMode;
  departureTime: string;
  routingEndpointKey?: string;
  accessAssumptions?: readonly PoiAccessAssumption[];
};

export type PlanningRoutePrefetch = {
  provider: "google_maps";
  fetchedAt: string | null;
  legs: PlanningRouteResult[];
  transitMinutes: Record<string, number>;
  walkingMinutes: Record<string, number>;
  drivingMinutes: Record<string, number>;
  skippedLegCount: number;
};

export type PlanningRoutePrefetchOptions = {
  modes?: PlanningRouteMode[];
  concurrency?: number;
  maxLegs?: number;
  /** Request keys that are already measured and must not be re-requested. */
  excludeKeys?: Iterable<string>;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

export type PlanningTransitLegRequest = SelectedTransitLegRequest & Readonly<{
  origin: LiveRouteCoordinate;
  destination: LiveRouteCoordinate;
  /** Exact critical-fact ids that consume this bucketed provider result. */
  factIds: readonly string[];
  routingEndpointKey?: string;
  accessAssumptions?: readonly PoiAccessAssumption[];
}>;

export type PlanningTransitFetchOptions = {
  concurrency?: number;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

type LiveRoutesPayload = {
  provider?: unknown;
  fetchedAt?: unknown;
  legs?: unknown;
  code?: string;
};

function localeLanguageCode(locale: Locale) {
  return locale === "zh" ? "zh-CN" as const : locale;
}

function clockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function addDays(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function providerEndpointsForLeg(origin: RouteStop, destination: RouteStop) {
  const resolution = routeAccessEndpointsForLeg(origin, destination);
  if (resolution.status === "conditional" || !resolution.origin || !resolution.destination) return null;
  return {
    origin: resolution.origin.coordinate,
    destination: resolution.destination.coordinate,
    ...(resolution.status === "access_node" ? {
      routingEndpointKey: resolution.routingEndpointKey!,
      accessAssumptions: resolution.assumptions,
    } : {}),
  };
}

function providerTransitIdentity(legId: string, routingEndpointKey?: string) {
  return routingEndpointKey ? `${legId}@${routingEndpointKey}` : legId;
}

function timedPathForDay(plan: BuiltTripPlan, dayIndex: number) {
  const day = plan.days[dayIndex];
  const destinationProfile = destinationById(plan.destination);
  const scheduledStops = day.stops.map(({ stop }) => stop);
  // Days can start and end at different hotels when nightly bases are set.
  const startBase = day.startBase ?? plan.selectedBase;
  const endBase = day.endBase ?? startBase;
  const path = startBase
    ? [startBase, ...scheduledStops, endBase ?? startBase]
    : scheduledStops;
  if (path.length < 2) return [];
  if (!day.date) throw new LiveRoutesError("missing_date");

  const departureClocks = startBase
    ? [day.startTime, ...day.stops.map((stop) => stop.departure)]
    : day.stops.slice(0, -1).map((stop) => stop.departure);
  let previousClock: number | null = null;
  let dayOffset = 0;
  return path.slice(0, -1).flatMap((origin, index): PlanningRouteLeg[] => {
    const localTime = departureClocks[index];
    const currentClock = localTime ? clockMinutes(localTime) : null;
    if (currentClock === null) return [];
    if (previousClock !== null && currentClock < previousClock) dayOffset += 1;
    previousClock = currentClock;
    const localDate = addDays(day.date!, dayOffset);
    if (!localDate) return [];
    const destination = path[index + 1];
    const departureTime = localDateTimeWithOffset(localDate, localTime, destinationProfile.timeZone);
    if (!departureTime) return [];
    const endpoints = providerEndpointsForLeg(origin, destination);
    if (!endpoints) return [];
    const shared = {
      id: routeLegKey(origin.id, destination.id),
      ...endpoints,
      departureTime,
    };
    // The mode the schedule actually uses (including a per-leg user pick) is
    // always measured, even when the contender pruning would have skipped it.
    const scheduledLeg = startBase ? day.legs[index - 1] : day.legs[index];
    const scheduledMode: PlanningRouteMode[] = scheduledLeg
      ? [scheduledLeg.comparison.recommended.mode === "walk" ? "walk" : scheduledLeg.comparison.recommended.mode === "taxi" ? "drive" : "transit"]
      : [];
    const modes = [...new Set([...contenderModes(origin, destination, plan.travelPreference, destinationProfile.mobility), ...scheduledMode])];
    return modes.map((mode) => ({ ...shared, mode }));
  });
}

function shiftedClock(value: string, minutes: number) {
  const start = clockMinutes(value);
  if (start === null) return null;
  const total = start + minutes;
  const dayOffset = Math.floor(total / 1440);
  const normalized = ((total % 1440) + 1440) % 1440;
  return {
    time: `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`,
    dayOffset,
  };
}

function timedAirportLegs(plan: BuiltTripPlan): PlanningRouteLeg[] {
  if (!plan.selectedBase || plan.airportConstraints.length === 0) return [];
  const profile = destinationById(plan.destination);
  const mode: PlanningRouteMode = plan.travelPreference === "car" || profile.mobility === "car_first" ? "drive" : "transit";
  return plan.airportConstraints.flatMap((constraint): PlanningRouteLeg[] => {
    const airport = destinationAirport(profile, constraint.airport);
    if (!airport) return [];
    const dayIndex = constraint.direction === "arrival" ? 0 : Math.max(0, plan.days.length - 1);
    const baseDate = plan.days[dayIndex]?.date;
    if (!baseDate) return [];
    // Activity Day 1 may already be the day after a late arrival. Recover the
    // scheduled flight's calendar date before adding airport processing, or a
    // 23:30 arrival would be shifted twice (Sep 14 -> plan Sep 15 -> Sep 16).
    const flightDate = constraint.direction === "arrival"
      ? addDays(baseDate, -constraint.cityTimeDayOffset)
      : baseDate;
    if (!flightDate) return [];
    const shifted = constraint.direction === "arrival"
      ? shiftedClock(constraint.flightTime, constraint.airportMinutes)
      : { time: constraint.cityTime, dayOffset: constraint.cityTimeDayOffset };
    if (!shifted) return [];
    const date = addDays(flightDate, shifted.dayOffset);
    if (!date) return [];
    const departureTime = localDateTimeWithOffset(date, shifted.time, profile.timeZone);
    if (!departureTime) return [];
    const airportCoordinate = { latitude: airport.latitude, longitude: airport.longitude };
    const baseCoordinate = { latitude: plan.selectedBase!.latitude, longitude: plan.selectedBase!.longitude };
    const arrival = constraint.direction === "arrival";
    return [{
      id: arrival
        ? routeLegKey(`airport-${airport.code.toLowerCase()}`, plan.selectedBase!.id)
        : routeLegKey(plan.selectedBase!.id, `airport-${airport.code.toLowerCase()}`),
      origin: arrival ? airportCoordinate : baseCoordinate,
      destination: arrival ? baseCoordinate : airportCoordinate,
      departureTime,
      mode,
    }];
  });
}

export function planningRouteFactId(dayLabel: string, fromId: string, toId: string) {
  return `route:${dayLabel}:${fromId}:${toId}`;
}

type SelectedTransitOccurrence = PlanningTransitLegRequest & Readonly<{ occurrenceId: string }>;

function selectedTransitOccurrencesForDay(plan: BuiltTripPlan, dayIndex: number): SelectedTransitOccurrence[] {
  const day = plan.days[dayIndex];
  const destinationProfile = destinationById(plan.destination);
  const scheduledStops = day.stops.map(({ stop }) => stop);
  const startBase = day.startBase ?? plan.selectedBase;
  const endBase = day.endBase ?? startBase;
  const path = startBase
    ? [startBase, ...scheduledStops, endBase ?? startBase]
    : scheduledStops;
  if (path.length < 2) return [];
  if (!day.date) throw new LiveRoutesError("missing_date");

  const departureClocks = startBase
    ? [day.startTime, ...day.stops.map((stop) => stop.departure)]
    : day.stops.slice(0, -1).map((stop) => stop.departure);
  let previousClock: number | null = null;
  let dayOffset = 0;
  return path.slice(0, -1).flatMap((origin, index): SelectedTransitOccurrence[] => {
    const localTime = departureClocks[index];
    const currentClock = localTime ? clockMinutes(localTime) : null;
    if (currentClock === null) return [];
    if (previousClock !== null && currentClock < previousClock) dayOffset += 1;
    previousClock = currentClock;
    const localDate = addDays(day.date!, dayOffset);
    if (!localDate) return [];
    const destination = path[index + 1];
    const departureTime = localDateTimeWithOffset(localDate, localTime, destinationProfile.timeZone);
    if (!departureTime) return [];

    const mode = startBase
      ? index === 0
        ? day.hotelOutboundMode
        : index === path.length - 2
          ? day.hotelInboundMode
          : day.legs[index - 1]?.comparison.recommended.mode
      : day.legs[index]?.comparison.recommended.mode;
    // Measure transit for the legs the schedule uses AND for taxi legs where
    // rail is a realistic contender that has simply never been measured.
    // Without the second group a leg demoted to taxi on estimates could never
    // earn its transit measurement back (the selection would skip it, so the
    // evidence gap that caused the demotion became permanent).
    const transitContender = mode === "taxi"
      && plan.travelPreference !== "car"
      && destinationProfile.mobility !== "car_first"
      && straightLineDistanceKm(origin, destination) >= 4;
    if (mode !== "transit" && !transitContender) return [];

    const endpoints = providerEndpointsForLeg(origin, destination);
    if (!endpoints) return [];
    const legId = routeLegKey(origin.id, destination.id);
    const requestKey = transitRequestKey(
      providerTransitIdentity(legId, endpoints.routingEndpointKey),
      departureTime,
    );
    const factId = planningRouteFactId(day.label, origin.id, destination.id);
    return [{
      legId,
      mode: "transit",
      departureTime,
      departureBucket: transitDepartureBucket(departureTime),
      requestKey,
      ...endpoints,
      factIds: [factId],
      occurrenceId: `${factId}@${departureTime}${endpoints.routingEndpointKey ? `@${endpoints.routingEndpointKey}` : ""}`,
    }];
  });
}

function selectedTransitOccurrences(plan: BuiltTripPlan): SelectedTransitOccurrence[] {
  // Timetable-bound evidence needs a verified destination timezone. The
  // worldwide fallback intentionally leaves those legs estimated.
  if (plan.destination === "worldwide") return [];
  const airportOccurrences = timedAirportLegs(plan)
    .filter((leg) => leg.mode === "transit")
    .map((leg, index): SelectedTransitOccurrence => ({
      legId: leg.id,
      mode: "transit",
      departureTime: leg.departureTime,
      departureBucket: transitDepartureBucket(leg.departureTime),
      requestKey: transitRequestKey(leg.id, leg.departureTime),
      origin: leg.origin,
      destination: leg.destination,
      factIds: plan.airportConstraints.flatMap((constraint) => {
        const airportId = `airport-${constraint.airport.toLowerCase()}`;
        const matches = constraint.direction === "arrival"
          ? leg.id.startsWith(`${airportId}::`)
          : leg.id.endsWith(`::${airportId}`);
        return matches ? [`route:airport:${constraint.direction}:${constraint.airport}`] : [];
      }),
      occurrenceId: `airport:${index}:${leg.id}@${leg.departureTime}`,
    }));
  return [
    ...airportOccurrences,
    ...plan.days.flatMap((_day, dayIndex) => selectedTransitOccurrencesForDay(plan, dayIndex)),
  ];
}

/**
 * Builds only physical transit legs the current schedule actually consumes.
 * Repeated facts in the same departure bucket share one provider event, while
 * every consuming fact id remains attached to the evidence.
 */
export function buildSelectedTransitLegRequests(plan: BuiltTripPlan): PlanningTransitLegRequest[] {
  const unique = new Map<string, PlanningTransitLegRequest>();
  for (const occurrence of selectedTransitOccurrences(plan)) {
    const current = unique.get(occurrence.requestKey);
    if (!current) {
      unique.set(occurrence.requestKey, {
        legId: occurrence.legId,
        mode: occurrence.mode,
        departureTime: occurrence.departureTime,
        departureBucket: occurrence.departureBucket,
        requestKey: occurrence.requestKey,
        origin: occurrence.origin,
        destination: occurrence.destination,
        factIds: occurrence.factIds,
        ...(occurrence.routingEndpointKey ? { routingEndpointKey: occurrence.routingEndpointKey } : {}),
        ...(occurrence.accessAssumptions ? { accessAssumptions: occurrence.accessAssumptions } : {}),
      });
      continue;
    }
    unique.set(occurrence.requestKey, {
      ...current,
      factIds: [...new Set([...current.factIds, ...occurrence.factIds])],
    });
  }
  return [...unique.values()];
}

/** The signature includes exact scheduled instants, not only cache buckets. */
export function buildPlanningTransitIteration(
  plan: BuiltTripPlan,
): TransitPlanIteration<BuiltTripPlan, PlanningTransitLegRequest> {
  const occurrences = selectedTransitOccurrences(plan);
  return {
    plan,
    signature: occurrences.map((entry) => entry.occurrenceId).join("|"),
    selectedTransitLegs: buildSelectedTransitLegRequests(plan),
  };
}

/*
 * Google-Maps-style shortest routing: instead of measuring only the mode our
 * estimate already picked, measure every mode that could realistically win
 * this leg and let the measured minutes decide. The estimate merely prunes
 * hopeless contenders (a three-hour walk, a taxi for a five-minute hop) so the
 * request budget stays sane.
 */
function contenderModes(
  origin: RouteStop,
  destination: RouteStop,
  preference: TravelPreference,
  mobility: MobilityProfile,
): PlanningRouteMode[] {
  const allowed = allowedTransportModesForLeg(origin, destination);
  if (allowed.length === 1 && allowed[0] === "transit") return ["transit"];
  const comparison = estimateTravelOptions(origin, destination, preference, mobility);
  const minutesOf = (mode: "walk" | "transit" | "taxi") =>
    comparison.options.find((option) => option.mode === mode)!.minutes;
  const distanceKm = straightLineDistanceKm(origin, destination);
  if (preference === "car") {
    return minutesOf("walk") <= 15 ? ["drive", "walk"] : ["drive"];
  }
  const modes: PlanningRouteMode[] = ["transit"];
  if (minutesOf("walk") <= 35) modes.push("walk");
  if (distanceKm >= 4 && minutesOf("taxi") <= minutesOf("transit") + 5) modes.push("drive");
  return modes;
}

/**
 * Transit duration depends on the requested departure time. Keeping the time
 * in the key prevents an earlier draft's result from being reused after the
 * schedule shifts.
 */
export function planningRouteRequestKey(
  leg: Pick<PlanningRouteLeg, "mode" | "id" | "departureTime" | "routingEndpointKey">,
) {
  // The departure minute is bucketed to half an hour in the KEY only: feeding
  // measured minutes back into the schedule shifts every later departure a
  // little, and an exact-minute key would treat each nudge as a brand-new
  // request. Within a bucket the earlier measurement stands.
  const bucketed = leg.departureTime.replace(
    /T(\d{2}):(\d{2})/,
    (_all, hour: string, minute: string) => `T${hour}:${Number(minute) < 30 ? "00" : "30"}`,
  );
  return `${leg.mode}|${providerTransitIdentity(leg.id, leg.routingEndpointKey)}|${bucketed}`;
}

/**
 * Builds coordinate-only requests from a draft plan. It is safe to call before
 * the UI exposes that draft by setting `hasPlan`.
 */
export function buildPlanningRouteLegs(plan: BuiltTripPlan) {
  const unique = new Map<string, PlanningRouteLeg>();
  // Airport transfers first: they bound the whole first and last day, so when
  // the per-build request cap truncates a dense trip they must survive.
  for (const leg of timedAirportLegs(plan)) {
    const key = planningRouteRequestKey(leg);
    if (!unique.has(key)) unique.set(key, leg);
  }
  plan.days.forEach((_day, dayIndex) => {
    for (const leg of timedPathForDay(plan, dayIndex)) {
      const key = planningRouteRequestKey(leg);
      if (!unique.has(key)) unique.set(key, leg);
    }
  });
  const legs = [...unique.values()];
  // A non-curated destination has no verified timezone, so a "local"
  // departure instant would be a guess; timetable-bound transit stays an
  // estimate there while time-insensitive walk/drive is still measured.
  return plan.destination === "worldwide" ? legs.filter((leg) => leg.mode !== "transit") : legs;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>) {
  const result = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(values[index]);
    }
  }));
  return result;
}

function parseResult(value: unknown): LiveRouteResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string") return null;
  if (candidate.status !== "ok" && candidate.status !== "unavailable") return null;
  const durationMinutes = typeof candidate.durationMinutes === "number" && Number.isFinite(candidate.durationMinutes)
    ? candidate.durationMinutes
    : null;
  const distanceMeters = typeof candidate.distanceMeters === "number" && Number.isFinite(candidate.distanceMeters)
    ? candidate.distanceMeters
    : null;
  const encodedPolyline = typeof candidate.encodedPolyline === "string" && candidate.encodedPolyline.length > 0
    ? candidate.encodedPolyline
    : null;
  const transferCount = candidate.status === "ok"
    && typeof candidate.transferCount === "number"
    && Number.isSafeInteger(candidate.transferCount)
    && candidate.transferCount >= 0
    && candidate.transferCount <= 100
    ? candidate.transferCount
    : null;
  if (candidate.status === "ok" && (durationMinutes === null || durationMinutes <= 0)) return null;
  const transitSteps = candidate.status === "ok" && Array.isArray(candidate.transitSteps)
    ? (candidate.transitSteps as TransitStepSummary[]).filter((step) => step && typeof step.lineName === "string").slice(0, 6)
    : null;
  const boundedWalk = (value: unknown) => candidate.status === "ok"
    && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 600
    ? value
    : null;
  return {
    id: candidate.id,
    status: candidate.status,
    durationMinutes,
    distanceMeters,
    encodedPolyline,
    transferCount,
    transitSteps,
    walkToStopMinutes: boundedWalk(candidate.walkToStopMinutes),
    walkFromStopMinutes: boundedWalk(candidate.walkFromStopMinutes),
  };
}

async function requestBatch(
  legs: PlanningRouteLeg[],
  mode: PlanningRouteMode,
  locale: Locale,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetcher("/api/live-routes", {
      method: "POST",
      headers: tripRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        legs: legs.map((leg) => ({
          id: leg.id,
          origin: leg.origin,
          destination: leg.destination,
          departureTime: leg.departureTime,
        })),
        languageCode: localeLanguageCode(locale),
        travelMode: (mode === "walk" ? "WALK" : mode === "drive" ? "DRIVE" : "TRANSIT") satisfies LiveRouteTravelMode,
      }),
      signal,
    });
  } catch {
    throw new LiveRoutesError("unavailable");
  }
  const payload = await response.json().catch(() => null) as LiveRoutesPayload | null;
  if (!response.ok || !payload) {
    if (payload?.code === "not_configured") throw new LiveRoutesError("not_configured");
    if (payload?.code === "invalid_or_out_of_range") throw new LiveRoutesError("invalid_or_out_of_range");
    throw new LiveRoutesError("unavailable");
  }
  if (payload.provider !== "google_maps" || typeof payload.fetchedAt !== "string" || !Array.isArray(payload.legs)) {
    throw new LiveRoutesError("unavailable");
  }
  const parsed = payload.legs.map(parseResult);
  if (parsed.some((leg) => leg === null)) throw new LiveRoutesError("unavailable");
  return {
    fetchedAt: payload.fetchedAt,
    legs: parsed.map((leg, index) => ({
      ...leg!,
      mode,
      departureTime: legs[index].departureTime,
      ...(legs[index].routingEndpointKey ? { routingEndpointKey: legs[index].routingEndpointKey } : {}),
      ...(legs[index].accessAssumptions ? { accessAssumptions: legs[index].accessAssumptions } : {}),
    } satisfies PlanningRouteResult)),
  };
}

/**
 * Provider adapter for the convergence coordinator. It preserves one result
 * per request key and never flattens time-dependent evidence into a pair-only
 * first-write-wins record.
 */
export async function fetchPlanningTransitEvidence(
  requests: readonly PlanningTransitLegRequest[],
  locale: Locale,
  options: PlanningTransitFetchOptions = {},
): Promise<TransitProviderObservation[]> {
  if (requests.length === 0) return [];
  const fetcher = options.fetcher ?? fetch;
  const concurrency = boundedInteger(options.concurrency, 2, 4);
  const batches = chunks([...requests], 12);
  const results = await mapWithConcurrency(batches, concurrency, async (batch) => {
    try {
      // Endpoint ids are transport correlation ids (max 160 chars), not
      // evidence identity. The requestKey below remains the exact provenance.
      const response = await requestBatch(batch.map((request, index) => ({
        id: `transit-${index}`,
        origin: request.origin,
        destination: request.destination,
        departureTime: request.departureTime,
        mode: "transit",
      })), "transit", locale, fetcher, options.signal);
      return batch.map((request, index): TransitProviderObservation => {
        const result = response.legs[index];
        const points = result?.encodedPolyline ? decodeGooglePolyline(result.encodedPolyline) : [];
        const providerRef = request.accessAssumptions?.length
          ? `google_maps:access_node:${request.accessAssumptions.map((item) => item.accessNodeId).sort().join(",")}`
          : "google_maps";
        return result?.status === "ok" && result.durationMinutes !== null
          ? {
              requestKey: request.requestKey,
              status: "verified",
              durationMinutes: result.durationMinutes,
              transferCount: result.transferCount,
              fetchedAt: response.fetchedAt,
              providerRef,
              ...(points.length >= 2 ? { routeGeometry: {
                points,
                distanceMeters: result.distanceMeters,
              } } : {}),
              ...(result.transitSteps?.length ? { transitSteps: result.transitSteps } : {}),
              walkToStopMinutes: result.walkToStopMinutes,
              walkFromStopMinutes: result.walkFromStopMinutes,
            }
          : {
              requestKey: request.requestKey,
              status: "unknown",
              durationMinutes: null,
              transferCount: null,
              fetchedAt: response.fetchedAt,
              providerRef,
            };
      });
    } catch {
      return batch.map((request): TransitProviderObservation => ({
        requestKey: request.requestKey,
        status: "failed",
        durationMinutes: null,
        transferCount: null,
        providerRef: request.accessAssumptions?.length
          ? `google_maps:access_node:${request.accessAssumptions.map((item) => item.accessNodeId).sort().join(",")}`
          : "google_maps",
      }));
    }
  });
  return results.flat();
}

/**
 * Fetches both transit and walking facts for a still-hidden draft plan. Requests
 * and Google calls remain bounded; no estimate is substituted when Google fails.
 */
export async function prefetchPlanningRouteDurations(
  plan: BuiltTripPlan,
  locale: Locale,
  options: PlanningRoutePrefetchOptions = {},
): Promise<PlanningRoutePrefetch> {
  const excluded = new Set(options.excludeKeys ?? []);
  const allLegs = buildPlanningRouteLegs(plan).filter((leg) => !excluded.has(planningRouteRequestKey(leg)));
  // The bound counts mode-contender requests, not physical legs, so the
  // Google-Maps-style multi-mode comparison still fits a paid budget.
  const maxLegs = boundedInteger(options.maxLegs, PLANNING_BUDGET.routeEvents, PLANNING_BUDGET.routeEvents);
  const legs = allLegs.slice(0, maxLegs);
  const tasks = options.modes
    ? ([...new Set(options.modes)] as PlanningRouteMode[]).flatMap((mode) => chunks(legs, 12).map((batch) => ({ mode, batch })))
    : (["transit", "walk", "drive"] as const).flatMap((mode) => chunks(legs.filter((leg) => leg.mode === mode), 12).map((batch) => ({ mode, batch })));
  if (tasks.length === 0) {
    return {
      provider: "google_maps",
      fetchedAt: null,
      legs: [],
      transitMinutes: {},
      walkingMinutes: {},
      drivingMinutes: {},
      skippedLegCount: Math.max(0, allLegs.length - legs.length),
    };
  }

  const fetcher = options.fetcher ?? fetch;
  const concurrency = boundedInteger(options.concurrency, 2, 4);
  // One failed mode batch (a transit 502, a quota denial) must not void the
  // measurements the other batches already paid for; each task fails alone.
  const batches = (await mapWithConcurrency(tasks, concurrency, ({ mode, batch }) => (
    requestBatch(batch, mode, locale, fetcher, options.signal).catch(() => null)
  ))).filter((batch): batch is Awaited<ReturnType<typeof requestBatch>> => batch !== null);
  if (batches.length === 0) throw new LiveRoutesError("unavailable");
  const routeResults = batches.flatMap((batch) => batch.legs);
  const transitMinutes: Record<string, number> = {};
  const walkingMinutes: Record<string, number> = {};
  const drivingMinutes: Record<string, number> = {};
  for (const leg of routeResults) {
    if (leg.status !== "ok" || leg.durationMinutes === null) continue;
    if (leg.mode === "walk") walkingMinutes[leg.id] ??= leg.durationMinutes;
    else if (leg.mode === "drive") drivingMinutes[leg.id] ??= leg.durationMinutes;
    else {
      transitMinutes[leg.id] ??= leg.durationMinutes;
    }
  }
  const fetchedAt = batches.map((batch) => batch.fetchedAt).sort().at(-1) ?? null;
  return {
    provider: "google_maps",
    fetchedAt,
    legs: routeResults,
    transitMinutes,
    walkingMinutes,
    drivingMinutes,
    skippedLegCount: Math.max(0, allLegs.length - legs.length),
  };
}
