/*
 * The trip's calendar: an optional first day, the date of each day after it,
 * and which of those dates a forecast exists for yet.
 *
 * Dates are plain calendar days ("2026-11-20") compared in UTC, the same way
 * lib/weather.ts decides what it will ask the provider for — so this module
 * never promises a forecast the request would then refuse.
 */

/**
 * How many days past today a forecast is asked for and promised. Open-Meteo's
 * forecast reaches 15 days past its own today, counted in the destination's
 * time zone; "today" here is the UTC date, which west of UTC can be a day
 * ahead of the destination's. One day is kept in hand so that the last date
 * asked for is inside the provider's range wherever the trip is — a single
 * refused date would lose the whole answer. This is the one place the number
 * is kept: the window, the "forecast from …" date and the wording all read it
 * (lib/weather.ts merely accepts up to its own, wider limit).
 */
export const FORECAST_DAYS_AHEAD = 14;
/** A trip already under way keeps its date, and its forecast, for this long. */
export const FORECAST_DAYS_BACK = 2;
/** Further ahead than this is a typing slip (year 2206), not a trip. */
const LATEST_START_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateMs(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(ms);
  // "2026-04-31" would otherwise roll over into May without a word.
  if (date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
  return ms;
}

function todayMs(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function iso(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The start date if it can still be used, otherwise null. A date that is not
 * a date, one more than two days gone, or one years away is dropped rather
 * than refused: the trip itself must still open.
 */
export function usableStartDate(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== "string") return null;
  const ms = dateMs(value);
  if (ms === null) return null;
  const today = todayMs(now);
  if (ms < today - FORECAST_DAYS_BACK * DAY_MS || ms > today + LATEST_START_DAYS * DAY_MS) return null;
  return value;
}

/** The earliest date usableStartDate accepts today: what a date field offers as its first day. */
export function earliestStartDate(now: Date = new Date()): string {
  return iso(todayMs(now) - FORECAST_DAYS_BACK * DAY_MS);
}

/** The calendar date of a day of the trip (0 is the first day). */
export function tripDate(startDate: string, dayIndex: number): string | null {
  const ms = dateMs(startDate);
  return ms === null ? null : iso(ms + dayIndex * DAY_MS);
}

const WEEKDAYS = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "11/20（金）" / "Fri 20 Nov". Empty for something that is not a date. */
export function dateLabel(date: string, locale: "ja" | "en", options: { weekday?: boolean } = {}): string {
  const ms = dateMs(date);
  if (ms === null) return "";
  const day = new Date(ms);
  const weekday = options.weekday === false ? null : WEEKDAYS[locale][day.getUTCDay()];
  if (locale === "ja") return `${day.getUTCMonth() + 1}/${day.getUTCDate()}${weekday ? `（${weekday}）` : ""}`;
  return `${weekday ? `${weekday} ` : ""}${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

export type ForecastWindow = {
  /** Days whose date a forecast can be asked for today. */
  within: Array<{ index: number; date: string }>;
  /** The first day still too far ahead, and the date from which its forecast exists. */
  later: { index: number; date: string; availableOn: string } | null;
};

/**
 * Which days of the trip a forecast exists for today. A day too far ahead is
 * not guessed at: it is reported with the date its forecast begins, which is
 * simply that day less the provider's horizon.
 */
export function forecastWindow(startDate: string, dayCount: number, now: Date = new Date()): ForecastWindow {
  const start = dateMs(startDate);
  const result: ForecastWindow = { within: [], later: null };
  if (start === null) return result;
  const today = todayMs(now);
  for (let index = 0; index < dayCount; index += 1) {
    const ms = start + index * DAY_MS;
    if (ms < today - FORECAST_DAYS_BACK * DAY_MS) continue;
    if (ms <= today + FORECAST_DAYS_AHEAD * DAY_MS) result.within.push({ index, date: iso(ms) });
    else if (!result.later) result.later = { index, date: iso(ms), availableOn: iso(ms - FORECAST_DAYS_AHEAD * DAY_MS) };
  }
  return result;
}
