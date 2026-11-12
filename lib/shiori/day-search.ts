/*
 * Which places share a day, and in what order they are visited.
 *
 * The planning engine can build a day once it is told who is on it and in
 * what order, but each such build is a full run, so a search made of engine
 * runs can only try a few hundred arrangements and has to stop where it
 * stands. This module keeps the same clock as the engine in a few lines of
 * arithmetic — start, stay, ride, ten minutes of slack per ride, wait for a
 * restaurant to open — and with it looks at every arrangement that matters:
 *
 *   - the order within a day is found exactly (every order is considered, by
 *     dynamic programming over the day's stops), on the priced minutes the
 *     booklet will print, not on straight lines;
 *   - the grouping into days is found exactly for lists of up to twelve
 *     places (every way of splitting the list is costed), and beyond that
 *     by a search that tries every single move and swap until none helps;
 *   - equal minutes are settled by distance, so of two plans that cost the
 *     same the one a person would draw on the map wins.
 *
 * Nothing here knows about trains or names: it works on a table of minutes.
 */

export type SearchStop = {
  /** Minutes spent at the place. */
  stay: number;
  /** A restaurant chosen for this meal: it is only visited during the meal. */
  meal: "lunch" | "dinner" | null;
  /** 1-based day the traveller pinned the place to. */
  day: number | null;
};

export type SearchProblem = {
  stops: SearchStop[];
  /** Priced minutes from row to column. */
  minutes: number[][];
  /** Straight-line kilometres from row to column: the tie-break, never the price. */
  km: number[][];
  /** The way out of and back to the hotel, when there is one. */
  hotel: { out: number[]; back: number[]; km: number[] } | null;
};

/** One day as planned here; the engine is then asked to build exactly this. */
export type PlannedDay = {
  /** Indices into the problem's stops, in visiting order. */
  order: number[];
  /** Priced minutes spent moving, hotel legs included. */
  travel: number;
  /** Straight-line length of the day's route. */
  km: number;
  /** Minutes since midnight, the lunch hour included. */
  arrive: number[];
  leave: number[];
  /** Position of the stop whose stay carries the lunch hour, or -1. */
  lunchAt: number;
  /** Chosen restaurants that cannot be reached during their meal. */
  missed: number;
  /** Minutes past what a traveller can keep: sights after 18:00, a dinner after 21:30. */
  overrun: number;
  /** First arrival to the end of the last sight, before lunch takes its hour. */
  span: number;
  /** What the booklet calls a packed day. */
  tight: boolean;
  /** What the day costs a traveller, in minutes (see orderCost). */
  cost: number;
};

export type PlannedTrip = {
  /** How many day slots the engine is to be given. */
  slots: number;
  /** The days that have places, each with its 1-based day number. */
  days: Array<PlannedDay & { day: number }>;
};

/** The clock the booklet keeps, in minutes since midnight. */
export const DAY_CLOCK = {
  start: 9 * 60,
  /** From a hotel the day starts at its door, half an hour earlier. */
  hotelStart: 8 * 60 + 30,
  /** Sightseeing is over by 18:00. */
  sightsEnd: 18 * 60,
  /** A chosen dinner may run to 21:30. */
  dinnerEnd: 21 * 60 + 30,
  lunchMinutes: 60,
  /** The engine allows ten minutes of slack after every ride. */
  legBuffer: 10,
  /** When a restaurant can be the meal: seated by 14:00 for lunch, from 17:30 for dinner. */
  meals: {
    lunch: { open: 11 * 60 + 30, lastSeat: 14 * 60 },
    dinner: { open: 17 * 60 + 30, lastSeat: 20 * 60 },
  },
} as const;

/** Six and a half hours of sightseeing, lunch not counted: a day that ends after about 16:30. */
const LONG_DAY = 390;
/** A stay this long claims the day (a theme park): it opens it. */
const DAY_FILLING_STAY = 300;
/** Up to this many ordinary sights a day's order is found exactly; no real day has more. */
const EXACT_ORDER_STOPS = 9;
/** Lists up to this long keep one table of routes for all their days (and are exact for any day). */
const SHARED_TABLE_STOPS = 14;
/**
 * Every split of the list into days is costed when there are at most this
 * many of them: any list of up to twelve places, whatever the days.
 */
const EXACT_SPLITS = 1_400_000;
/** A variant that only has to be close (a hotel area being tried) costs them all only up to here. */
const QUICK_EXACT_SPLITS = 50_000;
/** How often the neighbourhood search is shaken out of where it settled and run again. */
const SHAKES = 40;
/**
 * Another day is worth using when it saves this much door-to-door travel
 * per day added. Half an hour is about one ride across town; below it the
 * saving is inside the noise of the estimates (a bus leg alone is rounded
 * to five minutes), and a free day is worth more to a traveller than a few
 * minutes saved.
 */
