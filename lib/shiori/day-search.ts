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
 *     same the one a person would draw on the map wins;
 *   - once the days are chosen, each is put in the order that costs least
 *     with the hours of the day counted (HABITS): a few minutes more on the
 *     way for a museum not to open the day or a temple not to close it.
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
  /**
   * A time the traveller entered (a booking), in minutes since midnight: the
   * visit starts at exactly this minute. `day` is then the day of the
   * booking, and never beyond the days planned (the caller sets such a stop
   * aside before asking).
   */
  fixed?: number | null;
  /**
   * Habits of the planner about the hours of a day, by the kind of place
   * (lib/shiori/habits.ts) — preferences among the orders of a day that are
   * otherwise close, never a fact about the place and never a ban (see
   * HABITS). `daytime`: visited in the daytime, better over by about 17:00.
   */
  daytime?: boolean;
  /** A place with a door and a counter: better not the first thing in the morning when a place under the open sky could open the day. */
  ticketed?: boolean;
  /** A place under the open sky that can open a day. */
  early?: boolean;
  /** A place of the morning (a fish market, a morning market): better over by about 13:00. */
  morning?: boolean;
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
  /**
   * What the traveller said about the ends of the trip, in minutes since
   * midnight: day 1 has nothing before `firstStart`; the last day asked for
   * is over — the ride back to the hotel included — by `lastFinish`.
   */
  frames?: { firstStart: number | null; lastFinish: number | null };
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
  /** Minutes past what a traveller can keep: sights after 18:00, a dinner after 21:30 — nothing while within the grace of either (see pastEnd). */
  overrun: number;
  /**
   * The same to the minute, with no grace: what the search itself counts,
   * for ranking one plan against another (which area to stay in) the way
   * the search ranked them. Never a reason to say a day runs late.
   */
  pastHour: number;
  /** First arrival to the end of the last sight, on the clock the booklet prints. */
  span: number;
  /** What the booklet calls a packed day. */
  tight: boolean;
  /** What the day costs a traveller, in minutes (see orderCost). */
  cost: number;
  /** Booked times this day reaches too late. Never printed: the caller sets a place aside instead. */
  late: number;
  /** Minutes the day runs past the finish the traveller entered for it — or, on a trip with entered times, past its own midnight. */
  hardOver: number;
  /** A lunch hour had a place on this day but would have broken an entered time. */
  noLunchRoom: boolean;
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
  /**
   * A day that ends this little past one of those two hours is not called
   * late. The hours are the planner's habit and the legs before them are
   * estimates, most of them rounded to five minutes: 18:08 on five estimated
   * legs is no reason to tell a traveller to add a day or drop a place.
   * (See pastEnd: what is said of a day. The search itself goes on aiming
   * at the hour — it uses another day it was given before it ends one at
   * 18:08 — and no printed time is changed.)
   */
  endGrace: 15,
  /**
   * Where a day ends on a trip with entered times. Such a trip is laid on
   * the calendar — day 1 is the day of the start, a booking's day is its
   * date — so a day that ran past midnight would be standing in the next
   * day's morning: nothing nobody booked ends after it. (A booked late show
   * may: its hour is the traveller's own.) The last minute of the day: a
   * visit that ends at 24:00 is printed as 00:00 of the next.
   */
  lastMinute: 24 * 60 - 1,
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
 * How many minutes past an end of the planner's own (18:00 for sights, 21:30
 * for a chosen dinner) a visit runs, for saying that a day runs late: nothing
 * within the grace, and beyond it every minute past the hour itself. This is
 * the one place that decides it — the days the search hands back and the
 * booklet's "runs late", and with them the advice to add a day or leave a
 * place out, all read it. Never used for a time the traveller entered: a
 * booking or a finish is kept to the minute.
 */
export function pastEnd(leave: number, end: number) {
  return leave - end > DAY_CLOCK.endGrace ? leave - end : 0;
}

/**
 * What a taxi ride costs the search beyond its minutes. A taxi is money and
 * a car to find; a pairing of places whose only quick link is a taxi is
 * chosen over one by train or on foot when it saves this much, not for five
 * minutes. The printed minutes are untouched.
 */
export const TAXI_SURCHARGE = 15;

/**
 * What the hours of a day cost, in minutes of travel: the planner's habits
 * about kinds of places, weighed against the rides when the order of a day
 * is settled. The planner knows no opening hours, and none is implied; this
 * only decides between orders of one day that are close.
 *
 * A daytime place (a temple, a garden, a museum) that ends after 17:00 costs
 * ten minutes and half of every minute past it, thirty at most: a street, a
 * tower or a viewpoint takes the end of the day when that costs less than
 * that in rides. A place of the morning (a fish market, a morning market)
 * costs the same counted from 13:00: it opens the day or comes before lunch
 * when that is no more than half an hour longer. A place with a door and a counter (a museum, a zoo, a
 * castle) reached before 09:30 as the first of a day that has a place under
 * the open sky to start with costs fifteen: the shrine or the park goes
 * first when that is no more than a quarter of an hour longer.
 * A stop the traveller booked, or a chosen restaurant, has no habit.
 *
 * It is a preference with a price, not a ban, and only about the order: a
 * day of nothing but temples is planned as it always was, and which places
 * share a day is decided on the minutes on the way alone, as it always was
 * (the days are chosen first; then each is put in the order that costs
 * least with its hours counted: see byHours).
 */
export const HABITS = {
  daytimeEnd: 17 * 60,
  morningEnd: 13 * 60,
  lateBase: 10,
  latePerMinute: 0.5,
  lateCap: 30,
  firstDoor: 9 * 60 + 30,
  firstCost: 15,
} as const;

/** Seven and a half hours from the first arrival to the end of the last sight: a day from 09:00 that ends after 16:30. */
const LONG_DAY = 450;
/** Eight hours of it — a day from 09:00 still sightseeing at 17:00 — is a packed day. */
const PACKED_SPAN = 480;
/** A day that starts late so as not to wait for its dinner still sits down to a chosen lunch by 13:00; a lunch during a long visit starts by then too. */
export const LATE_LUNCH = 13 * 60;
/** The earliest a lunch is eaten before a long ride: not before half past ten. */
export const EARLY_LUNCH = 10 * 60 + 30;
/**
 * A stay this long claims the day (a theme park): it opens it. On a day that
 * cannot be kept in any order it still does — the park at opening and the
 * rest after it is the day a traveller would have, not the park from 10:53
 * after another sight. It gives way only to an order that can be kept, or
 * that keeps a chosen meal or an entered time the day would otherwise lose.
 */
export const DAY_FILLING_STAY = 300;
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
 * A day with a booked time has no table to look its order up in (what an
 * order costs depends on the clock), so every order is tried. While the days
 * are being chosen — thousands of candidate days — up to this many stops;
 * the days that are printed, up to EVERY_ORDER_STOPS.
 */
const BOOKED_DAY_STOPS = 6;
/** And a candidate day no order of which can be kept, only up to this many. */
const HOPELESS_DAY_STOPS = 5;
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

/**
 * What the traveller entered about a day, for the clock. Everything else the
 * clock knows — 09:00, 18:00, when a restaurant serves — is a habit of the
 * planner; these are facts, and a day that breaks one is never printed.
 */
export type ClockFrame = {
  /** Per position: the minute the visit must start at (a booking), or null. */
  fixed?: readonly (number | null | undefined)[];
  /** The earliest the first stop can be reached at all: a booking before the usual start opens the day that early. */
  earliest?: number;
  /**
   * The same without the ten minutes of slack after the ride out: when the
   * ride itself arrives. A booking between the two is still kept — the day
   * starts at its earliest and the slack is given up (see clockPass).
   */
  tightest?: number;
  /** The day is over by this minute, the ride home included. */
  close?: number | null;
  /** Minutes of the ride home after the last stop; 0 without a hotel. */
  homeward?: number;
  /** No stop nobody booked ends after this minute (see DAY_CLOCK.lastMinute). */
  night?: number | null;
};

/*
 * The ten minutes of slack after a ride are the planner's habit, there to
 * keep a day of estimates from running late. Between two times the traveller
 * entered — one booking straight after another, or a booking straight after
 * the hour day 1 can start — nothing can be moved to make room for them, and
 * the bookings are not the planner's to refuse: when the ride itself arrives
 * in time, the booking is kept and the slack given up. Everywhere else the
 * slack stays, because there the planner can choose another order.
 */

