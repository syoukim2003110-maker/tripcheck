import assert from "node:assert/strict";
import test from "node:test";

import { dayClock, daySearch, scheduleDay, type SearchProblem } from "../lib/shiori/day-search.ts";

/*
 * Times a traveller entered — when day 1 can start, when the last day has to
 * be over, a booked time on a place — in the search over days and orders.
 * Everything here is on tables of minutes written by hand or drawn at
 * random, and every "best" is checked against all the alternatives, tried
 * one by one with a clock written out again in this file.
 */

type Meal = "lunch" | "dinner" | null;
const at = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
function table(count: number, minutes: (from: number, to: number) => number) {
  return Array.from({ length: count }, (_, from) => Array.from({ length: count }, (_, to) => (from === to ? 0 : minutes(from, to))));
}
function generator(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((state / 2_147_483_648) * below);
  };
}
function permutations(list: readonly number[]): number[][] {
  if (list.length <= 1) return [[...list]];
  return list.flatMap((head, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [head, ...rest]));
}

/* ------------------------------------------------------------------ clock */

/** The day clock as it was before times could be entered, copied here: without a frame the new one must answer the same. */
function oldClockPass(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], first: number, lunchAt: number) {
  const arrive: number[] = [];
  const leave: number[] = [];
  const wait: number[] = [];
  let missed = 0;
  let cursor = first;
  for (let position = 0; position < stays.length; position += 1) {
    const meal = meals[position];
    let arrival = cursor;
    let held = 0;
    if (meal) {
      const hours = meal === "lunch" ? { open: 690, lastSeat: 840 } : { open: 1050, lastSeat: 1200 };
      const seated = Math.max(cursor, hours.open);
      if (seated > hours.lastSeat) missed += 1;
      else {
        held = seated - cursor;
        arrival = seated;
      }
    }
    const departure = arrival + stays[position] + (position === lunchAt ? 60 : 0);
    arrive.push(arrival);
    leave.push(departure);
    wait.push(held);
    cursor = departure;
    if (position < stays.length - 1) cursor += rides[position] + 10;
  }
  return { arrive, leave, wait, missed };
}
function oldDayClock(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], first: number) {
  const before = oldClockPass(stays, meals, rides, first, -1);
  let lunchAt = -1;
  if (!meals.includes("lunch")) {
    let nearest = Infinity;
    for (let position = 0; position < stays.length; position += 1) {
      const end = before.leave[position];
      if (meals[position] || end < 690 || end > 840) continue;
      if (Math.abs(end - 750) < nearest) {
        nearest = Math.abs(end - 750);
        lunchAt = position;
      }
    }
  }
  return { ...(lunchAt >= 0 ? oldClockPass(stays, meals, rides, first, lunchAt) : before), lunchAt };
}
function oldScheduleDay(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], hotelOut: number | null) {
  const door = hotelOut === null ? 0 : hotelOut + 10;
  const usual = (hotelOut === null ? 540 : 510) + door;
  const base = oldDayClock(stays, meals, rides, usual);
  const held = base.wait.findIndex((minutes) => minutes > 0);
  if (held >= 0) {
    const lunchBy = (clock: { arrive: number[] }) => meals.every((meal, position) => (
      meal !== "lunch" || position >= held || clock.arrive[position] <= Math.max(base.arrive[position], 780)
    ));
    for (let shift = base.wait[held]; shift > 0; shift -= shift % 5 || 5) {
      const later = oldDayClock(stays, meals, rides, usual + shift);
      if (later.missed === base.missed && later.arrive[held] === base.arrive[held] && lunchBy(later)) return { ...later, start: usual + shift - door };
    }
  }
  return { ...base, start: usual - door };
}

