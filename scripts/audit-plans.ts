/*
 * Writes a set of plans, exactly as the planner makes them on first sight
 * (bundled sights, bundled rail network, no street paths looked up), as plain
 * text for a reader to judge: "would a seasoned traveller change this?".
 * A development tool; nothing here runs on the site.
 *
 *   node --experimental-strip-types scripts/audit-plans.ts <out-dir>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { PopularDestination, PopularSight } from "../lib/popular-sights.ts";
import { RailNetwork } from "../lib/rail-router.ts";
import { buildShioriPlan, type ShioriDay, type ShioriHotel, type ShioriLeg, type ShioriPlan } from "../lib/shiori/plan.ts";
import { placeFromSight } from "../lib/shiori/state.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: audit-plans.ts <out-dir>");
mkdirSync(out, { recursive: true });

const cities = (JSON.parse(readFileSync(new URL("../lib/popular-sights-data.json", import.meta.url), "utf8")) as { cities: PopularDestination[] }).cities;
const railOf = (id: string) => {
  const file = new URL(`../public/rail/${id}.json`, import.meta.url);
  return existsSync(file) ? new RailNetwork(JSON.parse(readFileSync(file, "utf8"))) : null;
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

type Scenario = { id: string; city: PopularDestination; sights: PopularSight[]; days: number; hotel: ShioriHotel | null; note: string };
const CITY_IDS = ["tokyo", "kyoto", "osaka", "nara", "kanazawa", "hiroshima", "fukuoka", "sapporo", "kamakura", "hakone", "nikko", "naha", "yokohama", "kobe", "paris", "london", "newyork", "seoul", "taipei", "bangkok", "rome"];
const scenarios: Scenario[] = [];
for (const [cityIndex, id] of CITY_IDS.entries()) {
  const city = cities.find((entry) => entry.id === id);
  if (!city) continue;
  const next = draws(1000 + cityIndex);
  const centre: ShioriHotel = { name: "中心部のホテル", lat: city.lat, lon: city.lon };
  const edgeSight = [...city.sights].sort((a, b) => Math.hypot(b.lat - city.lat, b.lon - city.lon) - Math.hypot(a.lat - city.lat, a.lon - city.lon))[0];
  const edge: ShioriHotel = { name: "外れのホテル", lat: edgeSight.lat, lon: edgeSight.lon };
  const shapes: Array<{ sights: PopularSight[]; days: number; hotel: ShioriHotel | null; note: string }> = [
    { sights: city.sights.slice(0, 5), days: 1, hotel: null, note: "top 5 sights, 1 day, no hotel" },
    { sights: city.sights.slice(0, 8), days: 2, hotel: centre, note: "top 8 sights, 2 days, hotel in the centre" },
    { sights: pick(city.sights, 10, next), days: 3, hotel: edge, note: "10 sights drawn at random, 3 days, hotel at the edge of the city" },
  ];
  for (const [shapeIndex, shape] of shapes.entries()) scenarios.push({ id: `${id}-${shapeIndex + 1}`, city, ...shape });
}

const kindOf = (kind: string | undefined) => kind ?? "?";
function legText(leg: ShioriLeg | null): string {
  if (!leg) return "";
  if (leg.mode === "rail" && leg.rail) {
    const rides = leg.rail.rides.map((ride) => `${ride.line ?? "line unknown"} ${ride.from}→${ride.to} (${ride.stops} stops, ${ride.minutes} min)`).join(" + ");
    return `    ↓ train ${leg.minutes} min (walk ${leg.rail.walkToMinutes} to ${leg.rail.walkToStation}; ${leg.rail.transfers} change(s); walk ${leg.rail.walkFromMinutes} from ${leg.rail.walkFromStation}) ${rides}`;
  }
  return `    ↓ ${leg.mode} ${leg.minutes} min`;
}
function dayText(day: ShioriDay, hotel: ShioriHotel | null): string {
  const lines = [`  Day ${day.index + 1} "${day.title}" — ${day.start}–${day.end}${day.endsNextDay ? " (next day)" : ""}, load ${day.load}${day.runsLate ? ", runs late" : ""}, moving ${day.travelMinutes} min, on foot ${day.walkMinutes} min${day.noLunchRoom ? ", NO ROOM FOR LUNCH" : ""}`];
  if (hotel && day.fromHotel) lines.push(`    leave ${hotel.name} ${day.start}`, legText(day.fromHotel));
  day.stops.forEach((stop, index) => {
    lines.push(`    ${stop.arrive}–${stop.leave} ${stop.place.name} [${kindOf(stop.place.kind)}; stay ${stop.stayMinutes} min${stop.waitMinutes ? `; waits ${stop.waitMinutes} min first` : ""}]`);
    for (const meal of day.meals.filter((entry) => entry.afterStop === index)) lines.push(`      (${meal.kind} ${meal.start}${meal.end ? `–${meal.end}` : ""} near ${meal.nearName})`);
    if (day.cafe && day.cafe.afterStop === index) lines.push(`      (café break ${day.cafe.time}, ${day.cafe.reason})`);
    if (index < day.legs.length) lines.push(legText(day.legs[index]));
  });
  if (hotel && day.toHotel) lines.push(legText(day.toHotel), `    back at ${hotel.name} ${day.end}`);
  return lines.join("\n");
}
function planText(scenario: Scenario, plan: ShioriPlan): string {
  const places = scenario.sights.map((sight) => placeFromSight(sight, "ja"));
  return [
    `### ${scenario.id} — ${scenario.city.ja} (${scenario.city.en}): ${scenario.note}`,
    `Asked for: ${scenario.days} day(s). Hotel: ${scenario.hotel ? `${scenario.hotel.name} (${scenario.hotel.lat.toFixed(4)}, ${scenario.hotel.lon.toFixed(4)})` : "none"}. Rail network bundled: ${railOf(scenario.city.id) ? "yes" : "no"}.`,
    `Wishlist, in the order chosen: ${places.map((place) => `${place.name} [${kindOf(place.kind)}; ${place.stayMinutes} min; ${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}]`).join(" / ")}`,
    ...plan.days.map((day) => dayText(day, plan.hotel)),
    `Free days: ${plan.freeDays}. Left out: ${plan.leftOut.join(", ") || "none"}. Notices: ${plan.notices.length ? plan.notices.map((notice) => JSON.stringify(notice)).join(" ") : "none"}.`,
    plan.stayNear ? `Suggested area to stay: ${plan.stayNear.nearName ?? `${plan.stayNear.latitude.toFixed(4)}, ${plan.stayNear.longitude.toFixed(4)}`}.` : "",
  ].filter(Boolean).join("\n");
}

const BATCHES = 6;
const batches: string[][] = Array.from({ length: BATCHES }, () => []);
scenarios.forEach((scenario, index) => {
  const plan = buildShioriPlan({ places: scenario.sights.map((sight) => placeFromSight(sight, "ja")), days: scenario.days, hotel: scenario.hotel, locale: "ja" }, { rail: railOf(scenario.city.id), cities });
  batches[index % BATCHES].push(planText(scenario, plan));
});
batches.forEach((texts, index) => writeFileSync(`${out}/plans-${index + 1}.txt`, `${texts.join("\n\n")}\n`));
console.log(`${scenarios.length} plans in ${BATCHES} files under ${out}`);
