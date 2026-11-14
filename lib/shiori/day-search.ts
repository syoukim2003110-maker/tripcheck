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
  /** Pairs the booklet sends by taxi. The search counts each a quarter of an hour dearer than it prints. */
  taxi?: boolean[][];
  /** The way out of and back to the hotel, when there is one. */
  hotel: { out: number[]; back: number[]; km: number[]; taxiOut?: boolean[]; taxiBack?: boolean[] } | null;
};

/** One day as planned here; the engine is then asked to build exactly this. */
export type PlannedDay = {
  /** Indices into the problem's stops, in visiting order. */
  order: number[];
  /** Priced minutes spent moving, hotel legs included. */
  travel: number;
  /** Straight-line length of the day's route. */
  km: number;
  /**
   * When the day begins, in minutes since midnight: leaving the hotel, or
   * arriving at the first place. Later than the usual hour when the day
   * would otherwise wait at a restaurant's door.
   */
  start: number;
  /** Minutes since midnight, the lunch hour included. */
  arrive: number[];
  leave: number[];
  /** Position of the stop whose stay carries the lunch hour, or -1. */
  lunchAt: number;
  /** Chosen restaurants that cannot be reached during their meal. */
  missed: number;
  /** Minutes past what a traveller can keep: sights after 18:00, a dinner after 21:30. */
  overrun: number;
  /** First arrival to the end of the last sight, on the clock the booklet prints. */
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
  /**
   * When a restaurant can be the meal: seated by 14:00 for lunch, from 17:30
   * for dinner. The lunch hour of a day without a chosen restaurant starts
   * inside the same 11:30–14:00.
   */
  meals: {
    lunch: { open: 11 * 60 + 30, lastSeat: 14 * 60 },
    dinner: { open: 17 * 60 + 30, lastSeat: 20 * 60 },
  },
} as const;

/**
 * What a taxi ride costs the search beyond its minutes. A taxi is money and
 * a car to find; a pairing of places whose only quick link is a taxi is
 * chosen over one by train or on foot when it saves this much, not for five
 * minutes. The printed minutes are untouched.
 */
export const TAXI_SURCHARGE = 15;

/** Seven and a half hours from the first arrival to the end of the last sight: a day from 09:00 that ends after 16:30. */
const LONG_DAY = 450;
/** Eight hours of it — a day from 09:00 still sightseeing at 17:00 — is a packed day. */
const PACKED_SPAN = 480;
/** A day that starts late so as not to wait for its dinner still sits down to a chosen lunch by 13:00. */
const LATE_LUNCH = 13 * 60;
/** A stay this long claims the day (a theme park): it opens it, unless that costs a meal or the evening. */
const DAY_FILLING_STAY = 300;
/** Up to this many ordinary sights a day's order is found exactly; no real day has more. */
const EXACT_ORDER_STOPS = 9;
/** Lists up to this long keep one table of routes for all their days (and are exact for any day). */
const SHARED_TABLE_STOPS = 14;
/** A day with restaurants is searched arrangement by arrangement up to this many of them. */
const EXACT_ARRANGEMENTS = 250_000;
/** A day too full for any order is still searched arrangement by arrangement when it has no more of them than this. */
const SMALL_DAY_ARRANGEMENTS = 400;
/** A day that cannot be kept is tried in every order up to this many stops. */
const EVERY_ORDER_STOPS = 8;
/**
 * Every split of the list into days is costed when there are at most this
 * many of them: any list of up to twelve places, whatever the days.
 */
const EXACT_SPLITS = 1_400_000;
/**
 * And only for lists up to this long. A longer one that still has few
 * enough sights for the shared table is mostly restaurants; its days are
 * not look-ups, and every split of it means solving half a million of them.
 */
const EXACT_SPLIT_STOPS = 16;
/** A variant that only has to be close (a hotel area being tried) costs them all only up to here. */
const QUICK_EXACT_SPLITS = 50_000;
/** How often the neighbourhood search is shaken out of where it settled and run again. */
const SHAKES = 40;
/** The same when only asking whether the list would fit without one place: one such question per candidate. */
const SHAKES_WITHOUT = 10;
/**
 * Another day is worth using when it saves this much door-to-door travel
 * per day added. Half an hour is about one ride across town; below it the
 * saving is inside the noise of the estimates (a bus leg alone is rounded
 * to five minutes), and a free day is worth more to a traveller than a few
 * minutes saved.
 */
const EXTRA_DAY_SAVING = 30;
/**
 * When the days in use are packed and the traveller asked for more, another
 * day is used if it costs at most this much more door-to-door travel per day
 * added. Three quarters of an hour is the round trip to a hotel some twenty
 * minutes away less the ride it replaces: what the worst day gains (it ends
 * half an hour earlier, or stops being packed at all) is worth that. Beyond
 * it — a hotel an hour out, where a day more is two hours on the train —
 * the free day is the better day.
 */
const RELIEF_COST = 45;
/** The worst day has to end this much earlier (or stop being packed) for the extra day to count as relief. */
const RELIEF_GAIN = 30;

/** Weights: (minutes + taxi surcharge) · SCALE + taxi rides · TAXI_UNIT + distance in 100 m. */
const SCALE = 1e9;
const TAXI_UNIT = 1e7;
const TIE_LIMIT = 600_000;

const EPSILON = 1e-6;

type Meal = SearchStop["meal"];

/** One pass of the engine's clock over a day in a fixed order. */
function clockPass(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], first: number, lunchAt: number) {
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
      const hours = DAY_CLOCK.meals[meal];
      const seated = Math.max(cursor, hours.open);
      // Too late for the kitchen: the engine keeps the clock running and marks the meal missed.
      if (seated > hours.lastSeat) missed += 1;
      else {
        held = seated - cursor;
        arrival = seated;
      }
    }
    const departure = arrival + stays[position] + (position === lunchAt ? DAY_CLOCK.lunchMinutes : 0);
    arrive.push(arrival);
    leave.push(departure);
    wait.push(held);
    cursor = departure;
    if (position < stays.length - 1) cursor += rides[position] + DAY_CLOCK.legBuffer;
  }
  return { arrive, leave, wait, missed };
}

/**
 * The day's clock for one order — the engine's own arithmetic. `first` is
 * when the traveller reaches the first stop; `rides[i]` is the way from stop
 * i to stop i + 1. Run once without lunch to see where lunch falls (after
 * the stop that ends nearest 12:30, inside 11:30–14:00), then again with
 * that stop an hour longer. A day with a restaurant chosen for lunch has its
 * lunch; a day where no stop ends at lunchtime (one long visit over midday)
 * gets no separate hour.
 */