test("with nothing entered the day clock answers exactly as it did before", () => {
  const random = generator(11);
  for (let round = 0; round < 2_000; round += 1) {
    const count = 1 + random(7);
    const stays = Array.from({ length: count }, () => 15 + 15 * random(12));
    const meals: Meal[] = stays.map(() => (random(6) === 0 ? "lunch" : random(8) === 0 ? "dinner" : null));
    const rides = Array.from({ length: count - 1 }, () => 3 + random(70));
    const first = 500 + random(200);
    const now = dayClock(stays, meals, rides, first);
    const then = oldDayClock(stays, meals, rides, first);
    assert.deepEqual([now.arrive, now.leave, now.wait, now.missed, now.lunchAt], [then.arrive, then.leave, then.wait, then.missed, then.lunchAt], `round ${round}`);
    assert.deepEqual([now.late, now.hardOver, now.noLunchRoom], [0, 0, false]);
    const hotelOut = random(2) === 0 ? null : 5 + random(50);
    const printed = scheduleDay(stays, meals, rides, hotelOut);
    const before = oldScheduleDay(stays, meals, rides, hotelOut);
    assert.deepEqual([printed.arrive, printed.leave, printed.wait, printed.missed, printed.lunchAt, printed.start], [before.arrive, before.leave, before.wait, before.missed, before.lunchAt, before.start], `round ${round}`);
    // A frame that says nothing changes nothing either.
    const empty = dayClock(stays, meals, rides, first, { fixed: stays.map(() => null) });
    assert.deepEqual([empty.arrive, empty.leave, empty.wait, empty.missed, empty.lunchAt], [then.arrive, then.leave, then.wait, then.missed, then.lunchAt], `round ${round}`);
    const silent = scheduleDay(stays, meals, rides, hotelOut, { fixed: stays.map(() => null) });
    assert.deepEqual([silent.arrive, silent.leave, silent.lunchAt, silent.start], [before.arrive, before.leave, before.lunchAt, before.start], `round ${round}`);
  }
});

test("a booked time starts at exactly that time: early is a wait, late is counted and never hidden", () => {
  // Reached at 10:20 for an 11:00 booking: forty minutes of waiting, in at 11:00.
  const early = dayClock([60, 90], [null, null], [10], at("09:00"), { fixed: [null, at("11:00")] });
  assert.deepEqual([early.arrive[1], early.wait[1], early.late], [at("11:00"), 40, 0]);
  // Reached at 10:20 for a 10:00 booking: late. The clock keeps running; it does not pretend to be there at ten.
  const late = dayClock([60, 90], [null, null], [10], at("09:00"), { fixed: [null, at("10:00")] });
  assert.deepEqual([late.arrive[1], late.wait[1], late.late], [at("10:20"), 0, 1]);
  // Exactly on time is on time.
  const exact = dayClock([60, 90], [null, null], [10], at("09:00"), { fixed: [null, at("10:20")] });
  assert.deepEqual([exact.arrive[1], exact.wait[1], exact.late], [at("10:20"), 0, 0]);
  // A booked restaurant is seated at its booked time, whatever the usual meal hours say.
  const table = dayClock([60, 60], [null, "lunch"], [10], at("09:00"), { fixed: [null, at("15:00")] });
  assert.deepEqual([table.arrive[1], table.missed, table.late, table.lunchAt], [at("15:00"), 0, 0, -1]);
  // The finish counts the ride home.
  const closing = dayClock([60, 60], [null, null], [10], at("09:00"), { close: at("11:30"), homeward: 25 });
  assert.equal(closing.hardOver, at("11:20") + 25 - at("11:30"));
  assert.equal(dayClock([60, 60], [null, null], [10], at("09:00"), { close: at("11:45"), homeward: 25 }).hardOver, 0);
});

test("a booking before the usual start opens the day early; one the traveller cannot reach is late", () => {
  // 07:00 sunrise visit, no hotel: the day begins at 07:00, not 09:00.
  const sunrise = scheduleDay([60, 60], [null, null], [20], null, { fixed: [at("07:00"), null] });
  assert.deepEqual([sunrise.start, sunrise.arrive[0], sunrise.late], [at("07:00"), at("07:00"), 0]);
  // From a hotel twenty minutes (and ten of slack) away: leave at 06:30.
  const fromHotel = scheduleDay([60, 60], [null, null], [20], 20, { fixed: [at("07:00"), null] });
  assert.deepEqual([fromHotel.start, fromHotel.arrive[0], fromHotel.late], [at("06:30"), at("07:00"), 0]);
  // The traveller can only start at 08:00 on that day: 07:00 is not reachable, and says so.
  const blocked = scheduleDay([60, 60], [null, null], [20], null, { fixed: [at("07:00"), null], open: at("08:00") });
  assert.equal(blocked.late, 1);
  assert.ok(blocked.start >= at("08:00"));
  // A start entered for the day is a floor, never a pull: 07:00 does not start the day before nine …
  assert.equal(scheduleDay([60, 60], [null, null], [20], null, { open: at("07:00") }).start, at("09:00"));
  // … and a later one starts it later.
  const afternoon = scheduleDay([60, 60], [null, null], [20], 15, { open: at("13:00") });
  assert.deepEqual([afternoon.start, afternoon.arrive[0]], [at("13:00"), at("13:25")]);
});

