import { bundledSightsNearRoute } from "../bundled-route-recommendations.ts";
import { destinationForCoordinate } from "../destinations.ts";
import type { PopularDestination, PopularSight } from "../popular-sights.ts";
import { RailNetwork, type GeoPoint, type RailJourney } from "../rail-router.ts";
import type { ResolvedInputStop, RouteStop } from "../route-optimizer.ts";
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
};

export type ShioriHotel = { name: string; lat: number; lon: number };

export type ShioriInput = {
  places: ShioriPlace[];
  days: number;
  pace: ShioriPace;
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
};

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
};

const paceSettings: Record<ShioriPace, { engine: Pace; dayEnd: string }> = {
  relaxed: { engine: "relaxed", dayEnd: "16:30" },
  standard: { engine: "balanced", dayEnd: "18:00" },
  packed: { engine: "fast", dayEnd: "20:00" },
};
const DAY_START = "09:00";
const LUNCH_MINUTES = 60;

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

function dayRunsLate(plan: BuiltTripPlan, dayEnd: string) {
  return plan.days.some((day) => day.stops.length > 0 && (
    day.deadlineOverrunMinutes > 0 || clockMinutes(day.finishTime) > clockMinutes(dayEnd)
  ));
}

type Built = { plan: BuiltTripPlan; context: TripPlannerContext; raw: string; usedDays: number };

function buildWithEngine(input: ShioriInput, extra: Partial<TripPlannerContext>, usedDays: number): Built {
  const settings = paceSettings[input.pace];
  const stops = input.places.map(resolvedStop);
  const raw = stops.map((stop) => stop.input).join("\n");
  const base: ResolvedInputStop | null = input.hotel ? {
    // The id carries the position: a leg to another hotel is another leg,
    // and a street path looked up for the old one must not be reused.
    ...resolvedStop({ id: `shiori-hotel@${input.hotel.lat.toFixed(4)},${input.hotel.lon.toFixed(4)}`, name: input.hotel.name, lat: input.hotel.lat, lon: input.hotel.lon, stayMinutes: 15 }, 9_999),
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
    dayOverrides,
    ...extra,
  };
  return { plan: buildTripFromWishlist(raw, usedDays, settings.engine, input.locale, context), context, raw, usedDays };
}

function legKeysOf(plan: BuiltTripPlan) {
  const pairs: Array<{ from: RouteStop; to: RouteStop }> = [];
  for (const day of plan.days) {
    for (const leg of day.legs) pairs.push({ from: leg.from, to: leg.to });
    const first = day.stops[0]?.stop;
    const last = day.stops.at(-1)?.stop;
    if (day.startBase && first) pairs.push({ from: day.startBase, to: first });
    if (day.endBase && last) pairs.push({ from: last, to: day.endBase });
  }
  return pairs;
}

function estimatedTransitMinutes(from: RouteStop, to: RouteStop, plan: BuiltTripPlan) {
  for (const day of plan.days) {
    const leg = day.legs.find((candidate) => candidate.from.id === from.id && candidate.to.id === to.id);
    const transit = leg?.comparison.options.find((option) => option.mode === "transit");
    if (transit) return transit.minutes;
  }
  return null;
}

/**
 * The fewest days (up to the request) on which no day runs past the pace's
 * comfortable end. A traveller who asked for three days and listed one day's
 * worth of places gets one good day and two free ones, not three thin days.
 */
function chooseDays(input: ShioriInput, extra: Partial<TripPlannerContext>): Built {
  const requested = Math.max(1, Math.min(14, Math.round(input.days)));
  const pinned = input.places.reduce((maximum, place) => Math.max(maximum, typeof place.day === "number" ? place.day : 1), 1);
  const settings = paceSettings[input.pace];
  let last: Built | null = null;
  for (let days = Math.min(requested, pinned); days <= requested; days += 1) {
    last = buildWithEngine(input, extra, days);
    if (!dayRunsLate(last.plan, settings.dayEnd)) return last;
  }
  return last ?? buildWithEngine(input, extra, requested);
}

