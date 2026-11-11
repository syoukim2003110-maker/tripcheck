import type { BuiltTripPlan } from "./trip-builder.ts";
import { fetchTripHolidays, parseHolidaysRequest, type HolidaysRequest, type TripHoliday, type TripHolidaysResult } from "./holidays.ts";
import { serverRoutesUnavailable } from "./hosting-mode.ts";

/*
 * Client side of the holiday overlay. The payload is a country code and bare
 * calendar dates — no places, names or coordinates — so the holiday provider
 * learns nothing about the trip beyond "someone will be in this country then".
 */

export function buildHolidaysPayload(plan: BuiltTripPlan, countryCode: string | null): HolidaysRequest | null {
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return null;
  const dates: string[] = [];
  for (const day of plan.days) {
    // Travel-only days matter too: a holiday still closes shops and pharmacies.
    if (day.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date) && !dates.includes(day.date)) dates.push(day.date);
  }
  return dates.length > 0 ? { countryCode, dates: dates.slice(0, 31) } : null;
}

function validTripHoliday(value: unknown): value is TripHoliday {
  if (!value || typeof value !== "object") return false;
  const holiday = value as Record<string, unknown>;
  return typeof holiday.date === "string"
    && typeof holiday.localName === "string"
    && typeof holiday.name === "string"
    && typeof holiday.nationwide === "boolean";
}

/**
 * Holidays are enrichment, never a gate: any failure resolves to an empty
 * record and the plan renders without holiday warnings.
 */
export async function requestHolidays(payload: HolidaysRequest): Promise<Record<string, TripHoliday>> {
  let body: TripHolidaysResult | null;
  if (serverRoutesUnavailable()) {
    // Static hosting: the page asks the keyless public-holiday service
    // itself. Only a country code and the trip's dates go.
    const parsed = parseHolidaysRequest(payload);
    if (!parsed) return {};
    body = await fetchTripHolidays(parsed).catch(() => null);
  } else {
    let response: Response;
    try {
      response = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return {};
    }
    if (!response.ok) return {};
    body = await response.json().catch(() => null) as TripHolidaysResult | null;
  }
  if (!body || !Array.isArray(body.holidays)) return {};
  const result: Record<string, TripHoliday> = {};
  for (const holiday of body.holidays) {
    if (validTripHoliday(holiday)) result[holiday.date] = holiday;
  }
  return result;
}