test("the lunch hour never breaks an entered time", () => {
  // A sight until 11:35, then a 12:00 booking: lunch after the sight would
  // make the booking late, so the hour goes behind the booked visit.
  const pushed = dayClock([155, 90, 60], [null, null, null], [15, 20], at("09:00"), { fixed: [null, at("12:00"), null] });
  assert.deepEqual([pushed.late, pushed.lunchAt, pushed.arrive[1], pushed.leave[1]], [0, 1, at("12:00"), at("14:30")]);
  // And when that in turn would break the next booking, the day has no lunch hour and says so.
  const none = dayClock([155, 90, 60], [null, null, null], [15, 20], at("09:00"), { fixed: [null, at("12:00"), at("14:00")] });
  assert.deepEqual([none.late, none.lunchAt, none.noLunchRoom], [0, -1, true]);
  // A lunch hour that would carry the day past its finish is not taken either.
  const closing = dayClock([180, 60], [null, null], [20], at("09:00"), { close: at("14:00") });
  assert.deepEqual([closing.hardOver, closing.lunchAt, closing.noLunchRoom], [0, -1, true]);
  // With room for it, lunch is where it always was.
  const roomy = dayClock([180, 60], [null, null], [20], at("09:00"), { close: at("15:00") });
  assert.deepEqual([roomy.hardOver, roomy.lunchAt, roomy.noLunchRoom], [0, 0, false]);
  // A restaurant booked for lunch is the day's lunch.
  const booked = dayClock([120, 60], [null, "lunch"], [20], at("09:00"), { fixed: [null, at("13:00")] });
  assert.deepEqual([booked.lunchAt, booked.arrive[1], booked.wait[1], booked.noLunchRoom], [-1, at("13:00"), 90, false]);
});

test("before a booking the day starts later rather than waiting, and keeps an hour for lunch when it can", () => {
  // One 90-minute sight, then a 13:00 booking 20 minutes away. From 09:00
  // that is a sight until 10:30 and more than two hours of standing about.
  // Printed: the sight 10:10–11:40, lunch until 12:40, there at 13:00.
  const day = scheduleDay([90, 60], [null, null], [10], null, { fixed: [null, at("13:00")] });
  assert.deepEqual([day.start, day.arrive[0], day.leave[0], day.lunchAt, day.arrive[1], day.late], [at("10:10"), at("10:10"), at("12:40"), 0, at("13:00"), 0]);
  // The booked time itself never moves, whatever the start.
  const random = generator(5);
  for (let round = 0; round < 400; round += 1) {
    const count = 2 + random(4);
    const stays = Array.from({ length: count }, () => 30 + 15 * random(8));
    const meals: Meal[] = stays.map(() => (random(7) === 0 ? "lunch" : null));
    const rides = Array.from({ length: count - 1 }, () => 5 + random(40));
    const fixed = stays.map(() => (random(3) === 0 ? 600 + 15 * random(40) : null));
    const hotelOut = random(2) === 0 ? null : 5 + random(30);
    const open = random(3) === 0 ? 540 + 30 * random(8) : null;
    const frame = { fixed, open, close: random(3) === 0 ? 900 + 30 * random(10) : null, homeward: hotelOut ?? 0 };
    const usual = Math.max(hotelOut === null ? 540 : 510, open ?? 0) + (hotelOut === null ? 0 : hotelOut + 10);
    const unshifted = dayClock(stays, meals, rides, usual, { ...frame, earliest: (open ?? 0) + (hotelOut === null ? 0 : hotelOut + 10) });
    const printed = scheduleDay(stays, meals, rides, hotelOut, frame);
    // Starting later never breaks what the usual start kept.
    assert.equal(printed.late, unshifted.late, `round ${round}`);
    assert.ok(printed.hardOver <= unshifted.hardOver, `round ${round}`);
    assert.ok(printed.start >= (open ?? 0), `round ${round}`);
    fixed.forEach((minute, position) => {
      if (minute !== null) assert.ok(printed.arrive[position] >= minute, `round ${round}: a booked visit never starts before its time`);
      if (minute !== null && printed.late === 0) assert.equal(printed.arrive[position], minute, `round ${round}`);
    });
  }
});

/* ------------------------------------------------------- order, by brute force */

type Stop = SearchProblem["stops"][number];

/**
 * One order of a day on the clock, written out again from the rules — not
 * the planner's code. `first` / `last`: the day is day 1 with a start, the
 * last day with a finish.
 */