/** One pass of the engine's clock over a day in a fixed order. */
function clockPass(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], first: number, lunchAt: number, frame?: ClockFrame) {
  const arrive: number[] = [];
  const leave: number[] = [];
  const wait: number[] = [];
  let missed = 0;
  let late = 0;
  let cursor = first;
  let opened = first;
  const night = frame?.night ?? null;
  let nightOver = 0;
  for (let position = 0; position < stays.length; position += 1) {
    const meal = meals[position];
    const fixed = frame?.fixed?.[position] ?? null;
    let arrival = cursor;
    let held = 0;
    if (fixed !== null) {
      if (position === 0 && cursor > fixed) {
        // A booking before the usual start opens the day that much earlier.
        if ((frame!.earliest ?? Infinity) <= fixed) {
          cursor = fixed;
          opened = fixed;
        } else if ((frame!.tightest ?? Infinity) <= fixed) {
          // Reached by the ride alone: the day starts as early as it can.
          cursor = fixed;
          opened = frame!.earliest!;
        }
      } else if (position > 0 && cursor > fixed && cursor - DAY_CLOCK.legBuffer <= fixed && (frame!.fixed![position - 1] ?? null) !== null) {
        // Straight from one booking to the next: the ride arrives in time, the slack is given up.
        cursor = fixed;
      }
      // Early is a wait; late is late — the engine keeps the clock running, and so does this.
      // (No meal hours here: the booked time is the traveller's own fact.)
      if (cursor <= fixed) {
        held = fixed - cursor;
        arrival = fixed;
      } else late += 1;
    } else if (meal) {
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
    if (night !== null && fixed === null && departure - night > nightOver) nightOver = departure - night;
    cursor = departure;
    if (position < stays.length - 1) cursor += rides[position] + DAY_CLOCK.legBuffer;
  }
  const close = frame?.close ?? null;
  // Past the finish the traveller entered (the ride home included), or past the day's own midnight.
  const hardOver = Math.max(nightOver, close === null || leave.length === 0 ? 0 : leave[leave.length - 1] + (frame!.homeward ?? 0) - close);
  return { arrive, leave, wait, missed, late, hardOver, opened };
}

/**
 * The day's clock for one order — the engine's own arithmetic. `first` is
 * when the traveller reaches the first stop; `rides[i]` is the way from stop
 * i to stop i + 1. Run once without lunch to see where lunch falls (after
 * the stop that ends nearest 12:30, inside 11:30–14:00), then again with
 * that stop an hour longer. A day with a restaurant chosen for lunch has its
 * lunch.
 *
 * A day where no stop ends at lunchtime but one visit runs across it (a zoo
 * from 11:51 to 14:21: begun by 13:00, not over by 14:00) eats during that visit, and the hour is added to it
 * like any other lunch hour: the stays are an estimate of the visit alone,
 * on the short side, and nobody sees two and a half hours of a zoo with an
 * hour of them at a table. That stop is `lunchAt` too. Not a booked visit
 * (its hours are the traveller's own), and not a stay that fills the day (a
 * theme park of five hours or more): its hours are a day out, with eating
 * in it, and it gets no separate hour.
 *
 * A day where neither is so because a long ride runs across lunchtime (a
 * waterfall left at 11:20, the next sight reached at 13:05) eats before
 * setting off: the hour follows the stop the ride leaves from, when that
 * stop is over by half past ten at the earliest.
 *
 * With a `frame` the lunch hour never breaks what the traveller entered: a
 * lunch that would make a booking late, or carry the day past its finish, is
 * not put there. The next nearest stop is tried; when none will do the day
 * has no lunch hour and says so (`noLunchRoom`).
 */
export function dayClock(stays: readonly number[], meals: readonly Meal[], rides: readonly number[], first: number, frame?: ClockFrame) {
  const before = clockPass(stays, meals, rides, first, -1, frame);
  let lunchAt = -1;
  if (!meals.includes("lunch")) {
    const { open, lastSeat } = DAY_CLOCK.meals.lunch;
    /** The visit that runs across lunchtime, when no stop ends in it. */
    const across = () => {
      for (let position = 0; position < stays.length; position += 1) {
        if (meals[position] || (frame?.fixed?.[position] ?? null) !== null || stays[position] >= DAY_FILLING_STAY) continue;
        if (before.arrive[position] <= LATE_LUNCH && before.leave[position] > lastSeat) return position;
      }
      return -1;
    };
    /** The stop a ride across lunchtime leaves from, when no stop ends in it and no visit runs across it. */
    const beforeRide = () => {
      for (let position = 0; position < stays.length - 1; position += 1) {
        const end = before.leave[position];
        // (The ride itself, not a wait at the next door, is what runs across lunchtime.)
        if (!meals[position] && end >= EARLY_LUNCH && end < open && before.arrive[position + 1] - before.wait[position + 1] > LATE_LUNCH) return position;
      }
      return -1;
    };
    if (!frame) {
      let nearest = Infinity;
      for (let position = 0; position < stays.length; position += 1) {
        const end = before.leave[position];
        if (meals[position] || end < open || end > lastSeat) continue;
        if (Math.abs(end - 750) < nearest) {
          nearest = Math.abs(end - 750);
          lunchAt = position;
        }
      }
      if (lunchAt < 0) lunchAt = across();
      if (lunchAt < 0) lunchAt = beforeRide();
    } else {
      const candidates: number[] = [];
      for (let position = 0; position < stays.length; position += 1) {
        const end = before.leave[position];
        if (meals[position] || end < open || end > lastSeat) continue;
        candidates.push(position);
      }
      if (candidates.length === 0) {
        const inside = across();
        if (inside >= 0) candidates.push(inside);
      }
      if (candidates.length === 0) {
        const early = beforeRide();
        if (early >= 0) candidates.push(early);
      }
      // Nearest 12:30 first; the earlier stop on a tie, as without a frame.
      candidates.sort((left, right) => Math.abs(before.leave[left] - 750) - Math.abs(before.leave[right] - 750) || left - right);
      for (const position of candidates) {
        const lunched = clockPass(stays, meals, rides, first, position, frame);
        if (lunched.late <= before.late && (lunched.hardOver === 0 || before.hardOver > 0)) return { ...lunched, lunchAt: position, noLunchRoom: false };
      }
      return { ...before, lunchAt: -1, noLunchRoom: candidates.length > 0 };
    }
  }
  return { ...(lunchAt >= 0 ? clockPass(stays, meals, rides, first, lunchAt, frame) : before), lunchAt, noLunchRoom: false };
}

/**
 * The day as it is printed. Nobody is sent out to stand at a restaurant's
 * door: where the usual start (09:00, or 08:30 from a hotel) would reach a
 * chosen restaurant before it opens, the day starts that much later — as
 * late as it can without anything from that restaurant on moving. `start`
 * is when to leave the hotel (`hotelOut` minutes from the first stop), or
 * the first arrival without one. Any wait that is left — before a second
 * restaurant — is in `wait`.
 *
 * With a `frame`: the day never starts before `open` (the time the traveller
 * can start moving), a booking earlier than the usual start opens the day
 * early, and a later start is only taken when it breaks nothing entered and
 * does not carry sightseeing further past 18:00. Before a booking the later
 * start that still leaves an hour for lunch is preferred to the latest one.
 *
 * `daytime` (per position): places the planner visits in the daytime (see
 * HABITS). A later start never carries one of them past 17:00 — the day
 * that waits for its evening starts later, but not so late that the temple
 * before the night market is seen at dusk.
 */
export function scheduleDay(
  stays: readonly number[],
  meals: readonly Meal[],
  rides: readonly number[],
  hotelOut: number | null,
  frame?: ClockFrame & { /** The day does not begin before this minute. */ open?: number | null },
  daytime?: readonly (boolean | undefined)[],
) {
  const door = hotelOut === null ? 0 : hotelOut + DAY_CLOCK.legBuffer;
  /** No daytime place is over later than it was, where that is after 17:00. */
  const inDaylight = (clock: { leave: number[] }, base: { leave: number[] }) => !daytime || daytime.every((flag, position) => (
    !flag || meals[position] || (frame?.fixed?.[position] ?? null) !== null || clock.leave[position] <= Math.max(base.leave[position], HABITS.daytimeEnd)
  ));
  if (!frame) {
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
        if (later.missed === base.missed && later.arrive[held] === base.arrive[held] && lunchBy(later) && inDaylight(later, base)) return { ...later, start: usual + shift - door };
      }
    }
    return { ...base, start: usual - door };
  }
  const open = frame.open ?? 0;
  const usual = Math.max(hotelOut === null ? DAY_CLOCK.start : DAY_CLOCK.hotelStart, open) + door;
  const full: ClockFrame = { fixed: frame.fixed, close: frame.close, homeward: frame.homeward, night: frame.night, earliest: open + door, tightest: open + (hotelOut ?? 0) };
  const reserved = (position: number) => (frame.fixed?.[position] ?? null) !== null;
  /** Minutes past what the planner's own habits allow: sights by 18:00, a dinner by 21:30. A booked stop is not held to them. */
  const softOver = (clock: { leave: number[] }) => {
    let over = 0;
    for (let position = 0; position < stays.length; position += 1) {
      if (reserved(position)) continue;
      over = Math.max(over, clock.leave[position] - (meals[position] === "dinner" ? DAY_CLOCK.dinnerEnd : DAY_CLOCK.sightsEnd));
    }
    return over;
  };
  const base = dayClock(stays, meals, rides, usual, full);
  const startOf = (clock: { opened: number }) => clock.opened - door;
  const held = base.wait.findIndex((minutes) => minutes > 0);
  if (held >= 0) {
    const lunchBy = (clock: { arrive: number[] }) => meals.every((meal, position) => (
      meal !== "lunch" || reserved(position) || position >= held || clock.arrive[position] <= Math.max(base.arrive[position], LATE_LUNCH)
    ));
    const booked = stays.some((_, position) => reserved(position));
    // How well a start leaves room for lunch: 2 an hour before the stop the
    // day waits for (or a restaurant chosen for lunch), 1 an hour after it, 0 none.
    const lunch = (clock: { lunchAt: number }) => (meals.includes("lunch") || (clock.lunchAt >= 0 && clock.lunchAt < held) ? 2 : clock.lunchAt >= 0 ? 1 : 0);
    const baseOver = softOver(base);
    let best: ReturnType<typeof dayClock> | null = null;
    for (let shift = base.wait[held]; shift > 0; shift -= shift % 5 || 5) {
      const later = dayClock(stays, meals, rides, usual + shift, full);
      if (
        later.missed !== base.missed || later.arrive[held] !== base.arrive[held] || !lunchBy(later) || !inDaylight(later, base)
        || later.late !== base.late || later.hardOver > base.hardOver || softOver(later) > Math.max(0, baseOver)
      ) continue;
      // Without a booking: as late as the clock allows, as ever.
      if (!booked || lunch(later) === 2) return { ...later, start: startOf(later) };
      if (best === null || lunch(later) > lunch(best)) best = later;
    }
    // No later start has lunch before the booking: the latest of those that
    // keep the most of a lunch hour — unless the usual start keeps more.
    if (best && lunch(best) >= lunch(base)) return { ...best, start: startOf(best) };
  }
  return { ...base, start: startOf(base) };
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

function popcount(value: number) {
  let bits = 0;
  for (let rest = value; rest !== 0; rest &= rest - 1) bits += 1;
  return bits;
}

function permutations(list: readonly number[]): number[][] {
  if (list.length <= 1) return [[...list]];
  return list.flatMap((head, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [head, ...rest]));
}