const EXTRA_DAY_SAVING = 30;

/** Minutes and distance in one number: minutes decide, distance (to 100 m) breaks ties. */
const SCALE = 1e7;

const EPSILON = 1e-6;

export function daySearch(problem: SearchProblem, limits: { /** For tests: how many splits may be costed one by one (0: never). */ exactSplits?: number } = {}) {
  const { stops, hotel } = problem;
  const count = stops.length;
  const tie = (km: number) => Math.min(SCALE - 1, Math.round(km * 10));
  const weight = problem.minutes.map((row, from) => row.map((minutes, to) => minutes * SCALE + tie(problem.km[from][to])));
  const weightOut = hotel ? hotel.out.map((minutes, index) => minutes * SCALE + tie(hotel.km[index])) : null;
  const weightBack = hotel ? hotel.back.map((minutes, index) => minutes * SCALE + tie(hotel.km[index])) : null;

  /**
   * The day's clock for one order — the engine's own arithmetic. Run once
   * without lunch to see where lunch falls (after the stop that ends
   * nearest 12:30, within 11:00–14:30), then again with that stop an hour
   * longer.
   */
  function clockOf(order: number[]) {
    const run = (lunchAt: number) => {
      let cursor = hotel ? DAY_CLOCK.hotelStart + hotel.out[order[0]] + DAY_CLOCK.legBuffer : DAY_CLOCK.start;
      let missed = 0;
      const arrive: number[] = [];
      const leave: number[] = [];
      order.forEach((stop, position) => {
        const { stay, meal } = stops[stop];
        let arrival = cursor;
        if (meal) {
          const hours = DAY_CLOCK.meals[meal];
          const seated = Math.max(cursor, hours.open);
          // Too late for the kitchen: the engine keeps the clock running and marks the meal missed.
          if (seated > hours.lastSeat) missed += 1;
          else arrival = seated;
        }
        const departure = arrival + stay + (position === lunchAt ? DAY_CLOCK.lunchMinutes : 0);
        arrive.push(arrival);
        leave.push(departure);
        cursor = departure;
        if (position < order.length - 1) cursor += problem.minutes[stop][order[position + 1]] + DAY_CLOCK.legBuffer;
      });
      return { arrive, leave, missed };
    };
    const before = run(-1);
    let lunchAt = -1;
    // A day with a restaurant chosen for lunch has its lunch; a day that is
    // one long visit, or over before lunchtime, gets none.
    if (!order.some((stop) => stops[stop].meal === "lunch") && !(order.length < 2 && before.leave[0] > 15 * 60)) {
      let nearest = Infinity;
      order.forEach((stop, position) => {
        const end = before.leave[position];
        if (stops[stop].meal || end < 11 * 60 || end > 14 * 60 + 30) return;
        if (Math.abs(end - 750) < nearest) {
          nearest = Math.abs(end - 750);
          lunchAt = position;
        }
      });
    }
    return { before, after: lunchAt >= 0 ? run(lunchAt) : before, lunchAt };
  }

  /** Everything the search needs to know about a day visited in this order. */
  function describe(order: number[]): PlannedDay & { orderCost: number; sightsOver: number; weight: number } {
    const { before, after, lunchAt } = clockOf(order);
    const legs: number[] = [];
    let total = 0;
    if (hotel) {
      legs.push(hotel.out[order[0]], hotel.back[order.at(-1)!]);
      total += weightOut![order[0]] + weightBack![order.at(-1)!];
    }
    for (let position = 0; position + 1 < order.length; position += 1) {
      legs.push(problem.minutes[order[position]][order[position + 1]]);
      total += weight[order[position]][order[position + 1]];
    }
    const travel = legs.reduce((sum, minutes) => sum + minutes, 0);
    const lastSight = order.findLastIndex((stop) => stops[stop].meal !== "dinner");
    const hasDinner = lastSight < order.length - 1;
    const overrun = Math.max(
      0,
      lastSight >= 0 ? after.leave[lastSight] - DAY_CLOCK.sightsEnd : 0,
      hasDinner ? after.leave.at(-1)! - DAY_CLOCK.dinnerEnd : 0,
    );
    // Half of any time spent at a lunch restaurant's door counts as travel:
    // it is the middle of the day, lost. Free time before a chosen dinner
    // costs nothing — the same hours would be free on some other day, and
    // charging for them pulled sights onto the dinner's day from the
    // neighbourhood they belong to (Senso-ji away from the Skytree).
    let waiting = 0;
    order.forEach((stop, position) => {
      if (position === 0 || stops[stop].meal !== "lunch") return;
      waiting += Math.max(0, after.arrive[position] - after.leave[position - 1] - problem.minutes[order[position - 1]][stop]);
    });
    // A day's length is its sightseeing, first arrival to the last sight.
    const span = before.leave[Math.max(0, lastSight)] - before.arrive[0];
    // When the last sight is over: of two orders with the same travel, the earlier one is the better.
    const sightsOver = after.leave[Math.max(0, lastSight)];
    const sights = order.filter((stop) => stops[stop].meal !== "dinner").length;
    // The things people later say ruined a day: six places, still out at
    // 16:00 with lunch not yet counted, two and a half hours in transit, two
    // long hauls, more than ten hours door to door. A single visit is never it.
    const tight = sights >= 2 && (
      order.length >= 6
      || before.leave[lastSight] >= 16 * 60
      || travel >= 150
      || legs.filter((minutes) => minutes >= 45).length >= 2
      || before.leave.at(-1)! - before.arrive[0] > 600
    );
    return {
      order,
      travel,
      km: (total % SCALE) / 10,
      arrive: after.arrive,
      leave: after.leave,
      lunchAt,
      missed: after.missed,
      overrun,
      span,
      tight,
      cost: orderCost({ travel, waiting, overrun, missed: after.missed }) + Math.max(0, span - LONG_DAY) / 2,
      orderCost: orderCost({ travel, waiting, overrun, missed: after.missed }),
      sightsOver,
      weight: total,
    };
  }

  /**
   * What one order of a day costs a traveller, in minutes: every ride and
   * half of the time spent waiting for a lunch restaurant to open. A day
   * nobody can keep, or a meal that cannot be eaten, outweighs all of it;
   * the later a day runs, the more each further minute costs. Among orders
   * a traveller can keep this is simply the travel: the order chosen is the
   * one with the fewest minutes on the way.
   *
   * (For choosing which places share a day, a day also costs half of
   * whatever its sightseeing runs beyond six and a half hours — a day that
   * will end after about 16:30 once lunch is added. That is a property of
   * the day, not a reason to prefer a longer route within it.)
   */
  function orderCost(day: { travel: number; waiting: number; overrun: number; missed: number }) {
    return day.travel
      + day.waiting / 2
      + (day.overrun > 0 ? 500 + day.overrun * 10 + (day.overrun * day.overrun) / 6 : 0)
      + day.missed * 1000;
  }

  type Described = ReturnType<typeof describe>;
  // Fewer minutes first; then the order that is over sooner; then the shorter line on the map.
  const better = (left: Described, right: Described | null) => {
    if (right === null || left.orderCost < right.orderCost - EPSILON) return true;
    if (left.orderCost > right.orderCost + EPSILON) return false;
    return left.sightsOver < right.sightsOver || (left.sightsOver === right.sightsOver && left.weight < right.weight);
  };

  /**
   * The cheapest way to visit every subset of `nodes` starting where
   * `first` says, ending at each possible last stop (Held–Karp). One table
   * answers every question about one day's sights.
   */
  function pathTable(nodes: number[], first: (stop: number) => number) {
    const size = nodes.length;
    const table = new Float64Array((1 << size) * size).fill(Infinity);
    for (let index = 0; index < size; index += 1) table[(1 << index) * size + index] = first(nodes[index]);
    for (let mask = 1; mask < 1 << size; mask += 1) {
      for (let last = 0; last < size; last += 1) {
        const soFar = table[mask * size + last];
        if (soFar === Infinity) continue;
        const from = weight[nodes[last]];
        for (let next = 0; next < size; next += 1) {
          if (mask & (1 << next)) continue;
          const slot = (mask | (1 << next)) * size + next;
          const candidate = soFar + from[nodes[next]];
          if (candidate < table[slot]) table[slot] = candidate;
        }
      }
    }
    return table;
  }

  /** The best path through `mask`, given what follows its last stop. */
  function bestPath(table: Float64Array, nodes: number[], mask: number, after: (stop: number) => number) {
    const size = nodes.length;
    let last = -1;
    let least = Infinity;
    for (let index = 0; index < size; index += 1) {
      if (!(mask & (1 << index))) continue;
      const value = table[mask * size + index] + after(nodes[index]);
      if (value < least) {
        least = value;
        last = index;
      }
    }
    return pathTo(table, nodes, mask, last);
  }

  /** The best path through `mask` that ends on `nodes[last]`. */
  function pathTo(table: Float64Array, nodes: number[], mask: number, last: number) {
    const size = nodes.length;
    // Walk the table backwards: the stop before `last` is the one whose own
    // best path plus the ride to `last` gives exactly this total.
    const path: number[] = [];
    let remaining = mask;
    while (last >= 0) {
      path.push(nodes[last]);
      const previous = remaining ^ (1 << last);
      if (previous === 0) break;
      const target = table[remaining * size + last];
      let found = -1;
      for (let index = 0; index < size && found < 0; index += 1) {
        if ((previous & (1 << index)) && table[previous * size + index] + weight[nodes[index]][nodes[last]] === target) found = index;
      }
      remaining = previous;
      last = found;
    }
    return path.reverse();
  }

  // For a list of ordinary length one table per starting point covers every
  // day that could be made of it: thousands of candidate days are then
  // looked up, not computed.
  const ordinary = stops.flatMap((stop, index) => (!stop.meal && stop.stay < DAY_FILLING_STAY ? [index] : []));
  const shared = ordinary.length <= SHARED_TABLE_STOPS;
  const slot = new Map(ordinary.map((stop, index) => [stop, index]));
  const sharedTables = new Map<number, Float64Array>();
  /** Routes that begin after `from` (-1: at the day's start — the hotel's door, or anywhere). */
  const firstRide = (from: number) => (stop: number) => (from >= 0 ? weight[from][stop] : weightOut ? weightOut[stop] : 0);
  const routesOver = (plain: number[]) => {
    if (!shared) return { nodes: plain, all: (1 << plain.length) - 1, table: (from: number) => pathTable(plain, firstRide(from)) };
    return {
      nodes: ordinary,
      all: plain.reduce((mask, stop) => mask | (1 << slot.get(stop)!), 0),
      table: (from: number) => {
        const known = sharedTables.get(from);
        if (known) return known;
        const table = pathTable(ordinary, firstRide(from));
        sharedTables.set(from, table);
        return table;
      },
    };
  };

  const solved = new Map<number | string, Described>();
  /**
   * The best order for one day's places. What is fixed stays fixed: a stay
   * that fills the day opens it, a chosen dinner closes it, a restaurant
   * chosen for lunch is reached while it serves, and with a hotel the day
   * starts and ends at its door (without one it may start and end anywhere).
   */
  function solveDay(ids: readonly number[]): Described {
    const key = count <= 30 ? ids.reduce((mask, stop) => mask | (1 << stop), 0) : [...ids].sort((left, right) => left - right).join(",");
    const known = solved.get(key);
    if (known) return known;
    const dinners = ids.filter((stop) => stops[stop].meal === "dinner");
    const lunches = ids.filter((stop) => stops[stop].meal === "lunch");
    const openers = ids.filter((stop) => !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY);
    const plain = ids.filter((stop) => !stops[stop].meal && stops[stop].stay < DAY_FILLING_STAY);
    const best: { day: Described | null } = { day: null };
    const consider = (order: number[]) => {
      const candidate = describe(order);
      if (better(candidate, best.day)) best.day = candidate;
    };
    if (dinners.length <= 1 && lunches.length <= 1 && openers.length <= 1 && (shared || plain.length <= EXACT_ORDER_STOPS)) {
      const head = openers.length > 0 ? openers[0] : -1;
      const lunch = lunches.length > 0 ? lunches[0] : -1;
      const dinner = dinners.length > 0 ? dinners[0] : -1;
      const around = (middle: number[]) => [...(head >= 0 ? [head] : []), ...middle, ...(dinner >= 0 ? [dinner] : [])];
      const { nodes, all, table } = routesOver(plain);
      // The ride after the last sight (back to the hotel, or on to dinner)
      // is travel but not sightseeing: of two routes, one can be shorter
      // overall and the other over sooner. So the shortest route to each
      // possible last sight is a candidate — for a given last sight it is
      // both the least travel and the earliest end — and the day's cost
      // picks among them.
      const endings = (mask: number) => nodes.flatMap((_, index) => (mask & (1 << index) ? [index] : []));
      if (all === 0 && lunch < 0) {
        consider(around([]));
      } else if (lunch < 0) {
        const fromStart = table(head);
        for (const last of endings(all)) consider(around(pathTo(fromStart, nodes, all, last)));
      } else {
        // The restaurant splits the day in two. For every choice of what
        // comes before it, the shortest morning reaches it soonest and the
        // shortest afternoon ends soonest; the clock picks among the splits.
        const fromStart = table(head);
        const fromLunch = table(lunch);
        for (let morning = all; ; morning = (morning - 1) & all) {
          const before = morning === 0 ? [] : bestPath(fromStart, nodes, morning, (stop) => weight[stop][lunch]);
          if (morning === all) consider(around([...before, lunch]));
          for (const last of endings(all ^ morning)) consider(around([...before, lunch, ...pathTo(fromLunch, nodes, all ^ morning, last)]));
          if (morning === 0) break;
        }
      }
    } else if (ids.length <= 7) {
      // Two restaurants for one meal, two day-filling stays: rare enough to try every order.
      const rank = (stop: number) => (stops[stop].meal === "dinner" ? 2 : openers.includes(stop) ? 0 : 1);
      const order: number[] = [];
      const used = new Set<number>();
      const visit = () => {
        if (order.length === ids.length) {
          consider([...order]);
          return;
        }
        for (const stop of ids) {
          if (used.has(stop) || (order.length > 0 && rank(stop) < rank(order.at(-1)!))) continue;
          used.add(stop);
          order.push(stop);
          visit();
          order.pop();
          used.delete(stop);
        }
      };
      visit();
    } else {
      // More places than any day holds: the nearest next place, then each
      // place moved wherever it shortens the route. Good, not proven best —
      // such a day is reported as too full whatever its order.
      const route: number[] = [];
      const rest = new Set(plain);
      let at = openers.at(-1) ?? -1;
      while (rest.size > 0) {
        let next = -1;
        for (const stop of rest) {
          const step = at >= 0 ? weight[at][stop] : weightOut ? weightOut[stop] : 0;
          if (next < 0 || step < (at >= 0 ? weight[at][next] : weightOut ? weightOut[next] : 0)) next = stop;
        }
        route.push(next);
        rest.delete(next);
        at = next;
      }
      const assemble = (middle: number[]) => [...openers, ...middle, ...dinners];
      let current = describe(assemble(route));
      for (let improved = true; improved;) {
        improved = false;
        for (let from = 0; from < route.length; from += 1) {
          for (let to = 0; to < route.length; to += 1) {
            if (from === to) continue;
            const moved = [...route];
            moved.splice(to, 0, ...moved.splice(from, 1));
            const candidate = describe(assemble(moved));
            if (better(candidate, current)) {
              current = candidate;
              route.splice(0, route.length, ...moved);
              improved = true;
            }
          }
        }
      }
      // Each lunch restaurant goes where the day's clock likes it best.
      for (const lunch of lunches) {
        let placed = [lunch, ...route];
        let placedDay = describe(assemble(placed));
        for (let position = 1; position <= route.length; position += 1) {
          const candidate = [...route.slice(0, position), lunch, ...route.slice(position)];
          const day = describe(assemble(candidate));
          if (better(day, placedDay)) {
            placed = candidate;
            placedDay = day;
          }
        }
        route.splice(0, route.length, ...placed);
      }
      consider(assemble(route));
    }
    solved.set(key, best.day!);
    return best.day!;
  }

  /**
   * What a whole trip costs: its days, plus the one thing only the trip can
   * see — a short visit left alone on a day beside full days, which is
   * worth a small charge. Days are not otherwise evened out: a long day is
   * already charged for being long, and sending a sight across town to make
   * two days look alike costs the traveller minutes for nothing.
   */
  function tripCost(days: readonly Described[]) {
    let cost = 0;
    let km = 0;
    let lonely = false;
    let full = false;
    for (const day of days) {
      cost += day.cost;
      km += day.km;
      if (day.order.length === 1 && stops[day.order[0]].stay < 240) lonely = true;
      if (day.order.length >= 4) full = true;
    }
    if (lonely && full) cost += 40;
    return { cost, km };
  }
  type Grouping = { days: Described[]; cost: number; km: number };
  const cheaper = (left: { cost: number; km: number }, right: { cost: number; km: number } | null) => (
    right === null || left.cost < right.cost - EPSILON || (left.cost <= right.cost + EPSILON && left.km < right.km - EPSILON)
  );
  const grouping = (groups: readonly (readonly number[])[]): Grouping => {
    const days = groups.map(solveDay);
    return { days, ...tripCost(days) };
  };

  /** How many ways there are to split `items` places into `parts` days. */
  function splits(items: number, parts: number) {
    let row = [1];
    for (let item = 1; item <= items; item += 1) {
      const next = [0];
      for (let part = 1; part <= Math.min(item, parts); part += 1) next.push((row[part - 1] ?? 0) + part * (row[part] ?? 0));
      row = next;
    }
    return row[parts] ?? 0;
  }

  /**
   * The best split of the list into exactly `parts` days. Places pinned to
   * the same day stay together and places pinned to different days stay
   * apart (`pin` is the pinned day or null).
   */
  function split(parts: number, pin: readonly (number | null)[], quick: boolean): Grouping {
    const groups: number[][] = [];
    const pins: Array<number | null> = [];
    const loads: number[] = [];
    const best: { found: Grouping | null } = { found: null };
    const load = (stop: number) => (stops[stop].meal === "dinner" ? 0 : stops[stop].stay + DAY_CLOCK.legBuffer);
    // Nine hours of sightseeing, and the half hour a hotel day starts early.
    const dayLoad = DAY_CLOCK.sightsEnd - DAY_CLOCK.hotelStart + DAY_CLOCK.legBuffer;
    const every = (fitting: boolean) => {
      const place = (stop: number) => {
        if (stop === count) {
          if (groups.length !== parts) return;
          const candidate = grouping(groups);
          if (cheaper(candidate, best.found)) best.found = candidate;
          return;
        }
        // Not enough places left to open the days still missing.
        if (groups.length + (count - stop) < parts) return;
        const pinned = pin[stop];
        const home = pinned === null ? -1 : pins.indexOf(pinned);
        for (let index = 0; index < groups.length; index += 1) {
          if (home >= 0 ? index !== home : pinned !== null && pins[index] !== null) continue;
          if (fitting && loads[index] + load(stop) > dayLoad) continue;
          const before = pins[index];
          groups[index].push(stop);
          loads[index] += load(stop);
          if (pinned !== null) pins[index] = pinned;
          place(stop + 1);
          pins[index] = before;
          loads[index] -= load(stop);
          groups[index].pop();
        }
        if (home < 0 && groups.length < parts) {
          groups.push([stop]);
          pins.push(pinned);
          loads.push(load(stop));
          place(stop + 1);
          groups.pop();
          pins.pop();
          loads.pop();
        }
      };
      place(0);
    };
    const fits = (candidate: Grouping | null) => candidate !== null && candidate.days.every((day) => day.overrun === 0 && day.missed === 0);
    // (Only where a day is a look-up in the shared table: costing every
    // split of a longer list means solving tens of thousands of days.)
    if (shared && splits(count, parts) <= (limits.exactSplits ?? (quick ? QUICK_EXACT_SPLITS : EXACT_SPLITS))) {
      // First only the splits whose days could hold their stays at all. If
      // one of them fits, no split with an impossible day can beat it.
      every(true);
      if (fits(best.found)) return best.found!;
      // Nothing fits: every split is costed, so that a list too long for its
      // days is still laid out as well as it can be.
      every(false);
      return best.found!;
    }
    // Too many splits to cost them all. Start from maps that make sense and
    // keep moving one place, or swapping two, for as long as the trip gets
    // cheaper; every neighbouring split is tried before stopping.
    for (const variant of [0, 1, 2]) {
      const candidate = improve(seed(parts, pin, variant), pin);
      if (cheaper(candidate, best.found)) best.found = candidate;
    }
    // Where that settles need not be the best there is. A few places are
    // then thrown onto other days and the search run again from there,
    // keeping whatever comes out cheaper. (The throws follow a fixed
    // sequence: the same list always gives the same plan.)
    let state = 12_345;
    const draw = (below: number) => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return Math.floor((state / 2_147_483_648) * below);
    };
    const free = stops.flatMap((_, index) => (pin[index] === null ? [index] : []));
    for (let shake = 0; shake < (parts < 2 || free.length < 2 ? 0 : SHAKES); shake += 1) {
      const groups = best.found!.days.map((day) => [...day.order]);
      for (let moves = 0; moves < 3; moves += 1) {
        const stop = free[draw(free.length)];
        const from = groups.findIndex((group) => group.includes(stop));
        const to = (from + 1 + draw(parts - 1)) % parts;
        if (groups[from].length < 2) continue;
        groups[from].splice(groups[from].indexOf(stop), 1);
        groups[to].push(stop);
      }
      const candidate = improve(groups, pin);
      if (cheaper(candidate, best.found)) best.found = candidate;
    }
    return best.found!;
  }

  /** A first split: days grown around places far from each other, filled by nearness and by time. */
  function seed(parts: number, pin: readonly (number | null)[], variant: number) {
    const near = (left: number, right: number) => Math.min(problem.minutes[left][right], problem.minutes[right][left]);
    const groups: number[][] = [];
    const pinnedDays = [...new Set(pin.filter((day): day is number => day !== null))];
    for (const day of pinnedDays) groups.push(stops.flatMap((_, index) => (pin[index] === day ? [index] : [])));
    const free = stops.flatMap((_, index) => (pin[index] === null ? [index] : []));
    const taken = new Set<number>();
    while (groups.length < parts && taken.size < free.length) {
      const members = groups.flat();
      // The first centre differs per start; the rest are whatever is farthest from the centres so far.
      const rankOf = (stop: number) => (members.length === 0
        ? (variant === 0 ? stops[stop].stay : variant === 1 ? -problem.minutes[stop].reduce((sum, minutes) => sum + minutes, 0) : problem.minutes[stop].reduce((sum, minutes) => sum + minutes, 0))
        : Math.min(...members.map((member) => near(stop, member))));
      const next = free.filter((stop) => !taken.has(stop)).reduce((far, stop) => (rankOf(stop) > rankOf(far) ? stop : far));
      taken.add(next);
      groups.push([next]);
    }
    const total = stops.reduce((sum, stop) => sum + stop.stay, 0);
    const room = (total / groups.length) * 1.3;
    const stays = groups.map((group) => group.reduce((sum, stop) => sum + stops[stop].stay, 0));
    const waiting = free.filter((stop) => !taken.has(stop)).sort((left, right) => stops[right].stay - stops[left].stay || left - right);
    for (const stop of waiting) {
      const ranked = groups.map((group, index) => ({ index, distance: Math.min(...group.map((member) => near(stop, member))) }))
        .sort((left, right) => left.distance - right.distance || left.index - right.index);
      const target = ranked.find(({ index }) => stays[index] + stops[stop].stay <= room)?.index ?? stays.indexOf(Math.min(...stays));
      groups[target].push(stop);
      stays[target] += stops[stop].stay;
    }
    return groups;
  }

  /** Move one place to another day, or swap two between days, while the trip gets cheaper. */
  function improve(start: number[][], pin: readonly (number | null)[]): Grouping {
    const groups = start.map((group) => [...group]);
    let current = grouping(groups);
    for (let round = 0; round < 200; round += 1) {
      const found: { groups: number[][] | null; value: Grouping } = { groups: null, value: current };
      const tryWith = (left: number, leftGroup: number[], right: number, rightGroup: number[]) => {
        const candidate = groups.map((group, index) => (index === left ? leftGroup : index === right ? rightGroup : group));
        const value = grouping(candidate);
        if (cheaper(value, found.value)) {
          found.groups = candidate;
          found.value = value;
        }
      };
      for (let from = 0; from < groups.length; from += 1) {
        for (const stop of groups[from]) {
          if (pin[stop] !== null) continue;
          for (let to = 0; to < groups.length; to += 1) {
            if (to === from) continue;
            const without = groups[from].filter((member) => member !== stop);
            // Never the last place of its day: how many days are used is decided elsewhere.
            if (without.length > 0) tryWith(from, without, to, [...groups[to], stop]);
            if (to < from) continue;
            for (const other of groups[to]) {
              if (pin[other] !== null) continue;
              tryWith(from, [...without, other], to, [...groups[to].filter((member) => member !== other), stop]);
            }
          }
        }
      }
      if (!found.groups) break;
      groups.splice(0, groups.length, ...found.groups);
      current = found.value;
    }
    return current;
  }

  /** Gives each day its number: a pinned day keeps the traveller's, the rest follow the list. */
  function numbered(days: readonly PlannedDay[], slots: number, pin: readonly (number | null)[]): PlannedTrip {
    const pinnedTo = (day: PlannedDay) => day.order.map((stop) => pin[stop]).find((value) => value !== null) ?? null;
    const taken = new Set(days.map(pinnedTo).filter((value) => value !== null));
    const open = Array.from({ length: Math.max(slots, days.length + taken.size) }, (_, index) => index + 1).filter((day) => !taken.has(day));
    const inListOrder = days.filter((day) => pinnedTo(day) === null).sort((left, right) => Math.min(...left.order) - Math.min(...right.order));
    const numberedDays = days.map((day) => ({ ...day, day: pinnedTo(day) ?? open[inListOrder.indexOf(day)] }))
      .sort((left, right) => left.day - right.day);
    return { slots: Math.max(slots, ...numberedDays.map((day) => day.day)), days: numberedDays };
  }

  /**
   * Door-to-door travel, for comparing one number of days with another.
   * Without a hotel a day's route may start and end anywhere, so every
   * extra day would look like a saving (one ride fewer). The days are
   * therefore compared as if the traveller slept at the most central place
   * on the list: each day also pays the way there and back.
   */
  function doorToDoor(days: readonly PlannedDay[]) {
    if (hotel) return days.reduce((sum, day) => sum + day.travel, 0);
    let centre = 0;
    let least = Infinity;
    stops.forEach((stop, index) => {
      if (stop.meal) return;
      const reach = problem.minutes[index].reduce((sum, minutes) => sum + minutes, 0) + problem.minutes.reduce((sum, row) => sum + row[index], 0);
      if (reach < least) {
        least = reach;
        centre = index;
      }
    });
    return days.reduce((sum, day) => sum + day.travel + problem.minutes[centre][day.order[0]] + problem.minutes[day.order.at(-1)!][centre], 0);
  }

  return {
    /**
     * The trip on the fewest days (up to the request) that hold it — but not
     * at the price of a packed day when the traveller has another day to
     * give, and with one more day where that day really saves travel.
     */
    choose(requestedDays: number, options: { quick?: boolean } = {}): PlannedTrip {
      const requested = Math.max(1, Math.min(14, Math.round(requestedDays)));
      const pinned = stops.reduce((latest, stop) => Math.max(latest, typeof stop.day === "number" ? stop.day : 1), 1);
      // No fewer days than the stays alone fill: stays plus a quarter of an
      // hour of travel per place, against eight-hour days; one day below
      // that estimate is still tried.
      const estimate = Math.ceil(stops.reduce((sum, stop) => sum + stop.stay + 15, 0) / 480);
      const first = Math.min(requested, Math.max(pinned, estimate - 1, 1));
      type Candidate = { slots: number; pin: Array<number | null>; found: Grouping; late: boolean; tight: number };
      const tried = new Map<number, Candidate | null>();
      const candidate = (slots: number): Candidate | null => {
        if (tried.has(slots)) return tried.get(slots)!;
        // A pin beyond the days in play is not a pin.
        const pin = stops.map((stop) => (typeof stop.day === "number" && stop.day >= 1 && stop.day <= slots ? Math.round(stop.day) : null));
        const pinnedDays = new Set(pin.filter((day) => day !== null)).size;
        const parts = pinnedDays + Math.min(pin.filter((day) => day === null).length, slots - pinnedDays);
        // More days than places: the same plan as with fewer days.
        const same = [...tried.values()].some((other) => other !== null && other.found.days.length === parts && other.pin.join() === pin.join());
        const found = same ? null : split(parts, pin, Boolean(options.quick));
        const result = found && {
          slots,
          pin,
          found,
          late: found.days.some((day) => day.overrun > 0),
          tight: found.days.filter((day) => day.tight).length,
        };
        tried.set(slots, result);
        return result;
      };
      let chosen: Candidate | null = null;
      let fallback: Candidate | null = null;
      let last: Candidate | null = null;
      for (let slots = first; slots <= requested && !chosen; slots += 1) {
        const next = candidate(slots);
        if (!next) continue;
        last = next;
        if (next.late) continue;
        // Among the day counts that fit, the first with no packed day wins;
        // failing that, the one with the fewest. (A long list stops at the
        // first count that fits: each further count is a search of its own.)
        if (next.tight === 0 || count > 16) chosen = next;
        else if (!fallback || next.tight < fallback.tight) fallback = next;
      }
      chosen ??= fallback ?? last ?? candidate(requested)!;
      if (!options.quick && !chosen.late && count <= 16) {
        for (let slots = chosen.slots + 1; slots <= requested; slots += 1) {
          const next = candidate(slots);
          if (!next || next.late || next.tight > chosen.tight) continue;
          // A day with one short visit on it is not a day gained.
          if (next.found.days.some((day) => day.order.length === 1 && stops[day.order[0]].stay < 240)) continue;
          const added = next.found.days.length - chosen.found.days.length;
          if (added > 0 && doorToDoor(next.found.days) <= doorToDoor(chosen.found.days) - EXTRA_DAY_SAVING * added) chosen = next;
        }
      }
      return numbered(chosen.found.days, chosen.slots, chosen.pin);
    },
    /** Another plan's grouping (`dayOf[stop]` is its 1-based day), each day in its best order. */
    keep(dayOf: readonly number[], slots: number): PlannedTrip {
      const byDay = new Map<number, number[]>();
      dayOf.forEach((day, stop) => byDay.set(day, [...(byDay.get(day) ?? []), stop]));
      const days = [...byDay.entries()].sort(([left], [right]) => left - right).map(([day, group]) => ({ ...solveDay(group), day }));
      return { slots: Math.max(slots, ...days.map((day) => day.day)), days };
    },
    /** For tests: the best order of one set of places, and what any order costs. */
    solveDay: (ids: readonly number[]): PlannedDay => solveDay(ids),
    describe: (order: number[]): PlannedDay => describe(order),
  };
}
