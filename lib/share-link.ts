/*
 * Stateless trip sharing. The link IS the data: form inputs are compressed
 * into the URL hash, nothing is stored server-side, so the privacy promise
 * ("nothing is saved") stays true while a companion can open the same trip.
 */

export type ShareableTripInput = {
  itinerary: string;
  tripDays: number;
  tripStartDate: string;
  hotelQuery: string;
  pace: "relaxed" | "balanced" | "fast";
  mealPlan: "all" | "dinner" | "none";
  travelPreference: "auto" | "car";
  arrivalAirport: string;
  arrivalTime: string;
  departureAirport: string;
  departureTime: string;
  dayStartDefault: string;
  dayEndTarget: string;
};

const paces = new Set(["relaxed", "balanced", "fast"]);
const mealPlans = new Set(["all", "dinner", "none"]);
const travelPreferences = new Set(["auto", "car"]);
const airports = new Set(["none", "HND", "NRT", "KIX", "ITM", "NGO", "FUK", "CTS", "OKA"]);
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeTripShare(input: ShareableTripInput) {
  const payload = { v: 1, ...input };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function cleanClock(value: unknown) {
  return typeof value === "string" && clockPattern.test(value) ? value : "";
}

export function decodeTripShare(code: string): ShareableTripInput | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(code))) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return null;
  const itinerary = typeof parsed.itinerary === "string" ? parsed.itinerary.slice(0, 4_000) : "";
  if (!itinerary.trim()) return null;
  const tripDays = typeof parsed.tripDays === "number" && Number.isFinite(parsed.tripDays)
    ? Math.min(10, Math.max(1, Math.round(parsed.tripDays)))
    : 3;
  return {
    itinerary,
    tripDays,
    tripStartDate: typeof parsed.tripStartDate === "string" && datePattern.test(parsed.tripStartDate) ? parsed.tripStartDate : "",
    hotelQuery: typeof parsed.hotelQuery === "string" ? parsed.hotelQuery.slice(0, 160) : "",
    pace: paces.has(parsed.pace as string) ? parsed.pace as ShareableTripInput["pace"] : "balanced",
    mealPlan: mealPlans.has(parsed.mealPlan as string) ? parsed.mealPlan as ShareableTripInput["mealPlan"] : "all",
    travelPreference: travelPreferences.has(parsed.travelPreference as string)
      ? parsed.travelPreference as ShareableTripInput["travelPreference"]
      : "auto",
    arrivalAirport: airports.has(parsed.arrivalAirport as string) ? parsed.arrivalAirport as string : "none",
    arrivalTime: cleanClock(parsed.arrivalTime),
    departureAirport: airports.has(parsed.departureAirport as string) ? parsed.departureAirport as string : "none",
    departureTime: cleanClock(parsed.departureTime),
    dayStartDefault: cleanClock(parsed.dayStartDefault) || "09:00",
    dayEndTarget: cleanClock(parsed.dayEndTarget),
  };
}
