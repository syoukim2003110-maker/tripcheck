/*
 * Writes a set of plans, exactly as the planner makes them on first sight
 * (bundled sights, bundled rail network, no street paths looked up), as plain
 * text for a reader to judge: "would a seasoned traveller change this?".
 * A development tool; nothing here runs on the site.
 *
 *   node --experimental-strip-types scripts/audit-plans.ts <out-dir>
 */
import { mkdirSync, writeFileSync } from "node:fs";

import type { ShioriDay, ShioriHotel, ShioriLeg, ShioriPlan } from "../lib/shiori/plan.ts";
import { auditPlan, railOf, scenarioPlaces, scenarios, type Scenario } from "./audit-scenarios.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: audit-plans.ts <out-dir>");
mkdirSync(out, { recursive: true });

const kindOf = (kind: string | undefined) => kind ?? "?";
function legText(leg: ShioriLeg | null): string {
  if (!leg) return "";
  if (leg.mode === "rail" && leg.rail) {
    const rides = leg.rail.rides.map((ride) => `${ride.line ?? "line unknown"} ${ride.from}→${ride.to} (${ride.stops} stops, ${ride.minutes} min)`).join(" + ");
    return `    ↓ train ${leg.minutes} min (walk ${leg.rail.walkToMinutes} to ${leg.rail.walkToStation}; ${leg.rail.transfers} change(s); walk ${leg.rail.walkFromMinutes} from ${leg.rail.walkFromStation}) ${rides}`;
  }
  return `    ↓ ${leg.mode} ${leg.minutes} min${leg.climb ? " (up or down a hill, way unknown)" : ""}`;
}
function dayText(day: ShioriDay, hotel: ShioriHotel | null): string {
  const lines = [`  Day ${day.index + 1} "${day.title}" — ${day.start}–${day.end}${day.endsNextDay ? " (next day)" : ""}, load ${day.load}${day.runsLate ? ", runs late" : ""}, moving ${day.travelMinutes} min, on foot ${day.walkMinutes} min${day.noLunchRoom ? ", NO ROOM FOR LUNCH" : ""}`];
  if (hotel && day.fromHotel) lines.push(`    leave ${hotel.name} ${day.start}`, legText(day.fromHotel));
  day.stops.forEach((stop, index) => {
    lines.push(`    ${stop.arrive}–${stop.leave} ${stop.place.name} [${kindOf(stop.place.kind)}; stay ${stop.stayMinutes} min${stop.lunchMinutes ? ` + lunch ${stop.lunchMinutes} min` : ""}${stop.waitMinutes ? `; waits ${stop.waitMinutes} min first` : ""}]`);
    for (const meal of day.meals.filter((entry) => entry.afterStop === index)) lines.push(`      (${meal.kind} ${meal.start}${meal.end ? `–${meal.end}` : ""} ${meal.during ? (meal.onArrival ? "on arrival, before the visit, at or near" : "during the visit, at or near") : meal.atHotel ? "back near" : "near"} ${meal.nearName})`);
    if (day.cafe && day.cafe.afterStop === index) lines.push(`      (café break ${day.cafe.time}, ${day.cafe.reason})`);
    if (index < day.legs.length) lines.push(legText(day.legs[index]));
  });
  if (hotel && day.toHotel) lines.push(legText(day.toHotel), `    back at ${hotel.name} ${day.end}`);
  return lines.join("\n");
}
function planText(scenario: Scenario, plan: ShioriPlan): string {
  const places = scenarioPlaces(scenario);
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
  batches[index % BATCHES].push(planText(scenario, auditPlan(scenario.id).plan));
});
batches.forEach((texts, index) => writeFileSync(`${out}/plans-${index + 1}.txt`, `${texts.join("\n\n")}\n`));
console.log(`${scenarios.length} plans in ${BATCHES} files under ${out}`);
