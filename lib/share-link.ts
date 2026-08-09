/*
 * Stateless trip sharing. The link IS the data: form inputs are compressed
 * into the URL hash, nothing is stored server-side, so the privacy promise
 * ("nothing is saved") stays true while a companion can open the same trip.
 */

import type { DestinationChoice } from "./destinations.ts";
import { isDestinationChoice } from "./destinations.ts";

/**
 * The durable part of a place-resolution decision. Google-owned display
 * fields are intentionally absent: a provider decision persists only the
 * occurrence it applies to and the stable provider identifier. A manual
 * decision is different evidence and therefore keeps only traveller-authored
 * text and coordinates.
 */
export type ShareableResolutionOverride =
  | { inputIndex: number; providerRef: string }
  | { inputIndex: number; name: string; address: string; latitude: number; longitude: number };

export type ShareableTripInput = {
  /** Country the plan was built for, or "auto". */
  destination: DestinationChoice;
  itinerary: string;
  tripDays: number;
  tripStartDate: string;
  /** False means the date is an internal planning placeholder, not traveller-confirmed. */
  dateWasProvided: boolean;
  hotelQuery: string;
  pace: "relaxed" | "balanced" | "fast";
  mealPlan: "all" | "dinner" | "none";
  travelPreference: "auto" | "car";
  arrivalAirport: string;
  arrivalTime: string;
  departureAirport: string;
  departureTime: string;
  flightKind: "international" | "domestic";
  dayStartDefault: string;
  dayEndTarget: string;
  transferBufferMinutes: 0 | 10 | 20 | 30;
  maxWalkingMinutesPerLeg?: number;
  maxTransfersPerLeg?: number;
  /** User edits made on the result screen; provider evidence is never shared. */
  userStayMinutes: Record<string, number>;
  lastEntryTimes: Record<string, string>;
  dayStartTimes: Record<string, string>;
  dayEndTimes: Record<string, string>;
  legModeOverrides: Record<string, "walk" | "transit" | "taxi">;
  dayOverrides: Record<string, number>;
  lockedOrderByDay?: Record<string, string[]>;
  removedStops: Array<{ id: string; name: string }>;
  /** Stable resolution choices needed to reproduce the reviewed input. */
  resolutionOverrides?: ShareableResolutionOverride[];
};

const paces = new Set(["relaxed", "balanced", "fast"]);
const mealPlans = new Set(["all", "dinner", "none"]);
const travelPreferences = new Set(["auto", "car"]);
const flightKinds = new Set(["international", "domestic"]);
const airportCodePattern = /^[A-Z]{3}$/;
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const transportModes = new Set(["walk", "transit", "taxi"]);
const transferBuffers = new Set([0, 10, 20, 30]);
const providerRefPattern = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_RESOLUTION_OVERRIDES = 12;
// A shareable itinerary is capped at 4,000 characters, so a larger occurrence
// index cannot refer to content retained by this payload.
const MAX_RESOLUTION_INPUT_INDEX = 3_999;

function cleanCalendarDate(value: unknown) {
  if (typeof value !== "string" || !datePattern.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? value
    : "";
}

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
  // Project resolution choices before serialising. Types alone are not a
  // privacy boundary: a caller can still pass a provider result containing a
  // mutable Google name, address or coordinate at runtime.
  const { resolutionOverrides: rawResolutionOverrides, ...shareableInput } = input;
  const resolutionOverrides = cleanResolutionOverrides(rawResolutionOverrides);
  const payload = {
    v: 1,
    ...shareableInput,
    ...(resolutionOverrides.length > 0 ? { resolutionOverrides } : {}),
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function cleanClock(value: unknown) {
  return typeof value === "string" && clockPattern.test(value) ? value : "";
}

/* Any IATA code is accepted here; the builder ignores one the selected
 * destination does not offer, so a stale code cannot bend the wrong trip. */
function cleanAirport(value: unknown) {
  return typeof value === "string" && airportCodePattern.test(value) ? value : "none";
}

function cleanNumberRecord(value: unknown, minimum: number, maximum: number, limit = 80) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, limit)) {
    if (!key || key.length > 200 || typeof raw !== "number" || !Number.isFinite(raw)) continue;
    result[key] = Math.min(maximum, Math.max(minimum, Math.round(raw)));
  }
  return result;
}

function cleanDayTimes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 14)) {
    if (!/^(?:\d|1[0-3])$/.test(key)) continue;
    const time = cleanClock(raw);
    if (time) result[key] = time;
  }
  return result;
}

function cleanStopTimes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    if (!key || key.length > 200) continue;
    const time = cleanClock(raw);
    if (time) result[key] = time;
  }
  return result;
}

function cleanLegModes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 80)
    .filter(([key, mode]) => key.length > 0 && key.length <= 300 && transportModes.has(mode as string))) as ShareableTripInput["legModeOverrides"];
}

function cleanLockedOrder(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [day, rawIds] of Object.entries(value as Record<string, unknown>).slice(0, 14)) {
    if (!/^(?:\d|1[0-3])$/.test(day) || !Array.isArray(rawIds)) continue;
    const ids = rawIds.slice(0, 30).filter((id): id is string => (
      typeof id === "string" && id.length > 0 && id.length <= 200
    ));
    if (ids.length > 0) result[day] = [...new Set(ids)];
  }
  return result;
}

function cleanRemovedStops(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { id, name } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || id.length > 200 || typeof name !== "string" || !name.trim()) return [];
    return [{ id, name: name.trim().slice(0, 160) }];
  });
}

