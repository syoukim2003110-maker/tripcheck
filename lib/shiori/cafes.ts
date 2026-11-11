import type { GeoPoint } from "../rail-router.ts";
import type { ShioriLeg, ShioriMeal, ShioriStop } from "./plan.ts";

/*
 * A coffee break where the day has room for one.
 *
 * The booklet does not know which café is good — nothing free does — so it
 * does not pretend to. What it does know is the traveller's own route: where
 * they will be in mid-afternoon, and which cafés sit on the way to the next
 * place rather than off it. A suggestion here means "this one costs you the
 * fewest extra steps", and says so.
 */

export type CafeBreak = {
  /** The break comes after stops[afterStop]. */
  afterStop: number;
  /** Roughly when the traveller gets there. */
  time: string;
  /** on-the-way: along the walk to the next place · after: around the place just left. */
  reason: "on-the-way" | "after";
  from: GeoPoint;
  fromName: string;
  /** The next place, when the day goes on. */
  to: GeoPoint | null;
  toName: string | null;
  /** Where to look for cafés. */
  search: GeoPoint;
};

export type CafePick = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  kind: "cafe" | "bakery";
  /** on-the-way: extra walking against going straight to the next place · after: the walk from the place just left. Minutes. */
  detourMinutes: number;
  mapsUrl: string;
};

type CafeSearch = {
  search(options: {
    query: string;
    language: string;
    near: { latitude: number; longitude: number };
    withinMeters: number;
    poiCategories: readonly string[];
    poiOnly: boolean;
    signal?: AbortSignal;
  }): Promise<ReadonlyArray<{ id: string | null; name: string; latitude: number; longitude: number; formattedAddress: string; poiCategory: string | null }>>;
};

const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

function meters(from: GeoPoint, to: GeoPoint) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(to.latitude - from.latitude) / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Where a break fits in a day, or null when the day does not call for one.
 *
 * A day of five hours or more gets one, after the stop that ends nearest
 * 15:00 (between 13:30 and 17:00). Not straight after lunch, and not just
 * before a restaurant the traveller chose. When the next leg is a real walk
 * the cafés are looked for along it; otherwise around the place just left,
 * before the train.
 */
export function cafeBreakFor(day: {
  stops: readonly ShioriStop[];
  legs: readonly ShioriLeg[];
  meals: ReadonlyArray<ShioriMeal & { afterStop: number }>;
}): CafeBreak | null {
  // One place all day (a theme park) has its own cafés; a break is between places.
  if (day.stops.length < 2) return null;
  const span = minutesOf(day.stops.at(-1)!.leave) - minutesOf(day.stops[0].arrive);
  // (A day that prints past midnight gives a negative span: it has other
  // problems than coffee.)
  if (span < 300) return null;
  const lunchEnds = day.meals.flatMap((meal) => meal.kind === "lunch" && meal.end ? [minutesOf(meal.end)] : []);
  const candidates = day.stops.flatMap((stop, index) => {
    const leave = minutesOf(stop.leave);
    if (leave < 13 * 60 + 30 || leave > 17 * 60 || stop.place.meal) return [];
    if (day.meals.some((meal) => meal.afterStop === index && meal.kind === "lunch")) return [];
    if (lunchEnds.some((end) => leave - end >= 0 && leave - end < 75)) return [];
    const next = day.stops[index + 1];
    if (next?.place.meal) return [];
    return [{ index, leave }];
  }).sort((left, right) => Math.abs(left.leave - 900) - Math.abs(right.leave - 900));
  const chosen = candidates[0];
  if (!chosen) return null;
  const stop = day.stops[chosen.index];
  const next = day.stops[chosen.index + 1] ?? null;
  const leg = day.legs[chosen.index] ?? null;
  const from = { latitude: stop.place.lat, longitude: stop.place.lon };
  const to = next ? { latitude: next.place.lat, longitude: next.place.lon } : null;
  const onTheWay = Boolean(leg && leg.mode === "walk" && leg.minutes >= 8 && to);
  const middle = onTheWay ? leg!.path[Math.floor(leg!.path.length / 2)] : null;
  // A two-point path's "middle" is its far end; halfway is what is meant.
  const search = onTheWay
    ? leg!.path.length > 2 && middle ? middle : { latitude: (from.latitude + to!.latitude) / 2, longitude: (from.longitude + to!.longitude) / 2 }
    : from;
  return {
    afterStop: chosen.index,
    time: stop.leave,
    reason: onTheWay ? "on-the-way" : "after",
    from,
    fromName: stop.place.name,
    to,
    toName: next?.place.name ?? null,
    search,
  };
}

/**
 * Cafés for a break, ordered by how little they take the traveller off
 * their way: the extra walking against going straight to the next place
 * (or simply the walk from the place just left, when the day ends there).
 */
export async function findCafes(brk: CafeBreak, client: CafeSearch, languageCode: "ja" | "en", signal?: AbortSignal): Promise<CafePick[]> {
  const search = (withinMeters: number) => client.search({
    query: languageCode === "ja" ? "カフェ" : "cafe",
    language: languageCode === "ja" ? "ja-JP" : "en-US",
    near: brk.search,
    withinMeters,
    poiCategories: ["Cafe", "Bakery"],
    poiOnly: true,
    signal,
  });
  let places = [...await search(500)];
  if (places.length < 3) places = [...places, ...await search(1_200)];
  const straight = brk.to ? meters(brk.from, brk.to) : 0;
  const seen = new Set<string>();
  return places.flatMap((place): CafePick[] => {
    const key = `${place.name.normalize("NFKC").toLocaleLowerCase()}@${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    // Along a walk, what counts is the extra steps against going straight
    // on. Before a train ride it is simply the walk from the place just
    // left: a café "between" two places 4 km apart is not on anyone's way.
    const extra = brk.reason === "on-the-way" && brk.to ? meters(brk.from, place) + meters(place, brk.to) - straight : meters(brk.from, place);
    const coordinate = `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`;
    return [{
      id: `apple-${place.id ?? coordinate}`.slice(0, 160),
      name: place.name,
      address: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude,
      kind: place.poiCategory === "Bakery" ? "bakery" : "cafe",
      // Streets are not straight lines: 1.3× and 75 m a minute, as elsewhere.
      detourMinutes: Math.max(0, Math.round(extra * 1.3 / 75)),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${coordinate}`)}`,
    }];
  }).sort((left, right) => left.detourMinutes - right.detourMinutes).slice(0, 5);
}
