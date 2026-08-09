/*
 * Public holidays for the trip's calendar days, from the keyless Nager.Date
 * API. Google's regularOpeningHours is a weekly pattern and silently wrong on
 * public holidays (currentOpeningHours only covers the next 7 days), so the
 * planner overlays the country's holiday calendar instead: a day that is a
 * public holiday gets a visible warning that museums and shops may not follow
 * their usual schedule.
 */

export type HolidaysRequest = {
  /** ISO 3166-1 alpha-2, the destination profile's primary country. */
  countryCode: string;
  /** Local calendar days the trip touches, YYYY-MM-DD. */
  dates: string[];
};

export type TripHoliday = {
  date: string;
  /** Name in the country's own language — what signs and closures will say. */
  localName: string;
  /** English name. */
  name: string;
  /** False when the holiday only applies in some regions of the country. */
  nationwide: boolean;
};

export type TripHolidaysResult = { holidays: TripHoliday[] };

const MAX_DATES = 31;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarDateParts(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * Validates an untrusted request body. Dates outside a window of last year
 * through two years ahead are rejected outright — nothing legitimate plans
 * that far out, and the window bounds how many upstream calls one request
 * can cause.
 */
export function parseHolidaysRequest(input: unknown, now: Date = new Date()): HolidaysRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  if (typeof body.countryCode !== "string" || !/^[A-Z]{2}$/.test(body.countryCode)) return null;
  if (!Array.isArray(body.dates) || body.dates.length === 0 || body.dates.length > MAX_DATES) return null;
  const currentYear = now.getUTCFullYear();
  const dates: string[] = [];
  for (const value of body.dates) {
    if (typeof value !== "string") return null;
    const parts = calendarDateParts(value);
    if (!parts) return null;
    if (parts.year < currentYear - 1 || parts.year > currentYear + 2) return null;
    if (!dates.includes(value)) dates.push(value);
  }
  return { countryCode: body.countryCode, dates };
}

function parseHoliday(value: unknown, wantedDates: ReadonlySet<string>): TripHoliday | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.date !== "string" || !wantedDates.has(entry.date)) return null;
  if (typeof entry.localName !== "string" || typeof entry.name !== "string") return null;
  // Nager v3 lists observance/school days too; only "Public" closes shops.
  if (Array.isArray(entry.types) && !entry.types.includes("Public")) return null;
  return {
    date: entry.date,
    localName: entry.localName,
    name: entry.name,
    nationwide: entry.global !== false,
  };
}

/**
 * Fetches the covered years from Nager.Date and keeps the entries that land
 * on requested dates. A 404 means the country is not in the dataset — that is
 * an empty answer, not a failure. Anything else that goes wrong throws
 * `holidays_unavailable` so the route can answer 502.
 */
export async function fetchTripHolidays(
  request: HolidaysRequest,
  fetcher: typeof fetch = fetch,
): Promise<TripHolidaysResult> {
  const wantedDates = new Set(request.dates);
  const years = [...new Set(request.dates.map((date) => date.slice(0, 4)))].sort();
  const holidays: TripHoliday[] = [];
  for (const year of years) {
    let response: Response;
    try {
      response = await fetcher(`https://date.nager.at/api/v3/PublicHolidays/${year}/${request.countryCode}`, {
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      throw new Error("holidays_unavailable");
    }
    if (response.status === 404) continue;
    if (!response.ok) throw new Error("holidays_unavailable");
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) throw new Error("holidays_unavailable");
    for (const entry of body) {
      const holiday = parseHoliday(entry, wantedDates);
      if (holiday && !holidays.some((existing) => existing.date === holiday.date)) holidays.push(holiday);
    }
  }
  return { holidays: holidays.sort((left, right) => left.date.localeCompare(right.date)) };
}