function reference(problem: SearchProblem, order: readonly number[], first: boolean, last: boolean) {
  const { stops, minutes, hotel } = problem;
  const start = first ? problem.frames!.firstStart! : 0;
  const door = hotel ? hotel.out[order[0]] + 10 : 0;
  const run = (lunchAfter: number) => {
    let now = Math.max(hotel ? 510 : 540, start) + door;
    let late = 0;
    let missed = 0;
    let lunchWait = 0;
    const leave: number[] = [];
    const arrive: number[] = [];
    order.forEach((stop, position) => {
      const entry = stops[stop];
      if (position > 0) now += minutes[order[position - 1]][stop] + 10;
      if (typeof entry.fixed === "number") {
        // A booking earlier than the usual start opens the day, if the traveller can be there at all.
        // Between two entered times — the day's start and a booking, one booking and the next —
        // the ride alone has to arrive in time: the ten minutes of slack are given up there.
        const rideArrives = position === 0
          ? start + (hotel ? hotel.out[order[0]] : 0) <= entry.fixed
          : typeof stops[order[position - 1]].fixed === "number" && now - 10 <= entry.fixed;
        if (now > entry.fixed && rideArrives) now = entry.fixed;
        if (now <= entry.fixed) now = entry.fixed;
        else late += 1;
      } else if (entry.meal) {
        const [opens, lastSeat] = entry.meal === "lunch" ? [690, 840] : [1050, 1200];
        if (Math.max(now, opens) > lastSeat) missed += 1;
        else {
          if (entry.meal === "lunch") lunchWait += Math.max(0, opens - now);
          now = Math.max(now, opens);
        }
      }
      arrive.push(now);
      now += entry.stay + (position === lunchAfter ? 60 : 0);
      leave.push(now);
    });
    const over = last ? Math.max(0, now + (hotel ? hotel.back[order.at(-1)!] : 0) - problem.frames!.lastFinish!) : 0;
    return { arrive, leave, late, missed, lunchWait, over };
  };
  const plain = run(-1);
  let clock = plain;
  if (!order.some((stop) => stops[stop].meal === "lunch")) {
    const candidates = order.map((_, position) => position)
      .filter((position) => !stops[order[position]].meal && plain.leave[position] >= 690 && plain.leave[position] <= 840)
      .sort((left, right) => Math.abs(plain.leave[left] - 750) - Math.abs(plain.leave[right] - 750) || left - right);
    for (const candidate of candidates) {
      const lunched = run(candidate);
      if (lunched.late <= plain.late && (lunched.over === 0 || plain.over > 0)) {
        clock = lunched;
        break;
      }
    }
  }
  // The planner's own habits (18:00, 21:30) hold only the stops nobody booked.
  let overrun = 0;
  order.forEach((stop, position) => {
    if (typeof stops[stop].fixed === "number") return;
    overrun = Math.max(overrun, clock.leave[position] - (stops[stop].meal === "dinner" ? 1290 : 1080));
  });
  let travel = hotel ? hotel.out[order[0]] + hotel.back[order.at(-1)!] : 0;
  for (let position = 0; position + 1 < order.length; position += 1) travel += minutes[order[position]][order[position + 1]];
  const broken = clock.late + (clock.over > 0 ? 1 : 0);
  const fine = (minutesOver: number) => (minutesOver > 0 ? 500 + minutesOver * 10 + (minutesOver * minutesOver) / 6 : 0);
  return {
    broken,
    kept: broken === 0 && overrun === 0 && clock.missed === 0,
    travel,
    cost: travel + clock.lunchWait / 2 + fine(overrun) + clock.missed * 1000 + (broken > 0 ? 1000 * clock.late + fine(clock.over) : 0),
    arrive: clock.arrive,
    leave: clock.leave,
  };
}

/** Whether an order is one a day may have: among the stops nobody booked, a dinner is last — and, `opens`, a day-filling stay first. */
function allowed(stops: readonly Stop[], order: readonly number[], opens: boolean) {
  let rank = -1;
  for (const stop of order) {
    if (typeof stops[stop].fixed === "number") continue;
    const next = stops[stop].meal === "dinner" ? 2 : opens && !stops[stop].meal && stops[stop].stay >= 300 ? 0 : 1;
    if (next < rank) return false;
    rank = next;
  }
  return true;
}

