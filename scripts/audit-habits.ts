/*
 * Counts, over the trips of the plan audit, what a seasoned traveller would
 * change about the hours of a day: a temple or a museum late in the day, a
 * museum first thing while a shrine or a park was on the same day, a night
 * market before the evening, a fish market in the afternoon, a palace or a large zoo (a place of the first
 * half of the day, by its sight note) still being visited after four, days called late — and what the plans
 * cost in minutes on the way. A development tool for comparing two versions of the
 * planner; nothing here runs on the site.
 *
 *   node --experimental-strip-types scripts/audit-habits.ts [--lines]
 */
import { isDaytime, isOpenEarly } from "../lib/shiori/habits.ts";
import { habitOf } from "../lib/shiori/plan.ts";
import { auditPlan, scenarios } from "./audit-scenarios.ts";

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const lines = process.argv.includes("--lines");
const count = { daytimeLate: 0, daytimeLatePlans: 0, ticketedFirst: 0, ticketedFirstPlans: 0, eveningEarly: 0, eveningEarlyPlans: 0, morningLate: 0, firstHalfLate: 0, lateDays: 0, latePlans: 0, moving: 0, needsDays: 0, drop: 0, tooMuch: 0, days: 0 };
for (const scenario of scenarios) {
  const { plan } = auditPlan(scenario.id);
  const seen = { daytimeLate: 0, ticketedFirst: 0, eveningEarly: 0, morningLate: 0, firstHalfLate: 0, lateDays: 0 };
  for (const day of plan.days) {
    count.days += 1;
    count.moving += day.travelMinutes;
    if (day.runsLate) seen.lateDays += 1;
    const habits = day.stops.map((stop) => habitOf(stop.place));
    day.stops.forEach((stop, index) => {
      // (A clock after midnight is later still.)
      const arrive = minutes(stop.arrive) + (stop.arriveNextDay ? 1_440 : 0);
      const note = (what: string) => { if (lines) console.log(`${scenario.id} day ${day.index + 1}: ${what} ${stop.arrive}–${stop.leave} ${stop.place.name} [${stop.place.kind ?? "?"}]`); };
      if (isDaytime(habits[index]) && arrive >= 16 * 60 + 30) { seen.daytimeLate += 1; note("daytime place late"); }
      if (index === 0 && habits[index] === "ticketed" && arrive < 9 * 60 + 30 && habits.some((habit) => isOpenEarly(habit))) { seen.ticketedFirst += 1; note("ticketed place first"); }
      if (habits[index] === "evening" && arrive < 16 * 60) { seen.eveningEarly += 1; note("evening place early"); }
      if (habits[index] === "morning" && arrive >= 13 * 60) { seen.morningLate += 1; note("morning place in the afternoon"); }
      if (habits[index] === "early" && minutes(stop.leave) + (stop.leaveNextDay ? 1_440 : 0) > 16 * 60) { seen.firstHalfLate += 1; note("first-half place over after 16:00"); }
    });
  }
  count.daytimeLate += seen.daytimeLate;
  count.ticketedFirst += seen.ticketedFirst;
  count.eveningEarly += seen.eveningEarly;
  count.morningLate += seen.morningLate;
  count.firstHalfLate += seen.firstHalfLate;
  count.lateDays += seen.lateDays;
  if (seen.daytimeLate) count.daytimeLatePlans += 1;
  if (seen.ticketedFirst) count.ticketedFirstPlans += 1;
  if (seen.eveningEarly) count.eveningEarlyPlans += 1;
  if (seen.lateDays) count.latePlans += 1;
  for (const notice of plan.notices) {
    if (notice.kind === "needs-days") count.needsDays += 1;
    if (notice.kind === "drop") count.drop += 1;
    if (notice.kind === "too-much") count.tooMuch += 1;
  }
}
console.log(`${scenarios.length} plans, ${count.days} days`);
console.log(`daytime places starting at or after 16:30: ${count.daytimeLate} (in ${count.daytimeLatePlans} plans)`);
console.log(`ticketed places first before 09:30 with an open-air place on the day: ${count.ticketedFirst} (in ${count.ticketedFirstPlans} plans)`);
console.log(`evening places starting before 16:00: ${count.eveningEarly} (in ${count.eveningEarlyPlans} plans)`);
console.log(`morning places (fish market, morning market) starting at or after 13:00: ${count.morningLate}`);
console.log(`places of the first half of the day (palace, large zoo) still visited after 16:00: ${count.firstHalfLate}`);
console.log(`days called late: ${count.lateDays} (in ${count.latePlans} plans); notices: needs-days ${count.needsDays}, drop ${count.drop}, too-much ${count.tooMuch}`);
console.log(`minutes moving, all days: ${count.moving}`);
