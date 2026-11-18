import { bundledSightsNearRoute } from "../bundled-route-recommendations.ts";
import { destinationById, destinationForCoordinate } from "../destinations.ts";
import type { PopularDestination, PopularSight } from "../popular-sights.ts";
import { RailNetwork, walkMinutes, type GeoPoint, type RailAdvice, type RailJourney } from "../rail-router.ts";
import type { ResolvedInputStop, RouteStop } from "../route-optimizer.ts";
import { estimateTravelOptions } from "../time-feasibility.ts";
import { cafeBreakFor, type CafeBreak } from "./cafes.ts";
import { DAY_CLOCK, DAY_FILLING_STAY, LATE_LUNCH, daySearch, packedDay, pastEnd, scheduleDay, type SearchProblem } from "./day-search.ts";
import { isDaytime, isOpenEarly, placeHabit, type PlaceHabit } from "./habits.ts";
import { weatherDayOrder } from "./weather-days.ts";
import {
  buildTripFromWishlist,
  hotelRouteContextForDraft,
  routeLegKey,
  type BuiltPlanLeg,
  type BuiltTripPlan,
  type Pace,
  type TripPlannerContext,
} from "../trip-builder.ts";

/*
 * The trip as a traveller reads it.
 *
 * The planning engine builds a day — its clock, its legs, the way to and
 * from the hotel — once it is told who is on it and in what order. This
 * module prices every pair of places, has day-search.ts decide the days and
 * the order on those prices, and turns the engine's build of exactly that
 * into a booklet page per day: arrive, stay, how to get to the next place.
 * It also decides what the engine leaves to its caller:
 *
 *   - how many of the requested days the wishlist really needs (the rest are
 *     shown as free days, not filled with one stop each);
 *   - where lunch goes, so a day's clock is one a person could keep;
 *   - what a train leg actually is: board, line, change, get off.
 *
 * Every duration here is a planning estimate. Nothing in the output may be
 * presented as a timetable.
 */

export type ShioriPace = "relaxed" | "standard" | "packed";

/**
 * The longest trip the booklet keeps. Defined once: the day picker, a "this
 * needs more days" notice and the saved form must agree, or the app offers a
 * length that cannot be stored and the saved trip is unreadable next visit.
 */
export const MAX_TRIP_DAYS = 7;

/**
 * When the leg out of stops[index] sets off. A lunch hour suggested after a
 * stop is spent before leaving, so the leg — to the next stop or back to the
 * hotel — leaves when lunch ends. (A dinner slot has no end on the clock, and
 * a lunch during a visit is over before the visit is.)
 */
export function departureAfterStop(day: Pick<ShioriDay, "stops" | "meals">, index: number): string | undefined {
  return day.meals.find((meal) => meal.afterStop === index && meal.kind === "lunch" && meal.end && !meal.during)?.end ?? day.stops[index]?.leave;
}

/** A time of day as it is typed and printed: "HH:MM", 24-hour, zero-padded. */
export type ShioriClock = string;

/**
 * A time the traveller already has for a place — a booked table, a timed
 * ticket. The place is on this day and the visit starts at exactly this
 * time. Day and time come together: a time alone is not offered.
 */
export type ShioriReservation = { /** 1-based day of the trip. */ day: number; time: ShioriClock };

const CLOCK_TEXT = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Minutes since midnight for "HH:MM"; null for anything else. */
export function clockOfDay(value: unknown): number | null {
  return typeof value === "string" && CLOCK_TEXT.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
}

export type ShioriPlace = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  stayMinutes: number;
  kind?: string;
  /** Wikimedia Commons file name. */
  img?: string;
  desc?: string;
  /** 1-based day the traveller pinned this place to. */
  day?: number | null;
  /** A restaurant the traveller wants to eat at: it is that day's lunch or dinner. */
  meal?: "lunch" | "dinner";
  /** A fixed start the traveller entered. It outranks `day`. */
  reserve?: ShioriReservation;
  /**
   * Set by the planner on its own copy of a list, never stored and never
   * read from a trip: the planner's habit about the hours of this place is
   * set aside, because the hours the traveller entered leave no room for it
   * (see planOnce).
   */
  anyHour?: true;
};

export type ShioriHotel = { name: string; lat: number; lon: number };

export type ShioriInput = {
  places: ShioriPlace[];
  days: number;
  /** Kept for trips saved earlier; the booklet plans at the standard pace. */
  pace?: ShioriPace;
  hotel: ShioriHotel | null;
  locale: "ja" | "en";
  /**
   * The forecast, per day of the booklet (ShioriDay.index): true for a wet
   * day, false for a dry one, null where there is no forecast. It decides
   * only which calendar day a planned day goes on (see weather-days.ts);
   * without it the plan is exactly the plan there has always been.
   */
  wetDays?: ReadonlyArray<boolean | null> | null;
  /**
   * When the traveller can start moving on day 1 — not when a flight lands.
   * Day 1 has nothing before it. Only ever later than the usual start: an
   * earlier time changes nothing.
   */
  firstDayStart?: ShioriClock | null;
  /** The last day is over by this time, the ride back to the hotel included. */
  lastDayFinish?: ShioriClock | null;
  /**
   * The traveller asked for every place to be planned on the days asked for,
   * however late the days then run. Without it a list too full for its days
   * is planned as the set that fits, and the rest is listed as left out (see
   * leaveOutForRoom).
   */
  packAnyway?: boolean;
};

/** A street path looked up for one leg ("walk|<key>" or "drive|<key>"). */
export type ShioriRoute = { minutes: number | null; path: GeoPoint[] };

export type ShioriLeg = {
  /** Identifies the pair of places; stable across re-plans. */
  key: string;
  from: GeoPoint;
  to: GeoPoint;
  mode: "walk" | "rail" | "transit" | "taxi";
  minutes: number;
  /** False while the leg is a straight line because no path is known. */
  hasPath: boolean;
  /** True once a lookup came back empty: the straight line is all there is. */
  noPath: boolean;
  /** Board / line / change / get off, when the bundled network knows. */
  rail: RailJourney | null;
  /**
   * Present (true) on a leg to or from a summit that is near enough to walk
   * on level ground and whose way up is not known: a path, a ropeway, a
   * cable car. Its mode is "transit" (an estimate, drawn dashed); no train
   * or bus is known to run there, and the page does not say one does.
   */
  climb?: true;
  /** A maps link that opens this leg with live times. */
  mapsUrl: string;
  /** Points to draw: stations for a train leg, the two ends otherwise. */
  path: GeoPoint[];
  fromName: string;
  toName: string;
};

/**
 * What a leg is called on the page. Its mode says how it is priced and
 * drawn; the word above it must be true of the ride: a journey whose only
 * ride is a boat is not a train (宮島口 to 宮島桟橋 was headed 電車), and a
 * way up a hill that nobody knows is not a bus.
 */
export type ShioriLegWord = "walk" | "train" | "ferry" | "train-ferry" | "taxi" | "climb" | "transit";
export function legWord(leg: Pick<ShioriLeg, "mode" | "rail" | "climb">): ShioriLegWord {
  if (leg.mode === "walk" || leg.mode === "taxi") return leg.mode;
  if (leg.mode === "rail") {
    const rides = leg.rail?.rides ?? [];
    const boats = rides.filter((ride) => ride.boat).length;
    return boats === 0 ? "train" : boats === rides.length ? "ferry" : "train-ferry";
  }
  return leg.climb ? "climb" : "transit";
}

export type ShioriStop = {
  place: ShioriPlace;
  arrive: string;
  leave: string;
  /** The visit itself. `arrive`–`leave` is longer by `lunchMinutes` where a lunch hour lies inside the stop. */
  stayMinutes: number;
  /**
   * The lunch hour that `arrive`–`leave` holds on top of the stay: a visit
   * that runs across lunchtime, with the lunch during it. Absent otherwise.
   * (11:54–15:24 beside "stay 2 h 30" read as a mistake without it.)
   */
  lunchMinutes?: number;
  /**
   * Idle minutes before this stop: a restaurant that is not serving yet.
   * Every such minute is here, at the first stop as at any other. (A day
   * that would begin with a wait begins later instead: see `start`.)
   */
  waitMinutes: number;
  /**
   * A place that belongs to the evening (a night market): the planner keeps
   * it for the end of the day, from early evening — its own habit, not the
   * hours of the place. A wait in front of it is free time before the evening.
   */
  evening?: true;
  /** The restaurant could not be reached inside its meal hours on this day. */
  mealMissed: boolean;
  /**
   * The arrival / departure is after midnight, on the next calendar day. Only
   * a list far too long for its days gets there; the clock alone ("01:45")
   * cannot say so.
   */
  arriveNextDay: boolean;
  leaveNextDay: boolean;
  /** The arrival is a time the traveller entered (a booking), not an estimate. */
  reserved: boolean;
};

/**
 * A place the plan could not keep without breaking a time the traveller
 * entered. It is not shown at another time or on another day: it is listed
 * as not fitting, with the reason.
 *
 * `proven` is true only where the traveller's own entries contradict each
 * other — a day the trip does not have, a booking before the entered start,
 * a booked visit that ends after the entered finish, two booked visits that
 * overlap. Those are said as "cannot". Everything that rests on one of the
 * planner's estimates — a ride — is not proven: it is "could not fit", and
 * the ride is given as the estimate it is.
 */
export type ShioriUnplaced = { placeId: string; name: string } & (
  /** The booking is on a day the trip does not have. */
  | { reason: "reserve-day"; day: number; days: number; proven: true }
  /**
   * The booking is earlier than the place can be reached. Proven when it is
   * before the entered start of day 1 itself (`start`); otherwise it is the
   * estimated ride from the hotel (`rideMinutes`) that does not fit, and
   * `earliest` is the estimated arrival.
   */
  | { reason: "reserve-before-start"; day: number; time: ShioriClock; start: ShioriClock | null; rideMinutes: number; earliest: ShioriClock; proven: boolean }
  /**
   * The booked visit does not fit before the last-day finish. `ends` is when
   * the visit itself is over (its time plus its stay); proven when that is
   * already past the finish. Otherwise it is the estimated ride back to the
   * hotel (`rideMinutes`) that does not fit.
   */
  | { reason: "reserve-after-finish"; day: number; time: ShioriClock; ends: ShioriClock; rideMinutes: number; finish: ShioriClock; proven: boolean }
  /**
   * Two bookings on one day cannot both be kept; the one higher in the list
   * stays. `earlierId` is whichever of the two is first on the clock,
   * `stayEnds` when its visit is over. Proven when that is already past the
   * other's time; otherwise the estimated ride between them (`rideMinutes`)
   * does not fit, and `freeAt` is the estimated arrival at the other.
   */
  | { reason: "reserve-clash"; day: number; time: ShioriClock; withId: string; withName: string; withTime: ShioriClock; earlierId: string; stayEnds: ShioriClock; rideMinutes: number; freeAt: ShioriClock; proven: boolean }
  /** No way was found to be at the booking on time (a measured path made the way there too long). */
  | { reason: "reserve-late"; day: number; time: ShioriClock; proven: false }
  /**
   * No room was found: before the finish time (`edge: "finish"`), around the
   * booked times (`"reserve"`), or — on a trip with entered times — before
   * the day's own midnight (`"day"`).
   */
  | { reason: "no-room"; day: number; edge: "finish" | "reserve" | "day"; proven: false }
);

/** A place that is in the traveller's list and on no day of the booklet. */
export type ShioriLeftOut = { placeId: string; name: string };

/**
 * Where the traveller's own wishes pull against each other, each with the
 * way out the numbers support. This is what a list of places cannot show.
 */
export type ShioriNotice =
  /** The list does not fit the days asked for; it does in `days`. */
  | { kind: "needs-days"; days: number }
  /** It fits the days asked for once this one place is left out. */
  | { kind: "drop"; placeId: string; name: string }
  /** No number of days up to a week holds the list, and neither does leaving one place out. */
  | { kind: "too-much" }
  /**
   * The list did not fit the days asked for: these places are not on any
   * day (they stay in the traveller's list). `days` is the number of days
   * that holds everything, or null when no length up to a week does.
   */
  | { kind: "left-out"; places: ShioriLeftOut[]; days: number | null }
  /**
   * The traveller asked for everything to be planned anyway, and a day runs
   * far into the evening for it: `places` is what would be left out for the
   * days to be kept.
   */
  | { kind: "packed-anyway"; places: ShioriLeftOut[] }
  /** The chosen hotel costs this much travel; the suggested area saves `savedMinutes` over the trip. */
  | { kind: "hotel-far"; oneWayMinutes: number; savedMinutes: number; /** Days that are packed from this hotel and would not be from the area named. */ calmerDays?: number }
  /** Eating here adds this much travel to its day. */
  | { kind: "meal-detour"; placeId: string; name: string; meal: "lunch" | "dinner"; minutes: number }
  /** No day can reach this restaurant during the meal. */
  | { kind: "meal-time"; placeId: string; name: string; meal: "lunch" | "dinner" }
  /** The way back to the hotel after dinner here. */
  | { kind: "meal-hotel"; placeId: string; name: string; minutes: number }
  /**
   * Not a conflict but a choice the traveller should know was made: these
   * days (1-based) have rain forecast, and the planned day with less time
   * outdoors was put on each of them.
   */
  | { kind: "weather-order"; days: number[] }
  /** A place left out so that no entered time is broken. */
  | ({ kind: "unplaced" } & ShioriUnplaced)
  /** A one-day trip whose start is not before its finish: nothing can be planned. */
  | { kind: "frame-order"; start: ShioriClock; finish: ShioriClock }
  /**
   * Day 1 (`edge: "start"`) or the last day (`"finish"`) has nothing on it
   * because of the time entered for it: the same trip without that time puts
   * places there. Such a day is not a free day (see `freeDays`).
   */
  | { kind: "day-empty"; day: number; edge: "start" | "finish"; time: ShioriClock };

export type ShioriMeal = {
  kind: "lunch" | "dinner";
  start: string;
  end: string | null;
  near: GeoPoint;
  nearName: string;
  /** The slot starts after midnight, on the next calendar day (a day too full to keep). */
  nextDay?: boolean;
  /**
   * The dinner is back near the hotel, not near the stop it is listed after:
   * `near` is the hotel, and `start` is no earlier than the ride back gets there.
   */
  atHotel?: true;
  /**
   * The lunch is during the visit it is listed under, at the place or beside
   * it, not after it: one long visit runs across lunchtime. `start`–`end` lie
   * inside the stop's own times. Or the dinner of a day that ends at a place
   * of the evening (a night market): eaten there, `start` inside the visit.
   */
  during?: true;
  /**
   * With `during`: the lunch begins the minute the traveller arrives (after
   * 12:30), so it is eaten before the visit, not in the middle of it.
   */
  onArrival?: true;
};

export type ShioriDay = {
  index: number;
  title: string;
  /**
   * When to leave the hotel, or without one when the first place is reached.
   * 08:30 / 09:00 as a rule; later on a day that opens with a chosen
   * restaurant or runs up to a chosen dinner, so that nobody stands at a
   * closed door.
   */
  start: string;
  end: string;
  stops: ShioriStop[];
  /** legs[i] connects stops[i] to stops[i + 1]. */
  legs: ShioriLeg[];
  fromHotel: ShioriLeg | null;
  toHotel: ShioriLeg | null;
  /** Meal after stops[afterStop]. */
  meals: Array<ShioriMeal & { afterStop: number }>;
  walkMinutes: number;
  /** Well-known places near this day's route that are not on the list. */
  ideas: PopularSight[];
  /** Where a coffee break fits, if the day has room for one. */
  cafe: CafeBreak | null;
  /** Door-to-door minutes spent moving on this day, hotel legs included. */
  travelMinutes: number;
  /** How the day will feel: travellers' most common regret is the packed day. */
  load: "easy" | "normal" | "tight";
  /** Indoor places near this day's route, for a day when it rains. */
  rainIdeas: PopularSight[];
  /** The day runs past the pace's comfortable end. */
  runsLate: boolean;
  /** The planner's own 1-based day number (equal to index + 1 unless an empty day was skipped). */
  engineDay: number;
  /** The day ends (back at the hotel, when there is one) after midnight. */
  endsNextDay: boolean;
  /** An hour for lunch had a place on this day, but would have broken a booked time or the finish: there is none. */
  noLunchRoom: boolean;
};

export type ShioriPlan = {
  days: ShioriDay[];
  /**
   * Requested days the wishlist does not need. A day left empty by the start
   * or the finish the traveller entered is not one of them: the list would
   * use it, the time does not let it (it is named in a `day-empty` notice).
   */
  freeDays: number;
  /** Ideas for the free days: the destination's best-known unlisted sights. */
  freeDayIdeas: PopularSight[];
  /** Places the engine could not schedule. */
  leftOut: string[];
  /** Where a hotel would make the whole trip travel least. */
  stayNear: { latitude: number; longitude: number; routePoints: GeoPoint[]; /** The listed place the area is around, when it is one. */ nearName?: string } | null;
  hotel: ShioriHotel | null;
  notices: ShioriNotice[];
  /** Places left out because of a time the traveller entered (their names are in `leftOut` too). */
  unplaced: ShioriUnplaced[];
  /**
   * Places left out because the list is too full for the days asked for
   * (their names are in `leftOut` too). Empty when everything fits, and
   * always when the traveller asked for everything to be planned anyway.
   */
  overfull: ShioriLeftOut[];
};

