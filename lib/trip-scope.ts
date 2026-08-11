// TC-062: deterministic detection of trips that leave TripCheck's supported
// territory. The terms name the unsupported cases — border crossings,
// multi-time-zone travel and ferries — and this module turns the evidence the
// planner already holds (resolved-stop country codes, destination time zones,
// Google transit boarding steps) into at most one short warning per case.
// Pure data in, warning list out: no network, no React, never blocks a plan.
import { destinationForCountryCode, utcOffsetMinutesAt } from "./destinations.ts";

export type TripScopeStop = Readonly<{ countryCode?: string | null }>;
export type TripScopeTransitStep = Readonly<{ vehicleType?: string | null }>;

export type TripScopeWarning =
  | Readonly<{ kind: "border"; countryCodes: readonly string[] }>
  | Readonly<{ kind: "timezone"; timeZones: readonly string[] }>
  | Readonly<{ kind: "ferry" }>;

/**
 * Warnings for a trip whose resolved places or measured transit legs leave
 * the supported single-territory scope. Silent for the common case: one
 * country (or one destination profile), one clock, no ferry evidence.
 *
 * `reference` fixes the instant used to compare zone clocks (DST); callers
 * default to "now", tests pass a fixed date.
 */
export function tripScopeWarnings(
  stops: ReadonlyArray<TripScopeStop>,
  transitSteps?: ReadonlyArray<TripScopeTransitStep> | null,
  reference: Date = new Date(),
): TripScopeWarning[] {
  const warnings: TripScopeWarning[] = [];
  const countryCodes = [...new Set(stops.flatMap((stop) => {
    const code = typeof stop.countryCode === "string" ? stop.countryCode.trim().toUpperCase() : "";
    return /^[A-Z]{2}$/.test(code) ? [code] : [];
  }))].sort();

  // Countries the destination model declares one coverage profile (IT+VA+SM,
  // FR+MC, CH+LI, ES+AD, NL+BE+LU) count as one territory: a Rome trip that
  // includes the Vatican must not read as a border crossing. Countries with
  // no profile stay distinct territories of their own.
  const territories = new Set(countryCodes.map((code) => destinationForCountryCode(code)?.id ?? `country:${code}`));
  if (territories.size >= 2) warnings.push({ kind: "border", countryCodes });

  // Multiple time zones means the clocks actually differ at the reference
  // instant — Paris and Rome are distinct IANA zones on the same clock and
  // stay silent. Zone data comes from the destination profile, so a country
  // without a profile contributes nothing here (the border warning already
  // covers it).
  const timeZones = [...new Set(countryCodes.flatMap((code) => {
    const zone = destinationForCountryCode(code)?.timeZone;
    return zone ? [zone] : [];
  }))].sort();
  const offsets = new Set(timeZones.flatMap((zone) => {
    const offset = utcOffsetMinutesAt(reference, zone);
    return offset === null ? [] : [offset];
  }));
  if (offsets.size >= 2) warnings.push({ kind: "timezone", timeZones });

  // Ferries are only visible in live evidence: a Google transit boarding step
  // whose vehicle type is FERRY. Without measured transit legs this stays
  // silent rather than guessing from geography.
  if ((transitSteps ?? []).some((step) => step.vehicleType?.toUpperCase() === "FERRY")) {
    warnings.push({ kind: "ferry" });
  }
  return warnings;
}