/** The best of every order of `ids`, one by one. */
function bestByBruteForce(problem: SearchProblem, ids: readonly number[], first: boolean, last: boolean) {
  const leastOf = (opens: boolean) => {
    let least: ReturnType<typeof reference> | null = null;
    for (const order of permutations(ids)) {
      if (!allowed(problem.stops, order, opens)) continue;
      const day = reference(problem, order, first, last);
      if (least === null || day.broken < least.broken || (day.broken === least.broken && day.cost < least.cost - 1e-6)) least = day;
    }
    return least!;
  };
  // A stay that fills the day opens it when the day can be kept that way; else any order may be the day's.
  const opened = leastOf(true);
  return opened.kept ? opened : leastOf(false);
}

function randomDay(random: (below: number) => number, count: number, days: number) {
  const stops: Stop[] = Array.from({ length: count }, () => ({ stay: 30 + 15 * random(6), meal: null, day: null }));
  if (random(4) === 0) stops[random(count)] = { stay: 60, meal: "lunch", day: null };
  if (random(4) === 0) stops[count - 1] = { stay: 90, meal: "dinner", day: null };
  if (random(8) === 0) stops[0] = { stay: 300, meal: null, day: null };
  const bookings = random(4);
  for (let booking = 0; booking < bookings; booking += 1) {
    const stop = random(count);
    stops[stop] = { ...stops[stop], day: 1 + random(days), fixed: 420 + 15 * random(56) };
  }
  const problem: SearchProblem = {
    stops,
    minutes: table(count, () => 5 + random(50)),
    km: table(count, () => 1 + random(9)),
    hotel: random(2) === 0 ? { out: stops.map(() => 5 + random(40)), back: stops.map(() => 5 + random(40)), km: stops.map(() => 3) } : null,
    frames: { firstStart: random(2) === 0 ? 540 + 30 * random(12) : null, lastFinish: random(2) === 0 ? 720 + 30 * random(16) : null },
  };
  return problem;
}

test("with a booked time, a start or a finish, the order of a day is still the best of all orders", () => {
  // 500 random days of two to seven stops — up to three bookings, with and
  // without a hotel, a lunch restaurant, a dinner, a day-filling stay, on
  // an ordinary day, day 1, the last day or a one-day trip — each against
  // every order tried one by one on the clock written out above.
  // (More rounds, from another seed: SHIORI_FRAME_ROUNDS=20000 SHIORI_FRAME_SEED=7 node --test …)
  const rounds = Number(process.env.SHIORI_FRAME_ROUNDS ?? 500);
  const random = generator(Number(process.env.SHIORI_FRAME_SEED ?? 2026));
  let framed = 0;
  let unbroken = 0;
  let impossible = 0;
  for (let round = 0; round < rounds; round += 1) {
    const count = 2 + random(6);
    const problem = randomDay(random, count, 1);
    const cls = (problem.frames!.firstStart !== null && random(2) === 0 ? 1 : 0) | (problem.frames!.lastFinish !== null && random(2) === 0 ? 2 : 0);
    const ids = problem.stops.map((_, index) => index);
    const search = daySearch(problem);
    const found = search.solveDay(ids, cls);
    assert.deepEqual([...found.order].sort((left, right) => left - right), ids, `round ${round}`);
    const mine = reference(problem, found.order, Boolean(cls & 1), Boolean(cls & 2));
    const best = bestByBruteForce(problem, ids, Boolean(cls & 1), Boolean(cls & 2));
    const where = `round ${round}: order ${found.order.join(">")}, class ${cls}`;
    // Never an order that breaks an entered time when some order keeps them all; the least broken otherwise.
    assert.equal(mine.broken, best.broken, where);
    // And among those, the cheapest: the least travel when the day can be kept.
    assert.ok(Math.abs(mine.cost - best.cost) < 1e-6, `${where}: cost ${mine.cost}, best ${best.cost}`);
    if (best.kept) assert.equal(mine.travel, best.travel, where);
    // The planner's own account of that order is the same clock.
    const told = search.describe(found.order, cls);
    assert.deepEqual([told.late + (told.hardOver > 0 ? 1 : 0), told.keepable], [mine.broken, mine.kept], where);
    assert.ok(Math.abs(told.orderCost - mine.cost) < 1e-6, where);
    if (cls !== 0 || problem.stops.some((stop) => typeof stop.fixed === "number")) framed += 1;
    if (best.broken === 0) unbroken += 1;
    else impossible += 1;
  }
  // The rounds are not all of one kind.
  assert.ok(framed > rounds * 0.7 && unbroken > rounds * 0.3 && impossible > rounds * 0.1, `${framed} with a time entered, ${unbroken} that can be kept, ${impossible} that cannot`);
});