export function daySearch(
  problem: SearchProblem,
  limits: {
    /** For tests: how many splits may be costed one by one (0: never). */
    exactSplits?: number;
    /**
     * A candidate day with an entered time is tried in every order only up
     * to this many stops (default: BOOKED_DAY_STOPS). A search that only has
     * to be close — a hotel area being compared — asks for fewer.
     */
    bookedDayStops?: number;
  } = {},
) {
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
  /*
   * What the traveller entered about times. A stop with a booked time is
   * `fixed`; a day has a class: bit 1 for day 1 when it may not start before
   * `firstStart`, bit 2 for the last day asked for when it must be over by
   * `lastFinish`. With nothing entered every class is 0, no stop is fixed and
   * every path below is the one there has always been.
   */
  const firstStart = problem.frames?.firstStart ?? null;
  const lastFinish = problem.frames?.lastFinish ?? null;
  const fixedOf = stops.map((stop) => (typeof stop.fixed === "number" && Number.isFinite(stop.fixed) ? stop.fixed : null));
  const anyFixed = fixedOf.some((value) => value !== null);
  const framesOn = anyFixed || firstStart !== null || lastFinish !== null;
  const classOf = (day: number, requested: number) => (day === 1 && firstStart !== null ? 1 : 0) | (day === requested && lastFinish !== null ? 2 : 0);
  /** From the hotel's door to the first stop, slack included; nothing without a hotel. */
  const door = (stop: number) => (hotel ? hotel.out[stop] + DAY_CLOCK.legBuffer : 0);
  /** When the first stop is reached at the usual hour — or, on day 1, at the hour the traveller can start. */
  const firstArrival = (stop: number, cls = 0) => (
    cls & 1
      ? Math.max(hotel ? DAY_CLOCK.hotelStart : DAY_CLOCK.start, firstStart!) + door(stop)
      : hotel ? DAY_CLOCK.hotelStart + hotel.out[stop] + DAY_CLOCK.legBuffer : DAY_CLOCK.start
  );
  const penalty = (overrun: number, missed: number) => (overrun > 0 ? 500 + overrun * 10 + (overrun * overrun) / 6 : 0) + missed * 1000;
  /** Whether any place has a habit about its hours: without one every day is ordered as it always was. */
  const habitsOn = stops.some((stop, index) => (stop.daytime || stop.ticketed || stop.morning) && !stop.meal && fixedOf[index] === null);
  /**
   * What the hours of a day cost in this order (see HABITS), on its clock.
   * One function for every copy of the clock, so that they cannot drift.
   */
  function habitCost(order: ArrayLike<number>, total: number, arrive: ArrayLike<number>, leave: ArrayLike<number>) {
    let cost = 0;
    let early = false;
    for (let position = 0; position < total; position += 1) {
      const stop = order[position];
      const entry = stops[stop];
      if (entry.meal || fixedOf[stop] !== null) continue;
      // (A place of the morning is a daytime place with an earlier hour: one fine, counted from 13:00.)
      const over = entry.morning ? leave[position] - HABITS.morningEnd : entry.daytime ? leave[position] - HABITS.daytimeEnd : 0;
      if (over > 0) cost += Math.min(HABITS.lateCap, HABITS.lateBase + over * HABITS.latePerMinute);
      if (position > 0 && entry.early) early = true;
    }
    const first = stops[order[0]];
    if (early && first.ticketed && !first.meal && fixedOf[order[0]] === null && arrive[0] < HABITS.firstDoor) cost += HABITS.firstCost;
    return cost;
  }

  /**
   * Everything the search needs to know about a day visited in this order
   * (`cls`: the day's class). `hours`: with what the hours of the day cost
   * (see HABITS) counted in the order's cost — asked only once the days are
   * chosen, when each is put in order for printing.
   */
  function describe(order: number[], cls = 0, hours = false) {
    const stays = order.map((stop) => stops[stop].stay);
    const meals = order.map((stop) => stops[stop].meal);
    const rides: number[] = [];
    let total = hotel ? weightOut![order[0]] + weightBack![order.at(-1)!] : 0;
    for (let position = 0; position + 1 < order.length; position += 1) {
      rides.push(problem.minutes[order[position]][order[position + 1]]);
      total += weight[order[position]][order[position + 1]];
    }
    // On a trip the traveller entered a time for, every day is run on the
    // clock that keeps entered times: its own start and finish, the booked
    // times on it — and, for all of them, the day's own midnight and a lunch
    // hour that is only taken where it breaks none of these. (A day nothing
    // was said about differs from an ordinary one in exactly that.)
    const framed = framesOn;
    const frame: ClockFrame | undefined = framed
      ? {
        fixed: order.map((stop) => fixedOf[stop]),
        earliest: (cls & 1 ? firstStart! : 0) + door(order[0]),
        tightest: (cls & 1 ? firstStart! : 0) + (hotel ? hotel.out[order[0]] : 0),
        close: cls & 2 ? lastFinish : null,
        homeward: hotel ? hotel.back[order.at(-1)!] : 0,
        night: DAY_CLOCK.lastMinute,
      }
      : undefined;
    const clock = dayClock(stays, meals, rides, firstArrival(order[0], cls), frame);
    const hardOver = clock.hardOver;
    const travel = rides.reduce((sum, minutes) => sum + minutes, 0) + (hotel ? hotel.out[order[0]] + hotel.back[order.at(-1)!] : 0);
    // A booked stop is not held to the planner's own 18:00 and 21:30: the
    // traveller chose its hour. (With nothing booked this is the rule as it
    // always was: a dinner that is not last ends before the sight after it.)
    const lastSight = order.findLastIndex((stop) => stops[stop].meal !== "dinner" && fixedOf[stop] === null);
    let overrun: number;
    if (!framed) {
      const hasDinner = lastSight < order.length - 1;
      overrun = Math.max(
        0,
        lastSight >= 0 ? clock.leave[lastSight] - DAY_CLOCK.sightsEnd : 0,
        hasDinner ? clock.leave.at(-1)! - DAY_CLOCK.dinnerEnd : 0,
      );
    } else {
      overrun = 0;
      order.forEach((stop, position) => {
        if (fixedOf[stop] !== null) return;
        overrun = Math.max(overrun, clock.leave[position] - (stops[stop].meal === "dinner" ? DAY_CLOCK.dinnerEnd : DAY_CLOCK.sightsEnd));
      });
    }
    // Half of the time a lunch restaurant keeps the traveller from starting
    // or standing at its door counts as travel: it is the middle of the day,
    // lost — and so does the morning lost when the day opens with it. Only
    // the real wait: the ten minutes of slack after a ride are not waiting.
    // Free time before a chosen dinner costs nothing — the same hours would
    // be free on some other day, and charging for them pulled sights onto
    // the dinner's day from the neighbourhood they belong to (Senso-ji away
    // from the Skytree). Free time before a booked hour costs nothing either:
    // the hour is given, and no other order would have it sooner.
    let waiting = 0;
    order.forEach((stop, position) => {
      if (stops[stop].meal === "lunch" && fixedOf[stop] === null) waiting += clock.wait[position];
    });
    // When the last sight is over: of two orders with the same travel, the earlier one is the better.
    const sightsOver = clock.leave[Math.max(0, lastSight)];
    // A day's length is its sightseeing, first arrival to the last sight, lunch included.
    let span = sightsOver - clock.arrive[0];
    if (framed) {
      // A booked visit is part of the day wherever it falls; the idle time in front of it is not sightseeing.
      const lastVisit = order.findLastIndex((stop) => stops[stop].meal !== "dinner");
      span = clock.leave[Math.max(0, lastVisit)] - clock.arrive[0];
      for (let position = 1; position <= lastVisit; position += 1) {
        if (fixedOf[order[position]] !== null) span -= clock.wait[position];
      }
    }
    const sights = order.filter((stop) => stops[stop].meal !== "dinner").length;
    const tight = packedDay({ stops: order.length, sights, span, rides });
    const ride = rideOf(total);
    // What the traveller entered and this order breaks: a booked time reached
    // late, the day's finish passed — or, on a trip with entered times, the
    // day's own midnight. Such an order is only ever compared with other
    // broken ones — any order that breaks less is better whatever it costs.
    const broken = clock.late + (hardOver > 0 ? 1 : 0);
    const habit = hours && habitsOn ? habitCost(order, order.length, clock.arrive, clock.leave) : 0;
    const orderCost = ride + waiting / 2 + habit + penalty(overrun, clock.missed) + (broken > 0 ? 1000 * clock.late + penalty(hardOver, 0) : 0);
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
      // (Nor is what the day's hours cost: that too is about the order alone.)
      cost: orderCost - habit + Math.max(0, span - LONG_DAY) / 2,
      orderCost,
      /** The minutes the search counts for the rides: a taxi a quarter of an hour dearer. */
      ride,
      /** The order's cost before anything that makes it impossible to keep. */
      base: ride + waiting / 2 + habit,
      /** What the hours of the day cost in this order (see HABITS); 0 unless asked with `hours`. */
      habit,
      hours,
      keepable: overrun === 0 && clock.missed === 0 && broken === 0,
      /** How bad a packed day is, for comparing the worst day of two plans. */
      strain: tight ? 1 + Math.max(0, span - PACKED_SPAN) + 30 * Math.max(0, order.length - 5) + (rides.filter((minutes) => minutes >= 45).length >= 2 ? 20 : 0) : 0,
      sightsOver,
      weight: total,
      cls,
      framed,
      late: clock.late,
      hardOver,
      broken,
      noLunchRoom: clock.noLunchRoom,
    };
  }

  /*
   * What one order of a day costs a traveller, in minutes (`orderCost`
   * above): every ride — a taxi counted a quarter of an hour dearer — and
   * half of the time lost to a lunch restaurant that is not open yet. A day
   * nobody can keep, or a meal that cannot be eaten, outweighs all of it;
   * the later a day runs, the more each further minute costs. Among orders
   * a traveller can keep this is simply the travel: the order chosen is the
   * one with the fewest minutes on the way. (When a day that has been chosen
   * is put in order for printing, what its hours cost is counted too: see
   * HABITS and byHours.)
   */

  type Described = ReturnType<typeof describe>;
  // Fewer minutes first; then the order that is over sooner; then the shorter line on the map.
  // (Before any of it: the order that breaks less of what the traveller entered.)
  const better = (left: Described, right: Described | null) => {
    if (right === null) return true;
    if (left.broken !== right.broken) return left.broken < right.broken;
    if (left.orderCost < right.orderCost - EPSILON) return true;
    if (left.orderCost > right.orderCost + EPSILON) return false;
    return left.sightsOver < right.sightsOver || (left.sightsOver === right.sightsOver && left.weight < right.weight);
  };

  /**
   * Whether the day that opens with its day-filling stay gives way to the
   * best order found without that rule: only when that order can be kept, or
   * breaks less of what the traveller entered, or misses fewer chosen meals.
   * Ten minutes less on a day that runs late either way is no reason to
   * enter a theme park at eleven.
   */
  const openerYields = (opened: Described, free: Described) => (
    free.keepable || free.broken < opened.broken || (free.broken === opened.broken && free.missed < opened.missed)
  );

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
  /** Days with something entered about them that were tried in every order before printing. */
  const enumerated = new Map<string, Described>();
  const keyOf = (ids: readonly number[]) => (count <= 30 ? ids.reduce((mask, stop) => mask | (1 << stop), 0) : [...ids].sort((left, right) => left - right).join(","));
  /**
   * The best order for one day's places. A chosen dinner closes the day, a
   * restaurant chosen for lunch is reached while it serves, and with a
   * hotel the day starts and ends at its door (without one it may start and
   * end anywhere). A stay that fills the day opens it; another order is
   * the day's only when it can be kept, or keeps a meal that order misses
   * (see openerYields).
   */
  function solveDay(ids: readonly number[], cls = 0): Solved {
    const plainKey = keyOf(ids);
    const key = cls === 0 ? plainKey : typeof plainKey === "number" ? plainKey + cls * 2 ** 30 : `${cls}|${plainKey}`;
    const known = solved.get(key);
    if (known) return known;
    if (cls !== 0 || (anyFixed && ids.some((stop) => fixedOf[stop] !== null))) {
      const framed = kept(ids, cls, solveFramed(ids, cls));
      solved.set(key, framed);
      return framed;
    }
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
      // day cannot be kept that way, with it wherever the day can be kept or
      // keeps a meal more. Two lunch
      // restaurants on one day (more restaurants than days): every
      // arrangement that seats both, and when none does — the day misses a
      // meal whatever its order — the order found by nearness below.
      const strict = lunches.length >= 2;
      const first = arrangements(head, lunches, dinners, plain, { cost: Infinity }, strict);
      if (first.order) consider(first.order);
      best.unkept = Math.min(best.unkept, first.unkept);
      if (head >= 0 && !best.day?.keepable) {
        const free = arrangements(-1, [head, ...lunches], dinners, plain, { cost: best.day?.orderCost ?? Infinity }, strict);
        if (free.order) {
          const candidate = describe(free.order);
          if (!candidate.keepable && candidate.base < best.unkept) best.unkept = candidate.base;
          if (best.day === null || (openerYields(best.day, candidate) && better(candidate, best.day))) best.day = candidate;
        }
        best.unkept = Math.min(best.unkept, free.unkept);
      }
      if (strict && !best.day?.keepable) roughly();
    } else roughly();
    const day = best.day!;
    const result = kept(ids, cls, { ...day, doubt: !day.keepable || best.unkept < day.orderCost - EPSILON });
    solved.set(key, result);
    return result;
  }

  /** Among the stops nobody booked: a dinner closes the day, as it always has. A booked stop sits wherever its hour puts it. */
  const dinnersLast = (order: readonly number[]) => {
    let dinner = false;
    for (const stop of order) {
      if (fixedOf[stop] !== null) continue;
      if (stops[stop].meal === "dinner") dinner = true;
      else if (dinner) return false;
    }
    return true;
  };

  /**
   * A day the traveller said something about, laid out by construction: the
   * booked stops in the order of their hours, every other stop put where the
   * day then costs least, and each moved again for as long as that helps.
   * Good, not proven best — it starts the search over every order, and stands
   * in for it on a day too long to try them all.
   */
  function laidOut(ids: readonly number[], cls: number, rounds = 8): Described {
    const booked = ids.filter((stop) => fixedOf[stop] !== null).sort((left, right) => fixedOf[left]! - fixedOf[right]! || left - right);
    const free = ids.filter((stop) => fixedOf[stop] === null);
    const rank = (stop: number) => (stops[stop].meal === "dinner" ? 3 : stops[stop].meal === "lunch" ? 2 : stops[stop].stay >= DAY_FILLING_STAY ? 0 : 1);
    const waiting = [...free].sort((left, right) => rank(left) - rank(right) || left - right);
    let order = [...booked];
    let current: Described | null = order.length > 0 ? describe(order, cls) : null;
    const place = (stop: number, among: readonly number[]) => {
      let found: Described | null = null;
      for (let position = 0; position <= among.length; position += 1) {
        const candidate = [...among.slice(0, position), stop, ...among.slice(position)];
        if (!dinnersLast(candidate)) continue;
        const day = describe(candidate, cls);
        if (better(day, found)) found = day;
      }
      return found!;
    };
    for (const stop of waiting) {
      current = place(stop, order);
      order = current.order;
    }
    for (let round = 0, improved = true; improved && round < rounds; round += 1) {
      improved = false;
      for (const stop of free) {
        const moved = place(stop, order.filter((other) => other !== stop));
        if (better(moved, current)) {
          current = moved;
          order = moved.order;
          improved = true;
        }
      }
    }
    return current!;
  }

  /**
   * Every order of a day with a booked time, one by one, on the real clock.
   * What an order costs here is not the sum of its rides: a booked hour makes
   * an early arrival a wait and a late one a broken booking, and where the
   * lunch hour falls moves with the order. So nothing is looked up — each
   * order is run through the clock, and the best is the best by construction.
   * Orders are cut short only where no ending can win: when a booked hour has
   * already been passed (or can no longer be reached) once more than in the
   * best order found, or the rides so far, with the shortest ride into each
   * stop still to come, already cost more than it does. (The nearest stop is
   * tried first, so a good order is found early and most others are cut.)
   * Dinners nobody booked come after the sights nobody booked; a stay that
   * fills the day comes before them, unless another order can be kept or
   * breaks less (see openerYields).
   */
  function framedOrders(ids: readonly number[], cls: number, seed: Described | null, hours = false): Described {
    const total = ids.length;
    if (total < 2) return seed ?? describe([...ids], cls, hours);
    // The cheapest ride into each stop from any other of the day's, and the cheapest way home.
    const cheapestIn = new Float64Array(count);
    const nearest: number[][] = [];
    let everyIn = 0;
    for (const stop of ids) {
      let least = Infinity;
      for (const other of ids) if (other !== stop && weight[other][stop] < least) least = weight[other][stop];
      cheapestIn[stop] = least;
      everyIn += least;
      nearest[stop] = ids.filter((other) => other !== stop).sort((left, right) => weight[stop][left] - weight[stop][right] || left - right);
    }
    const fromStart = weightOut ? [...ids].sort((left, right) => weightOut[left] - weightOut[right] || left - right) : [...ids];
    const cheapestBack = weightBack ? Math.min(...ids.map((stop) => weightBack[stop])) : 0;
    const buffer = DAY_CLOCK.legBuffer;
    const lunchHours = DAY_CLOCK.meals.lunch;
    const close = cls & 2 ? lastFinish : null;
    const opens = cls & 1 ? firstStart! : 0;
    const lunchChosen = ids.some((stop) => stops[stop].meal === "lunch");
    const openers = ids.some((stop) => fixedOf[stop] === null && !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY);
    const booked = ids.filter((stop) => fixedOf[stop] !== null);
    type Found = { broken: number; cost: number; over: number; weight: number; order: number[]; keepable: boolean };
    const from = (day: Described): Found => ({ broken: day.broken, cost: day.orderCost, over: day.sightsOver, weight: day.weight, order: day.order, keepable: day.keepable });
    const arrive = new Float64Array(total);
    const ends = new Float64Array(total);
    const plainEnds = new Float64Array(total);
    const held = new Float64Array(total);
    const search = (openersFirst: boolean, limit: Found | null) => {
      // Among the stops nobody booked: 0 opens the day, 2 closes it. A booked stop has no rank.
      const rank = (stop: number) => (fixedOf[stop] !== null ? -1 : stops[stop].meal === "dinner" ? 2 : openersFirst && !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY ? 0 : 1);
      let found = limit;
      const order: number[] = [];
      const used = new Uint8Array(count);
      let missed = 0;
      let late = 0;
      let hardOver = 0;
      /** clockPass(), without building anything. */
      const pass = (lunchAt: number) => {
        missed = 0;
        late = 0;
        let nightOver = 0;
        let cursor = firstArrival(order[0], cls);
        for (let position = 0; position < total; position += 1) {
          const stop = order[position];
          const meal = stops[stop].meal;
          const fixed = fixedOf[stop];
          let arrival = cursor;
          let wait = 0;
          if (fixed !== null) {
            if (cursor > fixed && (position === 0 ? opens + (hotel ? hotel.out[stop] : 0) <= fixed : cursor - buffer <= fixed && fixedOf[order[position - 1]] !== null)) cursor = fixed;
            if (cursor <= fixed) {
              wait = fixed - cursor;
              arrival = fixed;
            } else late += 1;
          } else if (meal) {
            const hours = DAY_CLOCK.meals[meal];
            const seated = Math.max(cursor, hours.open);
            if (seated > hours.lastSeat) missed += 1;
            else {
              wait = seated - cursor;
              arrival = seated;
            }
          }
          const departure = arrival + stops[stop].stay + (position === lunchAt ? DAY_CLOCK.lunchMinutes : 0);
          arrive[position] = arrival;
          ends[position] = departure;
          held[position] = wait;
          if (fixed === null && departure - DAY_CLOCK.lastMinute > nightOver) nightOver = departure - DAY_CLOCK.lastMinute;
          cursor = departure;
          if (position < total - 1) cursor += problem.minutes[stop][order[position + 1]] + buffer;
        }
        hardOver = Math.max(nightOver, close === null ? 0 : ends[total - 1] + (hotel ? hotel.back[order[total - 1]] : 0) - close);
      };
      /** dayClock() and describe()'s cost for the order in hand. */
      const weigh = (soFar: number) => {
        const weightTotal = soFar + (weightBack ? weightBack[order[total - 1]] : 0);
        pass(-1);
        if (!lunchChosen) {
          const lateBefore = late;
          const hardBefore = hardOver;
          plainEnds.set(ends);
          let tried = 0;
          let lunched = false;
          for (;;) {
            // The stop that ends nearest 12:30 among those not tried yet; the earlier one on a tie.
            let next = -1;
            let nearest = Infinity;
            for (let position = 0; position < total; position += 1) {
              const end = plainEnds[position];
              if (tried & (1 << position) || stops[order[position]].meal || end < lunchHours.open || end > lunchHours.lastSeat) continue;
              if (Math.abs(end - 750) < nearest) {
                nearest = Math.abs(end - 750);
                next = position;
              }
            }
            if (next < 0) break;
            tried |= 1 << next;
            pass(next);
            if (late <= lateBefore && (hardOver === 0 || hardBefore > 0)) {
              lunched = true;
              break;
            }
          }
          if (tried === 0) {
            // No stop ends at lunchtime: the visit that runs across it carries the hour (see dayClock).
            for (let position = 0; position < total; position += 1) {
              const stop = order[position];
              if (stops[stop].meal || fixedOf[stop] !== null || stops[stop].stay >= DAY_FILLING_STAY) continue;
              if (arrive[position] <= LATE_LUNCH && plainEnds[position] > lunchHours.lastSeat) {
                tried = 1;
                pass(position);
                lunched = late <= lateBefore && (hardOver === 0 || hardBefore > 0);
                break;
              }
            }
          }
          if (tried === 0) {
            // Nor does a visit run across it: before a ride that does, the hour follows the stop it leaves from.
            for (let position = 0; position < total - 1; position += 1) {
              const end = plainEnds[position];
              if (stops[order[position]].meal || end < EARLY_LUNCH || end >= lunchHours.open || arrive[position + 1] - held[position + 1] <= LATE_LUNCH) continue;
              tried = 1;
              pass(position);
              lunched = late <= lateBefore && (hardOver === 0 || hardBefore > 0);
              break;
            }
          }
          if (!lunched && tried !== 0) pass(-1);
        }
        let overrun = 0;
        let waiting = 0;
        let lastSight = -1;
        for (let position = 0; position < total; position += 1) {
          const stop = order[position];
          if (fixedOf[stop] !== null) continue;
          const meal = stops[stop].meal;
          overrun = Math.max(overrun, ends[position] - (meal === "dinner" ? DAY_CLOCK.dinnerEnd : DAY_CLOCK.sightsEnd));
          if (meal === "lunch") waiting += held[position];
          if (meal !== "dinner") lastSight = position;
        }
        const broken = late + (hardOver > 0 ? 1 : 0);
        const over = ends[Math.max(0, lastSight)];
        let cost = rideOf(weightTotal) + waiting / 2 + penalty(overrun, missed) + (broken > 0 ? 1000 * late + penalty(hardOver, 0) : 0);
        // (What the hours cost is never less than nothing: an order already dearer without it is not asked.)
        if (hours && !(found && (broken > found.broken || (broken === found.broken && cost > found.cost + EPSILON)))) cost += habitCost(order, total, arrive, ends);
        if (found) {
          if (broken > found.broken) return;
          if (broken === found.broken && (cost > found.cost + EPSILON || (cost > found.cost - EPSILON && (over > found.over || (over === found.over && weightTotal >= found.weight))))) return;
        }
        found = { broken, cost, over, weight: weightTotal, order: [...order], keepable: overrun === 0 && missed === 0 && broken === 0 };
      };
      /** `leave`: when the last stop of the order so far is left, no lunch hour counted — never later than on the real clock. */
      const visit = (soFar: number, leave: number, lateSoFar: number, lastRank: number, toCome: number) => {
        if (order.length === total) {
          weigh(soFar);
          return;
        }
        const last = order.length > 0 ? order[order.length - 1] : -1;
        for (const stop of last >= 0 ? nearest[last] : fromStart) {
          if (used[stop]) continue;
          const ranked = rank(stop);
          if (ranked >= 0 && ranked < lastRank) continue;
          const next = soFar + (last >= 0 ? weight[last][stop] : weightOut ? weightOut[stop] : 0);
          let cursor = last >= 0 ? leave + problem.minutes[last][stop] + buffer : firstArrival(stop, cls);
          const fixed = fixedOf[stop];
          let lateNow = lateSoFar;
          let arrival = cursor;
          if (fixed !== null) {
            if (cursor > fixed && (last < 0 ? opens + (hotel ? hotel.out[stop] : 0) <= fixed : cursor - buffer <= fixed && fixedOf[last] !== null)) cursor = fixed;
            if (cursor <= fixed) arrival = fixed;
            else lateNow += 1;
          } else if (stops[stop].meal) {
            const hours = DAY_CLOCK.meals[stops[stop].meal!];
            const seated = Math.max(cursor, hours.open);
            if (seated <= hours.lastSeat) arrival = seated;
          }
          const departure = arrival + stops[stop].stay;
          if (found) {
            // Booked hours still to come that are already out of reach are late in every ending.
            let least = lateNow;
            // (Straight from a booking the slack may be given up; by any other way it is not.)
            const soonest = departure + (fixed !== null ? 0 : buffer);
            for (const other of booked) {
              if (other !== stop && !used[other] && fixedOf[other]! < soonest) least += 1;
            }
            if (least > found.broken) continue;
            // The rides — these, and no less than the cheapest into each stop still to come, and home — already cost more than the best order found.
            if (least === found.broken && rideOf(next + toCome - cheapestIn[stop] + cheapestBack) + 1000 * least > found.cost + EPSILON) continue;
          }
          used[stop] = 1;
          order.push(stop);
          visit(next, departure, lateNow, ranked >= 0 ? ranked : lastRank, toCome - cheapestIn[stop]);
          order.pop();
          used[stop] = 0;
        }
      };
      visit(0, 0, 0, -1, everyIn);
      return found;
    };
    /** Whether an order found elsewhere is one this search would look at. */
    const obeys = (order: readonly number[], openersFirst: boolean) => {
      let lastRank = -1;
      for (const stop of order) {
        if (fixedOf[stop] !== null) continue;
        const ranked = stops[stop].meal === "dinner" ? 2 : openersFirst && !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY ? 0 : 1;
        if (ranked < lastRank) return false;
        lastRank = ranked;
      }
      return true;
    };
    const start = (openersFirst: boolean) => (seed && obeys(seed.order, openersFirst) ? from(seed) : null);
    let found: Found | null;
    if (openers) {
      const opened = search(true, start(true));
      found = opened?.keepable ? opened : search(false, opened ?? start(false));
      if (opened && found && found.order !== opened.order) {
        const told = (day: Found) => (seed && day.order === seed.order ? seed : describe(day.order, cls, hours));
        if (!openerYields(told(opened), told(found))) found = opened;
      }
    } else found = search(false, start(false));
    return seed && found!.order === seed.order ? seed : describe(found!.order, cls, hours);
  }

  /**
   * The best order for a day the traveller said something about: a start
   * that is not the usual one, a finish, a booked time.
   */
  function solveFramed(ids: readonly number[], cls: number): Solved {
    const free = ids.filter((stop) => fixedOf[stop] === null);
    const dinners = free.filter((stop) => stops[stop].meal === "dinner");
    const lunches = free.filter((stop) => stops[stop].meal === "lunch");
    const openers = free.filter((stop) => !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY);
    const plain = free.filter((stop) => !stops[stop].meal && stops[stop].stay < DAY_FILLING_STAY);
    if (free.length === ids.length && lunches.length === 0 && openers.length <= 1 && dinners.length <= 4 && (shared || plain.length <= EXACT_ORDER_STOPS)) {
      // Nothing booked and no restaurant to reach at its hour: only the day's
      // start and finish moved, and the rides do not depend on the clock. So,
      // as on any day, the shortest route to each possible last sight is a
      // candidate and the day's cost — on this day's clock — picks among them.
      const head = openers.length === 1 ? openers[0] : -1;
      const best: { day: Described | null; unkept: number } = { day: null, unkept: Infinity };
      const closings = permutations(dinners);
      const { nodes, all, table } = routesOver(plain);
      const routes = all === 0 ? [[]] : nodes.flatMap((_, index) => (all & (1 << index) ? [pathTo(table(head), nodes, all, index)] : []));
      for (const route of routes) {
        for (const closing of closings) {
          const candidate = describe([...(head >= 0 ? [head] : []), ...route, ...closing], cls);
          if (!candidate.keepable && candidate.base < best.unkept) best.unkept = candidate.base;
          if (better(candidate, best.day)) best.day = candidate;
        }
      }
      const day = best.day!;
      return { ...day, doubt: !day.keepable || best.unkept < day.orderCost - EPSILON };
    }
    // Whether any order at all could be kept: the stays alone, from the
    // earliest start, against 18:00 (and half an hour, as on any day) and
    // against the finish the traveller entered.
    // (A booking before the usual start may open the day at its own hour.)
    const earliest = Math.min(...ids.map((stop) => Math.min(firstArrival(stop, cls), fixedOf[stop] ?? Infinity)));
    const sights = free.filter((stop) => stops[stop].meal !== "dinner");
    const hopeless = earliest + sights.reduce((sum, stop) => sum + stops[stop].stay, 0) + DAY_CLOCK.legBuffer * Math.max(0, sights.length - 1) > DAY_CLOCK.sightsEnd + 30
      || (cls & 2 && earliest + ids.reduce((sum, stop) => sum + stops[stop].stay, 0) + DAY_CLOCK.legBuffer * (ids.length - 1) + (hotel ? Math.min(...ids.map((stop) => hotel.back[stop])) : 0) > lastFinish!);
    if (ids.length <= Math.min(limits.bookedDayStops ?? Infinity, hopeless ? HOPELESS_DAY_STOPS : BOOKED_DAY_STOPS)) return { ...framedOrders(ids, cls, null), doubt: false };
    // Too many orders to try while the days are still being chosen — there
    // are thousands of candidate days. The stops nobody booked keep the
    // order they would have on an ordinary day, and each booked stop goes
    // where the day then costs least. If the day is printed, it is tried in
    // every order first (see everyOrder).
    let day = free.length > 0 ? describe([...solveDay(free).order], cls) : null;
    for (const stop of ids.filter((entry) => fixedOf[entry] !== null).sort((left, right) => fixedOf[left]! - fixedOf[right]! || left - right)) {
      const among: readonly number[] = day ? day.order : [];
      let placed: Described | null = null;
      for (let position = 0; position <= among.length; position += 1) {
        const candidate = describe([...among.slice(0, position), stop, ...among.slice(position)], cls);
        if (better(candidate, placed)) placed = candidate;
      }
      day = placed;
    }
    return { ...day!, doubt: true };
  }

  /**
   * Every order of a small day, one by one. The tables above give, for
   * each way a day can end, its shortest route; an order they rule out
   * because its clock runs late can still have a longer cousin that fits —
   * one whose lunch hour falls after another stop, or that takes a taxi
   * the shortest route avoids. So a day of up to eight stops whose shortest
   * routes did not all fit is tried in every order before it is printed.
   * Dinners come last; a stay that fills the day comes first, unless
   * another order can be kept or keeps a meal more (see openerYields).
   */
  function everyOrder(start: Solved): Described {
    const ids = start.order;
    const total = ids.length;
    // `hours`: the day is being put in order with what its hours cost counted (see byHours),
    // which the tables know nothing of: every order is tried whether or not they left a doubt.
    const hours = start.hours;
    if (start.framed) {
      if (!(start.doubt || hours) || total < 2) return start;
      // (Asked for every candidate count of days and again when printed: worked out once.)
      const key = `${hours ? "h" : ""}${start.cls}|${[...ids].sort((left, right) => left - right).join(",")}`;
      let known = enumerated.get(key);
      if (!known) {
        if (total <= EVERY_ORDER_STOPS) known = framedOrders(ids, start.cls, start, hours);
        else {
          // Too long for every order: each stop moved wherever it helps. Good, not proven best.
          const moved = laidOut(ids, start.cls);
          known = better(moved, start) ? moved : start;
        }
        enumerated.set(key, known);
      }
      return known;
    }
    if (!(start.doubt || hours) || total > EVERY_ORDER_STOPS || total < 2) return start;
    const dinners = new Set(ids.filter((stop) => stops[stop].meal === "dinner"));
    const openers = new Set(ids.filter((stop) => !stops[stop].meal && stops[stop].stay >= DAY_FILLING_STAY));
    const lunchChosen = ids.some((stop) => stops[stop].meal === "lunch");
    const ends = new Float64Array(total);
    const arrivals = new Float64Array(total);
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
            arrivals[position] = arrival;
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
            // No stop ends at lunchtime: the visit that runs across it carries the hour (see dayClock).
            for (let position = 0; lunchAt < 0 && position < total; position += 1) {
              const stop = order[position];
              if (stops[stop].meal || stops[stop].stay >= DAY_FILLING_STAY) continue;
              if (arrivals[position] <= LATE_LUNCH && ends[position] > DAY_CLOCK.meals.lunch.lastSeat) lunchAt = position;
            }
            // Nor does a visit run across it: before a ride that does, the hour follows the stop it leaves from.
            for (let position = 0; lunchAt < 0 && position < total - 1; position += 1) {
              if (stops[order[position]].meal || ends[position] < EARLY_LUNCH || ends[position] >= DAY_CLOCK.meals.lunch.open || ends[position] + problem.minutes[order[position]][order[position + 1]] + DAY_CLOCK.legBuffer <= LATE_LUNCH) continue;
              lunchAt = position;
            }
            if (lunchAt >= 0) continue;
          }
          const overrun = Math.max(
            0,
            sightsOver >= 0 ? sightsOver - DAY_CLOCK.sightsEnd : 0,
            dinners.has(order[total - 1]) ? ends[total - 1] - DAY_CLOCK.dinnerEnd : 0,
          );
          const over = sightsOver >= 0 ? sightsOver : ends[0];
          let cost = rideOf(weightTotal) + waiting / 2 + penalty(overrun, missed);
          // (What the hours cost is never less than nothing: an order already dearer without it is not asked.)
          if (hours && !(found && cost > found.cost + EPSILON)) cost += habitCost(order, total, arrivals, ends);
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
      if (opened && found && found.order !== opened.order) {
        const told = (day: Found) => (day.order === start.order ? start : describe(day.order, 0, hours));
        if (!openerYields(told(opened), told(found))) found = opened;
      }
    } else found = search(false, from(start));
    return found && found.order !== start.order ? describe(found.order, 0, hours) : start;
  }

  /**
   * A day that has been chosen, put in the order a traveller would keep it
   * in: the order that costs least with what its hours cost counted (see
   * HABITS) — the museum not at half past eight while a shrine could open
   * the day, the temple not after five while a street could close it, when
   * that is a few minutes more on the way and no more. Every order of the
   * day is tried, on the same clock and under the same rules as ever (a
   * dinner closes the day, a stay that fills it opens it, an entered time
   * is kept before anything), so the order found is the best there is by
   * that cost; a day of more than eight stops keeps the order it has.
   * Which places share the day was decided before this, without it.
   */
  function byHours(day: Solved): Described {
    if (!habitsOn || day.order.length < 2 || day.order.length > EVERY_ORDER_STOPS) return everyOrder(day);
    const told = describe(day.order, day.cls, true);
    // Nothing about its hours to mend: the day as it always was.
    if (told.habit === 0) return everyOrder(day);
    return everyOrder({ ...told, doubt: day.doubt });
  }

  /*
   * What a day costs, by the set of its places and the day's class, for the
   * loop that costs every split of the list: a million splits each ask for
   * three days, and with a start or a finish entered for each of them on the
   * day it could be. Kept as plain arrays indexed by the set, so asking is an
   * array read — the answers are solveDay()'s own, worked out once.
   */
  type DayTable = { cost: Float64Array; km: Float64Array; broken: Int16Array };
  const dayTables: Array<DayTable | null> = [null, null, null, null];
  function dayTable(cls: number): DayTable {
    let table = dayTables[cls];
    if (!table) {
      table = { cost: new Float64Array(1 << count).fill(NaN), km: new Float64Array(1 << count), broken: new Int16Array(1 << count) };
      dayTables[cls] = table;
    }
    return table;
  }
  /** Fills the table's entry for this set (`mask`: the group as bits), if it is not there yet. */
  function costed(table: DayTable, mask: number, group: readonly number[], cls: number) {
    if (table.cost[mask] === table.cost[mask]) return;
    const day = solveDay(group, cls);
    table.cost[mask] = day.cost;
    table.km[mask] = day.km;
    table.broken[mask] = day.broken;
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
   * Stops the trip is planned without, for asking whether the list would fit
   * once one place is left out — and for a place that an entered time leaves
   * no room for. The days are the same days, so everything already worked
   * out for them is reused.
   */
  const skipped = new Uint8Array(count);
  let skippedCount = 0;
  /** The skipped stops as text, for remembering what was asked. */
  let skippedKey = "";
  /** The best split for each question already asked (see split). */
  const splitAnswers = new Map<string, Grouping>();
  /**
   * How the days of the trip being chosen are numbered: how many were asked
   * for, and whether day 1 is left empty (see choose). It decides which of
   * the days is day 1 and which the last — only that, and only when the
   * traveller entered a start or a finish.
   */
  let layout = { requested: 0, emptyFirst: false };

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
  /**
   * `broken`: entered times the split cannot keep, all its days together. It
   * comes before everything: two dinners on one evening are better than a
   * booking reached late. (Always 0 when the traveller entered no time.)
   */
  type Grouping = { days: Solved[]; cost: number; km: number; doubled: number; broken: number };
  type Value = { cost: number; km: number; doubled: number; broken: number };
  const cheaper = (left: Value, right: Value | null) => (
    right === null || left.broken < right.broken
    || (left.broken === right.broken && (left.doubled < right.doubled
      || (left.doubled === right.doubled && (left.cost < right.cost - EPSILON || (left.cost <= right.cost + EPSILON && left.km < right.km - EPSILON)))))
  );

  type Special = { first: boolean; last: boolean };
  const NO_SPECIAL: Special = { first: false, last: false };
  /**
   * Whether the groups of a split into `parts` days that are not pinned
   * reach day 1 (when it has a start) and the last day asked for (when it
   * has a finish). They take the earliest days no pin holds, as they always
   * have; which of them takes a special day is decided where a split is
   * costed, because a group costs more on a shortened day.
   */
  function specialDays(parts: number, pin: readonly (number | null)[]): Special {
    if (firstStart === null && lastFinish === null) return NO_SPECIAL;
    const taken = new Set(pin.filter((day) => day !== null));
    const special = { first: false, last: false };
    for (let day = 1, left = parts - taken.size; left > 0; day += 1) {
      if (taken.has(day) || (layout.emptyFirst && day === 1)) continue;
      left -= 1;
      if (day === 1 && firstStart !== null) special.first = true;
      if (day === layout.requested && lastFinish !== null) special.last = true;
    }
    return special;
  }
  /**
   * The days of a split, each solved on the day it would be printed on. A
   * pinned group has its day. Of the others, the one that is cheapest to
   * start late takes day 1 and the one cheapest to end early takes the last
   * day — every pairing is costed and the least broken, then cheapest, kept
   * (on a tie, the group listed first).
   */
  function assigned(groups: readonly (readonly number[])[], pinOf: (index: number) => number | null, special: Special): Solved[] {
    const classes = groups.map((_, index) => {
      const pinned = pinOf(index);
      return pinned === null ? 0 : classOf(pinned, layout.requested);
    });
    if (special.first || special.last) {
      const free = groups.flatMap((_, index) => (pinOf(index) === null ? [index] : []))
        .sort((left, right) => Math.min(...groups[left]) - Math.min(...groups[right]));
      const firsts = special.first ? free : [-1];
      const lasts = special.last ? free : [-1];
      const more = (index: number, cls: number) => {
        const usual = solveDay(groups[index]);
        const day = solveDay(groups[index], cls);
        return { broken: day.broken - usual.broken, cost: day.cost - usual.cost };
      };
      let chosen: { first: number; last: number; broken: number; cost: number } | null = null;
      for (const first of firsts) {
        for (const last of lasts) {
          let broken = 0;
          let cost = 0;
          if (first === last && first >= 0) {
            // One group is both only on a one-day trip.
            if (free.length > 1) continue;
            ({ broken, cost } = more(first, 3));
          } else {
            for (const [index, cls] of [[first, 1], [last, 2]]) {
              if (index < 0) continue;
              const added = more(index, cls);
              broken += added.broken;
              cost += added.cost;
            }
          }
          if (chosen === null || broken < chosen.broken || (broken === chosen.broken && cost < chosen.cost - EPSILON)) chosen = { first, last, broken, cost };
        }
      }
      if (chosen) {
        if (chosen.first >= 0) classes[chosen.first] |= 1;
        if (chosen.last >= 0) classes[chosen.last] |= 2;
      }
    }
    return groups.map((group, index) => solveDay(group, classes[index]));
  }
  const pinOfGroup = (group: readonly number[], pin: readonly (number | null)[]) => {
    for (const stop of group) if (pin[stop] !== null) return pin[stop];
    return null;
  };
  const grouping = (groups: readonly (readonly number[])[], pin: readonly (number | null)[], special: Special): Grouping => {
    const days = framesOn ? assigned(groups, (index) => pinOfGroup(groups[index], pin), special) : groups.map((group) => solveDay(group));
    return {
      days,
      ...tripCost(days),
      doubled: hasMeals ? groups.reduce((sum, group) => sum + doubledIn(group), 0) : 0,
      broken: framesOn ? days.reduce((sum, day) => sum + day.broken, 0) : 0,
    };
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
        if (stop.meal !== meal || skipped[index]) return;
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
    // The same question comes back whenever the trip is tried on another
    // number of days ("would one more day hold it?"): the best split into
    // three days is the same split whether four or five were asked for, as
    // long as the same days have a start, a finish or a pin.
    const special = specialDays(parts, pin);
    const asked = `${parts}|${quick ? 1 : 0}|${skippedKey}|${special.first ? 1 : 0}${special.last ? 1 : 0}|${pin.map((day) => (day === null ? "" : framesOn ? `${day}.${classOf(day, layout.requested)}` : day)).join(",")}`;
    const known = splitAnswers.get(asked);
    if (known) return known;
    const found = splitInto(parts, pin, quick, special);
    splitAnswers.set(asked, found);
    return found;
  }
  function splitInto(parts: number, pin: readonly (number | null)[], quick: boolean, special: Special): Grouping {
    const groups: number[][] = [];
    /** Each group as bits, kept in step with `groups` (only where every split is costed: at most sixteen places). */
    const masks: number[] = [];
    const pins: Array<number | null> = [];
    const loads: number[] = [];
    const best: { found: Grouping | null } = { found: null };
    // (A booked stop may sit in the evening, like a dinner: its stay is no part of the nine hours.)
    const load = (stop: number) => (stops[stop].meal === "dinner" || fixedOf[stop] !== null ? 0 : stops[stop].stay + DAY_CLOCK.legBuffer);
    const brokenBy = new Float64Array(32);
    const costBy = new Float64Array(32);
    // Nine hours of sightseeing, and the half hour a hotel day starts early.
    const dayLoad = DAY_CLOCK.sightsEnd - DAY_CLOCK.hotelStart + DAY_CLOCK.legBuffer;
    const every = (fitting: boolean, doubledLimit: number) => {
      let doubled = 0;
      const place = (stop: number) => {
        if (stop === count) {
          if (groups.length !== parts) return;
          if (framesOn) {
            // With a time entered a day's cost depends on which day it is
            // (see assigned(), which this repeats on numbers alone): of the
            // groups no pin holds, the one cheapest to start late takes day
            // 1 and the one cheapest to end early the last day.
            let firstAt = -1;
            let lastAt = -1;
            const usual = dayTable(0);
            if (special.first || special.last) {
              const late = special.first ? dayTable(1) : usual;
              const early = special.last ? dayTable(2) : usual;
              let free = 0;
              // The least this split can come to, whichever group takes day 1
              // and whichever the last day: every day as it is on a day in
              // between (a pinned group on its own day), plus the least any
              // one group adds by starting late and the least any one adds by
              // ending early.
              let floorCost = 0;
              let floorBroken = 0;
              let leastLateBroken = Infinity;
              let leastLateCost = Infinity;
              let leastEarlyBroken = Infinity;
              let leastEarlyCost = Infinity;
              for (let index = 0; index < parts; index += 1) {
                const mask = masks[index];
                if (pins[index] !== null) {
                  const cls = classOf(pins[index]!, layout.requested);
                  const table = dayTable(cls);
                  costed(table, mask, groups[index], cls);
                  floorCost += table.cost[mask];
                  floorBroken += table.broken[mask];
                  continue;
                }
                free += 1;
                costed(usual, mask, groups[index], 0);
                if (special.first) costed(late, mask, groups[index], 1);
                if (special.last) costed(early, mask, groups[index], 2);
                floorCost += usual.cost[mask];
                floorBroken += usual.broken[mask];
                brokenBy[index] = late.broken[mask] - usual.broken[mask];
                costBy[index] = late.cost[mask] - usual.cost[mask];
                brokenBy[16 + index] = early.broken[mask] - usual.broken[mask];
                costBy[16 + index] = early.cost[mask] - usual.cost[mask];
                if (brokenBy[index] < leastLateBroken) leastLateBroken = brokenBy[index];
                if (costBy[index] < leastLateCost) leastLateCost = costBy[index];
                if (brokenBy[16 + index] < leastEarlyBroken) leastEarlyBroken = brokenBy[16 + index];
                if (costBy[16 + index] < leastEarlyCost) leastEarlyCost = costBy[16 + index];
              }
              // A split whose least is already no better than the best one
              // found is not looked at further: of a million splits a few
              // thousand are. (Not where one group is both day 1 and the last
              // day: that day is costed as itself, not as the two added up.)
              const found = best.found;
              if (found !== null && free > 0 && !(special.first && special.last && free === 1)) {
                const leastBroken = floorBroken + (special.first ? leastLateBroken : 0) + (special.last ? leastEarlyBroken : 0);
                const leastCost = floorCost + (special.first ? leastLateCost : 0) + (special.last ? leastEarlyCost : 0);
                if (leastBroken > found.broken || (leastBroken === found.broken && (doubled > found.doubled || (doubled === found.doubled && leastCost > found.cost + 2 * EPSILON)))) return;
              }
              let leastBroken = Infinity;
              let leastCost = Infinity;
              for (let first = special.first ? 0 : -1; first < (special.first ? parts : 0); first += 1) {
                if (first >= 0 && pins[first] !== null) continue;
                for (let last = special.last ? 0 : -1; last < (special.last ? parts : 0); last += 1) {
                  if (last >= 0 && pins[last] !== null) continue;
                  let brokenMore = (first >= 0 ? brokenBy[first] : 0) + (last >= 0 ? brokenBy[16 + last] : 0);
                  let costMore = (first >= 0 ? costBy[first] : 0) + (last >= 0 ? costBy[16 + last] : 0);
                  if (first === last && first >= 0) {
                    // One group is both only on a one-day trip.
                    if (free > 1) continue;
                    const both = dayTable(3);
                    costed(both, masks[first], groups[first], 3);
                    brokenMore = both.broken[masks[first]] - usual.broken[masks[first]];
                    costMore = both.cost[masks[first]] - usual.cost[masks[first]];
                  }
                  if (brokenMore < leastBroken || (brokenMore === leastBroken && costMore < leastCost - EPSILON)) {
                    leastBroken = brokenMore;
                    leastCost = costMore;
                    firstAt = first;
                    lastAt = last;
                  }
                }
              }
            }
            const classAt = (index: number) => (pins[index] !== null ? classOf(pins[index]!, layout.requested) : (index === firstAt ? 1 : 0) | (index === lastAt ? 2 : 0));
            let cost = 0;
            let km = 0;
            let broken = 0;
            let lonely = false;
            let full = false;
            for (let index = 0; index < parts; index += 1) {
              const group = groups[index];
              const cls = classAt(index);
              const table = dayTable(cls);
              costed(table, masks[index], group, cls);
              cost += table.cost[masks[index]];
              km += table.km[masks[index]];
              broken += table.broken[masks[index]];
              if (group.length === 1 && !stops[group[0]].meal && stops[group[0]].stay < 240) lonely = true;
              if (group.length >= 3) full = true;
            }
            if (lonely && full) cost += 40;
            if (cheaper({ cost, km, doubled, broken }, best.found)) best.found = { days: groups.map((group, index) => solveDay(group, classAt(index))), cost, km, doubled, broken };
            return;
          }
          // The days are looked up before anything is built: of a million splits one is kept.
          let cost = 0;
          let km = 0;
          let lonely = false;
          let full = false;
          const table = dayTable(0);
          for (let index = 0; index < parts; index += 1) {
            const group = groups[index];
            costed(table, masks[index], group, 0);
            cost += table.cost[masks[index]];
            km += table.km[masks[index]];
            if (group.length === 1 && !stops[group[0]].meal && stops[group[0]].stay < 240) lonely = true;
            if (group.length >= 3) full = true;
          }
          if (lonely && full) cost += 40;
          if (cheaper({ cost, km, doubled, broken: 0 }, best.found)) best.found = { days: groups.map((group) => solveDay(group)), cost, km, doubled, broken: 0 };
          return;
        }
        if (skipped[stop]) {
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
          masks[index] |= 1 << stop;
          loads[index] += load(stop);
          doubled += twice;
          if (pinned !== null) pins[index] = pinned;
          place(stop + 1);
          pins[index] = before;
          doubled -= twice;
          loads[index] -= load(stop);
          masks[index] ^= 1 << stop;
          groups[index].pop();
        }
        if (home < 0 && groups.length < parts) {
          groups.push([stop]);
          masks.push(1 << stop);
          pins.push(pinned);
          loads.push(load(stop));
          place(stop + 1);
          groups.pop();
          masks.pop();
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
    if (shared && count <= EXACT_SPLIT_STOPS && splits(count - skippedCount, parts) <= (limits.exactSplits ?? (quick ? QUICK_EXACT_SPLITS : EXACT_SPLITS))) {
      // First only the splits whose days could hold their stays at all. If
      // one of them fits, no split with an impossible day can beat it.
      every(true, least);
      if (fits(best.found)) return best.found!;
      // Nothing fits: every split is costed, so that a list too long for its
      // days is still laid out as well as it can be.
      every(false, least);
      // (Keeping restaurants apart must not cost a booking: when the best of
      // those splits breaks an entered time, the ones that double up are costed too.)
      if (!best.found || (hasMeals && best.found.broken > 0)) every(false, Infinity);
      return best.found!;
    }
    // Too many splits to cost them all. Start from maps that make sense and
    // keep moving one place, or swapping two, for as long as the trip gets
    // cheaper; every neighbouring split is tried before stopping.
    for (const variant of [0, 1, 2]) {
      const candidate = improve(apart(seed(parts, pin, variant), pin), pin, special);
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
    const free = stops.flatMap((_, index) => (pin[index] === null && !skipped[index] ? [index] : []));
    for (let shake = 0; shake < (parts < 2 || free.length < 2 ? 0 : quick && skippedCount > 0 ? SHAKES_WITHOUT : SHAKES); shake += 1) {
      const groups = best.found!.days.map((day) => [...day.order]);
      for (let moves = 0; moves < 3; moves += 1) {
        const stop = free[draw(free.length)];
        const from = groups.findIndex((group) => group.includes(stop));
        const to = (from + 1 + draw(parts - 1)) % parts;
        if (groups[from].length < 2) continue;
        groups[from].splice(groups[from].indexOf(stop), 1);
        groups[to].push(stop);
      }
      const candidate = improve(apart(groups, pin), pin, special);
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
    const free = stops.flatMap((_, index) => (pin[index] === null && !skipped[index] ? [index] : []));
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
    const total = stops.reduce((sum, stop, index) => sum + (skipped[index] ? 0 : stop.stay), 0);
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
  function improve(start: number[][], pin: readonly (number | null)[], special: Special): Grouping {
    const groups = start.map((group) => [...group]);
    let current = grouping(groups, pin, special);
    for (let round = 0; round < 200; round += 1) {
      const found: { groups: number[][] | null; value: Grouping } = { groups: null, value: current };
      const others = (left: number, right: number) => current.doubled - doubledIn(groups[left]) - doubledIn(groups[right]);
      const tryWith = (left: number, leftGroup: number[], right: number, rightGroup: number[]) => {
        // A split that doubles up more restaurants is never the better one: its days need not be solved.
        // (Unless an entered time is at stake: a split that breaks fewer of them wins even so.)
        if (hasMeals && !framesOn && others(left, right) + doubledIn(leftGroup) + doubledIn(rightGroup) > found.value.doubled) return;
        const candidate = groups.map((group, index) => (index === left ? leftGroup : index === right ? rightGroup : group));
        const value = grouping(candidate, pin, special);
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
    const final = thorough ? byHours(day) : day;
    const order = final.order;
    const clock = scheduleDay(
      order.map((stop) => stops[stop].stay),
      order.map((stop) => stops[stop].meal),
      order.slice(0, -1).map((stop, position) => problem.minutes[stop][order[position + 1]]),
      hotel ? hotel.out[order[0]] : null,
      final.framed
        ? {
          fixed: order.map((stop) => fixedOf[stop]),
          open: final.cls & 1 ? firstStart : null,
          close: final.cls & 2 ? lastFinish : null,
          homeward: hotel ? hotel.back[order.at(-1)!] : 0,
          night: DAY_CLOCK.lastMinute,
        }
        : undefined,
      habitsOn ? order.map((stop) => stops[stop].daytime) : undefined,
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
      // What is said of the day (the search's own count has no grace: see DAY_CLOCK.endGrace).
      // The worst of its stops is over its hour by exactly this much, so the grace is read off it.
      overrun: pastEnd(final.overrun, 0),
      pastHour: final.overrun,
      span: final.span,
      tight: final.tight,
      cost: final.cost,
      late: clock.late,
      hardOver: clock.hardOver,
      noLunchRoom: clock.noLunchRoom,
    };
  }

  /**
   * Gives each day its number: a pinned day keeps the traveller's, the rest
   * take the earliest days left, in list order. (With a start or a finish
   * entered, the group that was costed as day 1 is day 1 and the one costed
   * as the last day is the last day; the others follow in list order.)
   */
  function numbered(days: readonly Solved[], requested: number, pin: readonly (number | null)[], thorough: boolean, emptyFirst = false): PlannedTrip {
    const pinnedTo = (day: Solved) => day.order.map((stop) => pin[stop]).find((value) => value !== null) ?? null;
    const taken = new Set(days.map(pinnedTo).filter((value) => value !== null));
    const inListOrder = days.filter((day) => pinnedTo(day) === null).sort((left, right) => Math.min(...left.order) - Math.min(...right.order));
    const opening = inListOrder.find((day) => day.cls & 1) ?? null;
    const closing = inListOrder.find((day) => day.cls & 2) ?? null;
    const open = Array.from({ length: requested + days.length }, (_, index) => index + 1)
      .filter((day) => !taken.has(day) && !(day === 1 && (emptyFirst || opening)) && !(day === requested && closing));
    const others = inListOrder.filter((day) => day !== opening && day !== closing);
    const numberOf = (day: Solved) => pinnedTo(day) ?? (day === opening ? 1 : day === closing ? requested : open[others.indexOf(day)]);
    const numberedDays = days.map((day) => ({ ...printed(day, thorough), day: numberOf(day) }))
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

  /*
   * What can be kept at all.
   *
   * Whether a set of places can share a day without breaking an entered time
   * — a booking reached late, the finish passed, the day's own midnight — is
   * a question about clocks only, and it has an exact answer that needs no
   * search over orders: arriving earlier never makes a traveller leave later
   * (early at a booking or a restaurant is a wait), so the earliest moment a
   * set can be finished at each possible last stop is found by dynamic
   * programming over the set, and the set can be kept if one of those ends
   * is in time. The lunch hour is not counted: on a day with an entered time
   * it is only taken where it breaks nothing. The one rule about order the
   * search itself keeps is kept here too: among the stops nobody booked, a
   * dinner comes after the sights.
   */
  const leaveTables = new Map<number, Float64Array>();
  const freeDinners = stops.reduce((mask, stop, index) => (fixedOf[index] === null && stop.meal === "dinner" ? mask | (1 << index) : mask), 0);
  /** When a stop nobody booked is left, reached at `cursor`; Infinity when that is after the day's last minute. */
  function leaveFree(stop: number, cursor: number) {
    let arrival = cursor;
    const meal = stops[stop].meal;
    if (meal) {
      const seated = Math.max(cursor, DAY_CLOCK.meals[meal].open);
      if (seated <= DAY_CLOCK.meals[meal].lastSeat) arrival = seated;
    }
    const leave = arrival + stops[stop].stay;
    return leave > DAY_CLOCK.lastMinute ? Infinity : leave;
  }
  /** When `stop` is left as the first of a day of this class; Infinity when an entered time is broken. */
  function leaveFirst(cls: number, stop: number) {
    const fixed = fixedOf[stop];
    const cursor = firstArrival(stop, cls);
    if (fixed === null) return leaveFree(stop, cursor);
    // A booking opens the day early, or is reached by the ride alone from the hour the traveller can start.
    return cursor <= fixed || (cls & 1 ? firstStart! : 0) + (hotel ? hotel.out[stop] : 0) <= fixed ? fixed + stops[stop].stay : Infinity;
  }
  /** When `next` is left, coming from `last` (left at `left`) after the stops in `mask`; Infinity when an entered time is broken. */
  function leaveNext(mask: number, last: number, left: number, next: number) {
    const fixed = fixedOf[next];
    const cursor = left + problem.minutes[last][next] + DAY_CLOCK.legBuffer;
    if (fixed !== null) {
      // Straight from one booking to the next the slack is given up (see clockPass).
      return cursor <= fixed || (fixedOf[last] !== null && cursor - DAY_CLOCK.legBuffer <= fixed) ? fixed + stops[next].stay : Infinity;
    }
    if (mask & freeDinners && stops[next].meal !== "dinner") return Infinity;
    return leaveFree(next, cursor);
  }
  function earliestLeaves(cls: number) {
    const known = leaveTables.get(cls);
    if (known) return known;
    const size = 1 << count;
    const table = new Float64Array(size * count).fill(Infinity);
    for (let stop = 0; stop < count; stop += 1) table[(1 << stop) * count + stop] = leaveFirst(cls, stop);
    for (let mask = 1; mask < size; mask += 1) {
      for (let last = 0; last < count; last += 1) {
        const left = table[mask * count + last];
        if (left === Infinity) continue;
        for (let next = 0; next < count; next += 1) {
          if (mask & (1 << next)) continue;
          const leave = leaveNext(mask, last, left, next);
          const slot = (mask | (1 << next)) * count + next;
          if (leave < table[slot]) table[slot] = leave;
        }
      }
    }
    leaveTables.set(cls, table);
    return table;
  }
  /** The stop a day of these places can end on with every entered time kept — the one that is over soonest — or -1. */
  function lastHeld(cls: number, mask: number, ignoreFinish: boolean) {
    const table = earliestLeaves(cls);
    let found = -1;
    for (let last = 0; last < count; last += 1) {
      if (!(mask & (1 << last))) continue;
      const left = table[mask * count + last];
      if (left === Infinity || (cls & 2 && !ignoreFinish && left + (hotel ? hotel.back[last] : 0) > lastFinish!)) continue;
      if (found < 0 || left < table[mask * count + found]) found = last;
    }
    return found;
  }
  /** Whether the places in `mask` can share a day of this class with every entered time kept. */
  const holds = (cls: number, mask: number, ignoreFinish: boolean) => lastHeld(cls, mask, ignoreFinish) >= 0;
  /** An order of the places in `mask` that keeps every entered time on a day of this class, or null when there is none. */
  function heldOrder(cls: number, mask: number) {
    const table = earliestLeaves(cls);
    let last = lastHeld(cls, mask, false);
    if (last < 0) return null;
    const order: number[] = [];
    for (let rest = mask; ;) {
      order.push(last);
      const before = rest ^ (1 << last);
      if (before === 0) break;
      const target = table[rest * count + last];
      let previous = -1;
      for (let index = 0; index < count && previous < 0; index += 1) {
        if (!(before & (1 << index))) continue;
        const left = table[before * count + index];
        if (left !== Infinity && leaveNext(before, index, left, last) === target) previous = index;
      }
      if (previous < 0) return null;
      rest = before;
      last = previous;
    }
    return order.reverse();
  }
  /** The oracle's tables are two to the power of the list: only for lists up to this long. */
  const HELD_STOPS = 16;
  /**
   * A day the solver left breaking an entered time although the clock shows
   * it can be kept (the tables above are exact; the solver's shortcuts — the
   * shortest route to each last stop, a long stay put first, a booked stop
   * slotted into the others' order — are not). The order that keeps every
   * time replaces it, and on a short day starts the search over every order,
   * which then cuts off whatever breaks one: so a day is called broken only
   * when no order of it can be kept.
   */
  function kept(ids: readonly number[], cls: number, day: Solved): Solved {
    if (!framesOn || day.broken === 0 || count > HELD_STOPS) return day;
    const order = heldOrder(cls, ids.reduce((mask, stop) => mask | (1 << stop), 0));
    if (!order) return day;
    const held = describe(order, cls);
    if (held.broken > 0) return day;
    return { ...(ids.length <= BOOKED_DAY_STOPS ? framedOrders(ids, cls, held) : held), doubt: true };
  }
  /** Lists this long are looked at set by set: three to the power of the places, per day. */
  const KEEP_MOST_WORK = 30_000_000;

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
    choose(requestedDays: number, options: { quick?: boolean; /** Plan the trip without this stop, or these. */ without?: number | readonly number[] } = {}): PlannedTrip {
      const requested = Math.max(1, Math.min(14, Math.round(requestedDays)));
      const without = new Set(typeof options.without === "number" ? (options.without >= 0 ? [options.without] : []) : options.without ?? []);
      // A booking on a day the trip does not have cannot be planned; the
      // caller sets it aside and says so. It is never moved to another day here.
      stops.forEach((stop, index) => {
        if (fixedOf[index] !== null && !(typeof stop.day === "number" && Number.isInteger(stop.day) && stop.day >= 1 && stop.day <= requested)) without.add(index);
      });
      const left = [...without].filter((index) => index >= 0 && index < count).sort((first, second) => first - second);
      const asked = `${requested}|${options.quick ? 1 : 0}|${left.length > 0 ? left.join(",") : -1}`;
      const answered = answers.get(asked);
      if (answered) return answered;
      if (left.length >= count) {
        const nothing: PlannedTrip = { slots: 0, days: [] };
        answers.set(asked, nothing);
        return nothing;
      }
      skipped.fill(0);
      for (const index of left) skipped[index] = 1;
      skippedCount = left.length;
      skippedKey = left.join(",");
      // A pin beyond the days asked for is not a pin.
      const pin = stops.map((stop, index) => (!skipped[index] && typeof stop.day === "number" && stop.day >= 1 && Math.round(stop.day) <= requested ? Math.round(stop.day) : null));
      const pinnedDays = new Set(pin.filter((day) => day !== null)).size;
      const unpinned = pin.filter((day, index) => day === null && !skipped[index]).length;
      const fewest = Math.max(1, pinnedDays);
      type Candidate = { parts: number; found: Grouping; late: boolean; penalty: number; worst: number; door: number; lone: boolean; broken: number; emptyFirst: boolean };
      // More days are the answer to a list that does not fit (as long as
      // they make it fit better: a restaurant no day can reach is not a
      // reason to use them all); then to two dinners on one evening. An
      // entered time that cannot be kept outweighs both.
      const worse = (left: Candidate, right: Candidate) => (
        left.broken !== right.broken ? left.broken > right.broken
          : left.late !== right.late ? left.late : left.late ? left.penalty > right.penalty + EPSILON : left.found.doubled > right.found.doubled
      );
      /** The trip with its days numbered from day 1 — or, `emptyFirst`, with day 1 left free. */
      const plan = (emptyFirst: boolean): Candidate => {
        layout = { requested, emptyFirst };
        const most = Math.max(fewest, Math.min(requested - (emptyFirst ? 1 : 0), pinnedDays + unpinned));
        // No fewer days than the stays alone fill: stays plus a quarter of an
        // hour of travel per place, against eight-hour days; one day below
        // that estimate is still tried.
        const estimate = Math.ceil(stops.reduce((sum, stop, index) => sum + (skipped[index] ? 0 : stop.stay + 15), 0) / 480);
        let first = Math.min(most, Math.max(fewest, estimate - 1));
        // Nor so few that two restaurants for one meal must share a day which
        // the days asked for could keep apart: such a count is never the answer.
        if (hasMeals) {
          const apartAtMost = leastDoubled(most, pin);
          while (first < most && leastDoubled(first, pin) > apartAtMost) first += 1;
        }
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
            broken: days.reduce((sum, day) => sum + day.broken, 0),
            emptyFirst,
          };
          tried.set(parts, result);
          return result;
        };
        let chosen = candidate(first);
        for (let parts = first + 1; parts <= most && (chosen.late || chosen.found.doubled > 0); parts += 1) {
          const next = candidate(parts);
          if (worse(chosen, next)) chosen = next;
        }
        // An entered time that still cannot be kept may be one that fewer days
        // keep: the last day has a finish, and a trip that ends a day earlier
        // does not reach it.
        for (let parts = first - 1; parts >= fewest && chosen.broken > 0; parts -= 1) {
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
        return chosen;
      };
      // Day 1 is used whenever it can be. Only when the trip cannot be kept
      // with it — the traveller can start at seven in the evening, and
      // whatever goes on day 1 runs into the night — is the trip also planned
      // with day 1 left free, and that plan taken when it is the better one.
      const mayLeaveFirst = firstStart !== null && requested >= 2 && !pin.includes(1);
      // When not one place could be kept on day 1 even alone, no plan that
      // uses day 1 can be kept either: a day's first stop is reached at the
      // hour it would be reached alone. The plan with day 1 free is then made
      // first, and when it keeps everything it is the answer — the other
      // would have lost to it — without costing every split a second time.
      const firstHopeless = mayLeaveFirst && unpinned > 0
        && stops.every((_, index) => skipped[index] || pin[index] !== null || !solveDay([index], 1).keepable);
      let chosen: Candidate;
      if (firstHopeless) {
        const later = plan(true);
        if (!later.late && later.broken === 0) chosen = later;
        else {
          chosen = plan(false);
          if (worse(chosen, later)) chosen = later;
        }
      } else {
        chosen = plan(false);
        if (mayLeaveFirst && chosen.late) {
          const later = plan(true);
          if (worse(chosen, later)) chosen = later;
        }
      }
      layout = { requested, emptyFirst: chosen.emptyFirst };
      const answer = numbered(chosen.found.days, requested, pin, !options.quick, chosen.emptyFirst);
      skipped.fill(0);
      skippedCount = 0;
      skippedKey = "";
      answers.set(asked, answer);
      return answer;
    },
    /**
     * When the trip cannot be planned without breaking an entered time: the
     * most places that can be kept, bookings always among them, and which
     * places would then be left out. Every way of leaving places out and
     * sharing the rest among the days is looked at, on the clock alone (see
     * earliestLeaves), so the number kept is the largest there is. Several
     * sets of that size may do; they are returned with the one that keeps
     * the places highest in the traveller's list first, for the caller to
     * plan and choose among. Null when the list is too long to look at set
     * by set, or when not even the bookings can be kept together.
     *
     * `ignoreFinish`: the same question without the last day's finish — to
     * tell whether the finish is what leaves no room.
     */
    keepMost(requestedDays: number, options: { without?: readonly number[]; ignoreFinish?: boolean; atMost?: number } = {}): { kept: number; of: number; leaveOut: number[][] } | null {
      if (!framesOn || count > HELD_STOPS) return null;
      const requested = Math.max(1, Math.min(14, Math.round(requestedDays)));
      const out = new Set(options.without ?? []);
      let all = 0;
      let mustKeep = 0;
      const pinned: Array<number | null> = stops.map(() => null);
      stops.forEach((stop, index) => {
        const day = typeof stop.day === "number" && stop.day >= 1 && Math.round(stop.day) <= requested ? Math.round(stop.day) : null;
        // (A booking on a day the trip does not have is never planned: see choose.)
        if (out.has(index) || (fixedOf[index] !== null && day === null)) return;
        all |= 1 << index;
        pinned[index] = day;
        if (fixedOf[index] !== null) mustKeep |= 1 << index;
      });
      const total = popcount(all);
      if (total === 0 || 3 ** total * requested > KEEP_MOST_WORK) return null;
      // reach[set]: the days so far can hold exactly this set, each day keeping every entered time.
      let reach = new Uint8Array(1 << count);
      reach[0] = 1;
      for (let day = 1; day <= requested; day += 1) {
        const cls = classOf(day, requested);
        let allowed = 0;
        for (let index = 0; index < count; index += 1) if (all & (1 << index) && (pinned[index] === null || pinned[index] === day)) allowed |= 1 << index;
        const next = new Uint8Array(1 << count);
        for (let set = all; ; set = (set - 1) & all) {
          const share = set & allowed;
          for (let today = share; ; today = (today - 1) & share) {
            if (reach[set ^ today] && (today === 0 || holds(cls, today, Boolean(options.ignoreFinish)))) {
              next[set] = 1;
              break;
            }
            if (today === 0) break;
          }
          if (set === 0) break;
        }
        reach = next;
      }
      let most = -1;
      const sets: number[] = [];
      for (let set = all; ; set = (set - 1) & all) {
        if (reach[set] && (set & mustKeep) === mustKeep) {
          const size = popcount(set);
          if (size > most) {
            most = size;
            sets.length = 0;
          }
          if (size === most) sets.push(set);
        }
        if (set === 0) break;
      }
      if (most < 0) return null;
      // The places listed first are kept first: of two sets, the one that keeps the earlier place the other leaves out.
      const rank = (set: number) => {
        let value = 0;
        for (let index = 0; index < count; index += 1) value = value * 2 + (set & (1 << index) ? 1 : 0);
        return value;
      };
      sets.sort((left, right) => rank(right) - rank(left));
      return {
        kept: most,
        of: total,
        leaveOut: sets.slice(0, options.atMost ?? 16).map((set) => stops.flatMap((_, index) => (all & (1 << index) && !(set & (1 << index)) ? [index] : []))),
      };
    },
    /**
     * For a list too long for keepMost: the most of ONE day's places that
     * day can hold with every entered time kept (its bookings always among
     * them), found the same exact way on that day's places alone. Returns the
     * places to take off the day — those lowest in the traveller's list
     * where several sets do — or null when the day cannot even keep its
     * bookings. (A day of more than sixteen places is far beyond what any
     * day holds: its bookings and the places highest in the list, sixteen
     * in all, are looked at and the rest go with what does not fit.)
     */
    thinDay(order: readonly number[], day: number, requestedDays: number): number[] | null {
      if (!framesOn) return null;
      const requested = Math.max(1, Math.min(14, Math.round(requestedDays)));
      const listed = [...order].sort((left, right) => left - right);
      const bookedHere = listed.filter((stop) => fixedOf[stop] !== null);
      if (bookedHere.length > HELD_STOPS) return null;
      const looked = new Set([...bookedHere, ...listed.filter((stop) => fixedOf[stop] === null).slice(0, HELD_STOPS - bookedHere.length)]);
      const nodes = listed.filter((stop) => looked.has(stop));
      const beyond = listed.filter((stop) => !looked.has(stop));
      const size = nodes.length;
      const cls = classOf(day, requested);
      // The same table as earliestLeaves, over this day's places only.
      const table = new Float64Array((1 << size) * size).fill(Infinity);
      const dinners = nodes.reduce((bits, stop, index) => (fixedOf[stop] === null && stops[stop].meal === "dinner" ? bits | (1 << index) : bits), 0);
      for (let index = 0; index < size; index += 1) table[(1 << index) * size + index] = leaveFirst(cls, nodes[index]);
      let best = -1;
      let bestSize = -1;
      let bestRank = -1;
      const must = nodes.reduce((bits, stop, index) => (fixedOf[stop] !== null ? bits | (1 << index) : bits), 0);
      for (let mask = 1; mask < 1 << size; mask += 1) {
        let held = false;
        for (let last = 0; last < size; last += 1) {
          const left = table[mask * size + last];
          if (left === Infinity) continue;
          if (!(cls & 2) || left + (hotel ? hotel.back[nodes[last]] : 0) <= lastFinish!) held = true;
          for (let next = 0; next < size; next += 1) {
            if (mask & (1 << next)) continue;
            // (leaveNext asks only whether a dinner nobody booked is already on the day.)
            const leave = leaveNext(mask & dinners ? freeDinners : 0, nodes[last], left, nodes[next]);
            const slot = (mask | (1 << next)) * size + next;
            if (leave < table[slot]) table[slot] = leave;
          }
        }
        if (!held || (mask & must) !== must) continue;
        const kept = popcount(mask);
        // The places listed first are kept first.
        let rank = 0;
        for (let index = 0; index < size; index += 1) rank = rank * 2 + (mask & (1 << index) ? 1 : 0);
        if (kept > bestSize || (kept === bestSize && rank > bestRank)) {
          best = mask;
          bestSize = kept;
          bestRank = rank;
        }
      }
      if (best < 0) return must === 0 ? [...listed] : null;
      return [...nodes.filter((_, index) => !(best & (1 << index))), ...beyond].sort((left, right) => left - right);
    },
    /** Another plan's grouping (`dayOf[stop]` is its 1-based day; 0 or less: not in the plan), each day in its best order. */
    keep(dayOf: readonly number[], slots: number, options: { quick?: boolean; /** The days asked for, when the last of them has a finish. */ requested?: number } = {}): PlannedTrip {
      const byDay = new Map<number, number[]>();
      dayOf.forEach((day, stop) => {
        if (day >= 1) byDay.set(day, [...(byDay.get(day) ?? []), stop]);
      });
      const requested = options.requested ?? slots;
      const days = [...byDay.entries()].sort(([left], [right]) => left - right)
        .map(([day, group]) => ({ ...printed(solveDay(group, framesOn ? classOf(day, requested) : 0), !options.quick), day }));
      return { slots: Math.max(slots, ...days.map((day) => day.day)), days };
    },
    /** For tests: the best order of one set of places as it is printed, and what any order costs. */
    solveDay: (ids: readonly number[], cls = 0) => {
      const day = solveDay(ids, cls);
      return { ...byHours(day), ...printed(day, true) };
    },
    /**
     * The same set as the search costs it while the days are being chosen:
     * not tried in every order with its hours counted, so a fraction of the
     * work. For comparing many candidate days; the one chosen is then asked
     * of solveDay.
     */
    roughDay: (ids: readonly number[], cls = 0) => {
      const day = solveDay(ids, cls);
      return { cost: day.cost, overrun: printed(day, false).overrun };
    },
    /** `hours`: with what the hours of the day cost counted in `orderCost` (see HABITS), as when a chosen day is put in order. */
    describe: (order: number[], cls = 0, hours = false) => describe(order, cls, hours),
    /**
     * For tests: a set of places as the search costs it while choosing which
     * places share a day — before a day left in doubt is tried in every
     * order for printing (see everyOrder).
     */
    candidateDay: (ids: readonly number[], cls = 0) => {
      const day = solveDay(ids, cls);
      return { order: day.order, cost: day.cost, broken: day.broken, keepable: day.keepable };
    },
  };
}
