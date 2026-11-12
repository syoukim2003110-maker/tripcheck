import { bundledSightsNearRoute } from "../bundled-route-recommendations.ts";
import { destinationForCoordinate } from "../destinations.ts";
import type { PopularDestination, PopularSight } from "../popular-sights.ts";
import { RailNetwork, walkMinutes, type GeoPoint, type RailAdvice, type RailJourney } from "../rail-router.ts";
import type { ResolvedInputStop, RouteStop } from "../route-optimizer.ts";
import { estimateTravelOptions } from "../time-feasibility.ts";
import { cafeBreakFor, type CafeBreak } from "./cafes.ts";
import { DAY_CLOCK, daySearch, type SearchProblem } from "./day-search.ts";
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
};

export type ShioriHotel = { name: string; lat: number; lon: number };

export type ShioriInput = {
  places: ShioriPlace[];
  days: number;
  /** Kept for trips saved earlier; the booklet plans at the standard pace. */
  pace?: ShioriPace;
  hotel: ShioriHotel | null;
  locale: "ja" | "en";
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
  /** A maps link that opens this leg with live times. */
  mapsUrl: string;
  /** Points to draw: stations for a train leg, the two ends otherwise. */
  path: GeoPoint[];
  fromName: string;
  toName: string;
};

export type ShioriStop = {
  place: ShioriPlace;
  arrive: string;
  leave: string;
  stayMinutes: number;
  /** Idle minutes before this stop: a restaurant that is not serving yet. */
  waitMinutes: number;
  /** The restaurant could not be reached inside its meal hours on this day. */
  mealMissed: boolean;
  /**
   * The arrival / departure is after midnight, on the next calendar day. Only
   * a list far too long for its days gets there; the clock alone ("01:45")
   * cannot say so.
   */
  arriveNextDay: boolean;
  leaveNextDay: boolean;
};

/**
 * Where the traveller's own wishes pull against each other, each with the
 * way out the numbers support. This is what a list of places cannot show.
 */
export type ShioriNotice =
  /** The list does not fit the days asked for; it does in `days`. */
  | { kind: "needs-days"; days: number }
  /** It fits the days asked for once this one place is left out. */
  | { kind: "drop"; placeId: string; name: string }
  /** Neither one more day nor one place less is enough. */
  | { kind: "too-much" }
  /** The chosen hotel costs this much travel; the suggested area saves `savedMinutes` over the trip. */
  | { kind: "hotel-far"; oneWayMinutes: number; savedMinutes: number }
  /** Eating here adds this much travel to its day. */
  | { kind: "meal-detour"; placeId: string; name: string; meal: "lunch" | "dinner"; minutes: number }
  /** No day can reach this restaurant during the meal. */
  | { kind: "meal-time"; placeId: string; name: string; meal: "lunch" | "dinner" }
  /** The way back to the hotel after dinner here. */
  | { kind: "meal-hotel"; placeId: string; name: string; minutes: number };

export type ShioriMeal = { kind: "lunch" | "dinner"; start: string; end: string | null; near: GeoPoint; nearName: string };

export type ShioriDay = {
  index: number;
  title: string;
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
};

