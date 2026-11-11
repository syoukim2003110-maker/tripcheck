import { bundledSightsNearRoute } from "../bundled-route-recommendations.ts";
import { destinationForCoordinate } from "../destinations.ts";
import type { PopularDestination, PopularSight } from "../popular-sights.ts";
import { RailNetwork, type GeoPoint, type RailJourney } from "../rail-router.ts";
import type { ResolvedInputStop, RouteStop } from "../route-optimizer.ts";
import { estimateTravelOptions } from "../time-feasibility.ts";
import { cafeBreakFor, type CafeBreak } from "./cafes.ts";
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
 * The planning engine answers "does this fit, and in what order"; this module
 * turns that answer into a booklet page per day — arrive, stay, how to get to
 * the next place — and decides the things the engine leaves to its caller:
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
  stayNear: { latitude: number; longitude: number; routePoints: GeoPoint[] } | null;
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
const LUNCH_MINUTES = 60;
/** A day with a dinner the traveller chose is meant to run into the evening. */
const DINNER_DAY_END = "21:30";
/** When a restaurant can be the meal: seated by 14:00 for lunch, from 17:30 for dinner. */
const MEAL_HOURS = {
  lunch: { openMinutes: 11 * 60 + 30, lastSeatMinutes: 14 * 60 },
  dinner: { openMinutes: 17 * 60 + 30, lastSeatMinutes: 20 * 60 },
} as const;

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

function dayLate(day: BuiltTripPlan["days"][number], dayEnd: string, dinnerIds: ReadonlySet<string>) {
  if (day.stops.length === 0) return false;
  // The engine's own overrun, not the printed clock: a day that runs past
  // midnight prints "02:30", which reads as early.
  const hasDinner = day.stops.some((stop) => dinnerIds.has(stop.stop.id));
  return day.deadlineOverrunMinutes > (hasDinner ? clockMinutes(DINNER_DAY_END) - clockMinutes(dayEnd) : 0);
}

function dayRunsLate(plan: BuiltTripPlan, dayEnd: string, dinnerIds: ReadonlySet<string>) {
  return plan.days.some((day) => dayLate(day, dayEnd, dinnerIds));
}

function dinnerIdsOf(input: ShioriInput) {
  return new Set(input.places.filter((place) => place.meal === "dinner").map((place) => place.id));
}

function hotelId(hotel: ShioriHotel) {
  return `shiori-hotel@${hotel.lat.toFixed(4)},${hotel.lon.toFixed(4)}`;
}

type Built = { plan: BuiltTripPlan; context: TripPlannerContext; raw: string; usedDays: number };

