import type { Locale } from "./i18n.ts";
import type { LiveRouteCoordinate, LiveRouteResult, LiveRouteTravelMode } from "./google-routes.ts";
import { LiveRoutesError } from "./live-routes-client.ts";
import { routeLegKey, type BuiltTripPlan } from "./trip-builder.ts";

export type PlanningRouteMode = "transit" | "walk";

export type PlanningRouteLeg = {
  id: string;
  origin: LiveRouteCoordinate;
  destination: LiveRouteCoordinate;
  departureTime: string;
  mode: PlanningRouteMode;
};

export type PlanningRouteResult = LiveRouteResult & {
  mode: PlanningRouteMode;
  departureTime: string;
};

export type PlanningRoutePrefetch = {
  provider: "google_maps";
  fetchedAt: string | null;
  legs: PlanningRouteResult[];
  transitMinutes: Record<string, number>;
  walkingMinutes: Record<string, number>;
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

function timedPathForDay(plan: BuiltTripPlan, dayIndex: number) {
  const day = plan.days[dayIndex];
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
  const routeModes: PlanningRouteMode[] = startBase
    ? ["transit", ...day.legs.map((leg) => leg.comparison.recommended.mode === "walk" ? "walk" as const : "transit" as const), "transit"]
    : day.legs.map((leg) => leg.comparison.recommended.mode === "walk" ? "walk" as const : "transit" as const);
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
    return [{
      id: routeLegKey(origin.id, destination.id),
      origin: { latitude: origin.latitude, longitude: origin.longitude },
      destination: { latitude: destination.latitude, longitude: destination.longitude },
      departureTime: `${localDate}T${localTime}:00+09:00`,
      mode: routeModes[index] ?? "transit",
    }];
  });
}

/**
 * Transit duration depends on the requested departure time. Keeping the time
 * in the key prevents an earlier draft's result from being reused after the
 * schedule shifts.
 */
export function planningRouteRequestKey(
  leg: Pick<PlanningRouteLeg, "mode" | "id" | "departureTime">,
) {
  return `${leg.mode}|${leg.id}|${leg.departureTime}`;
}

/**
 * Builds coordinate-only requests from a draft plan. It is safe to call before
 * the UI exposes that draft by setting `hasPlan`.
 */
export function buildPlanningRouteLegs(plan: BuiltTripPlan) {
  const unique = new Map<string, PlanningRouteLeg>();
  plan.days.forEach((_day, dayIndex) => {
    for (const leg of timedPathForDay(plan, dayIndex)) {
      const key = planningRouteRequestKey(leg);
      if (!unique.has(key)) unique.set(key, leg);
    }
  });
  return [...unique.values()];
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
  if (candidate.status === "ok" && (durationMinutes === null || durationMinutes <= 0)) return null;
  return { id: candidate.id, status: candidate.status, durationMinutes, distanceMeters };
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legs: legs.map((leg) => ({
          id: leg.id,
          origin: leg.origin,
          destination: leg.destination,
          departureTime: leg.departureTime,
        })),
        languageCode: localeLanguageCode(locale),
        travelMode: (mode === "walk" ? "WALK" : "TRANSIT") satisfies LiveRouteTravelMode,
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
    } satisfies PlanningRouteResult)),
  };
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
  const maxLegs = boundedInteger(options.maxLegs, 24, 24);
  const legs = allLegs.slice(0, maxLegs);
  const tasks = options.modes
    ? ([...new Set(options.modes)] as PlanningRouteMode[]).flatMap((mode) => chunks(legs, 12).map((batch) => ({ mode, batch })))
    : (["transit", "walk"] as const).flatMap((mode) => chunks(legs.filter((leg) => leg.mode === mode), 12).map((batch) => ({ mode, batch })));
  if (tasks.length === 0) {
    return {
      provider: "google_maps",
      fetchedAt: null,
      legs: [],
      transitMinutes: {},
      walkingMinutes: {},
      skippedLegCount: Math.max(0, allLegs.length - legs.length),
    };
  }

  const fetcher = options.fetcher ?? fetch;
  const concurrency = boundedInteger(options.concurrency, 2, 4);
  const batches = await mapWithConcurrency(tasks, concurrency, ({ mode, batch }) => (
    requestBatch(batch, mode, locale, fetcher, options.signal)
  ));
  const routeResults = batches.flatMap((batch) => batch.legs);
  const transitMinutes: Record<string, number> = {};
  const walkingMinutes: Record<string, number> = {};
  for (const leg of routeResults) {
    if (leg.status !== "ok" || leg.durationMinutes === null) continue;
    if (leg.mode === "walk") walkingMinutes[leg.id] ??= leg.durationMinutes;
    else transitMinutes[leg.id] ??= leg.durationMinutes;
  }
  const fetchedAt = batches.map((batch) => batch.fetchedAt).sort().at(-1) ?? null;
  return {
    provider: "google_maps",
    fetchedAt,
    legs: routeResults,
    transitMinutes,
    walkingMinutes,
    skippedLegCount: Math.max(0, allLegs.length - legs.length),
  };
}
