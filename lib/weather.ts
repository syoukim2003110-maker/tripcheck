/*
 * Trip-day weather from Open-Meteo. Keyless, attribution-friendly, and
 * bounded: at most ten coordinate/date pairs per request, only within the
 * provider's real forecast horizon (2 days back for a trip already underway,
 * 15 days ahead — Open-Meteo's 16-day product includes today). Coordinates arrive pre-rounded by the client so the request
 * carries no place names, ids or precise positions — a forecast needs a town,
 * not an address.
 */

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "storm";

export type WeatherRequestDay = {
  /** The plan's day index, echoed back so the client can re-attach the answer. */
  index: number;
  date: string;
  latitude: number;
  longitude: number;
};

export type WeatherRequest = {
  days: WeatherRequestDay[];
};

export type TripWeatherDay = {
  index: number;
  date: string;
  /** Raw WMO interpretation code, kept for anyone who wants finer detail. */
  code: number;
  kind: WeatherKind;
  temperatureMaxC: number;
  temperatureMinC: number;
  precipitationPercent: number | null;
};

export type TripWeatherResult = {
  provider: "open_meteo";
  fetchedAt: string;
  days: TripWeatherDay[];
};

const MAX_DAYS = 10;
const HORIZON_PAST_DAYS = 2;
const HORIZON_FUTURE_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDateMs(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(ms);
  // Reject "2026-04-31"-style dates that Date silently rolls over.
  if (date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
  return ms;
}

function withinForecastHorizon(dateMs: number, now: Date) {
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return dateMs >= todayMs - HORIZON_PAST_DAYS * DAY_MS
    && dateMs <= todayMs + HORIZON_FUTURE_DAYS * DAY_MS;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function parseWeatherRequest(input: unknown, now: Date = new Date()): WeatherRequest | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (!Array.isArray(candidate.days) || candidate.days.length < 1 || candidate.days.length > MAX_DAYS) return null;
  const days: WeatherRequestDay[] = [];
  for (const raw of candidate.days) {
    if (!raw || typeof raw !== "object") return null;
    const day = raw as Record<string, unknown>;
    if (!Number.isInteger(day.index) || (day.index as number) < 0 || (day.index as number) > 30) return null;
    if (typeof day.date !== "string") return null;
    const dateMs = calendarDateMs(day.date);
    if (dateMs === null) return null;
    if (!finiteInRange(day.latitude, -90, 90) || !finiteInRange(day.longitude, -180, 180)) return null;
    // A date that merely aged out of the horizon between the client building
    // the payload and the server parsing it is skipped, not fatal: the other
    // days' forecast still renders.
    if (!withinForecastHorizon(dateMs, now)) continue;
    days.push({ index: day.index as number, date: day.date, latitude: day.latitude, longitude: day.longitude });
  }
  return days.length > 0 ? { days } : null;
}

/**
 * Collapses the WMO weather interpretation codes into the handful of visual
 * groups the UI can express. Codes outside the published table degrade to
 * "cloudy" — a neutral symbol — instead of inventing an "unknown" condition.
 */
export function weatherKindForCode(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  return "cloudy";
}

type OpenMeteoLocation = {
  daily?: {
    time?: unknown;
    weather_code?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    precipitation_probability_max?: unknown;
  };
};

function coordinateKey(value: number) {
  // 4 decimals ≈ 11 m — far beyond forecast resolution, but stable enough to
  // deduplicate days that share a rounded location.
  return String(Number(value.toFixed(4)));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function fetchTripWeather(
  request: WeatherRequest,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<TripWeatherResult> {
  // One provider call covers every location: Open-Meteo accepts comma-joined
  // coordinates and answers with one entry per location.
  const locationKeys: string[] = [];
  const locationIndexByKey = new Map<string, number>();
  for (const day of request.days) {
    const key = `${coordinateKey(day.latitude)},${coordinateKey(day.longitude)}`;
    if (!locationIndexByKey.has(key)) {
      locationIndexByKey.set(key, locationKeys.length);
      locationKeys.push(key);
    }
  }
  const dates = request.days.map((day) => day.date).sort();
  const params = new URLSearchParams({
    latitude: locationKeys.map((key) => key.split(",")[0]).join(","),
    longitude: locationKeys.map((key) => key.split(",")[1]).join(","),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    start_date: dates[0],
    end_date: dates[dates.length - 1],
  });
  const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("weather_unavailable");
  const payload = await response.json() as OpenMeteoLocation | OpenMeteoLocation[];
  const locations = Array.isArray(payload) ? payload : [payload];

  const days: TripWeatherDay[] = [];
  for (const day of request.days) {
    const key = `${coordinateKey(day.latitude)},${coordinateKey(day.longitude)}`;
    const daily = locations[locationIndexByKey.get(key) ?? -1]?.daily;
    if (!daily || !Array.isArray(daily.time)) continue;
    const at = daily.time.indexOf(day.date);
    if (at < 0) continue;
    const code = Array.isArray(daily.weather_code) ? daily.weather_code[at] : undefined;
    const max = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[at] : undefined;
    const min = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[at] : undefined;
    const rain = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max[at] : undefined;
    // A day with malformed provider values is dropped, never guessed at.
    if (!finiteNumber(code) || !finiteNumber(max) || !finiteNumber(min)) continue;
    days.push({
      index: day.index,
      date: day.date,
      code,
      kind: weatherKindForCode(code),
      temperatureMaxC: Math.round(max),
      temperatureMinC: Math.round(min),
      precipitationPercent: finiteNumber(rain) ? Math.round(rain) : null,
    });
  }
  return { provider: "open_meteo", fetchedAt: now.toISOString(), days };
}