export function dayClock(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], first: number) {
  const before = clockPass(stays, meals, rides, first, -1);
  let lunchAt = -1;
  if (!meals.includes("lunch")) {
    const { open, lastSeat } = DAY_CLOCK.meals.lunch;
    let nearest = Infinity;
    for (let position = 0; position < stays.length; position += 1) {
      const end = before.leave[position];
      if (meals[position] || end < open || end > lastSeat) continue;
      if (Math.abs(end - 750) < nearest) {
        nearest = Math.abs(end - 750);
        lunchAt = position;
      }
    }
  }
  return { ...(lunchAt >= 0 ? clockPass(stays, meals, rides, first, lunchAt) : before), lunchAt };
}

/**
 * The day as it is printed. Nobody is sent out to stand at a restaurant's
 * door: where the usual start (09:00, or 08:30 from a hotel) would reach a
 * chosen restaurant before it opens, the day starts that much later — as
 * late as it can without anything from that restaurant on moving. `start`
 * is when to leave the hotel (`hotelOut` minutes from the first stop), or
 * the first arrival without one. Any wait that is left — before a second
 * restaurant — is in `wait`.
 */
export function scheduleDay(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], hotelOut: number | null) {
  const door = hotelOut === null ? 0 : hotelOut + DAY_CLOCK.legBuffer;
  const usual = (hotelOut === null ? DAY_CLOCK.start : DAY_CLOCK.hotelStart) + door;
  const base = dayClock(stays, meals, rides, usual);
  const held = base.wait.findIndex((minutes) => minutes > 0);
  if (held >= 0) {
    // The whole wait if the clock allows it; less when starting later costs
    // an earlier table, or pushes a lunch restaurant on the way past 13:00
    // (a day that runs up to its dinner still eats lunch at lunchtime, not
    // a minute before the kitchen closes).
    const lunchBy = (clock: { arrive: number[] }) => meals.every((meal, position) => (
      meal !== "lunch" || position >= held || clock.arrive[position] <= Math.max(base.arrive[position], LATE_LUNCH)
    ));
    for (let shift = base.wait[held]; shift > 0; shift -= shift % 5 || 5) {
      const later = dayClock(stays, meals, rides, usual + shift);
      if (later.missed === base.missed && later.arrive[held] === base.arrive[held] && lunchBy(later)) return { ...later, start: usual + shift - door };
    }
  }
  return { ...base, start: usual - door };
}

/**
 * The things people later say ruined a day: six places, eight hours from
 * the first arrival to the end of the last sight, two and a half hours in
 * transit between places, two long hauls between places. A single visit is
 * never it, and neither is the way to and from the hotel — that is paid on
 * every day, however the places are split.
 */
export function packedDay(day: { stops: number; sights: number; span: number; rides: readonly number[] }) {
  return day.sights >= 2 && (
    day.stops >= 6
    || day.span >= PACKED_SPAN
    || day.rides.reduce((sum, minutes) => sum + minutes, 0) >= 150
    || day.rides.filter((minutes) => minutes >= 45).length >= 2
  );
}

function permutations(list: readonly number[]): number[][] {
  if (list.length <= 1) return [[...list]];
  return list.flatMap((head, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [head, ...rest]));
}

