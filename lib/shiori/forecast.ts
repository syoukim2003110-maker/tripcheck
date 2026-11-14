import type { TripWeatherDay, WeatherRequest } from "../weather.ts";
import { requestWeatherPayload } from "../weather-client.ts";
import { MONTHS } from "./trip-dates.ts";
import { isWetForecast } from "./weather-days.ts";

/*
 * The forecast for a trip's days. One question per plan: the destination's
 * centre, rounded to about a kilometre, and the dates — never a place name,
 * a hotel or the list. Nothing is asked until the traveller gives a start
 * date, and an answer is kept while it is fresh so that changing the list
 * does not ask again.
 */

/** A forecast older than this is asked for again the next time the plan needs it. */
export const FORECAST_FRESH_MS = 3 * 60 * 60 * 1000;

/** Whether an answer that arrived at `fetchedAt` may still be shown and planned with. An unreadable time is not fresh. */
export function isForecastFresh(fetchedAt: string, now: Date): boolean {
  const at = Date.parse(fetchedAt);
  return Number.isFinite(at) && now.getTime() - at < FORECAST_FRESH_MS;
}

/** When an answer arrived, in the reader's own time: "11/14 09:12" / "Nov 14, 09:12". Empty for an unreadable time. */
export function fetchedStamp(fetchedAt: string, locale: "ja" | "en"): string {
  const at = new Date(fetchedAt);
  if (Number.isNaN(at.getTime())) return "";
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return locale === "ja" ? `${at.getMonth() + 1}/${at.getDate()} ${clock}` : `${MONTHS[at.getMonth()]} ${at.getDate()}, ${clock}`;
}

export type DayForecast = TripWeatherDay & { /** When this answer arrived (ISO). */ fetchedAt: string };
export type ForecastCache = Map<string, DayForecast>;
export type ForecastCentre = { latitude: number; longitude: number };

/** ~1 km, as lib/weather-client.ts rounds: a daily forecast is not finer than a town. */
function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

/** Where to ask about: the chosen city's centre, or without one the middle of the listed places. */
export function forecastCentre(
  city: { lat: number; lon: number } | null,
  places: ReadonlyArray<{ lat: number; lon: number }>,
): ForecastCentre | null {
  if (city) return { latitude: roundCoordinate(city.lat), longitude: roundCoordinate(city.lon) };
  if (places.length === 0) return null;
  return {
    latitude: roundCoordinate(places.reduce((sum, place) => sum + place.lat, 0) / places.length),
    longitude: roundCoordinate(places.reduce((sum, place) => sum + place.lon, 0) / places.length),
  };
}

const cacheKey = (centre: ForecastCentre, date: string) => `${centre.latitude},${centre.longitude}|${date}`;

export type ForecastAnswer = {
  /** Forecasts by the trip's day index; a day without one is simply absent. */
  byIndex: Record<number, DayForecast>;
  /** A forecast was asked for and none came back. */
  failed: boolean;
};

/**
 * The forecast for the given days, from the cache where it is known and
 * still fresh, and one request for the rest. An answer past its freshness is
 * asked for again and, if that fails, not shown: an old forecast is not
 * today's forecast. Never throws: a forecast is an extra, and a plan
 * without one is still the plan.
 */
export async function loadForecast(
  centre: ForecastCentre,
  days: ReadonlyArray<{ index: number; date: string }>,
  cache: ForecastCache,
  request: (payload: WeatherRequest) => Promise<Record<number, TripWeatherDay>> = requestWeatherPayload,
  now: () => Date = () => new Date(),
): Promise<ForecastAnswer> {
  const fresh = (date: string) => {
    const known = cache.get(cacheKey(centre, date));
    return known && isForecastFresh(known.fetchedAt, now()) ? known : null;
  };
  const missing = days.filter((day) => !fresh(day.date));
  let failed = false;
  if (missing.length > 0) {
    const answer = await request({ days: missing.map((day) => ({ ...day, ...centre })) }).catch(() => ({} as Record<number, TripWeatherDay>));
    const fetchedAt = now().toISOString();
    let answered = 0;
    for (const day of missing) {
      const found = answer[day.index];
      // An answer for another date than the one asked about is not this day's forecast.
      if (!found || found.date !== day.date) continue;
      cache.set(cacheKey(centre, day.date), { ...found, fetchedAt });
      answered += 1;
    }
    failed = answered === 0;
  }
  const byIndex: Record<number, DayForecast> = {};
  for (const day of days) {
    const known = fresh(day.date);
    if (known) byIndex[day.index] = { ...known, index: day.index };
  }
  return { byIndex, failed };
}

/**
 * The forecast as the planner takes it: per day of the trip, wet, dry, or
 * null where nothing is known. Null for a trip with no forecast at all, so
 * such a trip is planned exactly as one without a date.
 */
export function wetDaysOf(byIndex: Readonly<Record<number, DayForecast>>, dayCount: number): Array<boolean | null> | null {
  const days = Array.from({ length: dayCount }, (_, index) => (byIndex[index] ? isWetForecast(byIndex[index]) : null));
  return days.some((day) => day !== null) ? days : null;
}