function buildWithEngine(input: ShioriInput, extra: Partial<TripPlannerContext>, usedDays: number): Built {
  const settings = paceSettings.standard;
  const stops = input.places.map(resolvedStop);
  const raw = stops.map((stop) => stop.input).join("\n");
  const base: ResolvedInputStop | null = input.hotel ? {
    // The id carries the position: a leg to another hotel is another leg,
    // and a street path looked up for the old one must not be reused.
    ...resolvedStop({ id: hotelId(input.hotel), name: input.hotel.name, lat: input.hotel.lat, lon: input.hotel.lon, stayMinutes: 15 }, 9_999),
    input: input.hotel.name,
    inputIndex: undefined,
    planningDurationMinutes: 0,
  } : null;
  const dayOverrides = Object.fromEntries(input.places.flatMap((place) => (
    typeof place.day === "number" && place.day >= 1 && place.day <= usedDays ? [[place.id, place.day] as const] : []
  )));
  const context: TripPlannerContext = {
    resolvedStops: stops,
    resolvedBase: base,
    ...(base ? { hotelQuery: base.input } : {}),
    defaultDayStart: DAY_START,
    dayEndTarget: settings.dayEnd,
    mealPlan: "all",
    // A restaurant is only a meal during the meal: the engine waits for it to
    // open and will not seat anyone after the kitchen's last order.
    openingWindowsByDay: Object.fromEntries(input.places.flatMap((place) => {
      if (!place.meal) return [];
      const hours = MEAL_HOURS[place.meal];
      const window = { openMinutes: hours.openMinutes, closeMinutes: hours.lastSeatMinutes + Math.max(15, Math.round(place.stayMinutes)) };
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

/**
 * The fewest days (up to the request) on which no day runs past the pace's
 * comfortable end. A traveller who asked for three days and listed one day's
 * worth of places gets one good day and two free ones, not three thin days.
 */
function chooseDays(input: ShioriInput, extra: Partial<TripPlannerContext>): Built {
  const requested = Math.max(1, Math.min(14, Math.round(input.days)));
  const pinned = input.places.reduce((maximum, place) => Math.max(maximum, typeof place.day === "number" ? place.day : 1), 1);
  const settings = paceSettings.standard;
  const dinnerIds = dinnerIdsOf(input);
  let last: Built | null = null;
  for (let days = Math.min(requested, pinned); days <= requested; days += 1) {
    last = buildWithEngine(input, extra, days);
    if (!dayRunsLate(last.plan, settings.dayEnd, dinnerIds)) return last;
  }
  return last ?? buildWithEngine(input, extra, requested);
}

type PlanOptions = {
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
  const mealOf = new Map(input.places.flatMap((place) => place.meal ? [[place.id, place.meal] as const] : []));
  const rail = options.rail ?? null;
  const journeys = new Map<string, RailJourney>();

  const routes = options.routes ?? new Map<string, ShioriRoute | null>();
  const walking: Record<string, number> = {};
  const walkAdvised = new Set<string>();
  const measuredWalking: Record<string, number> = {};
  const measuredDriving: Record<string, number> = {};
  for (const [routeKey, route] of routes) {
    if (!route || route.minutes === null) continue;
    if (routeKey.startsWith("walk|")) measuredWalking[routeKey.slice(5)] = route.minutes;
    else if (routeKey.startsWith("drive|")) measuredDriving[routeKey.slice(6)] = route.minutes;
  }
  /**
   * Prices every pair of places (and the hotel) with the bundled network
   * before anything is planned: a train journey becomes that pair's transit
   * time, "no train helps, just walk" its walking time. With every pair
   * known up front, whatever order the planning below settles on, each leg
   * in the booklet has its route — none is left as a bare estimate because
   * it only appeared in the last rebuild.
   */
  const transit: Record<string, number> = {};
  if (rail) {
    const points: RouteStop[] = [
      ...input.places.map(resolvedStop),
      ...(input.hotel ? [resolvedStop({ id: hotelId(input.hotel), name: input.hotel.name, lat: input.hotel.lat, lon: input.hotel.lon, stayMinutes: 15 }, 9_999)] : []),
    ];
    for (const from of points) {
      for (const to of points) {
        if (from.id === to.id) continue;
        const key = routeLegKey(from.id, to.id);
        const advice = rail.advise(from, to, input.locale);
        const estimate = estimateTravelOptions(from, to).options.find((option) => option.mode === "transit")?.minutes ?? null;
        if (advice.kind === "rail" && (estimate === null || advice.journey.totalMinutes <= estimate * 1.8 + 10)) {
          // A rail answer far slower than a typical transit estimate means the
          // real answer is a bus this data does not know; keep the estimate.
          journeys.set(key, advice.journey);
          transit[key] = advice.journey.totalMinutes;
        } else if (advice.kind === "walk") {
          walking[key] = advice.minutes;
          walkAdvised.add(key);
          transit[key] = advice.minutes + 8;
        }
      }
    }
  }

  // Which day each place is on, once the grouping below has improved on the
  // engine's. Empty means "as the engine decided".
  let pins: Record<string, number> = {};
  const durationOverrides: Record<string, number> = {};
  const legModeOverrides: Record<string, "transit"> = {};
  const orderOf = (plan: BuiltTripPlan) => Object.fromEntries(plan.days.flatMap((day, index) => (
    day.stops.length > 0 ? [[index, day.stops.map((stop) => stop.stop.id)] as const] : []
  )));
  /** One engine run with everything decided so far; `lock` keeps that plan's days and order. */
  const run = (days: number, lock?: BuiltTripPlan, more: Partial<TripPlannerContext> = {}) => buildWithEngine(input, {
    liveTransitMinutes: transit,
    liveWalkingMinutes: walking,
    durationOverrides,
    dayOverrides: pins,
    legModeOverrides,
    ...(lock ? { lockedOrderByDay: orderOf(lock) } : {}),
    ...more,
  }, days);

  let built = chooseDays(input, { liveTransitMinutes: transit, liveWalkingMinutes: walking });

  /**
   * What a plan costs a traveller, in minutes: every leg, the way out of and
   * back to the hotel, half of any time spent waiting for a restaurant, and
   * half of the gap between the longest and the shortest day (two even
   * days beat one crammed and one nearly empty). A day nobody can keep, or
   * a place left out, outweighs all of it.
   */
  const cost = (plan: BuiltTripPlan) => {
    const used = plan.days.filter((day) => day.stops.length > 0);
    const spans = used.map((day) => clockMinutes(day.stops.at(-1)!.departure) - clockMinutes(day.stops[0].arrival) + (day.deadlineOverrunMinutes > 0 ? day.deadlineOverrunMinutes : 0));
    const total = used.reduce((sum, day) => {
      const travel = day.legs.reduce((minutes, leg) => minutes + leg.comparison.recommended.minutes, 0)
        + (day.hotelOutboundMinutes ?? 0) + (day.hotelInboundMinutes ?? 0);
      const waiting = day.stops.reduce((minutes, stop, index) => {
        if (index === 0 || !mealOf.has(stop.stop.id)) return minutes;
        const gap = clockMinutes(stop.arrival) - clockMinutes(day.stops[index - 1].departure) - (day.legs[index - 1]?.comparison.recommended.minutes ?? 0);
        return minutes + Math.max(0, gap);
      }, 0);
      const missed = day.stops.filter((stop) => mealOf.has(stop.stop.id) && stop.openingStatus !== "verified_open").length;
      return sum + travel + waiting / 2 + (dayLate(day, settings.dayEnd, dinnerIds) ? 2000 : 0) + missed * 1000;
    }, 0);
    const scheduled = used.reduce((count, day) => count + day.stops.length, 0);
    return total + (spans.length > 1 ? (Math.max(...spans) - Math.min(...spans)) / 2 : 0) + (input.places.length - scheduled) * 5000;
  };
  const assignmentOf = (plan: BuiltTripPlan) => Object.fromEntries(plan.days.flatMap((day, index) => day.stops.map((stop) => [stop.stop.id, index + 1] as const)));
  /**
   * The engine groups places into days by balance as much as by distance,
   * and a restaurant's hours can pull a neighbourhood apart: Senso-ji on one
   * day and the Skytree, a 25-minute walk away, on the other. So each place
   * is tried on every other day that already has places, and two places on
   * different days are tried swapped; a change is kept when the whole trip
   * costs less. Bounded: each try is a full engine run.
   */
  const regroup = () => {
    const usedDays = built.plan.days.flatMap((day, index) => day.stops.length > 0 ? [index + 1] : []);
    if (usedDays.length < 2 || input.places.length > 16) return;
    let best = built;
    let bestCost = cost(best.plan);
    let tries = 0;
    const LIMIT = 160;
    const movable = (id: string) => typeof input.places.find((place) => place.id === id)?.day !== "number";
    for (let round = 0; round < 6 && tries < LIMIT; round += 1) {
      const current = assignmentOf(best.plan);
      const ids = Object.keys(current).filter(movable);
      const candidates: Array<Record<string, number>> = [];
      for (const id of ids) {
        // Never the last place of its day: that is a shorter trip, which is
        // the day count's decision, not this one's.
        if (Object.values(current).filter((day) => day === current[id]).length < 2) continue;
        for (const day of usedDays) if (day !== current[id]) candidates.push({ ...current, [id]: day });
      }
      for (let left = 0; left < ids.length; left += 1) {
        for (let right = left + 1; right < ids.length; right += 1) {
          if (current[ids[left]] !== current[ids[right]]) candidates.push({ ...current, [ids[left]]: current[ids[right]], [ids[right]]: current[ids[left]] });
        }
      }
      let improved: { built: Built; cost: number; pins: Record<string, number> } | null = null;
      for (const candidatePins of candidates) {
        if (tries >= LIMIT) break;
        tries += 1;
        const candidate = buildWithEngine(input, { liveTransitMinutes: transit, liveWalkingMinutes: walking, dayOverrides: candidatePins }, built.usedDays);
        const candidateCost = cost(candidate.plan);
        if (candidateCost < (improved?.cost ?? bestCost) - 5) improved = { built: candidate, cost: candidateCost, pins: candidatePins };
      }
      if (!improved) break;
      best = improved.built;
      bestCost = improved.cost;
      pins = improved.pins;
    }
    built = best;
  };
  regroup();

  // Lunch takes an hour of the day. It goes after the stop that ends nearest
  // 12:30 (within 11:00–14:30); a day that is one long visit, or over before
  // lunchtime, gets no lunch line. The hour is lent to that stop's stay, and
  // the day is rebuilt in the SAME order: left free, the engine reshuffles
  // around the longer stay and lunch ends up at 10:15 or on no day at all.
  const lunchAfter = new Map<number, string>();
  const stayOf = new Map(input.places.map((place) => [place.id, Math.max(15, Math.round(place.stayMinutes))]));
  const assignLunch = () => {
    lunchAfter.clear();
    for (const id of Object.keys(durationOverrides)) delete durationOverrides[id];
    built.plan.days.forEach((day, dayIndex) => {
      // A day with a restaurant chosen for lunch already has its lunch.
      if (day.stops.some((stop) => mealOf.get(stop.stop.id) === "lunch")) return;
      if (day.stops.length < 2 && clockMinutes(day.finishTime) > 15 * 60) return;
      const anchor = day.stops
        .map((stop) => ({ id: stop.stop.id, leave: clockMinutes(stop.departure) }))
        .filter((stop) => stop.leave >= 11 * 60 && stop.leave <= 14 * 60 + 30 && !mealOf.has(stop.id))
        .sort((left, right) => Math.abs(left.leave - 750) - Math.abs(right.leave - 750))[0];
      if (!anchor) return;
      lunchAfter.set(dayIndex, anchor.id);
      durationOverrides[anchor.id] = (stayOf.get(anchor.id) ?? 60) + LUNCH_MINUTES;
    });
    return lunchAfter.size > 0;
  };
  if (assignLunch()) {
    const withLunch = run(built.usedDays, built.plan);
    // Lunch can tip a full day past its end; one more day is better than a
    // day nobody can keep, when the traveller has one to give.
    if (dayRunsLate(withLunch.plan, settings.dayEnd, dinnerIds) && built.usedDays < Math.max(1, Math.min(14, Math.round(input.days)))) {
      // The grouping was made for the old number of days; the engine regroups
      // without lunch first, and lunch is placed again on what it decides.
      pins = {};
      lunchAfter.clear();
      for (const id of Object.keys(durationOverrides)) delete durationOverrides[id];
      built = run(built.usedDays + 1);
      regroup();
      if (assignLunch()) built = run(built.usedDays, built.plan);
    } else {
      built = withLunch;
    }
  }

  // Where the engine would send a traveller by taxi although the bundled
  // network has a train about as fast (it assumes thin rail in New York or
  // Sydney), the train is the plan.
  for (const day of built.plan.days) {
    for (const leg of day.legs) {
      const key = routeLegKey(leg.from.id, leg.to.id);
      const journey = journeys.get(key);
      if (journey && leg.comparison.recommended.mode === "taxi" && journey.totalMinutes <= leg.comparison.recommended.minutes + 15) legModeOverrides[key] = "transit";
    }
  }
  if (Object.keys(legModeOverrides).length > 0) built = run(built.usedDays, built.plan);

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
      liveDrivingMinutes: measuredDriving,
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
  const cities = options.cities ?? [];
  const days = plan.days.flatMap((day, index): ShioriDay[] => {
    if (day.stops.length === 0) return [];
    const lunchStopId = lunchAfter.get(index);
    const meals: ShioriDay["meals"] = [];
    const stops = day.stops.flatMap((entry, stopIndex): ShioriStop[] => {
      const place = placeById.get(entry.stop.id);
      if (!place) return [];
      const lunchHere = entry.stop.id === lunchStopId;
      const leaveMinutes = clockMinutes(entry.departure) - (lunchHere ? LUNCH_MINUTES : 0);
      if (lunchHere) {
        meals.push({ kind: "lunch", afterStop: stopIndex, start: clock(leaveMinutes), end: entry.departure, near: { latitude: place.lat, longitude: place.lon }, nearName: place.name });
      }
      // The engine holds a traveller at the door until the restaurant opens;
      // the booklet says how long that is instead of hiding it in the clock.
      const previous = day.stops[stopIndex - 1];
      const travel = previous ? day.legs[stopIndex - 1]?.comparison.recommended.minutes ?? 0 : 0;
      const waitMinutes = previous && place.meal ? Math.max(0, clockMinutes(entry.arrival) - clockMinutes(previous.departure) - travel) : 0;
      return [{
        place,
        arrive: entry.arrival,
        leave: clock(leaveMinutes),
        stayMinutes: leaveMinutes - clockMinutes(entry.arrival),
        waitMinutes: waitMinutes >= 20 ? waitMinutes : 0,
        mealMissed: Boolean(place.meal) && entry.openingStatus !== "verified_open",
      }];
    });
    if (stops.length === 0) return [];
    const lastPlace = stops.at(-1)!.place;
    if (clockMinutes(day.finishTime) >= 16 * 60 + 30 && !stops.some((stop) => stop.place.meal === "dinner")) {
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
    const endsEarly = clockMinutes(day.finishTime) <= clockMinutes(settings.dayEnd) - 120 || stops.some((stop) => stop.waitMinutes >= 120);
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
    const span = clockMinutes(stops.at(-1)!.leave) - clockMinutes(stops[0].arrive);
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
    }];
  }).map((day, position) => ({ ...day, index: position }));

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

  if (!fits(plan)) {
    let found = false;
    for (let days = requested + 1; days <= Math.min(7, requested + 2) && !found; days += 1) {
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
      .slice(0, 6);
    const droppable = costly.find(({ place }) => fits(planOnce({ ...input, places: input.places.filter((entry) => entry.id !== place.id) }, options)));
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

  if (input.hotel && plan.stayNear) {
    const hotelMinutes = (candidate: ShioriPlan) => candidate.days.reduce((sum, day) => sum + (day.fromHotel?.minutes ?? 0) + (day.toHotel?.minutes ?? 0), 0);
    const mine = hotelMinutes(plan);
    const oneWay = Math.round(mine / (plan.days.length * 2));
    if (oneWay >= 30) {
      const central = planOnce({ ...input, hotel: { name: input.hotel.name, lat: plan.stayNear.latitude, lon: plan.stayNear.longitude } }, options);
      const saved = mine - hotelMinutes(central);
      if (saved >= 20 * plan.days.length) notices.push({ kind: "hotel-far", oneWayMinutes: oneWay, savedMinutes: Math.round(saved / 10) * 10 });
    }
  }
  return { ...plan, notices };
}