export function buildShioriPlan(
  input: ShioriInput,
  options: {
    rail?: RailNetwork | null;
    cities?: readonly PopularDestination[];
    /** Street paths already looked up, keyed "walk|<leg key>" / "drive|<leg key>". */
    routes?: ReadonlyMap<string, ShioriRoute | null>;
  } = {},
): ShioriPlan {
  if (input.places.length === 0) {
    return { days: [], freeDays: Math.max(0, input.days), freeDayIdeas: [], leftOut: [], stayNear: null, hotel: input.hotel };
  }
  const settings = paceSettings[input.pace];
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
   * Looks up every leg the plan has that was not looked up yet. A train
   * journey is fed back as that leg's transit time. "Just walk" is fed back
   * as the walking time, with transit made a little slower, so the engine
   * stops proposing a train for a 20-minute stroll.
   */
  const routeNewLegs = (plan: BuiltTripPlan) => {
    if (!rail) return false;
    let changed = false;
    for (const { from, to } of legKeysOf(plan)) {
      const key = routeLegKey(from.id, to.id);
      if (key in transit) continue;
      const advice = rail.advise(from, to, input.locale);
      const estimate = estimatedTransitMinutes(from, to, plan);
      if (advice.kind === "rail" && (estimate === null || advice.journey.totalMinutes <= estimate * 1.8 + 10)) {
        // A rail answer far slower than a typical transit estimate means the
        // real answer is a bus this data does not know; keep the estimate.
        journeys.set(key, advice.journey);
        transit[key] = advice.journey.totalMinutes;
        changed = true;
      } else if (advice.kind === "walk") {
        walking[key] = advice.minutes;
        walkAdvised.add(key);
        transit[key] = advice.minutes + 8;
        changed = true;
      }
    }
    return changed;
  };

  // Train legs first, with no lunch in the day yet: ask the bundled network,
  // feed the minutes back so the order and the clock use them, and look
  // again at whatever legs that produced.
  const transit: Record<string, number> = {};
  let built = chooseDays(input, {});
  for (let pass = 0; pass < 3; pass += 1) {
    if (!routeNewLegs(built.plan)) break;
    built = chooseDays(input, { liveTransitMinutes: transit, liveWalkingMinutes: walking });
  }

  // Lunch takes an hour of the day. It goes after the stop that ends nearest
  // 12:30 (within 11:00–14:30); a day that is one long visit, or over before
  // lunchtime, gets no lunch line. The hour is lent to that stop's stay so
  // the engine moves everything after it, and handed back to the reader as
  // its own line.
  const lunchAfter = new Map<number, string>();
  const durationOverrides: Record<string, number> = {};
  const stayOf = new Map(input.places.map((place) => [place.id, Math.max(15, Math.round(place.stayMinutes))]));
  built.plan.days.forEach((day, dayIndex) => {
    if (day.stops.length < 2 && clockMinutes(day.finishTime) > 15 * 60) return;
    const candidates = day.stops
      .map((stop) => ({ id: stop.stop.id, leave: clockMinutes(stop.departure) }))
      .filter((stop) => stop.leave >= 11 * 60 && stop.leave <= 14 * 60 + 30)
      .sort((left, right) => Math.abs(left.leave - 750) - Math.abs(right.leave - 750));
    const anchor = candidates[0];
    if (!anchor) return;
    lunchAfter.set(dayIndex, anchor.id);
    durationOverrides[anchor.id] = (stayOf.get(anchor.id) ?? 60) + LUNCH_MINUTES;
  });
  if (lunchAfter.size > 0) {
    const daysBefore = built.usedDays;
    built = buildWithEngine(input, { liveTransitMinutes: transit, liveWalkingMinutes: walking, durationOverrides }, daysBefore);
    // Lunch can tip a full day past its end; one more day is better than a
    // day nobody can keep, when the traveller has one to give.
    if (dayRunsLate(built.plan, settings.dayEnd) && daysBefore < Math.max(1, Math.min(14, Math.round(input.days)))) {
      built = buildWithEngine(input, { liveTransitMinutes: transit, liveWalkingMinutes: walking, durationOverrides }, daysBefore + 1);
    }
    // The rebuild may have moved a stop to another day. Lunch follows the
    // stop that carries its hour; a day never gets two.
    const settle = () => {
      lunchAfter.clear();
      let dropped = false;
      built.plan.days.forEach((day, dayIndex) => {
        const carrying = day.stops.filter((stop) => stop.stop.id in durationOverrides);
        if (carrying.length === 0) return;
        lunchAfter.set(dayIndex, carrying[0].stop.id);
        for (const extra of carrying.slice(1)) {
          delete durationOverrides[extra.stop.id];
          dropped = true;
        }
      });
      return dropped;
    };
    if (settle()) {
      built = buildWithEngine(input, { liveTransitMinutes: transit, liveWalkingMinutes: walking, durationOverrides }, built.usedDays);
      settle();
    }
  }
  // Lunch and the day count can reorder a day, which creates legs the first
  // rounds never saw. Every leg that ends up in the booklet gets its route.
  for (let pass = 0; pass < 2; pass += 1) {
    if (!routeNewLegs(built.plan)) break;
    built = buildWithEngine(input, { liveTransitMinutes: transit, liveWalkingMinutes: walking, durationOverrides }, built.usedDays);
    lunchAfter.clear();
    built.plan.days.forEach((day, dayIndex) => {
      const carrying = day.stops.find((stop) => stop.stop.id in durationOverrides);
      if (carrying) lunchAfter.set(dayIndex, carrying.stop.id);
    });
  }

  // What a map service measured for a leg — the walk up to Victoria Peak is
  // 87 minutes, not the 25 a straight line suggests — corrects that leg's
  // clock and its mode. It never reshuffles the trip: days and order stay as
  // planned above, so the booklet does not rearrange itself a moment after
  // it appears on screen.
  if (Object.keys(measuredWalking).length + Object.keys(measuredDriving).length > 0) {
    const lockedOrderByDay = Object.fromEntries(built.plan.days.flatMap((day, index) => (
      day.stops.length > 0 ? [[index, day.stops.map((stop) => stop.stop.id)] as const] : []
    )));
    const measuredTransit = { ...transit };
    // "No train helps, just walk" was priced as the walk plus a wait; it
    // follows the walk's real length.
    for (const [key, minutes] of Object.entries(measuredWalking)) {
      if (walkAdvised.has(key)) measuredTransit[key] = minutes + 8;
    }
    built = buildWithEngine(input, {
      liveTransitMinutes: measuredTransit,
      liveWalkingMinutes: { ...walking, ...measuredWalking },
      liveDrivingMinutes: measuredDriving,
      durationOverrides,
      lockedOrderByDay,
    }, built.usedDays);
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
      return [{ place, arrive: entry.arrival, leave: clock(leaveMinutes), stayMinutes: leaveMinutes - clockMinutes(entry.arrival) }];
    });
    if (stops.length === 0) return [];
    const lastPlace = stops.at(-1)!.place;
    if (clockMinutes(day.finishTime) >= 16 * 60 + 30) {
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
    const endsEarly = clockMinutes(day.finishTime) <= clockMinutes(settings.dayEnd) - 120;
    const ideas = endsEarly && cities.length > 0
      ? bundledSightsNearRoute({ routePoints, excludedNames: listedNames, languageCode: input.locale, cities })
        .slice(0, 4)
        .flatMap((idea) => {
          const sight = cities.flatMap((city) => city.sights).find((candidate) => `wikidata-${candidate.q}` === idea.id);
          return sight ? [sight] : [];
        })
      : [];
    const names = stops.map((stop) => stop.place.name);
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
      runsLate: day.deadlineOverrunMinutes > 0 || clockMinutes(day.finishTime) > clockMinutes(settings.dayEnd),
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
  };
}