export type ShioriPlan = {
  days: ShioriDay[];
  /** Requested days the wishlist does not need. */
  freeDays: number;
  /** Ideas for the free days: the destination's best-known unlisted sights. */
  freeDayIdeas: PopularSight[];
  /** Places the engine could not schedule. */
  leftOut: string[];
  /** Where a hotel would make the whole trip travel least. */
  stayNear: { latitude: number; longitude: number; routePoints: GeoPoint[]; /** The listed place the area is around, when it is one. */ nearName?: string } | null;
  hotel: ShioriHotel | null;
  notices: ShioriNotice[];
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
 * How many minutes a day runs past what a traveller can keep. Sightseeing
 * ends by the day's end. A chosen dinner may run to 21:30 — the dinner, not
 * the day: the last sight before it still has to be over by the day's end.
 */
function overrunOf(day: EngineDay, dayEnd: string, dinnerIds: ReadonlySet<string>) {
  if (day.stops.length === 0) return 0;
  const times = timeline(day);
  const lastSight = day.stops.findLastIndex((stop) => !dinnerIds.has(stop.stop.id));
  // Sightseeing — not the ride back to the hotel — is what has to be over by
  // the day's end: the same nine hours with a hotel as without one.
  const sights = lastSight >= 0 ? times[lastSight].leave - clockMinutes(dayEnd) : 0;
  const hasDinner = lastSight < day.stops.length - 1;
  return Math.max(0, sights, hasDinner ? times.at(-1)!.leave - clockMinutes(DINNER_DAY_END) : 0);
}

function dayLate(day: EngineDay, dayEnd: string, dinnerIds: ReadonlySet<string>) {
  return overrunOf(day, dayEnd, dinnerIds) > 0;
}

function dinnerIdsOf(input: ShioriInput) {
  return new Set(input.places.filter((place) => place.meal === "dinner").map((place) => place.id));
}

/**
 * The taxi time to plan with on a leg that has a train. Someone reading a
 * trip booklet takes the train unless a taxi saves real time: up to 25
 * minutes slower, the train is the plan. The engine's own rule gives a train
 * 15 minutes of grace, so within that band the taxi is counted as no better
 * than the train less 14 — beyond it, the taxi's own time stands and wins.
 */
function taxiAgainstTrain(taxiMinutes: number, trainMinutes: number) {
  return trainMinutes <= taxiMinutes + 25 ? Math.max(taxiMinutes, trainMinutes - 14) : taxiMinutes;
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

function buildWithEngine(input: ShioriInput, extra: Partial<TripPlannerContext>, usedDays: number): Built {
  const settings = paceSettings.standard;
  const stops = input.places.map(resolvedStop);
  const raw = stops.map((stop) => stop.input).join("\n");
  const base = input.hotel ? hotelBase(input.hotel) : null;
  const dayOverrides = Object.fromEntries(input.places.flatMap((place) => (
    typeof place.day === "number" && place.day >= 1 && place.day <= usedDays ? [[place.id, place.day] as const] : []
  )));
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
      if (!place.meal) return [];
      const hours = DAY_CLOCK.meals[place.meal];
      const window = { openMinutes: hours.open, closeMinutes: hours.lastSeat + Math.max(15, Math.round(place.stayMinutes)) };
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
  durationOverrides: Record<string, number>;
  legModeOverrides: Record<string, "transit">;
  lunchAfter: Map<number, string>;
};
const NO_RAIL = {};
const structures = new WeakMap<object, Map<string, Structure>>();
function structureKey(input: ShioriInput, quick: boolean) {
  return JSON.stringify([
    input.places.map((place) => [place.id, place.lat, place.lon, place.stayMinutes, place.day ?? 0, place.meal ?? ""]),
    input.days,
    input.hotel ? [input.hotel.lat, input.hotel.lon] : 0,
    input.locale,
    quick,
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
  /** Pairs where the engine would take a taxi although a train is about as fast. */
  legModeOverrides: Record<string, "transit">;
};

/**
 * Prices one pair with the bundled network: a train journey becomes that
 * pair's transit time, "no train helps, just walk" its walking time.
 */
function priceLeg(tables: PriceTables, from: RouteStop, to: RouteStop, rail: RailNetwork | null, locale: "ja" | "en") {
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
  const bus = Math.ceil((12 + onFoot * 75 / 1.3 / 1_000 * 1.3 * 4.2) / 5) * 5;
  if (advice.kind === "rail" && advice.journey.totalMinutes <= bus + 10) {
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

type PlacePrices = { tables: PriceTables; minutes: number[][] };
const placePrices = new WeakMap<object, Map<string, PlacePrices>>();

/**
 * What every pair of places costs, in the minutes the booklet will print.
 * The tables are filled first; the minutes are then read back from the
 * engine itself, which decides between walking, the train and a taxi by
 * rules of its own — so the search and the printed plan can never disagree
 * about a leg.
 */
function pricePlaces(input: ShioriInput, rail: RailNetwork | null): PlacePrices {
  const shelf = placePrices.get(rail ?? NO_RAIL) ?? new Map<string, PlacePrices>();
  placePrices.set(rail ?? NO_RAIL, shelf);
  // Prices depend on where the places are, not on how long one stays. (The
  // same trip is priced again for every hotel area that is tried.)
  const cacheKey = JSON.stringify([input.locale, input.places.map((place) => [place.id, place.lat, place.lon])]);
  const known = shelf.get(cacheKey);
  if (known) return known;
  const stops = input.places.map(resolvedStop);
  const tables: PriceTables = { journeys: new Map(), transit: {}, walking: {}, walkAdvised: new Set(), driving: {}, legModeOverrides: {} };
  for (const from of stops) {
    for (const to of stops) if (from.id !== to.id) priceLeg(tables, from, to, rail, input.locale);
  }
  const engine = paceSettings.standard.engine;
  // The engine's rules depend on the country the whole list is in. Each
  // pair is read from a two-place run (the cheapest there is), told that
  // country, which one run with every place alone on its own day reports.
  const destination = buildTripFromWishlist(stops.map((stop) => stop.input).join("\n"), stops.length, engine, input.locale, {
    resolvedStops: stops,
    dayOverrides: Object.fromEntries(stops.map((stop, index) => [stop.id, index + 1])),
  }).destination;
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
    // Where the engine would send a traveller by taxi although the
    // bundled network has a train about as fast (it assumes thin rail in
    // New York or Sydney), the train is the plan — for every pair, before
    // anything is ordered, so the order is chosen on the minutes printed.
    const key = routeLegKey(from.id, to.id);
    const journey = tables.journeys.get(key);
    const train = leg.comparison.options.find((option) => option.mode === "transit");
    if (journey && train && leg.comparison.recommended.mode === "taxi" && journey.totalMinutes <= leg.comparison.recommended.minutes + 15) {
      tables.legModeOverrides[key] = "transit";
      return train.minutes;
    }
    return leg.comparison.recommended.minutes;
  }));
  const prices = { tables, minutes };
  shelf.set(cacheKey, prices);
  if (shelf.size > 12) shelf.delete(shelf.keys().next().value as string);
  return prices;
}

type TripPrices = PlacePrices & { hotel: { out: number[]; back: number[] } | null };

/** The places' prices plus, with a hotel, the way out of it and back to it from every place. */
function priceTrip(input: ShioriInput, rail: RailNetwork | null): TripPrices {
  const places = pricePlaces(input, rail);
  if (!input.hotel || input.places.length === 0) return { ...places, hotel: null };
  const stops = input.places.map(resolvedStop);
  const tables: PriceTables = {
    journeys: new Map(places.tables.journeys),
    transit: { ...places.tables.transit },
    walking: { ...places.tables.walking },
    walkAdvised: new Set(places.tables.walkAdvised),
    driving: { ...places.tables.driving },
    legModeOverrides: { ...places.tables.legModeOverrides },
  };
  // The engine renames the base "base-<id>"; priced under any other id,
  // the way out of and back to the hotel never finds its train.
  const door = resolvedStop({ id: `base-${hotelId(input.hotel)}`, name: input.hotel.name, lat: input.hotel.lat, lon: input.hotel.lon, stayMinutes: 15 }, 9_999);
  for (const stop of stops) {
    priceLeg(tables, door, stop, rail, input.locale);
    priceLeg(tables, stop, door, rail, input.locale);
  }
  const out = stops.map(() => 0);
  const back = stops.map(() => 0);
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
      // The same rule as between places: a train about as fast as the taxi is the plan.
      for (const [key, mode, legMinutes] of [
        [routeLegKey(door.id, stop.id), day.hotelOutboundMode, out[index]],
        [routeLegKey(stop.id, door.id), day.hotelInboundMode, back[index]],
      ] as const) {
        const journey = tables.journeys.get(key);
        if (journey && mode === "taxi" && !tables.legModeOverrides[key] && journey.totalMinutes <= legMinutes + 15) {
          tables.legModeOverrides[key] = "transit";
          changed = true;
        }
      }
    });
    return changed;
  };
  if (read()) read();
  return { tables, minutes: places.minutes, hotel: { out, back } };
}

