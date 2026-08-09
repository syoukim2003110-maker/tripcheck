import type { BuiltTripPlan } from "./trip-builder.ts";
import type { TripWeatherDay, TripWeatherResult, WeatherRequest } from "./weather.ts";

/*
 * Client side of the trip-day forecast. The payload is coordinate-only by
 * construction: each eligible day contributes one rounded centroid and its
 * date — never a stop name, area, id or source URL — so the weather provider
 * learns "someone cares about this town on this date" and nothing else.
 */

const MAX_DAYS = 10;
const HORIZON_PAST_DAYS = 2;
const HORIZON_FUTURE_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDateMs(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(ms);
  if (date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
  return ms;
}

/** ~1 km. A daily forecast is not finer than a town. */
function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildWeatherPayload(plan: BuiltTripPlan, now: Date = new Date()): WeatherRequest | null {
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: WeatherRequest["days"] = [];
  plan.days.forEach((day, index) => {
    if (days.length >= MAX_DAYS) return;
    const dateMs = calendarDateMs(day.date);
    if (dateMs === null) return;
    if (dateMs < todayMs - HORIZON_PAST_DAYS * DAY_MS || dateMs > todayMs + HORIZON_FUTURE_DAYS * DAY_MS) return;
    if (day.stops.length === 0) return;
    const latitude = day.stops.reduce((sum, { stop }) => sum + stop.latitude, 0) / day.stops.length;
    const longitude = day.stops.reduce((sum, { stop }) => sum + stop.longitude, 0) / day.stops.length;
    days.push({
      index,
      date: day.date!,
      latitude: roundCoordinate(latitude),
      longitude: roundCoordinate(longitude),
    });
  });
  return days.length > 0 ? { days } : null;
}

function validTripWeatherDay(value: unknown): value is TripWeatherDay {
  if (!value || typeof value !== "object") return false;
  const day = value as Record<string, unknown>;
  return Number.isInteger(day.index) && (day.index as number) >= 0
    && typeof day.date === "string"
    && typeof day.code === "number"
    && typeof day.kind === "string"
    && typeof day.temperatureMaxC === "number" && Number.isFinite(day.temperatureMaxC)
    && typeof day.temperatureMinC === "number" && Number.isFinite(day.temperatureMinC)
    && (day.precipitationPercent === null
      || (typeof day.precipitationPercent === "number" && Number.isFinite(day.precipitationPercent)));
}

/**
 * Weather is enrichment, never a gate: every failure — offline, rate limit,
 * malformed body — resolves to an empty record and the plan renders without
 * forecast chips instead of surfacing an error.
 */
export async function requestWeatherPayload(payload: WeatherRequest): Promise<Record<number, TripWeatherDay>> {
  let response: Response;
  try {
    response = await fetch("/api/weather", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return {};
  }
  if (!response.ok) return {};
  const body = await response.json().catch(() => null) as TripWeatherResult | null;
  if (!body || !Array.isArray(body.days)) return {};
  const result: Record<number, TripWeatherDay> = {};
  for (const day of body.days) {
    if (validTripWeatherDay(day)) result[day.index] = day;
  }
  return result;
}