export function daySearch(problem: SearchProblem, limits: { /** For tests: how many splits may be costed one by one (0: never). */ exactSplits?: number } = {}) {
  const { stops, hotel } = problem;
  const count = stops.length;
  const tie = (km: number) => Math.min(TIE_LIMIT, Math.round(km * 10));
  const priced = (minutes: number, km: number, taxi: boolean | undefined) => (minutes + (taxi ? TAXI_SURCHARGE : 0)) * SCALE + (taxi ? TAXI_UNIT : 0) + tie(km);
  const weight = problem.minutes.map((row, from) => row.map((minutes, to) => priced(minutes, problem.km[from][to], problem.taxi?.[from][to])));
  const weightOut = hotel ? hotel.out.map((minutes, index) => priced(minutes, hotel.km[index], hotel.taxiOut?.[index])) : null;
  const weightBack = hotel ? hotel.back.map((minutes, index) => priced(minutes, hotel.km[index], hotel.taxiBack?.[index])) : null;
  /** The minutes a traveller rides for a weight, and the minutes the search counts for it. */
  const rideOf = (total: number) => Math.floor(total / SCALE);
  const realOf = (total: number) => Math.floor(total / SCALE) - TAXI_SURCHARGE * Math.floor((total % SCALE) / TAXI_UNIT);
  /** When the first stop is reached at the usual hour. */
  const firstArrival = (stop: number) => (hotel ? DAY_CLOCK.hotelStart + hotel.out[stop] + DAY_CLOCK.legBuffer : DAY_CLOCK.start);
  const penalty = (overrun: number, missed: number) => (overrun > 0 ? 500 + overrun * 10 + (overrun * overrun) / 6 : 0) + missed * 1000;

  /** Everything the search needs to know about a day visited in this order. */
  function describe(order: number[]) {
    const stays = order.map((stop) => stops[stop].stay);
    const meals = order.map((stop) => stops[stop].meal);
    const rides: number[] = [];
    let total = hotel ? weightOut![order[0]] + weightBack![order.at(-1)!] : 0;
    for (let position = 0; position + 1 < order.length; position += 1) {
      rides.push(problem.minutes[order[position]][order[position + 1]]);
      total += weight[order[position]][order[position + 1]];
    }
    const clock = dayClock(stays, meals, rides, firstArrival(order[0]));
    const travel = rides.reduce((sum, minutes) => sum + minutes, 0) + (hotel ? hotel.out[order[0]] + hotel.back[order.at(-1)!] : 0);
    const lastSight = order.findLastIndex((stop) => stops[stop].meal !== "dinner");
    const hasDinner = lastSight < order.length - 1;
    const overrun = Math.max(
      0,
      lastSight >= 0 ? clock.leave[lastSight] - DAY_CLOCK.sightsEnd : 0,
      hasDinner ? clock.leave.at(-1)! - DAY_CLOCK.dinnerEnd : 0,
    );
    // Half of the time a lunch restaurant keeps the traveller from starting
    // or standing at its door counts as travel: it is the middle of the day,
    // lost — and so does the morning lost when the day opens with it. Only
    // the real wait: the ten minutes of slack after a ride are not waiting.
    // Free time before a chosen dinner costs nothing — the same hours would
    // be free on some other day, and charging for them pulled sights onto
    // the dinner's day from the neighbourhood they belong to (Senso-ji away
    // from the Skytree).
    let waiting = 0;
    order.forEach((stop, position) => {
      if (stops[stop].meal === "lunch") waiting += clock.wait[position];
    });
    // When the last sight is over: of two orders with the same travel, the earlier one is the better.
    const sightsOver = clock.leave[Math.max(0, lastSight)];
    // A day's length is its sightseeing, first arrival to the last sight, lunch included.
    const span = sightsOver - clock.arrive[0];
    const sights = order.filter((stop) => stops[stop].meal !== "dinner").length;
    const tight = packedDay({ stops: order.length, sights, span, rides });
    const ride = rideOf(total);
    const orderCost = ride + waiting / 2 + penalty(overrun, clock.missed);
    return {
      order,
      travel,
      km: (total % TAXI_UNIT) / 10,
      start: hotel ? DAY_CLOCK.hotelStart : clock.arrive[0],
      arrive: clock.arrive,
      leave: clock.leave,
      lunchAt: clock.lunchAt,
      missed: clock.missed,
      overrun,
      span,
      tight,
      // For choosing which places share a day, a day also costs half of
      // whatever it runs beyond seven and a half hours, on the clock the
      // booklet prints. That is a property of the day, not a reason to
      // prefer a longer route within it.
      cost: orderCost + Math.max(0, span - LONG_DAY) / 2,
      orderCost,
      /** The minutes the search counts for the rides: a taxi a quarter of an hour dearer. */
      ride,
      /** The order's cost before anything that makes it impossible to keep. */
      base: ride + waiting / 2,
      keepable: overrun === 0 && clock.missed === 0,
      /** How bad a packed day is, for comparing the worst day of two plans. */
      strain: tight ? 1 + Math.max(0, span - PACKED_SPAN) + 30 * Math.max(0, order.length - 5) + (rides.filter((minutes) => minutes >= 45).length >= 2 ? 20 : 0) : 0,
      sightsOver,
      weight: total,
    };
  }

  /*
   * What one order of a day costs a traveller, in minutes (`orderCost`
   * above): every ride — a taxi counted a quarter of an hour dearer — and
   * half of the time lost to a lunch restaurant that is not open yet. A day
   * nobody can keep, or a meal that cannot be eaten, outweighs all of it;
   * the later a day runs, the more each further minute costs. Among orders
   * a traveller can keep this is simply the travel: the order chosen is the
   * one with the fewest minutes on the way.
   */

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

  /** For every subset of `nodes`: the minutes of its stays, and how many stops it has. */
  function subsetSums(nodes: number[]) {
    const stay = new Float64Array(1 << nodes.length);
    const size = new Uint8Array(1 << nodes.length);
    for (let mask = 1; mask < 1 << nodes.length; mask += 1) {
      const low = 31 - Math.clz32(mask & -mask);
      stay[mask] = stay[mask & (mask - 1)] + stops[nodes[low]].stay;
      size[mask] = size[mask & (mask - 1)] + 1;
    }
    return { stay, size };
  }

  // For a list of ordinary length one table per starting point covers every
  // day that could be made of it: thousands of candidate days are then
  // looked up, not computed.
  const ordinary = stops.flatMap((stop, index) => (!stop.meal && stop.stay < DAY_FILLING_STAY ? [index] : []));
  const shared = ordinary.length <= SHARED_TABLE_STOPS;
  const slot = new Map(ordinary.map((stop, index) => [stop, index]));
  const sharedTables = new Map<number, Float64Array>();
  const sharedSums = shared ? subsetSums(ordinary) : null;
  /** Routes that begin after `from` (-1: at the day's start — the hotel's door, or anywhere). */
  const firstRide = (from: number) => (stop: number) => (from >= 0 ? weight[from][stop] : weightOut ? weightOut[stop] : 0);
  const routesOver = (plain: number[]) => {
    if (!shared) {
      const own = new Map<number, Float64Array>();
      return {
        nodes: plain,
        all: (1 << plain.length) - 1,
        sums: subsetSums(plain),
        table: (from: number) => {
          const known = own.get(from) ?? pathTable(plain, firstRide(from));
          own.set(from, known);
          return known;
        },
      };
    }
    return {
      nodes: ordinary,
      all: plain.reduce((mask, stop) => mask | (1 << slot.get(stop)!), 0),
      sums: sharedSums!,
      table: (from: number) => {
        const known = sharedTables.get(from);
        if (known) return known;
        const table = pathTable(ordinary, firstRide(from));
        sharedTables.set(from, table);
        return table;
      },
    };
  };

  /**
   * A day with restaurants (or a long stay that may not open it), every
   * arrangement of it: `mids` are visited in any order, each with any of
   * the day's ordinary sights before it; `tails` (dinners) close the day.
   * A day with a lunch restaurant has no lunch hour to place, so its clock
   * is plain arithmetic on the route tables: for a given set of sights
   * between two fixed stops the shortest way through them is both the least
   * travel and the earliest arrival. Returns the best order, or null.
   *
   * `seated` (a day with two or more lunch restaurants): only arrangements
   * that reach every lunch restaurant while it serves are looked at. The
   * second must be seated by 14:00 after the first opened at 11:30, so very
   * few sets of sights fit before or between them, and those few are all
   * that is costed; the rest are dismissed on their stays alone.
   */
  function arrangements(head: number, mids: number[], tails: number[], plain: number[], limit: { cost: number }, seated: boolean) {
    const { nodes, all, sums, table } = routesOver(plain);
    const size = nodes.length;
    const buffer = DAY_CLOCK.legBuffer;
    const tailOrders = tails.length <= 4 ? permutations(tails) : [tails];
    type Step = { from: number; set: number; to: number };
    const steps: Step[] = [];
    const found: { cost: number; over: number; weight: number; steps: Step[]; from: number; rest: number; end: number; tail: number[] } = {
      cost: limit.cost, over: Infinity, weight: Infinity, steps: [], from: -1, rest: 0, end: -1, tail: [],
    };
    let any = false;
    /** The cheapest unkeepable arrangement's cost before its penalty: see solveDay. */
    let unkept = Infinity;
    const reach = (routes: Float64Array, from: number, set: number, to: number) => {
      if (set === 0) return from >= 0 ? weight[from][to] : weightOut ? weightOut[to] : 0;
      let least = Infinity;
      for (let index = 0; index < size; index += 1) {
        if (!(set & (1 << index))) continue;
        const value = routes[set * size + index] + weight[nodes[index]][to];
        if (value < least) least = value;
      }
      return least;
    };
    const finish = (from: number, depart: number, rest: number, soFar: number, waiting: number, missedSoFar: number) => {
      const routes = table(from);
      for (let end = rest === 0 ? -1 : 0; end < (rest === 0 ? 0 : size); end += 1) {
        if (end >= 0 && !(rest & (1 << end))) continue;
        const route = end >= 0 ? routes[rest * size + end] : 0;
        const over = depart + (end >= 0 ? sums.stay[rest] + realOf(route) + buffer * sums.size[rest] : 0);
        const lastSight = end >= 0 ? nodes[end] : from;
        for (const tail of tailOrders) {
          let total = soFar + route;
          let cursor = over;
          let missed = missedSoFar;
          let previous = lastSight;
          for (const dinner of tail) {
            total += weight[previous][dinner];
            cursor += problem.minutes[previous][dinner] + buffer;
            const seated = Math.max(cursor, DAY_CLOCK.meals.dinner.open);
            if (seated > DAY_CLOCK.meals.dinner.lastSeat) {
              missed += 1;
              cursor += stops[dinner].stay;
            } else cursor = seated + stops[dinner].stay;
            previous = dinner;
          }
          if (weightBack) total += weightBack[previous];
          const overrun = Math.max(0, over - DAY_CLOCK.sightsEnd, tail.length > 0 ? cursor - DAY_CLOCK.dinnerEnd : 0);
          const base = rideOf(total) + waiting / 2;
          const cost = base + penalty(overrun, missed);
          if (cost > base && base < unkept) unkept = base;
          if (cost > found.cost + EPSILON) continue;
          if (any && cost > found.cost - EPSILON && (over > found.over || (over === found.over && total >= found.weight))) continue;
          any = true;
          Object.assign(found, { cost, over, weight: total, steps: [...steps], from, rest, end, tail });
        }
      }
    };
    const visit = (from: number, depart: number, rest: number, left: number[], soFar: number, waiting: number, missed: number) => {
      // Nothing that is still to come makes a day cheaper.
      if (rideOf(soFar) + waiting / 2 + missed * 1000 > found.cost + EPSILON) return;
      if (left.length === 0) {
        finish(from, depart, rest, soFar, waiting, missed);
        return;
      }
      const routes = table(from);
      // The first ride of a day without a hotel is no ride.
      const rideIn = from >= 0 || hotel ? 1 : 0;
      for (const mid of left) {
        const others = left.filter((stop) => stop !== mid);
        const lunch = stops[mid].meal === "lunch";
        for (let set = rest; ; set = (set - 1) & rest) {
          // The stays alone already pass the last seat: no route gets there in time.
          if (seated && lunch && depart + sums.stay[set] + buffer * (sums.size[set] + rideIn) > DAY_CLOCK.meals.lunch.lastSeat) {
            if (set === 0) break;
            continue;
          }
          const route = reach(routes, from, set, mid);
          const cursor = depart + sums.stay[set] + realOf(route) + buffer * (sums.size[set] + rideIn);
          let leave = cursor + stops[mid].stay;
          let held = 0;
          let late = 0;
          if (stops[mid].meal === "lunch") {
            const seated = Math.max(cursor, DAY_CLOCK.meals.lunch.open);
            if (seated > DAY_CLOCK.meals.lunch.lastSeat) late = 1;
            else {
              held = seated - cursor;
              leave = seated + stops[mid].stay;
            }
          }
          if (!(seated && late)) {
            steps.push({ from, set, to: mid });
            visit(mid, leave, rest ^ set, others, soFar + route, waiting + held, missed + late);
            steps.pop();
          }
          if (set === 0) break;
        }
      }
    };
    if (head >= 0) visit(head, firstArrival(head) + stops[head].stay, all, mids, weightOut ? weightOut[head] : 0, 0, 0);
    else visit(-1, hotel ? DAY_CLOCK.hotelStart : DAY_CLOCK.start, all, mids, 0, 0, 0);
    if (!any) return { order: null, unkept };
    const order = head >= 0 ? [head] : [];
    for (const step of found.steps) {
      if (step.set !== 0) order.push(...bestPath(table(step.from), nodes, step.set, (stop) => weight[stop][step.to]));
      order.push(step.to);
    }
    if (found.end >= 0) order.push(...pathTo(table(found.from), nodes, found.rest, found.end));
    order.push(...found.tail);
    return { order, unkept };
  }

  const factorial = (value: number) => [1, 1, 2, 6, 24, 120, 720][Math.min(value, 6)];

  type Solved = Described & { /** A cheaper order exists that the day's clock ruled out as it stood: worth trying every order. */ doubt: boolean };
  const solved = new Map<number | string, Solved>();
  const keyOf = (ids: readonly number[]) => (count <= 30 ? ids.reduce((mask, stop) => mask | (1 << stop), 0) : [...ids].sort((left, right) => left - right).join(","));
  /**
   * The best order for one day's places. A chosen dinner closes the day, a
   * restaurant chosen for lunch is reached while it serves, and with a
   * hotel the day starts and ends at its door (without one it may start and
   * end anywhere). A stay that fills the day opens it — when the day can be
   * kept that way; if that order misses a meal or runs late, any order may
   * be the day's.
   */
  function solveDay(ids: readonly number[]): Solved {
    const key = keyOf(ids);
    const known = solved.get(key);
    if (known) return known;
    const dinners = ids.filter((stop) => stops[stop].meal === "dinner");
    const lunches = ids.filter((stop) => stops[stop].meal === "lunch");
    const openers = ids.filter((stop) => !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY);
    const plain = ids.filter((stop) => !stops[stop].meal && stops[stop].stay < DAY_FILLING_STAY);
    const best: { day: Described | null; unkept: number } = { day: null, unkept: Infinity };
    const consider = (order: number[]) => {
      const candidate = describe(order);
      if (!candidate.keepable && candidate.base < best.unkept) best.unkept = candidate.base;
      if (better(candidate, best.day)) best.day = candidate;
    };
    /**
     * More than any day holds — ten sights, four lunches — or restaurants
     * that cannot all be reached while they serve: the nearest next place,
     * then each place moved wherever it shortens the route. Good, not
     * proven best; such a day is reported as too full whatever its order.
     */
    const roughly = () => {
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
    };
    const exactRoutes = shared || plain.length <= EXACT_ORDER_STOPS;
    const head = openers.length === 1 ? openers[0] : -1;
    // How many arrangements a day with restaurants has; and whether its
    // stays alone, from the earliest start, run half an hour past 18:00. No
    // order keeps such a day, and nothing bounds the search for its best
    // one: unless it is small, it is laid out by nearness.
    const between = lunches.length + openers.length;
    const ways = factorial(between) * (between + 1) ** plain.length * factorial(dinners.length);
    const sights = ids.length - dinners.length;
    const overfull = DAY_CLOCK.hotelStart + ids.reduce((sum, stop) => sum + (stops[stop].meal === "dinner" ? 0 : stops[stop].stay), 0)
      + DAY_CLOCK.legBuffer * Math.max(0, sights - 1) > DAY_CLOCK.sightsEnd + 30;
    if (exactRoutes && lunches.length === 0 && openers.length <= 1 && dinners.length <= 4) {
      const closings = permutations(dinners);
      const { nodes, all, table } = routesOver(plain);
      // The ride after the last sight (back to the hotel, or on to dinner)
      // is travel but not sightseeing: of two routes, one can be shorter
      // overall and the other over sooner. So the shortest route to each
      // possible last sight is a candidate — for a given last sight it is
      // both the least travel and the earliest end — and the day's cost
      // picks among them.
      const routes = all === 0 ? [[]] : nodes.flatMap((_, index) => (all & (1 << index) ? [pathTo(table(head), nodes, all, index)] : []));
      for (const route of routes) {
        for (const closing of closings) consider([...(head >= 0 ? [head] : []), ...route, ...closing]);
      }
    } else if (
      exactRoutes && lunches.length >= 1 && openers.length <= 1 && dinners.length <= 4 && lunches.length <= 3
      && (lunches.length >= 2 || ways <= EXACT_ARRANGEMENTS) && (ways <= SMALL_DAY_ARRANGEMENTS || !overfull)
    ) {
      // The restaurants split the day. With the long stay first; and if the
      // day cannot be kept that way, with it wherever it fits. Two lunch
      // restaurants on one day (more restaurants than days): every
      // arrangement that seats both, and when none does — the day misses a
      // meal whatever its order — the order found by nearness below.
      const strict = lunches.length >= 2;
      const first = arrangements(head, lunches, dinners, plain, { cost: Infinity }, strict);
      if (first.order) consider(first.order);
      best.unkept = Math.min(best.unkept, first.unkept);
      if (head >= 0 && !best.day?.keepable) {
        const free = arrangements(-1, [head, ...lunches], dinners, plain, { cost: best.day?.orderCost ?? Infinity }, strict);
        if (free.order) consider(free.order);
        best.unkept = Math.min(best.unkept, free.unkept);
      }
      if (strict && !best.day?.keepable) roughly();
    } else roughly();
    const day = best.day!;
    const result = { ...day, doubt: !day.keepable || best.unkept < day.orderCost - EPSILON };
    solved.set(key, result);
    return result;
  }

  /**
   * Every order of a small day, one by one. The tables above give, for
   * each way a day can end, its shortest route; an order they rule out
   * because its clock runs late can still have a longer cousin that fits —
   * one that lets a long museum visit cover the lunch hour, or takes a taxi
   * the shortest route avoids. So a day of up to eight stops whose shortest
   * routes did not all fit is tried in every order before it is printed.
   * Dinners come last; a stay that fills the day comes first when such an
   * order can be kept.
   */
  function everyOrder(start: Solved): Described {
    const ids = start.order;
    const total = ids.length;
    if (!start.doubt || total > EVERY_ORDER_STOPS || total < 2) return start;
    const dinners = new Set(ids.filter((stop) => stops[stop].meal === "dinner"));
    const openers = new Set(ids.filter((stop) => !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY));
    const lunchChosen = ids.some((stop) => stops[stop].meal === "lunch");
    const ends = new Float64Array(total);
    type Found = { cost: number; over: number; weight: number; order: number[]; keepable: boolean };
    const from = (day: Described): Found => ({ cost: day.orderCost, over: day.sightsOver, weight: day.weight, order: day.order, keepable: day.keepable });
    const search = (openersFirst: boolean, limit: Found | null) => {
      const rank = (stop: number) => (dinners.has(stop) ? 2 : openersFirst && openers.has(stop) ? 0 : 1);
      let found = limit;
      const order: number[] = [];
      const used = new Set<number>();
      // describe()'s clock and cost, without building anything: forty thousand orders are looked at for one that is kept.
      const weigh = (soFar: number) => {
        const weightTotal = soFar + (weightBack ? weightBack[order[total - 1]] : 0);
        let lunchAt = -1;
        for (let pass = 0; ; pass += 1) {
          let cursor = firstArrival(order[0]);
          let missed = 0;
          let waiting = 0;
          let sightsOver = -1;
          for (let position = 0; position < total; position += 1) {
            const stop = order[position];
            const meal = stops[stop].meal;
            let arrival = cursor;
            if (meal) {
              const hours = DAY_CLOCK.meals[meal];
              const seated = Math.max(cursor, hours.open);
              if (seated > hours.lastSeat) missed += 1;
              else {
                if (meal === "lunch") waiting += seated - cursor;
                arrival = seated;
              }
            }
            const departure = arrival + stops[stop].stay + (position === lunchAt ? DAY_CLOCK.lunchMinutes : 0);
            ends[position] = departure;
            if (meal !== "dinner") sightsOver = departure;
            cursor = departure;
            if (position < total - 1) cursor += problem.minutes[stop][order[position + 1]] + DAY_CLOCK.legBuffer;
          }
          if (pass === 0 && !lunchChosen) {
            let nearest = Infinity;
            for (let position = 0; position < total; position += 1) {
              const end = ends[position];
              if (stops[order[position]].meal || end < DAY_CLOCK.meals.lunch.open || end > DAY_CLOCK.meals.lunch.lastSeat) continue;
              if (Math.abs(end - 750) < nearest) {
                nearest = Math.abs(end - 750);
                lunchAt = position;
              }
            }
            if (lunchAt >= 0) continue;
          }
          const overrun = Math.max(
            0,
            sightsOver >= 0 ? sightsOver - DAY_CLOCK.sightsEnd : 0,
            dinners.has(order[total - 1]) ? ends[total - 1] - DAY_CLOCK.dinnerEnd : 0,
          );
          const over = sightsOver >= 0 ? sightsOver : ends[0];
          const cost = rideOf(weightTotal) + waiting / 2 + penalty(overrun, missed);
          if (found && (cost > found.cost + EPSILON || (cost > found.cost - EPSILON && (over > found.over || (over === found.over && weightTotal >= found.weight))))) return;
          found = { cost, over, weight: weightTotal, order: [...order], keepable: overrun === 0 && missed === 0 };
          return;
        }
      };
      const visit = (soFar: number) => {
        if (order.length === total) {
          weigh(soFar);
          return;
        }
        for (const stop of ids) {
          if (used.has(stop) || (order.length > 0 && rank(stop) < rank(order.at(-1)!))) continue;
          const next = soFar + (order.length > 0 ? weight[order.at(-1)!][stop] : weightOut ? weightOut[stop] : 0);
          // The rides alone already cost more than the best order found.
          if (found && rideOf(next) > found.cost + EPSILON) continue;
          used.add(stop);
          order.push(stop);
          visit(next);
          order.pop();
          used.delete(stop);
        }
      };
      visit(0);
      return found;
    };
    const opensWithStay = openers.size > 0 && ids.slice(0, openers.size).every((stop) => openers.has(stop));
    let found: Found | null;
    if (openers.size > 0) {
      const opened = search(true, opensWithStay ? from(start) : null);
      found = opened?.keepable ? opened : search(false, opened && (!opensWithStay || opened.order !== start.order) && opened.cost <= start.orderCost ? opened : from(start));
    } else found = search(false, from(start));
    return found && found.order !== start.order ? describe(found.order) : start;
  }

  /** How many restaurants share a day with another one for the same meal. */
  function doubledIn(group: readonly number[]) {
    let lunches = 0;
    let dinners = 0;
    for (const stop of group) {
      if (stops[stop].meal === "lunch") lunches += 1;
      else if (stops[stop].meal === "dinner") dinners += 1;
    }
    return Math.max(0, lunches - 1) + Math.max(0, dinners - 1);
  }
  const hasMeals = stops.some((stop) => stop.meal);
  /**
   * A stop the trip is planned without (-1: none), for asking whether the
   * list would fit once one place is left out. The days are the same days,
   * so everything already worked out for them is reused.
   */
  let skip = -1;

  /**
   * What a whole trip costs: its days, plus the one thing only the trip can
   * see — a short visit left alone on a day beside fuller days, which is
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
      if (day.order.length === 1 && !stops[day.order[0]].meal && stops[day.order[0]].stay < 240) lonely = true;
      if (day.order.length >= 3) full = true;
    }
    if (lonely && full) cost += 40;
    return { cost, km };
  }
  /**
   * `doubled`: two restaurants for the same meal on one day. A traveller
   * who picks two dinners means two evenings, so a split with fewer of
   * those is the better one whatever it costs in minutes.
   */
  type Grouping = { days: Solved[]; cost: number; km: number; doubled: number };
  const cheaper = (left: { cost: number; km: number; doubled: number }, right: { cost: number; km: number; doubled: number } | null) => (
    right === null || left.doubled < right.doubled
    || (left.doubled === right.doubled && (left.cost < right.cost - EPSILON || (left.cost <= right.cost + EPSILON && left.km < right.km - EPSILON)))
  );
  const grouping = (groups: readonly (readonly number[])[]): Grouping => {
    const days = groups.map(solveDay);
    return { days, ...tripCost(days), doubled: hasMeals ? groups.reduce((sum, group) => sum + doubledIn(group), 0) : 0 };
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

  /** The fewest same-meal restaurants that must share a day when the list goes on `parts` days. */
  function leastDoubled(parts: number, pin: readonly (number | null)[]) {
    let least = 0;
    for (const meal of ["lunch", "dinner"] as const) {
      const pinned = new Map<number, number>();
      let free = 0;
      stops.forEach((stop, index) => {
        if (stop.meal !== meal || index === skip) return;
        const day = pin[index];
        if (day === null) free += 1;
        else pinned.set(day, (pinned.get(day) ?? 0) + 1);
      });
      for (const together of pinned.values()) least += together - 1;
      least += Math.max(0, free - Math.max(0, parts - pinned.size));
    }
    return least;
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
    const every = (fitting: boolean, doubledLimit: number) => {
      let doubled = 0;
      const place = (stop: number) => {
        if (stop === count) {
          if (groups.length !== parts) return;
          // The days are looked up before anything is built: of a million splits one is kept.
          let cost = 0;
          let km = 0;
          let lonely = false;
          let full = false;
          for (const group of groups) {
            const day = solveDay(group);
            cost += day.cost;
            km += day.km;
            if (group.length === 1 && !stops[group[0]].meal && stops[group[0]].stay < 240) lonely = true;
            if (group.length >= 3) full = true;
          }
          if (lonely && full) cost += 40;
          if (cheaper({ cost, km, doubled }, best.found)) best.found = { days: groups.map(solveDay), cost, km, doubled };
          return;
        }
        if (stop === skip) {
          place(stop + 1);
          return;
        }
        // Not enough places left to open the days still missing.
        if (groups.length + (count - stop) < parts) return;
        const pinned = pin[stop];
        const meal = stops[stop].meal;
        const home = pinned === null ? -1 : pins.indexOf(pinned);
        for (let index = 0; index < groups.length; index += 1) {
          if (home >= 0 ? index !== home : pinned !== null && pins[index] !== null) continue;
          if (fitting && loads[index] + load(stop) > dayLoad) continue;
          // Two restaurants for one meal share a day only when the days cannot keep them apart.
          const twice = meal && groups[index].some((other) => stops[other].meal === meal) ? 1 : 0;
          if (doubled + twice > doubledLimit) continue;
          const before = pins[index];
          groups[index].push(stop);
          loads[index] += load(stop);
          doubled += twice;
          if (pinned !== null) pins[index] = pinned;
          place(stop + 1);
          pins[index] = before;
          doubled -= twice;
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
    const fits = (candidate: Grouping | null) => candidate !== null && candidate.days.every((day) => day.keepable);
    const least = hasMeals ? leastDoubled(parts, pin) : 0;
    // (Only where a day is a look-up in the shared table: costing every
    // split of a longer list means solving tens of thousands of days.)
    if (shared && count <= EXACT_SPLIT_STOPS && splits(count - (skip >= 0 ? 1 : 0), parts) <= (limits.exactSplits ?? (quick ? QUICK_EXACT_SPLITS : EXACT_SPLITS))) {
      // First only the splits whose days could hold their stays at all. If
      // one of them fits, no split with an impossible day can beat it.
      every(true, least);
      if (fits(best.found)) return best.found!;
      // Nothing fits: every split is costed, so that a list too long for its
      // days is still laid out as well as it can be.
      every(false, least);
      if (!best.found) every(false, Infinity);
      return best.found!;
    }
    // Too many splits to cost them all. Start from maps that make sense and
    // keep moving one place, or swapping two, for as long as the trip gets
    // cheaper; every neighbouring split is tried before stopping.
    for (const variant of [0, 1, 2]) {
      const candidate = improve(apart(seed(parts, pin, variant), pin), pin);
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
    const free = stops.flatMap((_, index) => (pin[index] === null && index !== skip ? [index] : []));
    for (let shake = 0; shake < (parts < 2 || free.length < 2 ? 0 : skip >= 0 ? SHAKES_WITHOUT : SHAKES); shake += 1) {
      const groups = best.found!.days.map((day) => [...day.order]);
      for (let moves = 0; moves < 3; moves += 1) {
        const stop = free[draw(free.length)];
        const from = groups.findIndex((group) => group.includes(stop));
        const to = (from + 1 + draw(parts - 1)) % parts;
        if (groups[from].length < 2) continue;
        groups[from].splice(groups[from].indexOf(stop), 1);
        groups[to].push(stop);
      }
      const candidate = improve(apart(groups, pin), pin);
      if (cheaper(candidate, best.found)) best.found = candidate;
    }
    return best.found!;
  }

  /** Moves a restaurant off a day that already has one for the same meal, onto the nearest day that has none. */
  function apart(groups: number[][], pin: readonly (number | null)[]) {
    if (!hasMeals) return groups;
    const near = (stop: number, group: number[]) => Math.min(...group.map((member) => Math.min(problem.minutes[stop][member], problem.minutes[member][stop])));
    for (const meal of ["lunch", "dinner"] as const) {
      for (let guard = 0; guard < count; guard += 1) {
        const has = (group: number[]) => group.filter((stop) => stops[stop].meal === meal);
        const crowded = groups.findIndex((group) => has(group).length > 1 && has(group).some((stop) => pin[stop] === null) && group.length > 1);
        const open = groups.flatMap((group, index) => (has(group).length === 0 ? [index] : []));
        if (crowded < 0 || open.length === 0) break;
        const stop = has(groups[crowded]).filter((candidate) => pin[candidate] === null).at(-1)!;
        const target = open.reduce((best, index) => (near(stop, groups[index]) < near(stop, groups[best]) ? index : best));
        groups[crowded].splice(groups[crowded].indexOf(stop), 1);
        groups[target].push(stop);
      }
    }
    return groups;
  }

  /** A first split: days grown around places far from each other, filled by nearness and by time. */
  function seed(parts: number, pin: readonly (number | null)[], variant: number) {
    const near = (left: number, right: number) => Math.min(problem.minutes[left][right], problem.minutes[right][left]);
    const groups: number[][] = [];
    const pinnedDays = [...new Set(pin.filter((day): day is number => day !== null))];
    for (const day of pinnedDays) groups.push(stops.flatMap((_, index) => (pin[index] === day ? [index] : [])));
    const free = stops.flatMap((_, index) => (pin[index] === null && index !== skip ? [index] : []));
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
    const total = stops.reduce((sum, stop, index) => sum + (index === skip ? 0 : stop.stay), 0);
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
      const others = (left: number, right: number) => current.doubled - doubledIn(groups[left]) - doubledIn(groups[right]);
      const tryWith = (left: number, leftGroup: number[], right: number, rightGroup: number[]) => {
        // A split that doubles up more restaurants is never the better one: its days need not be solved.
        if (hasMeals && others(left, right) + doubledIn(leftGroup) + doubledIn(rightGroup) > found.value.doubled) return;
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

  /** The day as it is printed: tried in every order where the tables left a doubt, and started late where it would wait. */
  function printed(day: Solved, thorough: boolean): PlannedDay {
    const final = thorough ? everyOrder(day) : day;
    const order = final.order;
    const clock = scheduleDay(
      order.map((stop) => stops[stop].stay),
      order.map((stop) => stops[stop].meal),
      order.slice(0, -1).map((stop, position) => problem.minutes[stop][order[position + 1]]),
      hotel ? hotel.out[order[0]] : null,
    );
    return {
      order,
      travel: final.travel,
      km: final.km,
      start: clock.start,
      arrive: clock.arrive,
      leave: clock.leave,
      lunchAt: clock.lunchAt,
      missed: final.missed,
      overrun: final.overrun,
      span: final.span,
      tight: final.tight,
      cost: final.cost,
    };
  }

  /** Gives each day its number: a pinned day keeps the traveller's, the rest take the earliest days left, in list order. */
  function numbered(days: readonly Solved[], requested: number, pin: readonly (number | null)[], thorough: boolean): PlannedTrip {
    const pinnedTo = (day: Solved) => day.order.map((stop) => pin[stop]).find((value) => value !== null) ?? null;
    const taken = new Set(days.map(pinnedTo).filter((value) => value !== null));
    const open = Array.from({ length: requested + days.length }, (_, index) => index + 1).filter((day) => !taken.has(day));
    const inListOrder = days.filter((day) => pinnedTo(day) === null).sort((left, right) => Math.min(...left.order) - Math.min(...right.order));
    const numberedDays = days.map((day) => ({ ...printed(day, thorough), day: pinnedTo(day) ?? open[inListOrder.indexOf(day)] }))
      .sort((left, right) => left.day - right.day);
    return { slots: Math.max(...numberedDays.map((day) => day.day)), days: numberedDays };
  }

  /**
   * Door-to-door travel, for comparing one number of days with another, in
   * the minutes a traveller rides (a taxi is dearer when choosing which
   * places go together, not a reason to spend a day). Without a hotel a day's
   * route may start and end anywhere, so every extra day would look like a
   * saving (one ride fewer). The days are therefore compared as if the
   * traveller slept at the most central place on the list: each day also
   * pays the way there and back.
   */
  let centre = -1;
  function doorToDoor(days: readonly Described[]) {
    if (hotel) return days.reduce((sum, day) => sum + day.travel, 0);
    if (centre < 0) {
      let least = Infinity;
      stops.forEach((stop, index) => {
        if (stop.meal && stops.some((other) => !other.meal)) return;
        const reach = problem.minutes[index].reduce((sum, minutes) => sum + minutes, 0) + problem.minutes.reduce((sum, row) => sum + row[index], 0);
        if (reach < least) {
          least = reach;
          centre = index;
        }
      });
    }
    return days.reduce((sum, day) => sum + day.travel + problem.minutes[centre][day.order[0]] + problem.minutes[day.order.at(-1)!][centre], 0);
  }

  /** What was asked before is not worked out again. */
  const answers = new Map<string, PlannedTrip>();

  return {
    /**
     * The trip on the fewest days (up to the request) that hold it, every
     * chosen meal eaten and no two restaurants for one meal on a day that
     * another requested day could take. Then, while the traveller has
     * another day to give: one more day where that really saves travel,
     * and one more day where the days in use are packed and the extra day
     * relieves the worst of them at little cost. A pin says which day a
     * place is on, never how many days are used.
     */
    choose(requestedDays: number, options: { quick?: boolean; /** Plan the trip without this stop. */ without?: number } = {}): PlannedTrip {
      const requested = Math.max(1, Math.min(14, Math.round(requestedDays)));
      const asked = `${requested}|${options.quick ? 1 : 0}|${options.without ?? -1}`;
      const answered = answers.get(asked);
      if (answered) return answered;
      skip = options.without ?? -1;
      // A pin beyond the days asked for is not a pin.
      const pin = stops.map((stop, index) => (index !== skip && typeof stop.day === "number" && stop.day >= 1 && Math.round(stop.day) <= requested ? Math.round(stop.day) : null));
      const pinnedDays = new Set(pin.filter((day) => day !== null)).size;
      const unpinned = pin.filter((day, index) => day === null && index !== skip).length;
      const fewest = Math.max(1, pinnedDays);
      const most = Math.max(fewest, Math.min(requested, pinnedDays + unpinned));
      // No fewer days than the stays alone fill: stays plus a quarter of an
      // hour of travel per place, against eight-hour days; one day below
      // that estimate is still tried.
      const estimate = Math.ceil(stops.reduce((sum, stop, index) => sum + (index === skip ? 0 : stop.stay + 15), 0) / 480);
      let first = Math.min(most, Math.max(fewest, estimate - 1));
      // Nor so few that two restaurants for one meal must share a day which
      // the days asked for could keep apart: such a count is never the answer.
      if (hasMeals) {
        const apartAtMost = leastDoubled(most, pin);
        while (first < most && leastDoubled(first, pin) > apartAtMost) first += 1;
      }
      type Candidate = { parts: number; found: Grouping; late: boolean; penalty: number; worst: number; door: number; lone: boolean };
      const tried = new Map<number, Candidate>();
      const candidate = (parts: number): Candidate => {
        const known = tried.get(parts);
        if (known) return known;
        const found = split(parts, pin, Boolean(options.quick));
        // The count of days is judged on the days as they will be printed.
        // A day that runs late in the order the split left it in may fit in
        // another order (a four-hour stay put first by habit), and that
        // other order is the one printed: judging the first would spread a
        // list that fits one day over two.
        const days = options.quick ? found.days : found.days.map((day) => (day.keepable ? day : everyOrder(day)));
        const result = {
          parts,
          found,
          // A day that runs over, or a chosen meal that cannot be eaten.
          late: days.some((day) => !day.keepable),
          penalty: days.reduce((sum, day) => sum + day.orderCost - day.base, 0),
          worst: Math.max(...days.map((day) => day.strain)),
          door: doorToDoor(days),
          // A day with one short visit on it is not a day gained.
          lone: found.days.some((day) => day.order.length === 1 && !stops[day.order[0]].meal && stops[day.order[0]].stay < 240),
        };
        tried.set(parts, result);
        return result;
      };
      // More days are the answer to a list that does not fit (as long as
      // they make it fit better: a restaurant no day can reach is not a
      // reason to use them all); then to two dinners on one evening.
      const worse = (left: Candidate, right: Candidate) => (
        left.late !== right.late ? left.late : left.late ? left.penalty > right.penalty + EPSILON : left.found.doubled > right.found.doubled
      );
      let chosen = candidate(first);
      for (let parts = first + 1; parts <= most && (chosen.late || chosen.found.doubled > 0); parts += 1) {
        const next = candidate(parts);
        if (worse(chosen, next)) chosen = next;
      }
      for (let settled = chosen.late; !settled;) {
        settled = true;
        // The day after next is looked at too: three neighbourhoods on two days want a third, not a second and a half.
        for (let parts = chosen.parts + 1; parts <= Math.min(most, chosen.parts + 2) && settled; parts += 1) {
          const next = candidate(parts);
          if (next.late || next.lone || next.found.doubled > chosen.found.doubled) continue;
          const added = parts - chosen.parts;
          const saves = next.door <= chosen.door - EXTRA_DAY_SAVING * added && next.worst <= chosen.worst;
          const relieves = chosen.worst > 0
            && (next.worst === 0 || next.worst <= chosen.worst - RELIEF_GAIN)
            && next.door <= chosen.door + RELIEF_COST * added;
          if (saves || relieves) {
            chosen = next;
            settled = false;
          }
        }
      }
      skip = -1;
      const answer = numbered(chosen.found.days, requested, pin, !options.quick);
      answers.set(asked, answer);
      return answer;
    },
    /** Another plan's grouping (`dayOf[stop]` is its 1-based day), each day in its best order. */
    keep(dayOf: readonly number[], slots: number, options: { quick?: boolean } = {}): PlannedTrip {
      const byDay = new Map<number, number[]>();
      dayOf.forEach((day, stop) => byDay.set(day, [...(byDay.get(day) ?? []), stop]));
      const days = [...byDay.entries()].sort(([left], [right]) => left - right).map(([day, group]) => ({ ...printed(solveDay(group), !options.quick), day }));
      return { slots: Math.max(slots, ...days.map((day) => day.day)), days };
    },
    /** For tests: the best order of one set of places as it is printed, and what any order costs. */
    solveDay: (ids: readonly number[]) => {
      const day = solveDay(ids);
      return { ...everyOrder(day), ...printed(day, true) };
    },
    describe: (order: number[]) => describe(order),
  };
}