function cleanTravellerText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
}

function cleanResolutionOverrides(value: unknown): ShareableResolutionOverride[] {
  if (!Array.isArray(value)) return [];
  const result: ShareableResolutionOverride[] = [];
  const usedInputIndexes = new Set<number>();
  for (const raw of value) {
    if (result.length >= MAX_RESOLUTION_OVERRIDES) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const inputIndex = entry.inputIndex;
    if (
      typeof inputIndex !== "number"
      || !Number.isSafeInteger(inputIndex)
      || inputIndex < 0
      || inputIndex > MAX_RESOLUTION_INPUT_INDEX
      || usedInputIndexes.has(inputIndex)
    ) continue;

    // The mere presence of providerRef makes this a provider decision. A bad
    // provider id must fail closed instead of falling through and persisting
    // provider-supplied display fields as if the traveller authored them.
    if (Object.prototype.hasOwnProperty.call(entry, "providerRef")) {
      const providerRef = entry.providerRef;
      if (typeof providerRef !== "string" || !providerRefPattern.test(providerRef)) continue;
      result.push({ inputIndex, providerRef });
      usedInputIndexes.add(inputIndex);
      continue;
    }

    const name = cleanTravellerText(entry.name, 160);
    const address = cleanTravellerText(entry.address, 300);
    const latitude = entry.latitude;
    const longitude = entry.longitude;
    if (
      !name
      || !address
      || typeof latitude !== "number"
      || !Number.isFinite(latitude)
      || latitude < -90
      || latitude > 90
      || typeof longitude !== "number"
      || !Number.isFinite(longitude)
      || longitude < -180
      || longitude > 180
    ) continue;
    result.push({
      inputIndex,
      name,
      address,
      latitude: Object.is(latitude, -0) ? 0 : latitude,
      longitude: Object.is(longitude, -0) ? 0 : longitude,
    });
    usedInputIndexes.add(inputIndex);
  }
  return result;
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
    ? Math.min(14, Math.max(1, Math.round(parsed.tripDays)))
    : 3;
  const tripStartDate = cleanCalendarDate(parsed.tripStartDate);
  const lockedOrderByDay = cleanLockedOrder(parsed.lockedOrderByDay);
  const resolutionOverrides = cleanResolutionOverrides(parsed.resolutionOverrides);
  const maxWalkingMinutesPerLeg = typeof parsed.maxWalkingMinutesPerLeg === "number" && Number.isFinite(parsed.maxWalkingMinutesPerLeg)
    ? Math.min(180, Math.max(5, Math.round(parsed.maxWalkingMinutesPerLeg)))
    : null;
  const maxTransfersPerLeg = typeof parsed.maxTransfersPerLeg === "number" && Number.isFinite(parsed.maxTransfersPerLeg)
    ? Math.min(8, Math.max(0, Math.round(parsed.maxTransfersPerLeg)))
    : null;
  return {
    destination: isDestinationChoice(parsed.destination) ? parsed.destination : "auto",
    itinerary,
    tripDays,
    tripStartDate,
    dateWasProvided: parsed.dateWasProvided === true && Boolean(tripStartDate),
    hotelQuery: typeof parsed.hotelQuery === "string" ? parsed.hotelQuery.slice(0, 160) : "",
    pace: paces.has(parsed.pace as string) ? parsed.pace as ShareableTripInput["pace"] : "balanced",
    mealPlan: mealPlans.has(parsed.mealPlan as string) ? parsed.mealPlan as ShareableTripInput["mealPlan"] : "all",
    travelPreference: travelPreferences.has(parsed.travelPreference as string)
      ? parsed.travelPreference as ShareableTripInput["travelPreference"]
      : "auto",
    arrivalAirport: cleanAirport(parsed.arrivalAirport),
    arrivalTime: cleanClock(parsed.arrivalTime),
    departureAirport: cleanAirport(parsed.departureAirport),
    departureTime: cleanClock(parsed.departureTime),
    flightKind: flightKinds.has(parsed.flightKind as string)
      ? parsed.flightKind as ShareableTripInput["flightKind"]
      : "international",
    dayStartDefault: cleanClock(parsed.dayStartDefault) || "09:00",
    dayEndTarget: cleanClock(parsed.dayEndTarget),
    transferBufferMinutes: transferBuffers.has(parsed.transferBufferMinutes as number)
      ? parsed.transferBufferMinutes as ShareableTripInput["transferBufferMinutes"]
      : 10,
    ...(maxWalkingMinutesPerLeg !== null ? { maxWalkingMinutesPerLeg } : {}),
    ...(maxTransfersPerLeg !== null ? { maxTransfersPerLeg } : {}),
    userStayMinutes: cleanNumberRecord(parsed.userStayMinutes, 15, 720),
    lastEntryTimes: cleanStopTimes(parsed.lastEntryTimes),
    dayStartTimes: cleanDayTimes(parsed.dayStartTimes),
    dayEndTimes: cleanDayTimes(parsed.dayEndTimes),
    legModeOverrides: cleanLegModes(parsed.legModeOverrides),
    dayOverrides: cleanNumberRecord(parsed.dayOverrides, 1, 14),
    ...(Object.keys(lockedOrderByDay).length > 0 ? { lockedOrderByDay } : {}),
    removedStops: cleanRemovedStops(parsed.removedStops),
    ...(resolutionOverrides.length > 0 ? { resolutionOverrides } : {}),
  };
}
