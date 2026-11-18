/*
 * The trips of the plan audit: 21 cities, three shapes each, drawn the same
 * way on every run. Kept apart from the tool that prints them so that a test
 * can build the very plan a reader found a fault in.
 */
import { existsSync, readFileSync } from "node:fs";

import type { PopularDestination, PopularSight } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { buildShioriPlan, type ShioriHotel, type ShioriPlan } from "../lib/shiori/plan.ts";
import { placeFromSight } from "../lib/shiori/state.ts";
import { shioriStayMinutes } from "../lib/shiori/stay.ts";

export const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
const networks = new Map<string, RailNetwork | null>();
export const railOf = (id: string) => {
  if (!networks.has(id)) {
    const file = new URL(`../public/rail/${id}.json`, import.meta.url);
    networks.set(id, existsSync(file) ? new RailNetwork(JSON.parse(readFileSync(file, "utf8"))) : null);
  }
  return networks.get(id) ?? null;
};

/** A repeatable draw, so that the same scenarios come out on every run. */
function draws(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function pick<T>(items: readonly T[], count: number, next: () => number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  while (chosen.length < count && pool.length > 0) chosen.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return chosen;
}

export type Scenario = { id: string; city: PopularDestination; sights: PopularSight[]; days: number; hotel: ShioriHotel | null; note: string };
const CITY_IDS = ["tokyo", "kyoto", "osaka", "nara", "kanazawa", "hiroshima", "fukuoka", "sapporo", "kamakura", "hakone", "nikko", "naha", "yokohama", "kobe", "paris", "london", "newyork", "seoul", "taipei", "bangkok", "rome"];
export const scenarios: Scenario[] = [];
for (const [cityIndex, id] of CITY_IDS.entries()) {
  const city = cities.find((entry) => entry.id === id);
  if (!city) continue;
  const next = draws(1000 + cityIndex);
  // Invented hotels, marked as such (an id-less hotel is one kept from before hotels had ids, which may be Apple's).
  const centre: ShioriHotel = { name: "中心部のホテル", lat: city.lat, lon: city.lon, id: "scenario-centre-hotel" };
  const edgeSight = [...city.sights].sort((a, b) => Math.hypot(b.lat - city.lat, b.lon - city.lon) - Math.hypot(a.lat - city.lat, a.lon - city.lon))[0];
  const edge: ShioriHotel = { name: "外れのホテル", lat: edgeSight.lat, lon: edgeSight.lon, id: "scenario-edge-hotel" };
  const shapes: Array<{ sights: PopularSight[]; days: number; hotel: ShioriHotel | null; note: string }> = [
    { sights: city.sights.slice(0, 5), days: 1, hotel: null, note: "top 5 sights, 1 day, no hotel" },
    { sights: city.sights.slice(0, 8), days: 2, hotel: centre, note: "top 8 sights, 2 days, hotel in the centre" },
    { sights: pick(city.sights, 10, next), days: 3, hotel: edge, note: "10 sights drawn at random, 3 days, hotel at the edge of the city" },
  ];
  for (const [shapeIndex, shape] of shapes.entries()) scenarios.push({ id: `${id}-${shapeIndex + 1}`, city, ...shape });
}

/**
 * The places of an audit trip, as a traveller adds them. `stays: "kind"`: with
 * the stay the rule by kind gives each (stay.ts) instead of the usual stay of
 * the sight notes — the trips as they were when most of the planner's rules
 * were found on them, so that a test of such a rule keeps its scenario.
 */
export const scenarioPlaces = (scenario: Scenario, stays: "notes" | "kind" = "notes") => scenario.sights.map((sight) => (
  stays === "kind" ? { ...placeFromSight(sight, "ja"), stayMinutes: shioriStayMinutes(sight.kind, `${sight.ja} ${sight.en}`) } : placeFromSight(sight, "ja")
));
/**
 * The plan of one audit trip, by its name in the audit ("kyoto-3"): as a
 * traveller first sees it, or — `packAnyway` — with every place planned on
 * the days asked for however late they run, as the audit first read them.
 * `stays: "kind"`: see scenarioPlaces.
 */
export function auditPlan(id: string, options: { packAnyway?: boolean; stays?: "notes" | "kind" } = {}): { scenario: Scenario; plan: ShioriPlan } {
  const scenario = scenarios.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`no audit trip ${id}`);
  return { scenario, plan: buildShioriPlan({ places: scenarioPlaces(scenario, options.stays), days: scenario.days, hotel: scenario.hotel, locale: "ja", packAnyway: options.packAnyway === true }, { rail: railOf(scenario.city.id), cities }) };
}