const paceSettings: Record<ShioriPace, { engine: Pace; dayEnd: string }> = {
  relaxed: { engine: "relaxed", dayEnd: "16:30" },
  standard: { engine: "balanced", dayEnd: "18:00" },
  packed: { engine: "fast", dayEnd: "20:00" },
};
const OUTDOOR_KIND = /park|garden|shrine|temple|pagoda|mountain|hill|beach|island|zoo|castle|bridge|square|plaza|street|market|monument|statue|ruins|palace|amusement|theme park|lake|river|waterfall|cemetery|neighbou?rhood/;
const INDOOR_KIND = /museum|gallery|aquarium|planetarium|department store|shopping (mall|centre|center)|library|theat|opera|concert hall|science cent/;
const DAY_START = "09:00";
const HOTEL_DAY_START = "08:30";
const LUNCH_MINUTES = DAY_CLOCK.lunchMinutes;
/** A day with a dinner the traveller chose is meant to run into the evening. */
const DINNER_DAY_END = "21:30";
function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function clock(minutes: number) {
  const bounded = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(bounded / 60) % 24).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

/** A wishlist line the engine's parser cannot mistake for a time, a day or a marker. */
function lineFor(index: number) {
  let code = "";
  let value = index;
  do {
    code = String.fromCharCode(97 + (value % 26)) + code;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return `shiori${code}`;
}

function resolvedStop(place: ShioriPlace, index: number): ResolvedInputStop {
  const profile = destinationForCoordinate(place.lat, place.lon);
  const countryCode = profile && profile.countryCodes.length === 1 ? profile.countryCodes[0] : undefined;
  return {
    id: place.id,
    input: lineFor(index),
    inputIndex: index,
    name: place.name,
    area: place.name,
    address: place.name,
    ...(countryCode ? { countryCode } : {}),
    latitude: place.lat,
    longitude: place.lon,
    sourceUrl: "",
    verifiedAt: "",
    confidence: "medium",
    planningDurationMinutes: Math.max(15, Math.round(place.stayMinutes)),
    isAnchor: false,
    // The traveller's own list has no business hours attached; the booklet
    // never claims a place is open.
    openingHoursApplicable: false,
  };
}

type EngineDay = BuiltTripPlan["days"][number];
const NO_IDS: ReadonlySet<string> = new Set<string>();

/**
 * What the traveller entered about times, read once: the start of day 1 and
 * the finish of the last day in minutes, and each usable booking by place.
 * Null when nothing was entered — the plan is then the one there has always
 * been, by the same code.
 */
type Frames = {
  start: number | null;
  finish: number | null;
  booked: Map<string, { day: number; at: number; time: ShioriClock }>;
};
function framesOf(input: ShioriInput): Frames | null {
  const start = clockOfDay(input.firstDayStart);
  const finish = clockOfDay(input.lastDayFinish);
  const booked: Frames["booked"] = new Map();
  for (const place of input.places) {
    const at = clockOfDay(place.reserve?.time);
    const day = place.reserve?.day;
    // Half a booking (a time without a usable day) is no booking.
    if (at !== null && typeof day === "number" && Number.isInteger(day) && day >= 1) booked.set(place.id, { day, at, time: place.reserve!.time });
  }
  return start === null && finish === null && booked.size === 0 ? null : { start, finish, booked };
}
const requestedDays = (input: ShioriInput) => Math.max(1, Math.min(14, Math.round(input.days)));

/**
 * A day's arrivals and departures as minutes that only grow. The engine
 * prints clocks, and a day that runs past midnight wraps: "01:45" after
 * "23:29" is 25:45, not a quarter to two in the morning of the same day.
 */
function timeline(day: EngineDay) {
  let floor = 0;
  const lift = (value: string) => {
    let minutes = clockMinutes(value);
    while (minutes < floor) minutes += 1_440;
    floor = minutes;
    return minutes;
  };
  return day.stops.map((stop) => ({ arrive: lift(stop.arrival), leave: lift(stop.departure) }));
}

/**
 * How many minutes a day runs past what a traveller can keep, for saying so:
 * a few minutes past either hour on estimated legs is not late (pastEnd in
 * day-search.ts, which the days of the search are read by too). Sightseeing
 * ends by the day's end. A chosen dinner may run to 21:30 — the dinner, not
 * the day: the last sight before it still has to be over by the day's end.
 */
function overrunOf(day: EngineDay, dayEnd: string, dinnerIds: ReadonlySet<string>, bookedIds: ReadonlySet<string> = NO_IDS) {
  if (day.stops.length === 0) return 0;
  const times = timeline(day);
  if (bookedIds.size > 0 && day.stops.some((stop) => bookedIds.has(stop.stop.id))) {
    // A booked stop is not held to 18:00 or 21:30: the traveller chose its hour.
    return day.stops.reduce((over, stop, index) => (
      bookedIds.has(stop.stop.id) ? over : Math.max(over, pastEnd(times[index].leave, clockMinutes(dinnerIds.has(stop.stop.id) ? DINNER_DAY_END : dayEnd)))
    ), 0);
  }
  const lastSight = day.stops.findLastIndex((stop) => !dinnerIds.has(stop.stop.id));
  // Sightseeing — not the ride back to the hotel — is what has to be over by
  // the day's end: the same nine hours with a hotel as without one.
  const sights = lastSight >= 0 ? pastEnd(times[lastSight].leave, clockMinutes(dayEnd)) : 0;
  const hasDinner = lastSight < day.stops.length - 1;
  return Math.max(sights, hasDinner ? pastEnd(times.at(-1)!.leave, clockMinutes(DINNER_DAY_END)) : 0);
}

function dayLate(day: EngineDay, dayEnd: string, dinnerIds: ReadonlySet<string>, bookedIds: ReadonlySet<string> = NO_IDS) {
  return overrunOf(day, dayEnd, dinnerIds, bookedIds) > 0;
}

/** The places that close their day and may run to 21:30: a chosen dinner, and a place that belongs to the evening (see clockMeal). */
function dinnerIdsOf(input: ShioriInput) {
  return new Set(input.places.filter((place) => clockMeal(place) === "dinner").map((place) => place.id));
}

/**
 * The taxi time to plan with on a leg that has a train. Someone reading a
 * trip booklet takes the train unless a taxi saves real time: up to 25
 * minutes slower, the train is the plan. The engine's own rule gives a train
 * 15 minutes of grace, so within that band the taxi is counted as no better
 * than the train less 14 — beyond it, the taxi's own time stands, and wins
 * on a short hop (see TAXI_HOP_MINUTES for anything longer).
 */
function taxiAgainstTrain(taxiMinutes: number, trainMinutes: number) {
  return trainMinutes <= taxiMinutes + 25 ? Math.max(taxiMinutes, trainMinutes - 14) : taxiMinutes;
}

/**
 * The longest ride (as estimated, about four kilometres) a taxi is the plan
 * for. Someone following a trip booklet rides the train or the bus across
 * town: forty minutes in a taxi costs many thousands of yen, and "taxi" on
 * every long leg is what the planner said when it did not know the way.
 * Beyond a short hop the leg goes by public transport — by the bundled
 * journey where there is one, otherwise as an estimate with the way unknown
 * (it is printed as that, and drawn dashed). Held wherever a rail network is
 * bundled and wherever the country is one travelled by train; where a car is
 * how one gets about (Guam, Bali), the engine's own choice stands.
 */
const TAXI_HOP_MINUTES = 20;
/** How far (straight line) a leg with no known way is priced as a city bus all the way. */
const CITY_BUS_KM = 10;

/** The longest walk (at the pace of level streets) printed to or from a summit: beyond it the way up is not known to be a walk. */
const SUMMIT_WALK_MINUTES = 15;

/**
 * What a place's kind and name say about how it is reached, as far as they
 * say it: an island (a boat, perhaps a bridge — never a taxi drawn over the
 * sea) or the top of a mountain (a ropeway, a bus or a hike — never a taxi
 * to the summit, never a level walk of the straight-line minutes). A small
 * rule, not a fact about the place: リバティ島 is known by its name, the
 * statue standing on it is not known at all.
 */
export function hardToReach(place: Pick<ShioriPlace, "kind" | "name">): "island" | "summit" | null {
  const kind = (place.kind ?? "").toLowerCase();
  // (A man-made island has roads to it; a quarter named after one is a quarter; a group of islands is a region, not a place to land.)
  const onLand = /artificial|neighbou?rhood|district|quarter|\bgroup\b|archipelago/.test(kind);
  const name = place.name.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
  if (/\bislands?\b|\bislet\b|\batoll\b/.test(kind)) return onLand ? null : "island";
  // (広島 and 福島 are cities, and so is anything of two characters ending in 島 as often as not;
  // a name that ends in a city's name is a place in that city: ヒルトン広島, お好み村 広島.)
  if ((/^.{2,}島$/.test(name) && !/(広島|福島|徳島|鹿児島)$/.test(name)) || /\b(island|isle)$/i.test(name)) return onLand ? null : "island";
  // (嵐山 is a quarter of Kyoto on level ground at the foot of the hill it is named after; the catalogue calls it a mountain.)
  if (/^(嵐山|arashiyama)$/i.test(name)) return null;
  if (/mountain|volcano|\bsummit\b|\bpeak\b/.test(kind) && !/\bpass\b|\brange\b|artificial|observatory|temple|shrine|castle|museum|resort|village|town|\bpark\b|railway|\bhut\b/.test(kind)) return "summit";
  return null;
}
type Sights = readonly PopularDestination[] | undefined;
const islandPoints = new WeakMap<object, Array<{ lat: number; lon: number }>>();
/** How near (km) the point of a bundled island a place stands on that island: Liberty Island is 300 m long. */
const ON_ISLAND_KM = 0.4;
/**
 * hardToReach(), and one thing more where the bundled sights are at hand: a
 * place that stands on one of their islands (自由の女神像 on リバティ島) is
 * reached the way the island is, whatever its own kind says.
 */
function reachOf(place: ShioriPlace, cities: Sights): "island" | "summit" | null {
  const own = hardToReach(place);
  if (own || !cities || cities.length === 0) return own;
  let points = islandPoints.get(cities);
  if (!points) {
    points = cities.flatMap((city) => city.sights).filter((sight) => hardToReach({ kind: sight.kind, name: sight.ja }) === "island").map((sight) => ({ lat: sight.lat, lon: sight.lon }));
    islandPoints.set(cities, points);
  }
  return points.some((point) => Math.abs(point.lat - place.lat) < 0.01 && straightKm(point, place) <= ON_ISLAND_KM) ? "island" : null;
}
type Ground = {
  /** A long taxi is not the plan here (see TAXI_HOP_MINUTES). */
  holdLongTaxi: boolean;
  /** By place id; a hotel has no kind. */
  reach: (id: string) => "island" | "summit" | null;
};
function groundOf(input: ShioriInput, holdLongTaxi: boolean, cities: Sights): Ground {
  const reach = new Map(input.places.map((place) => [place.id, reachOf(place, cities)] as const));
  return { holdLongTaxi, reach: (id) => reach.get(id) ?? null };
}

function hotelId(hotel: ShioriHotel) {
  return `shiori-hotel@${hotel.lat.toFixed(4)},${hotel.lon.toFixed(4)}`;
}

/** The hotel as the engine's base. */
function hotelBase(hotel: ShioriHotel): ResolvedInputStop {
  return {
    // The id carries the position: a leg to another hotel is another leg,
    // and a street path looked up for the old one must not be reused.
    ...resolvedStop({ id: hotelId(hotel), name: hotel.name, lat: hotel.lat, lon: hotel.lon, stayMinutes: 15 }, 9_999),
    input: hotel.name,
    inputIndex: undefined,
    planningDurationMinutes: 0,
  };
}

type Built = { plan: BuiltTripPlan; context: TripPlannerContext; raw: string; usedDays: number };
const stayOf = (place: ShioriPlace) => Math.max(15, Math.round(place.stayMinutes));
/**
 * The planner's habit about the hours of a place of this kind (habits.ts): a
 * preference for ordering a day, never printed and never a claim about when
 * the place is open. A restaurant chosen for a meal has its meal instead.
 */
export const habitOf = (place: Pick<ShioriPlace, "kind" | "name" | "meal" | "anyHour">): PlaceHabit | null => (place.meal || place.anyHour ? null : placeHabit(place.kind, place.name));
/**
 * What a place is to the day's clock. A place that belongs to the evening (a
 * night market, a night-life street) is kept like a chosen dinner: it closes
 * its day, the day reaches it from 17:30 — never in the morning, never with
 * a lunch — and it may run to 21:30 without the day being called late. Those
 * are the hours the booklet already keeps for a dinner, a habit of the
 * planner and not the hours of any place; nothing is said or implied about
 * when a market opens. (The place is still a sight: no table is booked, and
 * the day's open dinner is suggested there.)
 */
const clockMeal = (place: Pick<ShioriPlace, "kind" | "name" | "meal" | "anyHour">): "lunch" | "dinner" | null => place.meal ?? (habitOf(place) === "evening" ? "dinner" : null);

/**
 * The same, as the search is told it. (Every stop is handed over with the
 * same fields in the same order: the search reads them millions of times,
 * and stops of several shapes made it a third slower.)
 */
function hoursOf(place: ShioriPlace) {
  const habit = habitOf(place);
  return { daytime: isDaytime(habit), ticketed: habit === "ticketed", early: isOpenEarly(habit), morning: habit === "morning" };
}

/**
 * `slackFree`: booked places that come straight after another entered time —
 * the day's first stop, or the stop after another booking. They are reached
 * by the ride alone when the ten minutes of slack would pass their time (see
 * day-search.ts, which decides the same on the same numbers).
 */
function buildWithEngine(input: ShioriInput, extra: Partial<TripPlannerContext>, usedDays: number, frames: Frames | null = null, slackFree: ReadonlySet<string> = NO_IDS): Built {
  const settings = paceSettings.standard;
  // A stay that carries the lunch hour is handed over as a changed stay, and
  // the engine takes a changed stay only up to eight hours: a longer one it
  // drops without a word, and the visit would be printed an hour short. Such
  // a stay is the stop's own length instead. (Only a visit booked before
  // seven can be over seven hours long and end by lunchtime.)
  const lent = extra.durationOverrides ?? {};
  const stops = input.places.map((place, index) => {
    const stop = resolvedStop(place, index);
    const stay = lent[place.id];
    return typeof stay === "number" && stay > 480 ? { ...stop, planningDurationMinutes: Math.round(stay) } : stop;
  });
  const raw = stops.map((stop) => stop.input).join("\n");
  const base = input.hotel ? hotelBase(input.hotel) : null;
  const dayOverrides = Object.fromEntries(input.places.flatMap((place) => {
    // A booking's day outranks a pin.
    const day = frames?.booked.get(place.id)?.day ?? place.day;
    return typeof day === "number" && day >= 1 && day <= usedDays ? [[place.id, day] as const] : [];
  }));
  const context: TripPlannerContext = {
    resolvedStops: stops,
    resolvedBase: base,
    ...(base ? { hotelQuery: base.input } : {}),
    // From a hotel the day starts at its door, half an hour before the
    // first place would otherwise open the day.
    defaultDayStart: input.hotel ? HOTEL_DAY_START : DAY_START,
    dayEndTarget: settings.dayEnd,
    mealPlan: "all",
    // Every place arrives pinned to its day (see day-search.ts): the
    // engine's own search over groupings has nothing left to decide.
    dayAssignmentEvaluationLimit: 1,
    // A restaurant is only a meal during the meal: the engine waits for it to
    // open and will not seat anyone after the kitchen's last order.
    openingWindowsByDay: Object.fromEntries(input.places.flatMap((place) => {
      const booked = frames?.booked.get(place.id);
      const meal = clockMeal(place);
      if (!meal && !booked) return [];
      // A booked time is a door that opens at that minute and lets nobody in
      // after it: reached early the engine waits, reached late it says so
      // and keeps the clock running — never an earlier or a later start that
      // looks kept. (Room is left for the lunch hour its stay may carry.)
      // (A place of the evening is held to the dinner's hours too: a habit of the planner, see clockMeal.)
      const hours = meal ? DAY_CLOCK.meals[meal] : null;
      const window = booked
        ? { openMinutes: booked.at, closeMinutes: booked.at + stayOf(place) + LUNCH_MINUTES + 1, lastEntryMinutes: booked.at, ...(slackFree.has(place.id) ? { slackFreeEntry: true } : {}) }
        : { openMinutes: hours!.open, closeMinutes: hours!.lastSeat + Math.max(15, Math.round(place.stayMinutes)) };
      return [[place.id, Object.fromEntries(Array.from({ length: usedDays }, (_, day) => [day, [window]]))] as const];
    })),
    ...extra,
    // The traveller's own pins outrank any grouping passed in.
    dayOverrides: { ...extra.dayOverrides, ...dayOverrides },
  };
  // Every day keeps the ordinary end, the day of a chosen dinner included:
  // told that one day may run to 21:30, the engine fills that day with
  // everything and puts a shrine after dinner. The dinner itself is what
  // runs late, and dayLate() allows exactly that.
  let plan = buildTripFromWishlist(raw, usedDays, settings.engine, input.locale, context);
  // Nothing comes after a chosen dinner. Where the engine put a temple after
  // it, that day is rebuilt in the same order with the dinner moved last.
  const dinnerIds = dinnerIdsOf(input);
  const reordered = Object.fromEntries(plan.days.flatMap((day, index) => {
    const ids = day.stops.map((stop) => stop.stop.id);
    const lastSight = ids.findLastIndex((id) => !dinnerIds.has(id));
    const firstDinner = ids.findIndex((id) => dinnerIds.has(id));
    if (firstDinner < 0 || firstDinner > lastSight) return [];
    // (A day with a booked time keeps the order it was given: a booked night
    // visit may well come after dinner.)
    if (frames && ids.some((id) => frames.booked.has(id))) return [];
    return [[index, [...ids.filter((id) => !dinnerIds.has(id)), ...ids.filter((id) => dinnerIds.has(id))]] as const];
  }));
  if (Object.keys(reordered).length > 0) {
    context.lockedOrderByDay = { ...extra.lockedOrderByDay, ...reordered };
    plan = buildTripFromWishlist(raw, usedDays, settings.engine, input.locale, context);
  }
  return { plan, context, raw, usedDays };
}

const orderOf = (plan: BuiltTripPlan) => Object.fromEntries(plan.days.flatMap((day, index) => (
  day.stops.length > 0 ? [[index, day.stops.map((stop) => stop.stop.id)] as const] : []
)));

type Structure = {
  built: Built;
  journeys: Map<string, RailJourney>;
  transit: Record<string, number>;
  walking: Record<string, number>;
  walkAdvised: Set<string>;
  driving: Record<string, number>;
  pins: Record<string, number>;
  legModeOverrides: Record<string, "transit">;
  /** Every table the legs were priced with: what a measured leg is held to. */
  tables: PriceTables;
  timing: DayTiming;
  /** Wet days (1-based, as printed) that were given another planned day because of the forecast. */
  weatherDays: number[];
  /** Booked places reached straight from another entered time (see buildWithEngine). */
  slackFree: ReadonlySet<string>;
};
/** What the clock decides once the order is known: where lunch goes and when each day starts. */
type DayTiming = {
  /** Engine day index → the stop whose stay carries the lunch hour. */
  lunchAfter: Map<number, string>;
  durationOverrides: Record<string, number>;
  dayStartTimes: Record<number, string>;
  /** Engine day indices where a lunch hour had a place but an entered time left it no room. */
  noLunchRoom: Set<number>;
};
const sameTiming = (left: DayTiming, right: DayTiming) => (
  JSON.stringify([[...left.lunchAfter], left.dayStartTimes]) === JSON.stringify([[...right.lunchAfter], right.dayStartTimes])
);
const NO_RAIL = {};
const structures = new WeakMap<object, Map<string, Structure>>();
function structureKey(input: ShioriInput, frames: Frames | null = null, excluded: ReadonlySet<string> = NO_IDS, cities: Sights = undefined) {
  return JSON.stringify([
    // The names too: they are printed on the legs, and a renamed place or
    // hotel must not come back under its old name.
    // (And what kind and name say about the way there: an island, a summit.)
    // (And about its hours: a museum, a shrine, a night market.)
    input.places.map((place) => [place.id, place.name, place.lat, place.lon, place.stayMinutes, place.day ?? 0, place.meal ?? "", reachOf(place, cities) ?? 0, habitOf(place) ?? 0]),
    input.days,
    input.hotel ? [input.hotel.name, input.hotel.lat, input.hotel.lon] : 0,
    input.locale,
    // The forecast decides the numbering of the days: a plan made for one
    // forecast must never be served for another.
    (input.wetDays ?? []).map((wet) => (wet === null ? "-" : wet ? "w" : "d")).join(""),
    // The times the traveller entered, and what they left no room for.
    ...(frames ? [[frames.start, frames.finish, input.places.map((place) => { const booked = frames.booked.get(place.id); return booked ? [booked.day, booked.at] : 0; }), [...excluded].sort()]] : []),
    // What a list too full for its days leaves out.
    ...(!frames && excluded.size > 0 ? [[...excluded].sort()] : []),
  ]);
}

type PriceTables = {
  /** Board / line / change / get off, for the pairs the bundled network serves. */
  journeys: Map<string, RailJourney>;
  transit: Record<string, number>;
  walking: Record<string, number>;
  /** Pairs where the network's answer is "no train helps, just walk". */
  walkAdvised: Set<string>;
  driving: Record<string, number>;
  /** Pairs the engine would send by taxi or on foot and the booklet sends by public transport (see noTaxi, noWalk). */
  legModeOverrides: Record<string, "transit">;
  /** Pairs a taxi is not the plan for: anything beyond a short hop, a crossing by boat, the way to an island or a summit. */
  noTaxi: Set<string>;
  /** Pairs that are not a walk: a boat crosses the water between them, or one end is a summit some way off. */
  noWalk: Set<string>;
};
const emptyTables = (): PriceTables => ({ journeys: new Map(), transit: {}, walking: {}, walkAdvised: new Set(), driving: {}, legModeOverrides: {}, noTaxi: new Set(), noWalk: new Set() });
/** Whether the booklet sends this pair by public transport although the engine recommends `mode` at `minutes`. */
function heldToTransit(tables: PriceTables, key: string, mode: string | null | undefined, minutes: number) {
  if (mode === "walk") return tables.noWalk.has(key);
  if (mode !== "taxi") return false;
  if (tables.noTaxi.has(key)) return true;
  // A short hop: the engine assumes thin rail in New York or Sydney; a
  // bundled train about as fast as the taxi is the plan there too.
  const journey = tables.journeys.get(key);
  return journey !== undefined && journey.totalMinutes <= minutes + 15;
}
/** The legs of a built plan (hotel rides included) that the booklet sends by public transport and the engine did not. */
function strayLegs(plan: BuiltTripPlan, tables: PriceTables) {
  const keys: string[] = [];
  for (const day of plan.days) {
    for (const leg of day.legs) {
      const key = routeLegKey(leg.from.id, leg.to.id);
      if (heldToTransit(tables, key, leg.comparison.recommended.mode, leg.comparison.recommended.minutes)) keys.push(key);
    }
    const first = day.stops[0]?.stop;
    const last = day.stops.at(-1)?.stop;
    if (day.startBase && first && heldToTransit(tables, routeLegKey(day.startBase.id, first.id), day.hotelOutboundMode, day.hotelOutboundMinutes ?? 0)) keys.push(routeLegKey(day.startBase.id, first.id));
    if (day.endBase && last && heldToTransit(tables, routeLegKey(last.id, day.endBase.id), day.hotelInboundMode, day.hotelInboundMinutes ?? 0)) keys.push(routeLegKey(last.id, day.endBase.id));
  }
  return keys;
}

/**
 * Prices one pair with the bundled network: a train journey becomes that
 * pair's transit time, "no train helps, just walk" its walking time.
 */
function priceLeg(tables: PriceTables, from: RouteStop, to: RouteStop, rail: RailNetwork | null, locale: "ja" | "en", ground: Ground) {
  const key = routeLegKey(from.id, to.id);
  const onFoot = walkMinutes(from, to);
  const advice: RailAdvice = rail ? rail.advise(from, to, locale) : onFoot <= 30 ? { kind: "walk", minutes: onFoot } : { kind: "none" };
  const estimates = estimateTravelOptions(from, to).options;
  const estimate = estimates.find((option) => option.mode === "transit")?.minutes ?? null;
  const taxi = estimates.find((option) => option.mode === "taxi")?.minutes;
  // With no train, it is a bus through city streets: a quarter of an
  // hour to reach, wait for and leave it, then about 14 km/h along
  // roads a third longer than the straight line. The engine's generic
  // estimate assumes urban rail (26 km/h) and makes every cross-town
  // hop look alike — which is how Kinkaku-ji and Ginkaku-ji, at
  // opposite ends of Kyoto, ended up on the same day.
  //
  // (The quarter of an hour is the same on every bus leg and a trip of a
  // given number of days has a fixed number of legs, so it does not blur
  // near and far: the price still grows by five and a half minutes per
  // straight kilometre. What does make neighbours look alike is the
  // rounding to five minutes — places within about 900 m of each other
  // cost the same from across town. The price stays rounded, because it is
  // printed and must read as the estimate it is; the search breaks equal
  // minutes by distance instead.)
  const straight = onFoot * 75 / 1.3 / 1_000;
  const cityBus = Math.ceil((12 + straight * 1.3 * 4.2) / 5) * 5;
  // That pace is a bus across a city, about ten kilometres of it. A leg
  // that goes on beyond is a suburban line or a bus on an open road this
  // data does not know: the kilometres past the tenth are counted at the
  // engine's own pace for such a ride (26 km/h), not at 11 km/h all the way
  // — 135 minutes from Yokohama to Tokyo would be wrong on its face. Such
  // legs used to be printed as taxis and this number was never seen.
  const bus = straight <= CITY_BUS_KM ? cityBus : Math.ceil((12 + CITY_BUS_KM * 1.3 * 4.2 + (straight - CITY_BUS_KM) * 2.3) / 5) * 5;
  // A journey with a boat in it crosses water: no bus stands in for it, and
  // neither a taxi nor a walk does (Miyajima was reached by a 45-minute taxi
  // drawn across the strait while the network had the ferry). An island or
  // a summit is not reached by taxi either, as far as its kind says what it
  // is; and the way up to a summit is not a level walk.
  const boat = advice.kind === "rail" && advice.journey.rides.some((ride) => ride.boat);
  const ends = [ground.reach(from.id), ground.reach(to.id)];
  const summit = ends.includes("summit");
  if (boat || summit || ends.includes("island") || (ground.holdLongTaxi && taxi !== undefined && taxi > TAXI_HOP_MINUTES)) tables.noTaxi.add(key);
  if (boat || (summit && onFoot > SUMMIT_WALK_MINUTES)) tables.noWalk.add(key);
  if (advice.kind === "rail" && (boat || advice.journey.totalMinutes <= cityBus + 10)) {
    // (A rail answer slower than the bus means the real answer is a
    // bus this data does not know: 82 minutes by three trains from
    // Yasaka Shrine to Kinkaku-ji, against 50 by bus.)
    tables.journeys.set(key, advice.journey);
    tables.transit[key] = advice.journey.totalMinutes;
    if (taxi !== undefined) tables.driving[key] = taxiAgainstTrain(taxi, advice.journey.totalMinutes);
  } else if (advice.kind === "walk") {
    tables.walking[key] = advice.minutes;
    tables.walkAdvised.add(key);
    tables.transit[key] = advice.minutes + 8;
  } else if (estimate === null || bus > estimate) {
    tables.transit[key] = bus;
    if (taxi !== undefined) tables.driving[key] = taxiAgainstTrain(taxi, bus);
  }
}

const liveTables = (tables: PriceTables): Partial<TripPlannerContext> => ({
  liveTransitMinutes: tables.transit,
  liveWalkingMinutes: tables.walking,
  liveDrivingMinutes: tables.driving,
  legModeOverrides: tables.legModeOverrides,
});

type PlacePrices = { tables: PriceTables; minutes: number[][]; /** Pairs the booklet sends by taxi. */ taxi: boolean[][]; /** See TAXI_HOP_MINUTES. */ holdLongTaxi: boolean };
const placePrices = new WeakMap<object, Map<string, PlacePrices>>();

/**
 * What every pair of places costs, in the minutes the booklet will print.
 * The tables are filled first; the minutes are then read back from the
 * engine itself, which decides between walking, the train and a taxi by
 * rules of its own — so the search and the printed plan can never disagree
 * about a leg.
 */
function pricePlaces(input: ShioriInput, rail: RailNetwork | null, cities: Sights): PlacePrices {
  const shelf = placePrices.get(rail ?? NO_RAIL) ?? new Map<string, PlacePrices>();
  placePrices.set(rail ?? NO_RAIL, shelf);
  // Prices depend on where the places are, not on how long one stays. (The
  // same trip is priced again for every hotel area that is tried.)
  // (And, for the way to an island or a summit, on what they are.)
  const cacheKey = JSON.stringify([input.locale, input.places.map((place) => [place.id, place.lat, place.lon, reachOf(place, cities) ?? 0])]);
  const known = shelf.get(cacheKey);
  if (known) return known;
  const stops = input.places.map(resolvedStop);
  const engine = paceSettings.standard.engine;
  // The engine's rules depend on the country the whole list is in. Each
  // pair is read from a two-place run (the cheapest there is), told that
  // country, which one run with every place alone on its own day reports.
  const destination = buildTripFromWishlist(stops.map((stop) => stop.input).join("\n"), stops.length, engine, input.locale, {
    resolvedStops: stops,
    dayOverrides: Object.fromEntries(stops.map((stop, index) => [stop.id, index + 1])),
  }).destination;
  const holdLongTaxi = rail !== null || destinationById(destination).mobility === "transit_first";
  const ground = groundOf(input, holdLongTaxi, cities);
  const tables = emptyTables();
  for (const from of stops) {
    for (const to of stops) if (from.id !== to.id) priceLeg(tables, from, to, rail, input.locale, ground);
  }
  const taxi = stops.map(() => stops.map(() => false));
  const minutes = stops.map((from, row) => stops.map((to, column) => {
    if (row === column) return 0;
    const pair = [{ ...from, input: lineFor(0), inputIndex: 0 }, { ...to, input: lineFor(1), inputIndex: 1 }];
    const leg = buildTripFromWishlist(`${pair[0].input}\n${pair[1].input}`, 1, engine, input.locale, {
      destination,
      resolvedStops: pair,
      ...liveTables(tables),
      lockedOrderByDay: { 0: [from.id, to.id] },
    }).days[0]?.legs[0];
    if (!leg) return 0;
    // Where the engine would send a traveller by taxi beyond a short hop,
    // or by taxi although the bundled network has a train about as fast,
    // or on foot over water a boat crosses or up to a summit, public
    // transport is the plan — for every pair, before anything is ordered,
    // so the order is chosen on the minutes printed.
    const key = routeLegKey(from.id, to.id);
    const train = leg.comparison.options.find((option) => option.mode === "transit");
    if (train && heldToTransit(tables, key, leg.comparison.recommended.mode, leg.comparison.recommended.minutes)) {
      tables.legModeOverrides[key] = "transit";
      return train.minutes;
    }
    taxi[row][column] = leg.comparison.recommended.mode === "taxi";
    return leg.comparison.recommended.minutes;
  }));
  const prices = { tables, minutes, taxi, holdLongTaxi };
  shelf.set(cacheKey, prices);
  if (shelf.size > 12) shelf.delete(shelf.keys().next().value as string);
  return prices;
}

type TripPrices = PlacePrices & { hotel: { out: number[]; back: number[]; taxiOut: boolean[]; taxiBack: boolean[] } | null };
const tripPrices = new WeakMap<object, Map<string, TripPrices>>();

/** The places' prices plus, with a hotel, the way out of it and back to it from every place. */
function priceTrip(input: ShioriInput, rail: RailNetwork | null, cities: Sights): TripPrices {
  const places = pricePlaces(input, rail, cities);
  if (!input.hotel || input.places.length === 0) return { ...places, hotel: null };
  // (Every hotel area that is tried is priced once, however often it is planned.)
  const shelf = tripPrices.get(rail ?? NO_RAIL) ?? new Map<string, TripPrices>();
  tripPrices.set(rail ?? NO_RAIL, shelf);
  const cacheKey = JSON.stringify([input.locale, input.places.map((place) => [place.id, place.lat, place.lon, reachOf(place, cities) ?? 0]), input.hotel.lat, input.hotel.lon]);
  const known = shelf.get(cacheKey);
  if (known) return known;
  const stops = input.places.map(resolvedStop);
  const tables: PriceTables = {
    journeys: new Map(places.tables.journeys),
    transit: { ...places.tables.transit },
    walking: { ...places.tables.walking },
    walkAdvised: new Set(places.tables.walkAdvised),
    driving: { ...places.tables.driving },
    legModeOverrides: { ...places.tables.legModeOverrides },
    noTaxi: new Set(places.tables.noTaxi),
    noWalk: new Set(places.tables.noWalk),
  };
  const ground = groundOf(input, places.holdLongTaxi, cities);
  // The engine renames the base "base-<id>"; priced under any other id,
  // the way out of and back to the hotel never finds its train.
  const door = resolvedStop({ id: `base-${hotelId(input.hotel)}`, name: input.hotel.name, lat: input.hotel.lat, lon: input.hotel.lon, stayMinutes: 15 }, 9_999);
  for (const stop of stops) {
    priceLeg(tables, door, stop, rail, input.locale, ground);
    priceLeg(tables, stop, door, rail, input.locale, ground);
  }
  const out = stops.map(() => 0);
  const back = stops.map(() => 0);
  const taxiOut = stops.map(() => false);
  const taxiBack = stops.map(() => false);
  // One engine run with every place alone on a day of its own reads all
  // the hotel legs at once.
  const read = () => {
    const plan = buildTripFromWishlist(stops.map((stop) => stop.input).join("\n"), stops.length, paceSettings.standard.engine, input.locale, {
      resolvedStops: stops,
      resolvedBase: hotelBase(input.hotel!),
      hotelQuery: input.hotel!.name,
      ...liveTables(tables),
      dayOverrides: Object.fromEntries(stops.map((stop, index) => [stop.id, index + 1])),
    });
    let changed = false;
    plan.days.forEach((day) => {
      if (day.stops.length !== 1) return;
      const stop = day.stops[0].stop;
      const index = stops.findIndex((candidate) => candidate.id === stop.id);
      out[index] = day.hotelOutboundMinutes ?? 0;
      back[index] = day.hotelInboundMinutes ?? 0;
      taxiOut[index] = day.hotelOutboundMode === "taxi";
      taxiBack[index] = day.hotelInboundMode === "taxi";
      // The same rule as between places.
      for (const [key, mode, legMinutes] of [
        [routeLegKey(door.id, stop.id), day.hotelOutboundMode, out[index]],
        [routeLegKey(stop.id, door.id), day.hotelInboundMode, back[index]],
      ] as const) {
        if (!tables.legModeOverrides[key] && heldToTransit(tables, key, mode, legMinutes)) {
          tables.legModeOverrides[key] = "transit";
          changed = true;
        }
      }
    });
    return changed;
  };
  if (read()) read();
  const prices = { tables, minutes: places.minutes, taxi: places.taxi, holdLongTaxi: places.holdLongTaxi, hotel: { out, back, taxiOut, taxiBack } };
  shelf.set(cacheKey, prices);
  if (shelf.size > 60) shelf.delete(shelf.keys().next().value as string);
  return prices;
}

/** The trip as the search sees it: stays, meals, pins, entered times and a table of minutes. */
function searchProblem(input: ShioriInput, pricing: TripPrices, frames: Frames | null = null): SearchProblem {
  return {
    stops: input.places.map((place) => {
      const booked = frames?.booked.get(place.id);
      // (A booked stop has no habit: its hour is the traveller's own.)
      return booked
        ? { stay: stayOf(place), meal: place.meal ?? null, day: booked.day, fixed: booked.at }
        : { stay: stayOf(place), meal: clockMeal(place), day: typeof place.day === "number" ? place.day : null, ...hoursOf(place) };
    }),
    minutes: pricing.minutes,
    km: input.places.map((from) => input.places.map((to) => straightKm(from, to))),
    taxi: pricing.taxi,
    hotel: pricing.hotel && input.hotel ? { ...pricing.hotel, km: input.places.map((place) => straightKm(place, input.hotel!)) } : null,
    ...(frames && (frames.start !== null || frames.finish !== null) ? { frames: { firstStart: frames.start, lastFinish: frames.finish } } : {}),
  };
}

/**
 * The search for the trip in hand. One is kept: asking the same list for
 * another number of days, or without one of its places, looks up the days
 * it has already worked out instead of solving them again.
 */
let lastSearch: { minutes: number[][]; out: number[] | null; key: string; search: ReturnType<typeof daySearch> } | null = null;
const searchKey = (input: ShioriInput, frames: Frames | null) => JSON.stringify(input.places.map((place) => [stayOf(place), place.meal ?? "", place.day ?? 0, habitOf(place) ?? 0]))
  + (frames ? JSON.stringify([frames.start, frames.finish, input.places.map((place) => { const booked = frames.booked.get(place.id); return booked ? [booked.day, booked.at] : 0; })]) : "");
function searchFor(input: ShioriInput, pricing: TripPrices, frames: Frames | null = null) {
  const key = searchKey(input, frames);
  const out = pricing.hotel?.out ?? null;
  if (lastSearch && lastSearch.minutes === pricing.minutes && lastSearch.out === out && lastSearch.key === key) return lastSearch.search;
  const search = daySearch(searchProblem(input, pricing, frames));
  lastSearch = { minutes: pricing.minutes, out, key, search };
  return search;
}

/**
 * The search for the same trip with other entered times — asked "would this
 * day be used if the start had not been entered?". Kept beside the search in
 * hand, never in its place: that one is asked again and again while a trip
 * is on screen. A few are remembered per trip, so the question costs one
 * search however many lengths of trip it is asked for.
 */
const sideSearches = new WeakMap<object, Map<string, ReturnType<typeof daySearch>>>();
function sideSearchFor(input: ShioriInput, pricing: TripPrices, frames: Frames | null) {
  const shelf = sideSearches.get(pricing.minutes) ?? new Map<string, ReturnType<typeof daySearch>>();
  sideSearches.set(pricing.minutes, shelf);
  const key = `${searchKey(input, frames)}|${pricing.hotel ? pricing.hotel.out.join(",") : ""}`;
  let search = shelf.get(key);
  if (!search) {
    search = daySearch(searchProblem(input, pricing, frames));
    shelf.set(key, search);
    if (shelf.size > 4) shelf.delete(shelf.keys().next().value as string);
  }
  return search;
}

/**
 * How far past its ordinary end — 18:00 for sightseeing, 21:30 for a place
 * of the evening — a day may run and still be printed with everything on it:
 * an hour. Up to there the booklet keeps the whole list and says the day
 * runs late, with the way out (a day more, a place less). Beyond it the day
 * is not one a traveller can use as it stands — sights at ten at night — and
 * the list is planned as the set that fits instead (see leaveOutForRoom).
 * The planner's own measure of a day, like the 18:00 it is counted from:
 * nothing about the hours of any place.
 */
export const FAR_PAST_END = 60;
/** How many ways of leaving places out are planned to find the fewest; beyond it each late day is thinned on its own. */
const ROOM_SEARCHES = 160;

/**
 * Which places a list too full for its days is planned without.
 *
 * Nothing, unless a day of the trip as the search plans it runs more than an
 * hour past its end (FAR_PAST_END). Then places are left out until no day
 * runs late at all — the set that fits, not the set that is only less late:
 *
 *   - as few as can be: every way of leaving one place out is planned, then
 *     every way of leaving two, and so on (ways that cannot free the time
 *     that is missing are not tried; a list of more than fourteen places,
 *     or one with too many ways to plan them all, has each late day thinned
 *     on its own instead: good, not proven fewest);
 *   - among sets of one size, the one whose plan costs least — so the place
 *     far from the rest goes, or the long stay that crowds out several
 *     others — and, where two cost the same, the places lower in the list.
 *
 * Never left out: a restaurant or a shop the traveller chose, a place with a
 * time the traveller entered, a place the traveller put on a day, and a
 * place that would run late on a day of its own (leaving out everything
 * around it is no cure). A day that only such places make late stays as it
 * is and is said to run late.
 *
 * Decided on the priced minutes alone, like the days and their order: a
 * street path measured later corrects a clock and never throws a place out
 * of a booklet that is already on screen.
 *
 * `already`: places set aside for an entered time. Returns indices into
 * `input.places`, in list order.
 */
function leaveOutForRoom(input: ShioriInput, pricing: TripPrices, search: ReturnType<typeof daySearch>, frames: Frames | null, already: readonly number[]): number[] {
  // The answer hangs on the search (the priced minutes, the stays, the entered times), the days asked for and
  // what is protected, and on nothing else: it is worked out once and looked up while the trip is on screen.
  const shelf = roomAnswers.get(search) ?? new Map<string, number[]>();
  roomAnswers.set(search, shelf);
  const asked = `${input.days}|${already.join(",")}|${input.places.map((place) => (place.id.startsWith("hotpepper-") ? 1 : 0)).join("")}`;
  let answer = shelf.get(asked);
  if (!answer) {
    answer = roomFor(input, pricing, search, frames, already);
    if (shelf.size >= 24) shelf.clear();
    shelf.set(asked, answer);
  }
  return [...answer];
}
const roomAnswers = new WeakMap<object, Map<string, number[]>>();

function roomFor(input: ShioriInput, pricing: TripPrices, search: ReturnType<typeof daySearch>, frames: Frames | null, already: readonly number[]): number[] {
  const requested = requestedDays(input);
  type Days = ReturnType<ReturnType<typeof daySearch>["choose"]>["days"];
  const planned = (out: readonly number[]): Days => search.choose(input.days, already.length + out.length === 0 ? {} : { without: [...already, ...out] }).days;
  const whole = planned([]);
  if (!whole.some((day) => day.overrun > FAR_PAST_END)) return [];
  const gone = new Set(already);
  const free = new Set(input.places.flatMap((place, index) => {
    if (gone.has(index) || place.meal || place.id.startsWith("hotpepper-") || frames?.booked.has(place.id)) return [];
    if (typeof place.day === "number" && place.day >= 1 && Math.round(place.day) <= requested) return [];
    return search.solveDay([index]).overrun === 0 ? [index] : [];
  }));
  /** The days that run late and have a place on them that could be left out. */
  const late = (days: Days) => days.filter((day) => day.overrun > 0 && day.order.some((stop) => free.has(stop)));
  if (!late(whole).some((day) => day.overrun > FAR_PAST_END)) return [];
  // Leaving a place out never costs an entered time or a chosen meal that the whole list keeps.
  const lost = (days: Days) => days.reduce((sum, day) => sum + day.late + (day.hardOver > 0 ? 1 : 0) + day.missed, 0);
  const lostWhole = lost(whole);
  const fits = (days: Days) => days.length > 0 && late(days).length === 0 && lost(days) <= lostWhole;
  const costOf = (days: Days) => days.reduce((sum, day) => sum + day.cost, 0);
  // The most time a place can free: its stay and the longest rides in and out of it.
  const takes = (index: number) => stayOf(input.places[index]) + DAY_CLOCK.legBuffer
    + Math.max(pricing.hotel?.out[index] ?? 0, ...pricing.minutes.map((row) => row[index]))
    + Math.max(pricing.hotel?.back[index] ?? 0, ...pricing.minutes[index]);
  // On a list of plain sights — no chosen meal, no place of the evening, no entered time, no stay that claims
  // a day — a place frees no more than putting it back would cost: its stay and the detour to it from the
  // nearest place that stays, whatever comes after that one. A far tighter measure, so that the ways of
  // leaving out too little are not planned one by one (ten sights for one day: none of the 45 pairs).
  const plain = frames === null && input.places.every((place) => clockMeal(place) === null && stayOf(place) < DAY_FILLING_STAY);
  const live = input.places.map((_, index) => index).filter((index) => !gone.has(index));
  const detours = live.map((stop) => live.map((from) => {
    if (from === stop) return Infinity;
    let after = pricing.hotel ? Math.max(0, pricing.hotel.back[stop] - pricing.hotel.back[from]) : 0;
    for (const next of live) if (next !== stop && next !== from) after = Math.max(after, pricing.minutes[stop][next] - pricing.minutes[from][next]);
    return pricing.minutes[from][stop] + after;
  }));
  const position = new Map(live.map((index, at) => [index, at]));
  /** The most time leaving these out can free. */
  const frees = (out: readonly number[]) => {
    if (!plain) return out.reduce((sum, index) => sum + takes(index), 0);
    const kept = live.filter((index) => !out.includes(index));
    return out.reduce((sum, index) => {
      const row = detours[position.get(index)!];
      const detour = Math.min(...kept.map((from) => row[position.get(from)!]));
      return sum + Math.min(takes(index), stayOf(input.places[index]) + DAY_CLOCK.legBuffer + detour);
    }, 0);
  };
  const missing = late(whole).reduce((sum, day) => sum + day.overrun - DAY_CLOCK.endGrace, 0);
  const candidates = [...free].sort((left, right) => takes(right) - takes(left) || left - right);
  // Of two sets, the one that keeps the place higher in the list.
  const lower = (left: readonly number[], right: readonly number[]) => {
    const first = [...left].sort((a, b) => a - b);
    const second = [...right].sort((a, b) => a - b);
    for (let position = 0; position < first.length; position += 1) if (first[position] !== second[position]) return first[position] > second[position];
    return false;
  };
  let found: number[] | null = null;
  let budget = ROOM_SEARCHES;
  // (Set by set only where the search keeps one table for all the days of a list: up to fourteen places.)
  if (input.places.length > 14) budget = 0;
  for (let size = 1; size < candidates.length && found === null && budget > 0; size += 1) {
    const sets: number[][] = [];
    const grow = (from: number, chosen: number[], freed: number) => {
      if (chosen.length === size) {
        if (freed + 30 >= missing && frees(chosen) + 30 >= missing) sets.push(chosen);
        return;
      }
      for (let position = from; position <= candidates.length - (size - chosen.length); position += 1) {
        grow(position + 1, [...chosen, candidates[position]], freed + takes(candidates[position]));
        if (sets.length > budget) return;
      }
    };
    grow(0, [], 0);
    if (sets.length > budget) {
      budget = 0;
      break;
    }
    budget -= sets.length;
    let best: { out: number[]; cost: number } | null = null;
    for (const out of sets) {
      // Planned first as the days are costed while they are chosen, a hundredth of the work: a way that
      // leaves a day more than an hour over there is not one that every order of its days could mend.
      if (late(search.choose(input.days, { quick: true, without: [...already, ...out] }).days).some((day) => day.overrun > FAR_PAST_END)) continue;
      const days = planned(out);
      if (!fits(days)) continue;
      const cost = costOf(days);
      if (best === null || cost < best.cost - 1e-6 || (cost <= best.cost + 1e-6 && lower(out, best.out))) best = { out, cost };
    }
    if (best) found = best.out;
  }
  if (found === null) {
    // Too many ways to plan them all. Each day that runs late is thinned on
    // its own — the place whose absence leaves that day least late goes,
    // until the day can be kept — and the trip planned again without what
    // the days gave up, for as long as a day runs late. (A day is cheap to
    // plan; a long list is not.)
    const out: number[] = [];
    for (;;) {
      const days = planned(out);
      if (fits(days)) break;
      const before = out.length;
      for (const full of late(days)) {
        const cls = frames ? (full.day === 1 && frames.start !== null ? 1 : 0) | (full.day === requested && frames.finish !== null ? 2 : 0) : 0;
        let rest = [...full.order].sort((left, right) => left - right);
        while (rest.length > 1 && search.solveDay(rest, cls).overrun > 0) {
          let best: { stop: number; over: number; cost: number } | null = null;
          for (const stop of rest) {
            if (!free.has(stop)) continue;
            // (Compared as the search costs a day while choosing days: nine days of eight places tried in every order are a quarter of a second.)
            const day = search.roughDay(rest.filter((other) => other !== stop), cls);
            // (The place lower in the list goes where two do the same.)
            if (best === null || day.overrun < best.over || (day.overrun === best.over && day.cost <= best.cost + 1e-6)) best = { stop, over: day.overrun, cost: day.cost };
          }
          if (best === null) break;
          const gone = best.stop;
          out.push(gone);
          rest = rest.filter((other) => other !== gone);
        }
      }
      if (out.length === before) break;
    }
    found = out;
  }
  // One of them may fit again now that the others are gone: each is tried, in the traveller's own order.
  // (Each try is a search of the whole list: on a long one only the three highest in the list are tried.)
  let chosen: number[] = [...found].sort((left, right) => left - right);
  if (chosen.length >= 2) {
    for (const stop of chosen.slice(0, input.places.length <= 16 ? chosen.length : 3)) {
      const rest = chosen.filter((other) => other !== stop);
      if (fits(planned(rest))) chosen = rest;
    }
  }
  // (Where even that leaves a day late, the places are left out only if fewer days are.)
  return fits(planned(chosen)) || late(planned(chosen)).length < late(whole).length ? chosen : [];
}

function straightKm(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  return Math.hypot((from.lat - to.lat) * 111, (from.lon - to.lon) * 111 * Math.cos((from.lat * Math.PI) / 180));
}

/**
 * The minutes the planner works with, for tests that check its plans
 * against an exhaustive search: `minutes[from][to]` between places in list
 * order, and the hotel legs when there is a hotel.
 */
export function shioriPricing(input: ShioriInput, options: { rail?: RailNetwork | null; cities?: readonly PopularDestination[] } = {}) {
  const prices = priceTrip(input, options.rail ?? null, options.cities);
  return {
    minutes: prices.minutes,
    fromHotel: prices.hotel?.out ?? null,
    toHotel: prices.hotel?.back ?? null,
    tables: prices.tables,
    /** Pairs (and hotel legs) the booklet sends by taxi: the search counts each a quarter of an hour dearer. */
    taxi: prices.taxi,
    taxiFromHotel: prices.hotel?.taxiOut ?? null,
    taxiToHotel: prices.hotel?.taxiBack ?? null,
  };
}

/** When the lunch of a visit that runs across lunchtime starts: at 12:30, or on arrival when that is later (never after 13:00: see dayClock). */
const lunchDuringStart = (arrive: number) => Math.max(arrive, 12 * 60 + 30);

/** A sight with nowhere to sit down to dinner beside it, as far as its kind says: open country, not a town's own park or a park of rides. */
const NO_TABLE_KIND = /mountain|volcano|waterfall|canyon|\bcave\b|\blake\b|forest|\bpark\b|wildlife|island|beach|ruin|archaeological|cemetery|lighthouse/;
const TOWN_PARK_KIND = /theme park|amusement|urban park|science park|hi-tech park|exhibition park|miniature park|artificial/;

/** When the place's country sits down to dinner, in minutes since midnight (lib/destinations.ts); 17:30 where it is not known. */
export function dinnerHourAt(place: { lat: number; lon: number }): number {
  return destinationForCoordinate(place.lat, place.lon)?.meals.dinner.start ?? DAY_CLOCK.meals.dinner.open;
}

/**
 * Where and when the open dinner of a day is: a slot to look for a table in,
 * not a stop on the clock. Never before the dinner hour of the place; a day
 * that is still sightseeing after it eats when its last sight is over.
 *
 * Near the last sight, as a rule. Back near the hotel when there is one and
 * the last sight is over before the dinner hour (nobody waits an hour beside
 * an earthwork — and the ride back that the booklet prints leaves when the
 * sight is over, be it five minutes before the hour: a dinner "near the
 * zoo at 17:30" under a train that left the zoo at 17:25 is a row the
 * traveller cannot keep) or is a place with no table around it (a forest
 * park, a mountain, ruins): then not before the ride back has got there.
 * So a dinner near the last sight of a day with a hotel always begins the
 * minute that sight is left, which is the minute the ride back is printed
 * from: the traveller eats, and rides back that much later.
 */
export function dinnerSlot(day: {
  /** When the last stop is left, in minutes since the day's midnight. */
  lastLeave: number;
  lastPlace: Pick<ShioriPlace, "name" | "lat" | "lon" | "kind">;
  /** The hotel the day ends at and the minutes of the ride back to it; null on a trip without one. */
  hotel: { name: string; lat: number; lon: number; rideBack: number } | null;
}): { start: number; near: GeoPoint; nearName: string; atHotel: boolean } {
  const hour = dinnerHourAt(day.lastPlace);
  const kind = (day.lastPlace.kind ?? "").toLowerCase();
  const noTable = NO_TABLE_KIND.test(kind) && !TOWN_PARK_KIND.test(kind);
  if (day.hotel && (noTable || day.lastLeave < hour)) {
    return {
      start: Math.max(hour, day.lastLeave + day.hotel.rideBack),
      near: { latitude: day.hotel.lat, longitude: day.hotel.lon },
      nearName: day.hotel.name,
      atHotel: true,
    };
  }
  return {
    start: Math.max(hour, day.lastLeave),
    near: { latitude: day.lastPlace.lat, longitude: day.lastPlace.lon },
    nearName: day.lastPlace.name,
    atHotel: false,
  };
}

/** A place to eat or drink is under a roof whatever else is known of it. */
const TABLE_KIND = /restaurant|caf[eé]/;

/*
 * Kinds the two lists above leave out but whose weather is plain, used only
 * for deciding which date a day goes on (a fifth of the cities' best-known
 * sights would otherwise be "unknown" and keep their days fixed). A church or
 * an observation deck is visited under a roof; a fort, a historic quarter or
 * a harbour is walked in the open. Kinds that could go either way (stadium,
 * onsen, cave, tower) stay unknown.
 */
const WEATHER_INDOOR_KIND = /cathedral|basilica|church|mosque|synagogue|chapel|observation (deck|tower)|skyscraper/;
const WEATHER_OUTDOOR_KIND = /archaeological site|fort|citadel|gate|historic (site|district)|old town|avenue|harbou?r|volcano|triumphal arch|fountain|lighthouse/;

/**
 * Whether a place is out of doors, as far as its kind says. A place that is
 * both ("museum in a park") counts as indoors; one with no kind, or a kind
 * that says neither (typed by name, "tower"), is unknown — it is not assumed
 * to be under a roof.
 */
export function weatherExposure(place: Pick<ShioriPlace, "kind" | "meal">): "outdoor" | "indoor" | "unknown" {
  const kind = (place.kind ?? "").toLowerCase();
  if (place.meal || TABLE_KIND.test(kind) || INDOOR_KIND.test(kind) || WEATHER_INDOOR_KIND.test(kind)) return "indoor";
  return OUTDOOR_KIND.test(kind) || WEATHER_OUTDOOR_KIND.test(kind) ? "outdoor" : "unknown";
}

/** Time at places that are out of doors. */
function outdoorMinutes(places: readonly ShioriPlace[]) {
  return places.reduce((sum, place) => sum + (weatherExposure(place) === "outdoor" ? stayOf(place) : 0), 0);
}

/**
 * The day number each searched day is printed under once the forecast has
 * had its say. The search numbers days by travel alone; where rain is
 * forecast, whole days trade numbers so that the outdoor one falls on a dry
 * date. Days, order, legs and clocks are untouched — they move together.
 */
function weatherNumbering(input: ShioriInput, days: ReadonlyArray<{ day: number; order: readonly number[] }>, frames: Frames | null = null) {
  const none = { dayFor: new Map<number, number>(), wetDays: [] as number[] };
  if (!input.wetDays || !input.wetDays.some((wet) => wet !== null)) return none;
  const sorted = [...days].sort((left, right) => left.day - right.day);
  // The day as the booklet prints it: empty days are skipped in the count,
  // unless a place is pinned to a day — then "Day 3" stays Day 3 (see where
  // the days are numbered in planOnce).
  // An entered time means calendar days too: day 1 is the day the traveller
  // arrives, a booking's day is the day it was booked for.
  const keepDayNumbers = frames !== null || input.places.some((place) => typeof place.day === "number");
  const printed = (position: number) => (keepDayNumbers ? sorted[position].day - 1 : position);
  const lastDay = requestedDays(input);
  const result = weatherDayOrder(sorted.map((day, position) => {
    const places = day.order.map((stop) => input.places[stop]);
    return {
      outdoorMinutes: outdoorMinutes(places),
      // A day holding a place of unknown kind is not known to be the day with
      // less time outdoors: it stays where it is, like a pinned one. So does
      // a day with a booking on it, day 1 when it has a start and the last
      // day when it has a finish: those days were planned for their own
      // hours, and no other day's places would fit them.
      fixed: places.some((place) => typeof place.day === "number" || weatherExposure(place) === "unknown")
        || (frames !== null && (
          places.some((place) => frames.booked.has(place.id))
          || (frames.start !== null && day.day === 1)
          || (frames.finish !== null && day.day === lastDay)
        )),
      wet: input.wetDays![printed(position)] ?? null,
    };
  }));
  if (!result.changed) return none;
  // order[slot] names the group that moves onto that slot's day.
  result.order.forEach((group, slot) => none.dayFor.set(sorted[group].day, sorted[slot].day));
  return { dayFor: none.dayFor, wetDays: result.wetSlotsChanged.map((slot) => printed(slot) + 1) };
}

type PlanOptions = {
  rail?: RailNetwork | null;
  cities?: readonly PopularDestination[];
  /** Street paths already looked up, keyed "walk|<leg key>" / "drive|<leg key>". */
  routes?: ReadonlyMap<string, ShioriRoute | null>;
};

function planOnce(input: ShioriInput, options: PlanOptions): ShioriPlan {
  const frames = framesOf(input);
  if (frames) {
    const plan = planFramed(input, options, frames);
    // The evening is the planner's habit for a night market, and the hours the traveller entered come before
    // it: a place of the evening that those hours leave no room for (a trip that is over by 16:00) is planned
    // at any hour instead, like any other sight — where the days then hold more of the list.
    const aside = (from: ShioriPlan) => new Set([...from.unplaced.filter((entry) => entry.reason === "no-room"), ...from.overfull].map((entry) => entry.placeId));
    const before = aside(plan);
    const yielding = new Set(input.places.filter((place) => before.has(place.id) && habitOf(place) === "evening").map((place) => place.id));
    if (yielding.size === 0) return plan;
    const eased = planFramed({ ...input, places: input.places.map((place) => (yielding.has(place.id) ? { ...place, anyHour: true as const } : place)) }, options, frames);
    const after = aside(eased);
    const other = (from: ShioriPlan) => from.unplaced.filter((entry) => entry.reason !== "no-room").length;
    if (!(after.size < before.size && other(eased) <= other(plan))) return plan;
    // (The booklet carries the traveller's own places, without the planner's mark.)
    const own = new Map(input.places.map((place) => [place.id, place]));
    return { ...eased, days: eased.days.map((day) => ({ ...day, stops: day.stops.map((stop) => (yielding.has(stop.place.id) ? { ...stop, place: own.get(stop.place.id)! } : stop)) })) };
  }
  if (input.packAnyway || input.places.length < 2) return planCore(input, options, null, NO_IDS);
  // A list too full for its days: the set that fits is planned, the rest is listed.
  const pricing = priceTrip(input, options.rail ?? null, options.cities);
  const out = leaveOutForRoom(input, pricing, searchFor(input, pricing, null), null, []);
  if (out.length === 0) return planCore(input, options, null, NO_IDS);
  const overfull = out.map((index) => ({ placeId: input.places[index].id, name: input.places[index].name }));
  return { ...planCore(input, options, null, new Set(overfull.map((entry) => entry.placeId))), overfull };
}

/**
 * The booklet for the list less the places in `excluded` — places an entered
 * time left no room for. They stay in the list (it is priced and searched
 * once, whatever is set aside) and come back in `leftOut`. Without `frames`
 * nothing is ever excluded and this is the plan as it has always been made.
 */
function planCore(input: ShioriInput, options: PlanOptions, frames: Frames | null, excluded: ReadonlySet<string>): ShioriPlan {
  const engineInput = excluded.size === 0 ? input : { ...input, places: input.places.filter((place) => !excluded.has(place.id)) };
  if (engineInput.places.length === 0) {
    return { days: [], freeDays: Math.max(0, input.days), freeDayIdeas: [], leftOut: input.places.map((place) => place.name), stayNear: null, hotel: input.hotel, notices: [], unplaced: [], overfull: [] };
  }
  const settings = paceSettings.standard;
  const dinnerIds = dinnerIdsOf(input);
  const bookedIds: ReadonlySet<string> = frames ? new Set(frames.booked.keys()) : NO_IDS;
  const requested = requestedDays(input);
  const rail = options.rail ?? null;

  const routes = options.routes ?? new Map<string, ShioriRoute | null>();
  const measuredWalking: Record<string, number> = {};
  const measuredDriving: Record<string, number> = {};
  for (const [routeKey, route] of routes) {
    if (!route || route.minutes === null) continue;
    if (routeKey.startsWith("walk|")) measuredWalking[routeKey.slice(5)] = route.minutes;
    else if (routeKey.startsWith("drive|")) measuredDriving[routeKey.slice(6)] = route.minutes;
  }
  const placeById = new Map(input.places.map((place) => [place.id, place]));
  /**
   * Lunch and the day's start, from the legs of a plan as built: the same
   * clock the search keeps, run over the engine's own minutes.
   */
  const timingOf = (plan: BuiltTripPlan): DayTiming => {
    const timing: DayTiming = { lunchAfter: new Map(), durationOverrides: {}, dayStartTimes: {}, noLunchRoom: new Set() };
    plan.days.forEach((day, index) => {
      const places = day.stops.flatMap((entry) => placeById.get(entry.stop.id) ?? []);
      if (places.length === 0 || places.length !== day.stops.length) return;
      // The day's entered times, exactly as the search knows them (see day-search.ts).
      const open = frames && index === 0 ? frames.start : null;
      const close = frames && index === requested - 1 ? frames.finish : null;
      // (On a trip with an entered time every day keeps that clock: see describe() in day-search.ts.)
      const schedule = scheduleDay(
        places.map(stayOf),
        places.map((place) => (frames?.booked.has(place.id) ? place.meal ?? null : clockMeal(place))),
        day.legs.map((leg) => leg.comparison.recommended.minutes),
        day.startBase && day.hotelOutboundMinutes !== null ? day.hotelOutboundMinutes : null,
        frames !== null
          ? { fixed: places.map((place) => frames.booked.get(place.id)?.at ?? null), open, close, homeward: day.endBase && day.hotelInboundMinutes !== null ? day.hotelInboundMinutes : 0, night: DAY_CLOCK.lastMinute }
          : undefined,
        // (As the search is told: a later start does not carry a daytime place past 17:00.)
        places.map((place) => !frames?.booked.has(place.id) && isDaytime(habitOf(place))),
      );
      if (schedule.noLunchRoom) timing.noLunchRoom.add(index);
      timing.dayStartTimes[index] = clock(schedule.start);
      if (schedule.lunchAt >= 0) {
        timing.lunchAfter.set(index, places[schedule.lunchAt].id);
        timing.durationOverrides[places[schedule.lunchAt].id] = stayOf(places[schedule.lunchAt]) + LUNCH_MINUTES;
      }
    });
    return timing;
  };
  /**
   * Everything that does not depend on looked-up street paths: the prices
   * of all pairs, the days, the order, lunch. It is the expensive part, and
   * street paths arrive in batches a second apart, so it is computed once
   * per trip and remembered.
   */
  const structure = (): Structure => {
    const pricing = priceTrip(input, rail, options.cities);
    const { journeys, transit, walking, walkAdvised, driving, legModeOverrides } = pricing.tables;
    // Which places share a day and in what order is decided on the priced
    // minutes alone (see day-search.ts).
    const without = excluded.size === 0 ? null : input.places.flatMap((place, index) => (excluded.has(place.id) ? [index] : []));
    const search = searchFor(input, pricing, frames);
    const trip = without ? search.choose(input.days, { without }) : search.choose(input.days);

    // The engine then builds exactly those days in exactly that order, so
    // every clock, leg and hotel ride in the booklet comes from one place.
    // Lunch takes an hour of the day: it is lent to the stay of the stop it
    // follows. A day that would wait at a restaurant's door starts later.
    const pins: Record<string, number> = {};
    const lockedOrderByDay: Record<number, string[]> = {};
    const timing: DayTiming = { lunchAfter: new Map(), durationOverrides: {}, dayStartTimes: {}, noLunchRoom: new Set() };
    const numbering = weatherNumbering(input, trip.days, frames);
    const slackFree = new Set<string>();
    for (const day of trip.days) {
      const places = day.order.map((stop) => input.places[stop]);
      if (frames) {
        places.forEach((place, position) => {
          if (frames.booked.has(place.id) && (position === 0 || frames.booked.has(places[position - 1].id))) slackFree.add(place.id);
        });
      }
      const dayNumber = numbering.dayFor.get(day.day) ?? day.day;
      lockedOrderByDay[dayNumber - 1] = places.map((place) => place.id);
      for (const place of places) pins[place.id] = dayNumber;
      timing.dayStartTimes[dayNumber - 1] = clock(day.start);
      if (day.noLunchRoom) timing.noLunchRoom.add(dayNumber - 1);
      if (day.lunchAt >= 0) {
        timing.lunchAfter.set(dayNumber - 1, places[day.lunchAt].id);
        timing.durationOverrides[places[day.lunchAt].id] = stayOf(places[day.lunchAt]) + LUNCH_MINUTES;
      }
    }
    const built = buildWithEngine(engineInput, {
      liveTransitMinutes: transit,
      liveWalkingMinutes: walking,
      liveDrivingMinutes: driving,
      legModeOverrides,
      dayOverrides: pins,
      lockedOrderByDay,
      durationOverrides: timing.durationOverrides,
      dayStartTimes: timing.dayStartTimes,
    }, trip.slots, frames, slackFree);
    return { built, journeys, transit, walking, walkAdvised, driving, pins, legModeOverrides, tables: pricing.tables, timing, weatherDays: numbering.wetDays, slackFree };
  };
  const cacheKey = structureKey(input, frames, excluded, options.cities);
  const shelf = structures.get(rail ?? NO_RAIL) ?? new Map<string, Structure>();
  structures.set(rail ?? NO_RAIL, shelf);
  let known = shelf.get(cacheKey);
  if (known) {
    // Most recently used last: the trip on screen is asked for again with
    // every batch of street paths and must outlive the variants tried
    // around it.
    shelf.delete(cacheKey);
    shelf.set(cacheKey, known);
  } else {
    known = structure();
    shelf.set(cacheKey, known);
    if (shelf.size > 120) shelf.delete(shelf.keys().next().value as string);
  }
  const { journeys, transit, walking, walkAdvised, driving, pins, legModeOverrides } = known;
  let built = known.built;
  let timing = known.timing;

  // What a map service measured for a leg — the walk up to Victoria Peak is
  // 87 minutes, not the 25 a straight line suggests — corrects that leg's
  // clock and its mode. It never reshuffles the trip: days and order stay as
  // planned above, so the booklet does not rearrange itself a moment after
  // it appears on screen. Lunch and the day's start do follow the corrected
  // clock: they are read off it again, so the lunch hour stays at lunchtime.
  if (Object.keys(measuredWalking).length + Object.keys(measuredDriving).length > 0) {
    const measuredTransit = { ...transit };
    // "No train helps, just walk" was priced as the walk plus a wait; it
    // follows the walk's real length.
    for (const [key, minutes] of Object.entries(measuredWalking)) {
      if (walkAdvised.has(key)) measuredTransit[key] = minutes + 8;
    }
    let held = legModeOverrides;
    const measured = (when: DayTiming) => buildWithEngine(engineInput, {
      dayOverrides: pins,
      legModeOverrides: held,
      lockedOrderByDay: orderOf(known.built.plan),
      durationOverrides: when.durationOverrides,
      dayStartTimes: when.dayStartTimes,
      liveTransitMinutes: measuredTransit,
      liveWalkingMinutes: { ...walking, ...measuredWalking },
      // A measured drive is held to the same rule as an estimated one: it
      // does not beat a train the traveller could simply take.
      liveDrivingMinutes: {
        ...driving,
        ...Object.fromEntries(Object.entries(measuredDriving).map(([key, minutes]) => {
          const journey = journeys.get(key);
          return [key, journey ? taxiAgainstTrain(minutes, journey.totalMinutes) : minutes];
        })),
      },
    }, known.built.usedDays, frames, known.slackFree);
    built = measured(timing);
    // A measured walk or drive is held to the same rules as an estimated
    // one: a long ride does not turn into a taxi across town, nor the
    // 87-minute climb into a taxi to the summit.
    const stray = strayLegs(built.plan, known.tables);
    if (stray.length > 0) {
      held = { ...held, ...Object.fromEntries(stray.map((key) => [key, "transit" as const])) };
      built = measured(timing);
    }
    const corrected = timingOf(built.plan);
    if (!sameTiming(corrected, timing)) {
      timing = corrected;
      built = measured(timing);
    }
  }
  const plan = built.plan;
  const lunchAfter = timing.lunchAfter;

  const legView = (from: RouteStop, to: RouteStop, engineLeg: BuiltPlanLeg | null, fallback: { mode: string | null; minutes: number | null }): ShioriLeg => {
    const recommended = engineLeg?.comparison.recommended ?? null;
    const engineMode = recommended?.mode ?? fallback.mode ?? "transit";
    const minutes = recommended?.minutes ?? fallback.minutes ?? 0;
    const journey = engineMode === "transit" ? journeys.get(routeLegKey(from.id, to.id)) ?? null : null;
    const mode: ShioriLeg["mode"] = engineMode === "walk" ? "walk" : engineMode === "taxi" ? "taxi" : journey ? "rail" : "transit";
    const travelMode = mode === "walk" ? "walking" : mode === "taxi" ? "driving" : "transit";
    const ends = [{ latitude: from.latitude, longitude: from.longitude }, { latitude: to.latitude, longitude: to.longitude }];
    const key = routeLegKey(from.id, to.id);
    // A walk follows its streets; a bus or taxi leg follows the road. Until
    // that path has been looked up the leg is a straight line and says so.
    const streetKey = `${mode === "walk" ? "walk" : "drive"}|${key}`;
    const street = journey ? null : routes.get(streetKey) ?? null;
    // Two places a few doors apart: the straight line is the way.
    const adjacent = Math.hypot(
      (from.latitude - to.latitude) * 111_000,
      (from.longitude - to.longitude) * 111_000 * Math.cos((from.latitude * Math.PI) / 180),
    ) < 90;
    return {
      key,
      from: ends[0],
      to: ends[1],
      mode,
      minutes,
      hasPath: Boolean(journey || street || adjacent),
      noPath: !journey && !street && !adjacent && routes.has(streetKey),
      rail: journey,
      ...(mode === "transit" && !journey && known.tables.noWalk.has(key) && walkAdvised.has(key) ? { climb: true as const } : {}),
      mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}&travelmode=${travelMode}`,
      // A routed path starts and ends on the nearest street; the line still
      // has to reach both pins.
      path: journey ? [ends[0], ...journey.rides.flatMap((ride) => ride.path), ends[1]] : street ? [ends[0], ...street.path, ends[1]] : ends,
      fromName: from.name,
      toName: to.name,
    };
  };

  const listedNames = input.places.map((place) => place.name);
  const keepDayNumbers = frames !== null || input.places.some((place) => typeof place.day === "number");
  const cities = options.cities ?? [];
  const days = plan.days.flatMap((day, index): ShioriDay[] => {
    if (day.stops.length === 0) return [];
    const lunchStopId = lunchAfter.get(index);
    const meals: ShioriDay["meals"] = [];
    const times = timeline(day);
    const stops = day.stops.flatMap((entry, stopIndex): ShioriStop[] => {
      const place = placeById.get(entry.stop.id);
      if (!place) return [];
      const lunchHere = entry.stop.id === lunchStopId;
      // The hour lent to this stop's stay is eaten after the visit — or, when
      // the visit alone runs past the last lunch seating, during it (see
      // dayClock): the stop is then printed with the hour in it.
      const visitOver = times[stopIndex].leave - (lunchHere ? LUNCH_MINUTES : 0);
      const lunchDuring = lunchHere && visitOver > DAY_CLOCK.meals.lunch.lastSeat;
      const leaveMinutes = lunchDuring ? times[stopIndex].leave : visitOver;
      if (lunchDuring) {
        const start = lunchDuringStart(times[stopIndex].arrive);
        meals.push({ kind: "lunch", afterStop: stopIndex, start: clock(start), end: clock(start + LUNCH_MINUTES), near: { latitude: place.lat, longitude: place.lon }, nearName: place.name, during: true, ...(start === times[stopIndex].arrive ? { onArrival: true as const } : {}) });
      } else if (lunchHere) {
        meals.push({ kind: "lunch", afterStop: stopIndex, start: clock(leaveMinutes), end: entry.departure, near: { latitude: place.lat, longitude: place.lon }, nearName: place.name, ...(leaveMinutes >= 1_440 ? { nextDay: true } : {}) });
      }
      // The engine holds a traveller at the door until the restaurant opens;
      // the booklet says how long that is instead of hiding it in the clock
      // — at the first stop as at any other, and only the wait itself, not
      // the ten minutes of slack every ride is given.
      const reached = stopIndex > 0
        ? times[stopIndex - 1].leave + (day.legs[stopIndex - 1]?.comparison.recommended.minutes ?? 0) + DAY_CLOCK.legBuffer
        : clockMinutes(day.startTime) + (day.startBase && day.hotelOutboundMinutes !== null ? day.hotelOutboundMinutes + DAY_CLOCK.legBuffer : 0);
      const waitMinutes = Math.max(0, times[stopIndex].arrive - reached);
      return [{
        place,
        arrive: entry.arrival,
        leave: clock(leaveMinutes),
        // From the minutes, not the printed clocks: 23:32 to 01:02 is an hour and a half.
        // The visit itself: a lunch hour inside it is the lunch row's, not the stay's.
        stayMinutes: visitOver - times[stopIndex].arrive,
        ...(lunchDuring ? { lunchMinutes: LUNCH_MINUTES } : {}),
        waitMinutes,
        mealMissed: Boolean(place.meal) && entry.openingStatus !== "verified_open",
        arriveNextDay: times[stopIndex].arrive >= 1_440,
        leaveNextDay: leaveMinutes >= 1_440,
        reserved: bookedIds.has(place.id),
        ...(!bookedIds.has(place.id) && habitOf(place) === "evening" ? { evening: true as const } : {}),
      }];
    });
    if (stops.length === 0) return [];
    // A stay that fills the day (a theme park of five hours or more) is a day
    // out with eating in it: when it runs across lunchtime and the day has no
    // other lunch, the lunch is listed during it, and no hour is added — its
    // hours already hold it. Not under a time the traveller booked.
    if (meals.length === 0 && !timing.noLunchRoom.has(index) && !stops.some((stop) => stop.place.meal === "lunch")) {
      const lastSeat = DAY_CLOCK.meals.lunch.lastSeat;
      const park = stops.findIndex((stop, stopIndex) => (
        !stop.place.meal && !stop.reserved && stop.stayMinutes >= DAY_FILLING_STAY
        && times[stopIndex].arrive <= LATE_LUNCH && times[stopIndex].leave > lastSeat
      ));
      if (park >= 0) {
        const start = lunchDuringStart(times[park].arrive);
        const place = stops[park].place;
        meals.push({ kind: "lunch", afterStop: park, start: clock(start), end: clock(start + LUNCH_MINUTES), near: { latitude: place.lat, longitude: place.lon }, nearName: place.name, during: true, ...(start === times[park].arrive ? { onArrival: true as const } : {}) });
      }
    }
    const lastPlace = stops.at(-1)!.place;
    // The day the traveller has to be done by a certain time is over by then: no dinner is suggested after it.
    const finish = frames && index === requested - 1 ? frames.finish : null;
    const legs = day.legs.map((leg) => legView(leg.from, leg.to, leg, { mode: null, minutes: null }));
    const first = day.stops[0].stop;
    const last = day.stops.at(-1)!.stop;
    const fromHotel = day.startBase && day.hotelOutboundMinutes !== null
      ? legView(day.startBase, first, null, { mode: day.hotelOutboundMode, minutes: day.hotelOutboundMinutes })
      : null;
    const toHotel = day.endBase && day.hotelInboundMinutes !== null
      ? legView(last, day.endBase, null, { mode: day.hotelInboundMode, minutes: day.hotelInboundMinutes })
      : null;
    // A day that ends at a place of the evening eats there: the dinner is during that visit, from the dinner
    // hour of the place (a night market is the dinner). Where that hour comes after the visit, as after any sight.
    const eveningDinner = stops.at(-1)!.evening ? Math.max(dinnerHourAt(lastPlace), times.at(-1)!.arrive) : null;
    if (eveningDinner !== null && eveningDinner < times.at(-1)!.leave && !stops.some((stop) => stop.place.meal === "dinner") && finish === null) {
      meals.push({ kind: "dinner", afterStop: stops.length - 1, start: clock(eveningDinner), end: null, near: { latitude: lastPlace.lat, longitude: lastPlace.lon }, nearName: lastPlace.name, during: true, ...(eveningDinner >= 1_440 ? { nextDay: true } : {}) });
    } else if (times.at(-1)!.leave >= 16 * 60 + 30 && !stops.some((stop) => stop.place.meal === "dinner") && finish === null) {
      const slot = dinnerSlot({
        lastLeave: times.at(-1)!.leave,
        lastPlace,
        hotel: input.hotel && toHotel ? { name: input.hotel.name, lat: input.hotel.lat, lon: input.hotel.lon, rideBack: toHotel.minutes } : null,
      });
      meals.push({
        kind: "dinner", afterStop: stops.length - 1, start: clock(slot.start), end: null, near: slot.near, nearName: slot.nearName,
        ...(slot.start >= 1_440 ? { nextDay: true } : {}),
        ...(slot.atHotel ? { atHotel: true as const } : {}),
      });
    }
    const allLegs = [...legs, ...(fromHotel ? [fromHotel] : []), ...(toHotel ? [toHotel] : [])];
    const walkMinutes = allLegs.reduce((sum, leg) => sum + (
      leg.mode === "walk" ? leg.minutes : leg.rail ? leg.rail.walkToMinutes + leg.rail.walkFromMinutes + leg.rail.transferMinutes : 0
    ), 0);
    const routePoints = stops.map((stop) => ({ latitude: stop.place.lat, longitude: stop.place.lon }));
    // A long gap before a chosen dinner is room for one more place, too.
    // (On a day with a finish, room means room before that finish and the ride back.)
    const dayCloses = finish === null ? clockMinutes(settings.dayEnd) : Math.min(clockMinutes(settings.dayEnd), finish - (toHotel?.minutes ?? 0));
    const endsEarly = times.at(-1)!.leave <= dayCloses - 120 || stops.some((stop) => stop.waitMinutes >= 120);
    const ideas = endsEarly && cities.length > 0
      ? bundledSightsNearRoute({ routePoints, excludedNames: listedNames, languageCode: input.locale, cities })
        .slice(0, 4)
        .flatMap((idea) => {
          const sight = cities.flatMap((city) => city.sights).find((candidate) => `wikidata-${candidate.q}` === idea.id);
          return sight ? [sight] : [];
        })
      : [];
    const names = stops.map((stop) => stop.place.name);
    const travelMinutes = allLegs.reduce((sum, leg) => sum + leg.minutes, 0);
    const late = dayLate(day, settings.dayEnd, dinnerIds, bookedIds);
    const span = times.at(-1)!.leave - times[0].arrive;
    // Tight: a day that runs late, or what the search itself calls a packed
    // day (day-search.ts: six places, eight hours of sightseeing, two and a
    // half hours or two long hauls between places — never a single visit,
    // never the rides to and from the hotel), or an hour and a half on foot.
    // The label and the way the days were split follow one rule.
    // (As the search counts them: a place of the evening closes the day like a dinner, unless its hour was booked.)
    const closes = (stop: ShioriStop) => stop.place.meal === "dinner" || stop.evening === true;
    const lastSight = stops.findLastIndex((stop) => !closes(stop));
    const packed = packedDay({
      stops: stops.length,
      sights: stops.filter((stop) => !closes(stop)).length,
      // (The idle time in front of a booked hour is not sightseeing.)
      span: times[Math.max(0, lastSight)].leave - times[0].arrive
        - stops.reduce((sum, stop, position) => sum + (stop.reserved && position >= 1 && position <= lastSight ? stop.waitMinutes : 0), 0),
      rides: legs.map((leg) => leg.minutes),
    });
    const load: ShioriDay["load"] = late || packed || (stops.length >= 2 && walkMinutes >= 90)
      ? "tight"
      : span <= 300 && travelMinutes <= 60 && stops.length <= 3 ? "easy" : "normal";
    // For a wet day: roofed places within about 2.5 km of this day's stops,
    // offered only when the day is mostly out of doors.
    const outdoors = stops.filter((stop) => OUTDOOR_KIND.test((stop.place.kind ?? "").toLowerCase())).length;
    const rainIdeas = outdoors * 2 >= stops.length && cities.length > 0
      ? cities.flatMap((city) => city.sights).filter((sight) => (
        INDOOR_KIND.test(sight.kind.toLowerCase())
        && !placeById.has(`wikidata-${sight.q}`)
        && !listedNames.includes(input.locale === "ja" ? sight.ja : sight.en)
        && routePoints.some((point) => Math.hypot((point.latitude - sight.lat) * 111, (point.longitude - sight.lon) * 111 * Math.cos((point.latitude * Math.PI) / 180)) <= 2.5)
      )).slice(0, 3)
      : [];
    return [{
      index,
      title: names.length <= 2 ? names.join("・") : `${names.slice(0, 2).join("・")} ${input.locale === "ja" ? "ほか" : "and more"}`,
      start: fromHotel ? day.startTime : stops[0].arrive,
      end: day.finishTime,
      stops,
      legs,
      fromHotel,
      toHotel,
      meals,
      walkMinutes,
      ideas,
      cafe: cafeBreakFor({ stops, legs, meals, spare: finish === null ? null : finish - (clockMinutes(day.startTime) + day.totalMinutes), noLunchRoom: timing.noLunchRoom.has(index) }),
      travelMinutes,
      load,
      rainIdeas,
      runsLate: dayLate(day, settings.dayEnd, dinnerIds, bookedIds),
      engineDay: index + 1,
      endsNextDay: clockMinutes(day.startTime) + day.totalMinutes >= 1_440,
      noLunchRoom: timing.noLunchRoom.has(index),
    }];
  // Empty days are not printed. The rest are numbered 1, 2, 3 — unless the
  // traveller pinned a place to a day: "Day 3" must then stay Day 3.
  }).map((day, position) => (keepDayNumbers ? day : { ...day, index: position }));

  const freeDays = Math.max(0, requested - days.length);
  const listed = new Set(input.places.map((place) => place.id));
  const centre = input.places.reduce((sum, place) => ({ lat: sum.lat + place.lat / input.places.length, lon: sum.lon + place.lon / input.places.length }), { lat: 0, lon: 0 });
  const home = cities
    .map((city) => ({ city, distance: Math.hypot(city.lat - centre.lat, (city.lon - centre.lon) * Math.cos(centre.lat * Math.PI / 180)) }))
    .sort((left, right) => left.distance - right.distance)[0];
  const freeDayIdeas = freeDays > 0 && home && home.distance * 111 <= home.city.radiusKm + 10
    ? home.city.sights.filter((sight) => !listed.has(`wikidata-${sight.q}`) && !listedNames.includes(input.locale === "ja" ? sight.ja : sight.en)).slice(0, 8)
    : [];

  const hotelContext = hotelRouteContextForDraft(plan);
  const scheduled = new Set(days.flatMap((day) => day.stops.map((stop) => stop.place.id)));
  return {
    days,
    freeDays,
    freeDayIdeas,
    leftOut: input.places.filter((place) => !scheduled.has(place.id)).map((place) => place.name),
    stayNear: hotelContext ? { latitude: hotelContext.latitude, longitude: hotelContext.longitude, routePoints: hotelContext.routePoints } : null,
    hotel: input.hotel,
    notices: known.weatherDays.length > 0 ? [{ kind: "weather-order", days: known.weatherDays }] : [],
    unplaced: [],
    overfull: [],
  };
}

/**
 * The plan when the traveller entered a time: a start on day 1, a finish on
 * the last day, a booking. One rule above all: a day that is printed breaks
 * none of them. Whatever cannot be placed without breaking one is set aside
 * and listed, with the reason — never shown at another time. Three layers,
 * each on its own:
 *
 *   1. What the numbers prove impossible whatever else is on the day (a
 *      booking on a day the trip does not have, before the day can start,
 *      past its finish, or clashing with another booking) is set aside
 *      before anything is planned. Only these are called "cannot".
 *   2. The search breaks an entered time only when it found no way not to;
 *      if it still does, places nobody booked are set aside — as few as
 *      can be: for a list short enough, every way of leaving places out is
 *      weighed (day-search.ts, keepMost). A trip with entered times lies on
 *      the calendar, so this covers its own midnight too: what would run
 *      into the next day is set aside, not printed at two in the morning.
 *   3. The booklet as built — after measured street paths have corrected
 *      its clocks — is read back against every entered time; a place is set
 *      aside and the booklet built again for as long as one is broken.
 */
function planFramed(input: ShioriInput, options: PlanOptions, frames: Frames): ShioriPlan {
  const rail = options.rail ?? null;
  const requested = requestedDays(input);
  const unplaced: ShioriUnplaced[] = [];
  const overfull: ShioriLeftOut[] = [];
  const excluded = new Set<string>();
  const setAside = (entry: ShioriUnplaced) => {
    unplaced.push(entry);
    excluded.add(entry.placeId);
  };
  // A one-day trip that may not start before it has to end: nothing is planned into it.
  if (requested === 1 && frames.start !== null && frames.finish !== null && frames.start >= frames.finish) {
    for (const place of input.places) setAside({ placeId: place.id, name: place.name, reason: "no-room", day: 1, edge: "finish", proven: false });
    // (Its one day is not a free day to fill: nothing can go on it.)
    return { ...planCore(input, options, frames, excluded), freeDays: 0, freeDayIdeas: [], unplaced, notices: [{ kind: "frame-order", start: clock(frames.start), finish: clock(frames.finish) }] };
  }
  if (input.places.length > 0) {
    const pricing = priceTrip(input, rail, options.cities);
    // 1. The bookings alone. A booked visit starts at its time and leaves a
    // stay later whatever else the day holds, so these checks — each booking
    // against the day's ends, neighbours on the clock against each other —
    // are exactly what it takes for a day's bookings to be kept together.
    // Between two entered times the ride alone has to fit: the ten minutes
    // of slack are the planner's habit and are given up there (day-search.ts).
    // What fails without any ride at all is proven; what fails on a ride is
    // an estimate that did not fit, and is said as that.
    const keptOn = new Map<number, Array<{ index: number; place: ShioriPlace; at: number; time: ShioriClock }>>();
    input.places.forEach((place, index) => {
      const booked = frames.booked.get(place.id);
      if (!booked) return;
      const about = { placeId: place.id, name: place.name, day: booked.day };
      if (booked.day > requested) {
        setAside({ ...about, reason: "reserve-day", days: requested, proven: true });
        return;
      }
      const start = booked.day === 1 ? frames.start : null;
      const rideOut = pricing.hotel ? pricing.hotel.out[index] : 0;
      if (booked.at < (start ?? 0) + rideOut) {
        setAside({ ...about, reason: "reserve-before-start", time: booked.time, start: start === null ? null : clock(start), rideMinutes: rideOut, earliest: clock((start ?? 0) + rideOut), proven: start !== null && booked.at < start });
        return;
      }
      const ends = booked.at + stayOf(place);
      const rideBack = pricing.hotel ? pricing.hotel.back[index] : 0;
      if (booked.day === requested && frames.finish !== null && ends + rideBack > frames.finish) {
        setAside({ ...about, reason: "reserve-after-finish", time: booked.time, ends: clock(ends), rideMinutes: rideBack, finish: clock(frames.finish), proven: ends > frames.finish });
        return;
      }
      // Of two bookings that cannot both be kept, the one higher in the list stays.
      const kept = keptOn.get(booked.day) ?? [];
      keptOn.set(booked.day, kept);
      const before = kept.filter((other) => other.at <= booked.at).sort((left, right) => right.at - left.at)[0];
      const after = kept.filter((other) => other.at > booked.at).sort((left, right) => left.at - right.at)[0];
      const self = { index, place, at: booked.at, time: booked.time };
      const between = (from: typeof self, to: typeof self) => {
        const stayEnds = from.at + stayOf(from.place);
        const ride = pricing.minutes[from.index][to.index];
        return stayEnds + ride > to.at ? { earlierId: from.place.id, stayEnds: clock(stayEnds), rideMinutes: ride, freeAt: clock(stayEnds + ride), proven: stayEnds > to.at } : null;
      };
      const clash = (before ? between(before, self) : null) ?? (after ? between(self, after) : null);
      if (clash) {
        const other = clash.earlierId === place.id ? after : before;
        setAside({ ...about, reason: "reserve-clash", time: booked.time, withId: other.place.id, withName: other.place.name, withTime: other.time, ...clash });
        return;
      }
      kept.push(self);
    });
    // 2. The search, until it breaks nothing.
    const search = searchFor(input, pricing, frames);
    const without = () => input.places.flatMap((place, index) => (excluded.has(place.id) ? [index] : []));
    const broken = (days: ReadonlyArray<{ late: number; hardOver: number }>) => days.some((day) => day.late > 0 || day.hardOver > 0);
    const lastHasFinish = (day: number) => day === requested && frames.finish !== null;
    if (excluded.size < input.places.length && broken(search.choose(input.days, { without: without() }).days)) {
      // Something has to give. First the exact answer, for a list short
      // enough to look at set by set: the fewest places set aside — every
      // way of leaving places out is weighed — and, among the sets of that
      // size, the one whose plan costs least. (When several hundred sets tie,
      // the sixteen that keep the places highest in the list are planned.)
      const most = search.keepMost(input.days, { without: without() });
      if (most && most.kept < most.of) {
        let best: { leaveOut: number[]; cost: number } | null = null;
        for (const leaveOut of most.leaveOut) {
          const days = search.choose(input.days, { without: [...without(), ...leaveOut] }).days;
          if (broken(days)) continue;
          const cost = days.reduce((sum, day) => sum + day.cost, 0);
          if (best === null || cost < best.cost - 1e-6) best = { leaveOut, cost };
        }
        if (best) {
          // Why: the finish, when everything would fit without it; else a
          // booking on the day the place is pinned to; else the days themselves.
          const finishOnly = frames.finish !== null && search.keepMost(input.days, { without: without(), ignoreFinish: true, atMost: 1 })?.kept === most.of;
          const bookedDays = new Set([...frames.booked.entries()].flatMap(([id, booked]) => (excluded.has(id) ? [] : [booked.day])));
          for (const index of best.leaveOut) {
            const place = input.places[index];
            const pin = typeof place.day === "number" && place.day >= 1 && place.day <= requested ? place.day : null;
            setAside(finishOnly
              ? { placeId: place.id, name: place.name, reason: "no-room", day: requested, edge: "finish", proven: false }
              : pin !== null && bookedDays.has(pin)
                ? { placeId: place.id, name: place.name, reason: "no-room", day: pin, edge: "reserve", proven: false }
                : { placeId: place.id, name: place.name, reason: "no-room", day: pin ?? (frames.finish !== null && frames.start === null ? requested : 1), edge: lastHasFinish(pin ?? 0) ? "finish" : "day", proven: false });
          }
        }
      }
    }
    // A list too long for that — or a plan the search still cannot keep —
    // is thinned one place at a time. Good, not proven fewest.
    const mark = unplaced.length;
    while (excluded.size < input.places.length) {
      const day = search.choose(input.days, { without: without() }).days.find((entry) => entry.late > 0 || entry.hardOver > 0);
      if (!day) break;
      const places = day.order.map((stop) => input.places[stop]);
      const bookedAt = places.map((place) => frames.booked.get(place.id)?.at ?? null);
      // The first booking reached late — or, when only the day's end is passed, the end of the day.
      const latePosition = day.late > 0 ? places.findIndex((_, position) => bookedAt[position] !== null && day.arrive[position] > bookedAt[position]!) : -1;
      const edge = latePosition >= 0 ? "reserve" as const : lastHasFinish(day.day) ? "finish" as const : "day" as const;
      // All that the day cannot hold goes at once, where the day is short
      // enough to know exactly what it can hold (see thinDay).
      const tooMany = search.thinDay(day.order, day.day, input.days);
      if (tooMany && tooMany.length > 0 && tooMany.every((stop) => !frames.booked.has(input.places[stop].id))) {
        for (const stop of tooMany) setAside({ placeId: input.places[stop].id, name: input.places[stop].name, reason: "no-room", day: day.day, edge, proven: false });
        continue;
      }
      // Places nobody booked go first: in front of the late booking the
      // nearest first, else from the end of the day backwards.
      const candidates = places.flatMap((_, position) => (bookedAt[position] === null && (latePosition < 0 || position < latePosition) ? [position] : [])).reverse();
      // The one whose absence lets every entered time be kept is the one set
      // aside; when no single place does that, the first, and the search goes
      // on. (On a long list each such question is a search of its own: the first goes.)
      const cure = input.places.length > 12 ? undefined : candidates.find((position) => !broken(search.choose(input.days, { without: [...without(), day.order[position]] }).days));
      const position = cure ?? candidates[0];
      if (position !== undefined) {
        setAside({ placeId: places[position].id, name: places[position].name, reason: "no-room", day: day.day, edge, proven: false });
        continue;
      }
      // Nothing but bookings in the way. (Not expected: the bookings alone were checked above.)
      const last = latePosition >= 0 ? latePosition : places.length - 1;
      const booked = frames.booked.get(places[last].id);
      setAside(latePosition >= 0 && booked
        ? { placeId: places[last].id, name: places[last].name, reason: "reserve-late", day: day.day, time: booked.time, proven: false }
        : { placeId: places[last].id, name: places[last].name, reason: "no-room", day: day.day, edge, proven: false });
    }
    // Places thinned out one at a time, the first of them while the day was
    // still far too full: one of those may fit again now that others are
    // gone. Each is tried, in the traveller's own order, and kept out only if
    // the trip cannot hold it.
    // (Up to sixteen places. Beyond that each try is a search of the whole
    // list, and what was taken off a day was all that day could not hold.)
    const listed = new Map(input.places.map((place, index) => [place.id, index]));
    for (const entry of input.places.length > 16 ? [] : unplaced.slice(mark).filter((candidate) => candidate.reason === "no-room").sort((left, right) => listed.get(left.placeId)! - listed.get(right.placeId)!)) {
      const others = without().filter((index) => input.places[index].id !== entry.placeId);
      if (broken(search.choose(input.days, { without: others }).days)) continue;
      excluded.delete(entry.placeId);
      unplaced.splice(unplaced.indexOf(entry), 1);
    }
    // With every entered time kept, the list may still be too full for its
    // days — sightseeing until ten at night. As on any trip, the set that
    // fits is planned and the rest listed (never a booked place).
    if (!input.packAnyway) {
      for (const index of leaveOutForRoom(input, pricing, search, frames, without())) {
        overfull.push({ placeId: input.places[index].id, name: input.places[index].name });
        excluded.add(input.places[index].id);
      }
    }
  }
  // 3. The booklet itself, read back.
  let plan = planCore(input, options, frames, excluded);
  for (let round = 0; round <= input.places.length; round += 1) {
    const victim = brokenInPrint(plan, input, frames, excluded);
    if (!victim) break;
    setAside(victim);
    plan = planCore(input, options, frames, excluded);
  }
  // A day with nothing on it is a free day only when the list does not need
  // it. Day 1 with a start, or the last day with a finish, may be empty for
  // another reason: the time leaves no use for it. Which it is, is asked of
  // the search — the same trip without that one time (bookings that cannot
  // be kept still set aside): when that trip puts places on the day, the day
  // is empty because of the time, and is said to be, not offered as free.
  const emptied: ShioriNotice[] = [];
  if (input.places.length > 0) {
    const printed = new Set(plan.days.map((day) => day.index + 1));
    const broken = new Set(unplaced.flatMap((entry) => (entry.reason === "no-room" ? [] : [entry.placeId])));
    const without = input.places.flatMap((place, index) => (broken.has(place.id) ? [index] : []));
    // (Day 1 without its start needs no search when nothing is pinned or
    // booked: the days of a trip are filled from day 1 on.)
    const anyPin = input.places.some((place, index) => !without.includes(index) && (frames.booked.has(place.id) || typeof place.day === "number"));
    const usedWithout = (edge: "start" | "finish", day: number) => {
      if (edge === "start" && !anyPin) return without.length < input.places.length;
      const other: Frames = { ...frames, [edge]: null };
      const rest = other.start === null && other.finish === null && other.booked.size === 0 ? null : other;
      return sideSearchFor(input, priceTrip(input, rail, options.cities), rest).choose(input.days, { without }).days.some((entry) => entry.day === day);
    };
    if (frames.start !== null && !printed.has(1) && usedWithout("start", 1)) emptied.push({ kind: "day-empty", day: 1, edge: "start", time: clock(frames.start) });
    // (A one-day trip's only day is named once.)
    if (frames.finish !== null && !printed.has(requested) && emptied.every((notice) => notice.kind !== "day-empty" || notice.day !== requested) && usedWithout("finish", requested)) {
      emptied.push({ kind: "day-empty", day: requested, edge: "finish", time: clock(frames.finish) });
    }
  }
  const freeDays = Math.max(0, plan.freeDays - emptied.length);
  return {
    ...plan,
    freeDays,
    freeDayIdeas: freeDays > 0 ? plan.freeDayIdeas : [],
    unplaced,
    overfull,
    notices: [...unplaced.map((entry): ShioriNotice => ({ kind: "unplaced", ...entry })), ...emptied, ...plan.notices],
  };
}

/**
 * Reads the booklet as printed against every time the traveller entered and
 * names the place to set aside for the first one that is broken, or null
 * when all are kept. It looks only at what is on the page — day, arrival,
 * start, end — so it holds whatever the search and the engine did.
 */
function brokenInPrint(plan: ShioriPlan, input: ShioriInput, frames: Frames, excluded: ReadonlySet<string>): ShioriUnplaced | null {
  const requested = requestedDays(input);
  for (const place of input.places) {
    const booked = frames.booked.get(place.id);
    if (!booked || excluded.has(place.id)) continue;
    const late: ShioriUnplaced = { placeId: place.id, name: place.name, reason: "reserve-late", day: booked.day, time: booked.time, proven: false };
    const day = plan.days.find((entry) => entry.stops.some((stop) => stop.place.id === place.id));
    if (!day) return late;
    const position = day.stops.findIndex((stop) => stop.place.id === place.id);
    const stop = day.stops[position];
    if (day.index === booked.day - 1 && stop.arrive === booked.time && !stop.arriveNextDay) continue;
    // What is in front of it is what made it late: the nearest place nobody booked goes.
    for (let before = position - 1; before >= 0 && day.index === booked.day - 1; before -= 1) {
      if (!day.stops[before].reserved) return { placeId: day.stops[before].place.id, name: day.stops[before].place.name, reason: "no-room", day: booked.day, edge: "reserve", proven: false };
    }
    return late;
  }
  const aside = (day: ShioriDay, stop: ShioriStop, edge: "finish" | "reserve" | "day"): ShioriUnplaced => ({ placeId: stop.place.id, name: stop.place.name, reason: "no-room", day: day.index + 1, edge, proven: false });
  if (frames.start !== null) {
    const first = plan.days.find((day) => day.index === 0);
    if (first && (clockMinutes(first.start) < frames.start || clockMinutes(first.stops[0].arrive) < frames.start)) {
      return aside(first, first.stops.find((stop) => !stop.reserved) ?? first.stops[0], "reserve");
    }
  }
  if (frames.finish !== null) {
    const last = plan.days.find((day) => day.index === requested - 1);
    if (last && (last.endsNextDay || clockMinutes(last.end) > frames.finish)) {
      return aside(last, last.stops.findLast((stop) => !stop.reserved) ?? last.stops.at(-1)!, "finish");
    }
  }
  // A day ends on its own date: nothing nobody booked runs past midnight.
  for (const day of plan.days) {
    const over = day.stops.findLast((stop) => !stop.reserved && stop.leaveNextDay);
    if (over) return aside(day, over, "day");
  }
  return null;
}

/** Minutes a day by which two places to stay are not told apart: the legs are estimates. */
const STAY_NEAR_SLACK_PER_DAY = 5;
/**
 * What a packed day weighs against minutes of moving when places to stay are
 * compared: an hour. Enough that a place does not win by squeezing the list
 * onto fewer, fuller days; not so much that a place two hours of riding
 * further out wins for sparing one.
 */
const STAY_NEAR_PACKED_DAY = 60;
/**
 * A point on the map where there is no bed: the top of a mountain, the
 * middle of an island or of a forest, a waterfall, a gorge, a cave — or
 * that is no point at all: a funicular or a cable-car line (小田急箱根鋼索線
 * was named as the area to stay around). (A man-made island, a castle on a
 * hill, a church in a cave and an observatory on a volcano are not that.)
 */
export function nobodySleepsAt(kind: string | undefined) {
  const lowered = (kind ?? "").toLowerCase();
  if (/artificial|observatory|church|temple|shrine|castle|museum|resort|village|town/.test(lowered)) return false;
  return /mountain|volcano|\bsummit\b|\bpeak\b|\bisland|\bislet\b|\batoll\b|\bforest\b|waterfall|\bcanyon\b|\bgorge\b|\bcave\b|funicular|^cable car$|ropeway|aerial tramway/.test(lowered);
}

function straightMinutes(from: GeoPoint, to: GeoPoint) {
  const stop = (point: GeoPoint) => ({ latitude: point.latitude, longitude: point.longitude }) as RouteStop;
  return estimateTravelOptions(stop(from), stop(to)).recommended.minutes;
}

/**
 * The trip as planned, plus where the traveller's wishes collide: too much
 * for the days, a hotel far from everything, a restaurant across town. Each
 * notice is backed by a second plan that was actually computed — "one more
 * day fits" is only said when the plan with one more day does fit.
 */
export function buildShioriPlan(input: ShioriInput, options: PlanOptions = {}): ShioriPlan {
  const plan = planOnce(input, options);
  if (plan.days.length === 0) return plan;
  const rail = options.rail ?? null;
  const notices: ShioriNotice[] = [];
  const requested = requestedDays(input);
  const frames = framesOf(input);
  // What the planner laid out: the list less what an entered time left no
  // room for. The hotel area is judged on that — a booking that cannot be
  // kept says nothing about where to stay.
  const aside = new Set([...plan.unplaced, ...plan.overfull].map((entry) => entry.placeId));
  const laid = aside.size > 0 ? { ...input, places: input.places.filter((place) => !aside.has(place.id)) } : input;
  const fits = (candidate: ShioriPlan) => candidate.leftOut.length === 0 && !candidate.days.some((day) => day.runsLate || day.stops.some((stop) => stop.mealMissed));
  /**
   * The search alone, no booklet built: enough to compare hotel areas. Where
   * to stay is a question of how far the days' places are from the door, not
   * of the hour day 1 starts or the last day ends, so the areas are compared
   * without those two — every area on the same terms, and at the price of an
   * ordinary trip instead of three (a day costs differently as day 1, as the
   * last day and in between, and each area tried is a search of its own).
   * Bookings stay: they decide which places share a day. (A day with one is
   * not a look-up; for an area that is only being compared, fewer orders are tried.)
   */
  const areaFrames = (trip: ShioriInput): Frames | null => {
    const entered = framesOf(trip);
    return entered && entered.booked.size > 0 ? { start: null, finish: null, booked: entered.booked } : null;
  };
  const searched = (trip: ShioriInput) => daySearch(searchProblem(trip, priceTrip(trip, rail, options.cities), areaFrames(trip)), frames ? { bookedDayStops: 4 } : {});
  const unkept = (days: ReturnType<ReturnType<typeof daySearch>["choose"]>["days"]) => days.filter((day) => day.overrun > 0 || day.missed > 0 || day.late > 0 || day.hardOver > 0).length;
  const runsLate = plan.days.some((day) => day.runsLate);
  // Left out because the list is too full, or by the engine — not by an entered time.
  const otherLeftOut = plan.leftOut.length > plan.unplaced.length;
  const overfull = plan.overfull.length > 0;
  // What more days, or one place fewer, could cure. A booking that clashes
  // with another, or cannot be reached in time, is cured by neither.
  const curable = (entry: ShioriUnplaced) => entry.reason === "no-room" || entry.reason === "reserve-day" || entry.reason === "reserve-after-finish";

  if (runsLate || otherLeftOut || plan.unplaced.some(curable)) {
    // No day holds more than its nine and a half hours of stays: fewer days than that are not worth planning.
    const least = Math.ceil(input.places.reduce((sum, place) => sum + (clockMeal(place) === "dinner" ? 0 : stayOf(place) + DAY_CLOCK.legBuffer), 0) / (DAY_CLOCK.sightsEnd - DAY_CLOCK.hotelStart + DAY_CLOCK.legBuffer));
    let found = false;
    // Never past the longest trip that can be kept: a length that cannot be
    // saved must not be offered.
    // A booking no number of days can keep — before the entered start,
    // clashing with another — is set aside at every length, and is said in
    // its own notice. "This many days hold it" is said of the rest: without
    // this, one such booking turned every too-full trip into "too much even
    // with more days", which is not so.
    const beyondDays = new Set(plan.unplaced.flatMap((entry) => (curable(entry) ? [] : [entry.placeId])));
    const holds = (candidate: ShioriPlan) => (beyondDays.size === 0 ? fits(candidate) : (
      candidate.leftOut.length === candidate.unplaced.length
      && candidate.unplaced.every((entry) => beyondDays.has(entry.placeId))
      && !candidate.days.some((day) => day.runsLate || day.stops.some((stop) => stop.mealMissed))
    ));
    for (let days = Math.max(requested + 1, least); days <= MAX_TRIP_DAYS && !found; days += 1) {
      // Said only if the plan the traveller would then get — the full one — fits.
      // (The whole list on that many days: what did not fit is not left out again to answer this.)
      if (holds(planOnce({ ...input, days, packAnyway: true }, options))) {
        // Where places were left out, the days that bring them back are said with their names.
        notices.push(overfull ? { kind: "left-out", places: plan.overfull, days } : { kind: "needs-days", days });
        found = true;
      }
    }
    if (overfull && !found) notices.push({ kind: "left-out", places: plan.overfull, days: null });
    // Leaving one place out: the places that cost the most — a long stay,
    // or far from the rest — first, since their absence is what saves a
    // day. On a short list every place is tried; on a long one the six
    // costliest. Whether the rest fits is first asked of the search alone
    // (free to regroup the days: a list a little over on two days fits
    // once any one place is gone, whichever day it was on); the one that
    // works is then planned for real before it is offered.
    const centre = input.places.reduce((sum, place) => ({ lat: sum.lat + place.lat / input.places.length, lon: sum.lon + place.lon / input.places.length }), { lat: 0, lon: 0 });
    // (A booked place is never the one to leave out: it is the one thing the traveller cannot move.)
    const costly = input.places
      .filter((place) => !place.meal && !frames?.booked.has(place.id))
      .map((place) => ({ place, cost: place.stayMinutes + 2 * straightMinutes({ latitude: centre.lat, longitude: centre.lon }, { latitude: place.lat, longitude: place.lon }) }))
      .sort((left, right) => right.cost - left.cost)
      .slice(0, input.places.length <= 12 ? input.places.length : 6);
    const pricing = priceTrip(input, rail, options.cities);
    const whole = searchFor(input, pricing, frames);
    // How far over the plan is, all its days together. A place whose stay
    // and longest rides in and out are well short of that cannot be the one
    // whose absence makes the list fit: it is not tried.
    const asPlanned = whole.choose(input.days).days;
    const over = asPlanned.reduce((sum, day) => sum + day.overrun, 0);
    const takes = (index: number) => stayOf(input.places[index]) + DAY_CLOCK.legBuffer
      + Math.max(pricing.hotel?.out[index] ?? 0, ...pricing.minutes.map((row) => row[index]))
      + Math.max(pricing.hotel?.back[index] ?? 0, ...pricing.minutes[index]);
    // (Where a booking itself cannot be kept, leaving out some other place cures nothing.)
    // (Nor where the planner has already left out what did not fit: the booklet shown is that plan.)
    const droppable = overfull || plan.unplaced.some((entry) => entry.reason !== "no-room") ? undefined : costly.find(({ place }) => {
      const without = { ...input, places: input.places.filter((entry) => entry.id !== place.id) };
      if (without.places.length === 0 || over > takes(input.places.indexOf(place)) + 30) return false;
      return unkept(whole.choose(input.days, { quick: true, without: input.places.indexOf(place) }).days) === 0 && fits(planOnce({ ...without, packAnyway: true }, options));
    });
    if (droppable) notices.push({ kind: "drop", placeId: droppable.place.id, name: droppable.place.name });
    // "Too much for the days" is said of a list, never of a booking that cannot be kept.
    if (!overfull && !found && !droppable && (runsLate || otherLeftOut || plan.unplaced.some((entry) => entry.reason === "no-room"))) notices.push({ kind: "too-much" });
    // Everything was planned because the traveller asked for it: what the
    // booklet would leave out for its days to be kept, so that the choice
    // can be taken back.
    if (input.packAnyway && runsLate) {
      const fitted = planOnce({ ...input, packAnyway: false }, options);
      if (fitted.overfull.length > 0) notices.push({ kind: "packed-anyway", places: fitted.overfull });
    }
  }

  for (const day of plan.days) {
    day.stops.forEach((stop, index) => {
      const meal = stop.place.meal;
      if (!meal) return;
      if (stop.mealMissed) {
        notices.push({ kind: "meal-time", placeId: stop.place.id, name: stop.place.name, meal });
        return;
      }
      // What the day would travel between its neighbours without this stop.
      const before = index > 0 ? day.legs[index - 1] : day.fromHotel;
      const after = index < day.stops.length - 1 ? day.legs[index] : day.toHotel;
      const direct = before && after ? straightMinutes(before.from, after.to) : 0;
      const detour = (before?.minutes ?? 0) + (after?.minutes ?? 0) - direct;
      if (detour >= 45) notices.push({ kind: "meal-detour", placeId: stop.place.id, name: stop.place.name, meal, minutes: Math.round(detour / 5) * 5 });
      if (meal === "dinner" && index === day.stops.length - 1 && day.toHotel && day.toHotel.minutes >= 45) {
        notices.push({ kind: "meal-hotel", placeId: stop.place.id, name: stop.place.name, minutes: day.toHotel.minutes });
      }
    });
  }

  // Where to stay: the listed place around which a hotel makes this trip
  // travel least door to door. Each candidate is the same list with the
  // hotel there, its days searched again and summed — not a midpoint of
  // coordinates, which lands in Central Park or the harbour and knows
  // nothing of train lines.
  //
  // The trip from each candidate is judged as the traveller would live it:
  // days that cannot be kept first, then the minutes moving with an hour
  // added for every packed day (STAY_NEAR_PACKED_DAY).
  // Without the packed days a place far out won: every day from there
  // costs a long way out and back, so the search put the list on fewer,
  // fuller days, and fewer days are fewer ways out and back — 高山寺, ten
  // kilometres from Kyoto, at 337 minutes on two packed days against 343
  // on three easy ones from 本能寺 in the centre.
  // With packed days counted before any number of minutes, a place far out
  // won the other way: 関渡宮 at the northern edge of Taipei, 539 minutes
  // moving and no day packed, over 国立中正文化中心 in the centre at 386
  // with one — two and a half hours of riding to spare one full day.
  let stayNear = plan.stayNear;
  if (plan.stayNear) {
    const count = laid.places.length;
    const dayOf = new Map(plan.days.flatMap((day) => day.stops.map((stop) => [stop.place.id, day.engineDay] as const)));
    const usedDays = Math.max(...plan.days.map((day) => day.engineDay));
    type Measure = { late: number; tight: number; travel: number; days: number };
    // (Ranked as the search ranks its own plans, to the minute: the grace is for what is said of a day, not for choosing between areas.)
    const sum = (days: ReturnType<ReturnType<typeof daySearch>["choose"]>["days"]): Measure => ({ late: days.filter((day) => day.pastHour > 0 || day.missed > 0 || day.late > 0 || day.hardOver > 0).length, tight: days.filter((day) => day.tight).length, travel: days.reduce((total, day) => total + day.travel, 0), days: days.length });
    // The days as planned, each in its best order from that hotel (cheap) …
    const kept = (hotel: ShioriHotel) => sum(searched({ ...laid, hotel }).keep(laid.places.map((place) => dayOf.get(place.id) ?? 1), usedDays, frames ? { quick: true, requested } : { quick: true }).days);
    // … and the trip planned afresh from that hotel, which changes which
    // places share a day. Short lists exactly as the booklet would plan
    // them; long ones with the lighter search.
    const planned = (hotel: ShioriHotel) => sum(searched({ ...laid, hotel }).choose(input.days, { quick: count > 10 }).days);
    const weight = (measure: Measure) => measure.travel + STAY_NEAR_PACKED_DAY * measure.tight;
    const less = (left: Measure, right: Measure) => left.late - right.late || weight(left) - weight(right);
    const seen = new Set<string>();
    const listed = laid.places.flatMap((place) => {
      const spot = `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
      if (seen.has(spot)) return [];
      seen.add(spot);
      return [{ name: place.name, lat: place.lat, lon: place.lon, kind: place.kind }];
    });
    // A summit, an island or a forest is a point nobody sleeps at; it is
    // named only when the list holds nothing else.
    const sleepable = listed.filter((place) => !nobodySleepsAt(place.kind));
    const candidates = (sleepable.length > 0 ? sleepable : listed).map(({ name, lat, lon }) => ({ name, lat, lon }));
    // Up to ten places every listed place is planned afresh, so the one
    // named really is the best of them. Beyond that the few best by the
    // cheap measure are; beyond 16 the cheap measure decides alone.
    const finalists = count <= 10
      ? candidates.map((hotel) => ({ hotel, measure: planned(hotel) }))
      : candidates.map((hotel) => ({ hotel, measure: kept(hotel) }))
        .sort((left, right) => less(left.measure, right.measure))
        .slice(0, count > 16 ? 1 : count > 12 ? 2 : 4)
        .map((candidate) => (count > 16 ? candidate : { hotel: candidate.hotel, measure: planned(candidate.hotel) }));
    const least = finalists.reduce((best, candidate) => (less(candidate.measure, best.measure) < 0 ? candidate : best));
    // The minutes are estimates, and five of them a day are not a reason to
    // sleep at the edge of the list: of the places that close to the least
    // (and no worse in days kept), the one in the middle of the
    // list — the least far, as the crow flies, from all the others.
    const spread = (hotel: ShioriHotel) => listed.reduce((total, place) => total + straightKm(hotel, place), 0);
    const winner = finalists
      .filter((candidate) => candidate.measure.late <= least.measure.late && weight(candidate.measure) <= weight(least.measure) + STAY_NEAR_SLACK_PER_DAY * least.measure.days)
      .reduce((best, candidate) => (spread(candidate.hotel) < spread(best.hotel) - 0.05 ? candidate : best), least);
    stayNear = { ...plan.stayNear, latitude: winner.hotel.lat, longitude: winner.hotel.lon, nearName: winner.hotel.name };
    // The traveller's own hotel against that: said when it costs twenty
    // minutes a day or more, and half an hour each way — or when it makes
    // two more days packed than the area named would: from a hotel far out
    // the search puts the list on fewer, fuller days to save the long way
    // out and back (Nara, hotel at the edge: two packed days until 18:50
    // and a day left empty, 29 minutes more moving than three easy days
    // from 唐招提寺), and the minutes alone then hide what the hotel costs.
    if (input.hotel) {
      const hotelLegs = plan.days.reduce((total, day) => total + (day.fromHotel?.minutes ?? 0) + (day.toHotel?.minutes ?? 0), 0);
      const oneWay = Math.round(hotelLegs / (plan.days.length * 2));
      const apart = Math.hypot((input.hotel.lat - winner.hotel.lat) * 111, (input.hotel.lon - winner.hotel.lon) * 111 * Math.cos((winner.hotel.lat * Math.PI) / 180));
      const mine = count > 16 ? kept(input.hotel) : planned(input.hotel);
      // Far is judged against the best any listed place gives; the minutes
      // said are what the area that is named saves in moving, and nothing
      // is said unless that is a real saving too.
      const saved = mine.travel - winner.measure.travel;
      // (Packed days as the booklet prints them, where the search of the area counts more.)
      const packed = Math.min(mine.tight, plan.days.filter((day) => day.load === "tight").length);
      const calmer = Math.max(0, packed - winner.measure.tight);
      const farByMinutes = saved > 0 && mine.travel - least.measure.travel >= 20 * plan.days.length;
      if (oneWay >= 30 && apart > 0.5 && winner.measure.late <= mine.late && (farByMinutes || (saved >= 20 && calmer >= 2))) {
        notices.push({ kind: "hotel-far", oneWayMinutes: oneWay, savedMinutes: Math.round(saved / 10) * 10, ...(calmer > 0 ? { calmerDays: calmer } : {}) });
      }
    }
  }
  // First what an entered time left no room for; last what the forecast
  // moved: that is something to know, not something to fix.
  const entered = (notice: ShioriNotice) => notice.kind === "unplaced" || notice.kind === "frame-order" || notice.kind === "day-empty";
  return { ...plan, stayNear, notices: [...plan.notices.filter(entered), ...notices, ...plan.notices.filter((notice) => !entered(notice))] };
}