test("the printed day keeps the booked times the chosen order keeps, to the minute", () => {
  const random = generator(77);
  for (let round = 0; round < 300; round += 1) {
    const count = 2 + random(5);
    const problem = randomDay(random, count, 1);
    const cls = (problem.frames!.firstStart !== null ? 1 : 0) | (problem.frames!.lastFinish !== null && random(2) === 0 ? 2 : 0);
    const search = daySearch(problem);
    const day = search.solveDay(problem.stops.map((_, index) => index), cls);
    const told = search.describe(day.order, cls);
    // Printed: possibly started later, never with more broken than the order was chosen for.
    assert.equal(day.late, told.late, `round ${round}`);
    assert.ok(day.hardOver <= told.hardOver, `round ${round}`);
    if (cls & 1) assert.ok(day.start >= problem.frames!.firstStart!, `round ${round}: starts ${day.start}`);
    if (day.late === 0) {
      day.order.forEach((stop, position) => {
        const fixed = problem.stops[stop].fixed;
        if (typeof fixed === "number") assert.equal(day.arrive[position], fixed, `round ${round}`);
      });
    }
    if (cls & 2 && day.hardOver === 0) {
      assert.ok(day.leave.at(-1)! + (problem.hotel ? problem.hotel.back[day.order.at(-1)!] : 0) <= problem.frames!.lastFinish!, `round ${round}`);
    }
  }
});

test("a booked visit in the evening may follow a dinner nobody booked; a sight nobody booked may not", () => {
  // A sight, a dinner (17:30–21:00 seating), and a night tour booked for 20:30.
  const stops: Stop[] = [
    { stay: 120, meal: null, day: null },
    { stay: 90, meal: "dinner", day: null },
    { stay: 60, meal: null, day: 1, fixed: at("20:30") },
  ];
  const search = daySearch({ stops, minutes: table(3, () => 15), km: table(3, () => 2), hotel: null });
  const day = search.solveDay([0, 1, 2]);
  assert.deepEqual(day.order, [0, 1, 2]);
  assert.equal(day.arrive[2], at("20:30"));
  // The tour is not "sightseeing after 18:00": the traveller booked that hour.
  assert.deepEqual([day.overrun, day.late, day.missed], [0, 0, 0]);
});

/* ---------------------------------------------------- grouping, by brute force */

/** Every way of putting the stops on the given day numbers, pins kept. */
function assignments(stops: readonly Stop[], labels: readonly number[]) {
  const all: number[][][] = [];
  const groups: number[][] = labels.map(() => []);
  const place = (stop: number) => {
    if (stop === stops.length) {
      if (groups.every((group) => group.length > 0)) all.push(groups.map((group) => [...group]));
      return;
    }
    const pinned = stops[stop].day;
    labels.forEach((label, index) => {
      if (pinned !== null && pinned !== label) return;
      groups[index].push(stop);
      place(stop + 1);
      groups[index].pop();
    });
  };
  place(0);
  return all;
}

