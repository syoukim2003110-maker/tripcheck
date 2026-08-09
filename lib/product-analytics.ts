/**
 * Privacy-minimal product telemetry for the P0 funnel.
 *
 * The schema is a closed allowlist: itinerary text, place/hotel names,
 * addresses, dates, reservation times and identifiers have no representable
 * field. Events are operational aggregates only.
 */

export const PRODUCT_EVENT_NAMES = Object.freeze([
  "trip_input_started",
  "places_parsed",
  "places_resolved",
  "constraints_completed",
  "provisional_result_shown",
  "live_verification_completed",
  "alternative_applied",
  "plan_saved_or_shared",
] as const);

export type ProductEventName = typeof PRODUCT_EVENT_NAMES[number];

export type ProductEventFields = Partial<{
  place_count: number;
  trip_day_count: number;
  constraint_count: number;
  verified_count: number;
  unknown_count: number;
  solver_time_ms: number;
  provider_name: "google" | "anthropic" | "open_meteo" | "derived" | "none";
  error_code: string;
  result_state: "VERIFIED_FEASIBLE" | "PROVISIONAL_FEASIBLE" | "FEASIBLE_IF_ASSUMPTIONS" | "INFEASIBLE_HARD_CONFLICT" | "UNKNOWN";
  alternative_type: "CHANGE_DAYS" | "START_EARLIER" | "END_LATER" | "REMOVE_OPTIONAL" | "CHANGE_BASE" | "CHANGE_MODE" | "OPTIMIZE_ORDER";
}>;

export type ProductEvent = Readonly<{
  event: ProductEventName;
  fields: ProductEventFields;
}>;

const eventNames = new Set<string>(PRODUCT_EVENT_NAMES);
const numericBounds: Record<string, readonly [number, number]> = Object.freeze({
  place_count: [0, 30],
  trip_day_count: [1, 14],
  constraint_count: [0, 200],
  verified_count: [0, 500],
  unknown_count: [0, 500],
  solver_time_ms: [0, 120_000],
});
const providers = new Set(["google", "anthropic", "open_meteo", "derived", "none"]);
const resultStates = new Set(["VERIFIED_FEASIBLE", "PROVISIONAL_FEASIBLE", "FEASIBLE_IF_ASSUMPTIONS", "INFEASIBLE_HARD_CONFLICT", "UNKNOWN"]);
const alternatives = new Set(["CHANGE_DAYS", "START_EARLIER", "END_LATER", "REMOVE_OPTIONAL", "CHANGE_BASE", "CHANGE_MODE", "OPTIMIZE_ORDER"]);
const allowedFieldNames = new Set([...Object.keys(numericBounds), "provider_name", "error_code", "result_state", "alternative_type"]);

export function parseProductEvent(input: unknown): ProductEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  if (typeof source.event !== "string" || !eventNames.has(source.event)) return null;
  if (!source.fields || typeof source.fields !== "object" || Array.isArray(source.fields)) return null;
  const rawFields = source.fields as Record<string, unknown>;
  if (Object.keys(rawFields).some((key) => !allowedFieldNames.has(key))) return null;

  const fields: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    const bounds = numericBounds[key];
    if (bounds) {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      fields[key] = Math.min(bounds[1], Math.max(bounds[0], Math.round(value)));
      continue;
    }
    if (key === "provider_name" && typeof value === "string" && providers.has(value)) fields[key] = value;
    else if (key === "result_state" && typeof value === "string" && resultStates.has(value)) fields[key] = value;
    else if (key === "alternative_type" && typeof value === "string" && alternatives.has(value)) fields[key] = value;
    else if (key === "error_code" && typeof value === "string" && /^[a-z0-9_]{1,40}$/.test(value)) fields[key] = value;
    else return null;
  }

  return { event: source.event as ProductEventName, fields: fields as ProductEventFields };
}

export function trackProductEvent(event: ProductEventName, fields: ProductEventFields = {}) {
  const parsed = parseProductEvent({ event, fields });
  if (!parsed || typeof window === "undefined") return false;
  const body = JSON.stringify(parsed);
  try {
    if (typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon("/api/product-events", new Blob([body], { type: "application/json" }));
    }
    void fetch("/api/product-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    return true;
  } catch {
    return false;
  }
}