function straightKm(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  return Math.hypot((from.lat - to.lat) * 111, (from.lon - to.lon) * 111 * Math.cos((from.lat * Math.PI) / 180));
}

/**
 * The minutes the planner works with, for tests that check its plans
 * against an exhaustive search: `minutes[from][to]` between places in list
 * order, and the hotel legs when there is a hotel.
 */
export function shioriPricing(input: ShioriInput, options: { rail?: RailNetwork | null } = {}) {
  const prices = priceTrip(input, options.rail ?? null);
  return { minutes: prices.minutes, fromHotel: prices.hotel?.out ?? null, toHotel: prices.hotel?.back ?? null, tables: prices.tables };
}

type PlanOptions = {
  /** A variant that only has to be close (does it fit? is this hotel area better?): a lighter search. */
  quick?: boolean;
  /** Keep this grouping (place id → 1-based day) and only order each day. */
  seed?: { pins: Record<string, number>; days: number };
  rail?: RailNetwork | null;
  cities?: readonly PopularDestination[];
  /** Street paths already looked up, keyed "walk|<leg key>" / "drive|<leg key>". */
  routes?: ReadonlyMap<string, ShioriRoute | null>;
};

function planOnce(input: ShioriInput, options: PlanOptions): ShioriPlan {
  if (input.places.length === 0) {
    return { days: [], freeDays: Math.max(0, input.days), freeDayIdeas: [], leftOut: [], stayNear: null, hotel: input.hotel, notices: [] };
  }
  const settings = paceSettings.standard;
  const dinnerIds = dinnerIdsOf(input);
  const rail = options.rail ?? null;

  const routes = options.routes ?? new Map<string, ShioriRoute | null>();
  const measuredWalking: Record<string, number> = {};
  const measuredDriving: Record<string, number> = {};
  for (const [routeKey, route] of routes) {
    if (!route || route.minutes === null) continue;
    if (routeKey.startsWith("walk|")) measuredWalking[routeKey.slice(5)] = route.minutes;
    else if (routeKey.startsWith("drive|")) measuredDriving[routeKey.slice(6)] = route.minutes;
  }
  /**
   * Everything that does not depend on looked-up street paths: the prices
   * of all pairs, the days, the order, lunch. It is the expensive part, and
   * street paths arrive in batches a second apart, so it is computed once
   * per trip and remembered.
   */
  const structure = (): Structure => {
    const pricing = priceTrip(input, rail);
    const { journeys, transit, walking, walkAdvised, driving, legModeOverrides } = pricing.tables;
    const stayOf = (place: ShioriPlace) => Math.max(15, Math.round(place.stayMinutes));
    const problem: SearchProblem = {
      stops: input.places.map((place) => ({ stay: stayOf(place), meal: place.meal ?? null, day: typeof place.day === "number" ? place.day : null })),
      minutes: pricing.minutes,
      km: input.places.map((from) => input.places.map((to) => straightKm(from, to))),
      hotel: pricing.hotel && input.hotel ? { ...pricing.hotel, km: input.places.map((place) => straightKm(place, input.hotel!)) } : null,
    };
    // Which places share a day and in what order is decided on the priced
    // minutes alone (see day-search.ts). A seeded variant keeps another
    // plan's grouping and only orders each day.
    const search = daySearch(problem);
    const trip = options.seed
      ? search.keep(input.places.map((place) => options.seed!.pins[place.id] ?? 1), options.seed.days)
      : search.choose(input.days, { quick: options.quick });

    // The engine then builds exactly those days in exactly that order, so
    // every clock, leg and hotel ride in the booklet comes from one place.
    // Lunch takes an hour of the day: it is lent to the stay of the stop it
    // follows.
    const pins: Record<string, number> = {};
    const lockedOrderByDay: Record<number, string[]> = {};
    const durationOverrides: Record<string, number> = {};
    const lunchAfter = new Map<number, string>();
    for (const day of trip.days) {
      const places = day.order.map((stop) => input.places[stop]);
      lockedOrderByDay[day.day - 1] = places.map((place) => place.id);
      for (const place of places) pins[place.id] = day.day;
      if (day.lunchAt >= 0) {
        lunchAfter.set(day.day - 1, places[day.lunchAt].id);
        durationOverrides[places[day.lunchAt].id] = stayOf(places[day.lunchAt]) + LUNCH_MINUTES;
      }
    }
    const built = buildWithEngine(input, {
      liveTransitMinutes: transit,
      liveWalkingMinutes: walking,
      liveDrivingMinutes: driving,
      legModeOverrides,
      dayOverrides: pins,
      lockedOrderByDay,
      durationOverrides,
    }, trip.slots);
    return { built, journeys, transit, walking, walkAdvised, driving, pins, durationOverrides, legModeOverrides, lunchAfter };
  };
  const cacheKey = `${structureKey(input, Boolean(options.quick))}|${options.seed ? JSON.stringify(options.seed) : ""}`;
  const shelf = structures.get(rail ?? NO_RAIL) ?? new Map<string, Structure>();
  structures.set(rail ?? NO_RAIL, shelf);
  let known = shelf.get(cacheKey);
  if (known) {
    // Most recently used last: the trip on screen is asked for again with
    // every batch of street paths and must outlive the variants tried
    // around it (one per candidate hotel area alone).
    shelf.delete(cacheKey);
    shelf.set(cacheKey, known);
  } else {
    known = structure();
    shelf.set(cacheKey, known);
    if (shelf.size > 120) shelf.delete(shelf.keys().next().value as string);
  }
  const { journeys, transit, walking, walkAdvised, driving, pins, durationOverrides, legModeOverrides, lunchAfter } = known;
  let built = known.built;
  const run = (days: number, lock: BuiltTripPlan, more: Partial<TripPlannerContext>) => buildWithEngine(input, {
    durationOverrides,
    dayOverrides: pins,
    legModeOverrides,
    lockedOrderByDay: orderOf(lock),
    ...more,
  }, days);

  // What a map service measured for a leg — the walk up to Victoria Peak is
  // 87 minutes, not the 25 a straight line suggests — corrects that leg's
  // clock and its mode. It never reshuffles the trip: days and order stay as
  // planned above, so the booklet does not rearrange itself a moment after
  // it appears on screen.
  if (Object.keys(measuredWalking).length + Object.keys(measuredDriving).length > 0) {
    const measuredTransit = { ...transit };
    // "No train helps, just walk" was priced as the walk plus a wait; it
    // follows the walk's real length.
    for (const [key, minutes] of Object.entries(measuredWalking)) {
      if (walkAdvised.has(key)) measuredTransit[key] = minutes + 8;
    }
    built = run(built.usedDays, built.plan, {
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
    });
  }
  const plan = built.plan;

  const placeById = new Map(input.places.map((place) => [place.id, place]));
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
      mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}&travelmode=${travelMode}`,
      // A routed path starts and ends on the nearest street; the line still
      // has to reach both pins.
      path: journey ? [ends[0], ...journey.rides.flatMap((ride) => ride.path), ends[1]] : street ? [ends[0], ...street.path, ends[1]] : ends,
      fromName: from.name,
      toName: to.name,
    };
  };

  const listedNames = input.places.map((place) => place.name);
  const keepDayNumbers = input.places.some((place) => typeof place.day === "number");
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
      const leaveMinutes = times[stopIndex].leave - (lunchHere ? LUNCH_MINUTES : 0);
      if (lunchHere) {
        meals.push({ kind: "lunch", afterStop: stopIndex, start: clock(leaveMinutes), end: entry.departure, near: { latitude: place.lat, longitude: place.lon }, nearName: place.name });
      }
      // The engine holds a traveller at the door until the restaurant opens;
      // the booklet says how long that is instead of hiding it in the clock.
      const travel = stopIndex > 0 ? day.legs[stopIndex - 1]?.comparison.recommended.minutes ?? 0 : 0;
      const waitMinutes = stopIndex > 0 && place.meal ? Math.max(0, times[stopIndex].arrive - times[stopIndex - 1].leave - travel) : 0;
      return [{
        place,
        arrive: entry.arrival,
        leave: clock(leaveMinutes),
        // From the minutes, not the printed clocks: 23:32 to 01:02 is an hour and a half.
        stayMinutes: leaveMinutes - times[stopIndex].arrive,
        waitMinutes: waitMinutes >= 20 ? waitMinutes : 0,
        mealMissed: Boolean(place.meal) && entry.openingStatus !== "verified_open",
        arriveNextDay: times[stopIndex].arrive >= 1_440,
        leaveNextDay: leaveMinutes >= 1_440,
      }];
    });
    if (stops.length === 0) return [];
    const lastPlace = stops.at(-1)!.place;
    if (times.at(-1)!.leave >= 16 * 60 + 30 && !stops.some((stop) => stop.place.meal === "dinner")) {
      meals.push({ kind: "dinner", afterStop: stops.length - 1, start: stops.at(-1)!.leave, end: null, near: { latitude: lastPlace.lat, longitude: lastPlace.lon }, nearName: lastPlace.name });
    }
    const legs = day.legs.map((leg) => legView(leg.from, leg.to, leg, { mode: null, minutes: null }));
    const first = day.stops[0].stop;
    const last = day.stops.at(-1)!.stop;
    const fromHotel = day.startBase && day.hotelOutboundMinutes !== null
      ? legView(day.startBase, first, null, { mode: day.hotelOutboundMode, minutes: day.hotelOutboundMinutes })
      : null;
    const toHotel = day.endBase && day.hotelInboundMinutes !== null
      ? legView(last, day.endBase, null, { mode: day.hotelInboundMode, minutes: day.hotelInboundMinutes })
      : null;
    const allLegs = [...legs, ...(fromHotel ? [fromHotel] : []), ...(toHotel ? [toHotel] : [])];
    const walkMinutes = allLegs.reduce((sum, leg) => sum + (
      leg.mode === "walk" ? leg.minutes : leg.rail ? leg.rail.walkToMinutes + leg.rail.walkFromMinutes + leg.rail.transferMinutes : 0
    ), 0);
    const routePoints = stops.map((stop) => ({ latitude: stop.place.lat, longitude: stop.place.lon }));
    // A long gap before a chosen dinner is room for one more place, too.
    const endsEarly = times.at(-1)!.leave <= clockMinutes(settings.dayEnd) - 120 || stops.some((stop) => stop.waitMinutes >= 120);
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
    const late = dayLate(day, settings.dayEnd, dinnerIds);
    const span = times.at(-1)!.leave - times[0].arrive;
    const longLegs = allLegs.filter((leg) => leg.minutes >= 45).length;
    // Tight: the things people say ruined a day — over two and a half hours
    // in transit, an hour and a half on foot, six places, two long hauls.
    const load: ShioriDay["load"] = late || travelMinutes >= 150 || walkMinutes >= 90 || stops.length >= 6 || longLegs >= 2
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
      cafe: cafeBreakFor({ stops, legs, meals }),
      travelMinutes,
      load,
      rainIdeas,
      runsLate: dayLate(day, settings.dayEnd, dinnerIds),
      engineDay: index + 1,
      endsNextDay: clockMinutes(day.startTime) + day.totalMinutes >= 1_440,
    }];
  // Empty days are not printed. The rest are numbered 1, 2, 3 — unless the
  // traveller pinned a place to a day: "Day 3" must then stay Day 3.
  }).map((day, position) => (keepDayNumbers ? day : { ...day, index: position }));

  const requested = Math.max(1, Math.min(14, Math.round(input.days)));
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
    notices: [],
  };
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
  const notices: ShioriNotice[] = [];
  const requested = Math.max(1, Math.min(14, Math.round(input.days)));
  const fits = (candidate: ShioriPlan) => candidate.leftOut.length === 0 && !candidate.days.some((day) => day.runsLate);

  // "Would it fit?" does not need the full search over groupings, only a plan.
  const quick = { ...options, quick: true };
  const grouping = Object.fromEntries(plan.days.flatMap((day) => day.stops.map((stop) => [stop.place.id, day.engineDay] as const)));
  const usedDays = Math.max(...plan.days.map((day) => day.engineDay));
  if (!fits(plan)) {
    let found = false;
    for (let days = requested + 1; days <= Math.min(7, requested + 2) && !found; days += 1) {
      // Said only if the plan the traveller would then get — the full one — fits.
      if (fits(planOnce({ ...input, days }, options))) {
        notices.push({ kind: "needs-days", days });
        found = true;
      }
    }
    // The places that cost the most — a long stay, or far from the rest —
    // are the ones whose absence can save a day.
    const centre = input.places.reduce((sum, place) => ({ lat: sum.lat + place.lat / input.places.length, lon: sum.lon + place.lon / input.places.length }), { lat: 0, lon: 0 });
    const costly = input.places
      .filter((place) => !place.meal)
      .map((place) => ({ place, cost: place.stayMinutes + 2 * straightMinutes({ latitude: centre.lat, longitude: centre.lon }, { latitude: place.lat, longitude: place.lon }) }))
      .sort((left, right) => right.cost - left.cost)
      .slice(0, 4);
    // Tried first with everything else left on the day it is on (cheap);
    // the one that works is then planned for real before it is offered.
    const droppable = costly.find(({ place }) => {
      const without = { ...input, places: input.places.filter((entry) => entry.id !== place.id) };
      const kept = Object.fromEntries(Object.entries(grouping).filter(([id]) => id !== place.id));
      return fits(planOnce(without, { ...quick, seed: { pins: kept, days: usedDays } })) && fits(planOnce(without, options));
    });
    if (droppable) notices.push({ kind: "drop", placeId: droppable.place.id, name: droppable.place.name });
    if (!found && !droppable) notices.push({ kind: "too-much" });
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

  // Where to stay: the listed place around which a hotel makes this very
  // plan travel least. Each candidate is the same days and places with the
  // hotel there, planned and summed — not a midpoint of coordinates, which
  // lands in Central Park or the harbour and knows nothing of train lines.
  let stayNear = plan.stayNear;
  const travelOf = (candidate: ShioriPlan) => candidate.days.reduce((sum, day) => sum + day.travelMinutes, 0);
  const lateOf = (candidate: ShioriPlan) => candidate.days.filter((day) => day.runsLate).length;
  if (plan.stayNear) {
    // Short lists are re-planned exactly as the booklet would plan them;
    // long ones with the lighter search.
    const thorough = input.places.length <= 10 ? { ...options, routes: undefined } : { ...quick, routes: undefined };
    const withHotelAt = (name: string, lat: number, lon: number) => planOnce({ ...input, hotel: { name, lat, lon } }, { ...quick, routes: undefined, seed: { pins: grouping, days: usedDays } });
    const candidates = [
      { name: null as string | null, lat: plan.stayNear.latitude, lon: plan.stayNear.longitude },
      ...input.places.map((place) => ({ name: place.name as string | null, lat: place.lat, lon: place.lon })),
    ].map((candidate) => ({ ...candidate, plan: withHotelAt(candidate.name ?? "", candidate.lat, candidate.lon) }))
      .filter((candidate) => candidate.plan.leftOut.length === 0);
    const fewestLate = Math.min(...candidates.map((candidate) => lateOf(candidate.plan)));
    // The few best by that quick measure are then planned for real — a
    // hotel changes which places go on which day — and the least travel of
    // those wins.
    const finalists = candidates
      .filter((candidate) => lateOf(candidate.plan) === fewestLate)
      .sort((left, right) => travelOf(left.plan) - travelOf(right.plan))
      .slice(0, input.places.length > 16 ? 1 : input.places.length > 12 ? 2 : input.places.length > 10 ? 4 : 6)
      // (Beyond 16 places the quick measure decides alone.)
      .map((candidate) => (input.places.length > 16 ? candidate : { ...candidate, plan: planOnce({ ...input, hotel: { name: candidate.name ?? "", lat: candidate.lat, lon: candidate.lon } }, thorough) }))
      .filter((candidate) => candidate.plan.leftOut.length === 0);
    const leastLate = Math.min(...finalists.map((candidate) => lateOf(candidate.plan)));
    const winner = finalists
      .filter((candidate) => lateOf(candidate.plan) === leastLate)
      .sort((left, right) => travelOf(left.plan) - travelOf(right.plan))[0];
    if (winner) {
      stayNear = { ...plan.stayNear, latitude: winner.lat, longitude: winner.lon, ...(winner.name ? { nearName: winner.name } : {}) };
      // The traveller's own hotel against that: said when it costs twenty
      // minutes a day or more, and half an hour each way.
      if (input.hotel) {
        const hotelLegs = plan.days.reduce((sum, day) => sum + (day.fromHotel?.minutes ?? 0) + (day.toHotel?.minutes ?? 0), 0);
        const oneWay = Math.round(hotelLegs / (plan.days.length * 2));
        const apart = Math.hypot((input.hotel.lat - winner.lat) * 111, (input.hotel.lon - winner.lon) * 111 * Math.cos((winner.lat * Math.PI) / 180));
        const mine = input.places.length > 16 ? withHotelAt(input.hotel.name, input.hotel.lat, input.hotel.lon) : planOnce(input, thorough);
        const saved = travelOf(mine) - travelOf(winner.plan);
        if (oneWay >= 30 && apart > 0.5 && saved >= 20 * plan.days.length && lateOf(winner.plan) <= lateOf(mine)) {
          notices.push({ kind: "hotel-far", oneWayMinutes: oneWay, savedMinutes: Math.round(saved / 10) * 10 });
        }
      }
    }
  }
  return { ...plan, stayNear, notices };
}