test("which places share a day, and which day is day 1 and which the last, is the best of all ways", () => {
  // 150 random trips of five to seven places on one to three days, with
  // bookings, pins, a start and a finish. For the day numbers the planner
  // used, every way of putting the places on those days is costed and
  // compared with the plan. A day is costed as the search costs it while it
  // chooses — for a day with a booking that is its best order, proven above;
  // an ordinary day, or one that only starts late or ends early, is as ever
  // costed on its shortest routes, and tried in every order only if printed.
  const rounds = Math.max(150, Math.round(Number(process.env.SHIORI_FRAME_ROUNDS ?? 0) / 10));
  const random = generator(Number(process.env.SHIORI_FRAME_SEED ?? 31));
  let brokenTrips = 0;
  let labelled = 0;
  for (let round = 0; round < rounds; round += 1) {
    const days = 1 + random(3);
    const count = days === 1 ? 2 + random(5) : 5 + random(3);
    const problem = randomDay(random, count, days);
    // Bookings on one day must be able to stand together: the planner's caller sets a clashing one aside first.
    const seen = new Set<number>();
    problem.stops.forEach((stop, index) => {
      if (typeof stop.fixed !== "number") return;
      if (seen.has(stop.day!)) problem.stops[index] = { stay: stop.stay, meal: stop.meal, day: null };
      seen.add(stop.day!);
    });
    problem.stops.forEach((stop, index) => {
      if (stop.day === null && random(6) === 0) problem.stops[index] = { ...stop, day: 1 + random(days) };
    });
    const search = daySearch(problem);
    const trip = search.choose(days);
    const labels = trip.days.map((day) => day.day);
    assert.deepEqual([...trip.days.flatMap((day) => day.order)].sort((left, right) => left - right), problem.stops.map((_, index) => index), `round ${round}`);
    trip.days.forEach((day) => day.order.forEach((stop) => {
      if (problem.stops[stop].day !== null) assert.equal(day.day, problem.stops[stop].day, `round ${round}: a pinned or booked place is on its day`);
    }));
    const classOf = (label: number) => (label === 1 && problem.frames!.firstStart !== null ? 1 : 0) | (label === days && problem.frames!.lastFinish !== null ? 2 : 0);
    if (labels.some((label) => classOf(label) !== 0)) labelled += 1;
    const value = (groups: readonly (readonly number[])[]) => {
      let broken = 0;
      let cost = 0;
      let doubled = 0;
      let kept = true;
      let lonely = false;
      let full = false;
      groups.forEach((group, index) => {
        const told = search.candidateDay(group, classOf(labels[index]));
        broken += told.broken;
        cost += told.cost;
        kept &&= told.keepable;
        // (A day with a booking of up to five stops is always costed at its
        // best order; so is one of six, unless no order of it could be kept.)
        if (group.length <= 5 && group.some((stop) => typeof problem.stops[stop].fixed === "number")) {
          const best = bestByBruteForce(problem, group, Boolean(classOf(labels[index]) & 1), Boolean(classOf(labels[index]) & 2));
          const mine = reference(problem, told.order, Boolean(classOf(labels[index]) & 1), Boolean(classOf(labels[index]) & 2));
          assert.deepEqual([mine.broken, Math.round(mine.cost * 1e6)], [best.broken, Math.round(best.cost * 1e6)], `round ${round}: group ${group.join(",")} on day ${labels[index]}`);
        }
        doubled += Math.max(0, group.filter((stop) => problem.stops[stop].meal === "lunch").length - 1) + Math.max(0, group.filter((stop) => problem.stops[stop].meal === "dinner").length - 1);
        if (group.length === 1 && !problem.stops[group[0]].meal && problem.stops[group[0]].stay < 240) lonely = true;
        if (group.length >= 3) full = true;
      });
      return { broken, doubled, cost: cost + (lonely && full ? 40 : 0), kept };
    };
    const mine = value(trip.days.map((day) => day.order));
    const all = assignments(problem.stops, labels).map(value);
    const leastBroken = Math.min(...all.map((entry) => entry.broken));
    const where = `round ${round}: days ${trip.days.map((day) => `${day.day}:${day.order.join(">")}`).join(" | ")}`;
    // No way of sharing the places out breaks fewer entered times.
    assert.equal(mine.broken, leastBroken, where);
    const less = (left: typeof mine, right: typeof mine) => left.broken - right.broken || left.doubled - right.doubled || (Math.abs(left.cost - right.cost) < 1e-6 ? 0 : left.cost - right.cost);
    // None that can be kept is better; and when the plan itself cannot be kept, none at all is.
    for (const other of all) {
      if (other.kept || !mine.kept) assert.ok(less(mine, other) <= 0, `${where}: ${JSON.stringify(mine)} against ${JSON.stringify(other)}`);
    }
    if (mine.broken > 0) brokenTrips += 1;
  }
  assert.ok(labelled > 60 && brokenTrips > 5, `${labelled} trips with a special day, ${brokenTrips} that cannot keep every time`);
});

test("day 1 is used when the traveller can start in the afternoon, and left free when only the evening is left", () => {
  const stops: Stop[] = Array.from({ length: 6 }, () => ({ stay: 90, meal: null, day: null }));
  const problem = (firstStart: number): SearchProblem => ({ stops, minutes: table(6, () => 15), km: table(6, () => 2), hotel: null, frames: { firstStart, lastFinish: null } });
  // From 14:00: two sights fit before 18:00, and they are on day 1.
  const afternoon = daySearch(problem(at("14:00"))).choose(3);
  const first = afternoon.days.find((day) => day.day === 1)!;
  assert.ok(first, "day 1 is used");
  assert.ok(first.start >= at("14:00") && first.overrun === 0 && first.order.length >= 1);
  assert.equal(afternoon.days.every((day) => day.overrun === 0), true);
  // From 19:00 nothing can be seen on day 1 without running into the night:
  // the two days after it take the list.
  const evening = daySearch(problem(at("19:00"))).choose(3);
  assert.deepEqual(evening.days.map((day) => day.day), [2, 3]);
  assert.equal(evening.days.every((day) => day.overrun === 0), true);
  // With only two days there is no day to spare: day 1 is used, and is over the usual hours.
  const short = daySearch(problem(at("19:00"))).choose(1);
  assert.deepEqual(short.days.map((day) => day.day), [1]);
  assert.ok(short.days[0].start >= at("19:00"));
});

test("the last day's finish decides which places end the trip", () => {
  // Five places of two hours: the last of three days must be over by noon,
  // so it takes one place and the other two days take two each.
  const stops: Stop[] = Array.from({ length: 5 }, () => ({ stay: 120, meal: null, day: null }));
  const trip = daySearch({ stops, minutes: table(5, () => 20), km: table(5, () => 2), hotel: null, frames: { firstStart: null, lastFinish: at("12:00") } }).choose(3);
  const last = trip.days.find((day) => day.day === 3);
  assert.ok(trip.days.every((day) => day.hardOver === 0 && day.late === 0));
  if (last) {
    assert.equal(last.order.length, 1);
    assert.ok(last.leave.at(-1)! <= at("12:00"));
  }
});

test("two dinners share an evening rather than break the last day's finish", () => {
  // Two sights, a dinner booked for 20:30 on day 1 and a second dinner
  // nobody booked. Kept apart, the second dinner would sit on day 2 — which
  // has to be over by 15:00, hours before any kitchen opens for dinner.
  const stops: Stop[] = [
    { stay: 60, meal: null, day: null },
    { stay: 60, meal: null, day: null },
    { stay: 90, meal: "dinner", day: 1, fixed: at("20:30") },
    { stay: 90, meal: "dinner", day: null },
  ];
  const problem = (lastFinish: number | null): SearchProblem => ({ stops, minutes: table(4, () => 15), km: table(4, () => 2), hotel: null, frames: { firstStart: null, lastFinish } });
  const trip = daySearch(problem(at("15:00"))).choose(2);
  const dayOf = (stop: number) => trip.days.find((day) => day.order.includes(stop))!;
  assert.equal(trip.days.every((day) => day.late === 0 && day.hardOver === 0), true);
  assert.equal(dayOf(3).day, 1, "the second dinner is on the booked dinner's evening");
  assert.equal(dayOf(2).arrive[dayOf(2).order.indexOf(2)], at("20:30"));
  // Without the finish the two dinners are two evenings, as ever.
  const free = daySearch(problem(null)).choose(2);
  assert.notEqual(free.days.find((day) => day.order.includes(3))!.day, free.days.find((day) => day.order.includes(2))!.day);
});

test("a booking beyond the days asked for is never moved onto another day by the search", () => {
  const stops: Stop[] = [
    { stay: 60, meal: null, day: null },
    { stay: 60, meal: null, day: 4, fixed: at("13:00") },
    { stay: 60, meal: null, day: null },
  ];
  const trip = daySearch({ stops, minutes: table(3, () => 15), km: table(3, () => 2), hotel: null }).choose(2);
  assert.equal(trip.days.some((day) => day.order.includes(1)), false);
  assert.deepEqual([...trip.days.flatMap((day) => day.order)].sort(), [0, 2]);
});

test("a list too long to cost every split keeps its bookings as well as the exact search does", () => {
  const random = generator(404);
  for (let round = 0; round < 40; round += 1) {
    const days = 2 + random(2);
    const problem = randomDay(random, 6 + random(3), days);
    const seen = new Set<number>();
    problem.stops.forEach((stop, index) => {
      if (typeof stop.fixed !== "number") return;
      if (seen.has(stop.day!)) problem.stops[index] = { stay: stop.stay, meal: stop.meal, day: null };
      seen.add(stop.day!);
    });
    const broken = (trip: ReturnType<ReturnType<typeof daySearch>["choose"]>) => trip.days.reduce((sum, day) => sum + day.late + (day.hardOver > 0 ? 1 : 0), 0);
    const exact = broken(daySearch(problem).choose(days));
    const searched = broken(daySearch(problem, { exactSplits: 0 }).choose(days));
    assert.ok(searched <= exact, `round ${round}: ${searched} broken by the neighbourhood search, ${exact} by the exact one`);
  }
});
