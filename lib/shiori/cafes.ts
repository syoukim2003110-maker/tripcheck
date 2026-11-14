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
  /** From the shop guide, when it lists this café: a photo and what it costs. */
  photo?: string;
  budget?: string;
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
  /**
   * On a day the traveller has to be done by a certain time: the minutes
   * between the end of the day as planned (the ride back included) and that
   * time. Null or absent on any other day.
   */
  spare?: number | null;
  /** The day has no room for a lunch hour beside the times the traveller entered. */
  noLunchRoom?: boolean;
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
    // A break takes time, and everything after it moves by that much. Where
    // a time the traveller entered comes later in the day there has to be a
    // half hour to give: idle time in front of the next booked visit, or —
    // with no booking left — before the hour the day has to be over.
    const booked = day.stops.find((later, position) => position > index && later.reserved);
    if (booked ? booked.waitMinutes < 30 : typeof day.spare === "number" && day.spare < 30) return [];
    // And a day that could not keep an hour for lunch does not end with coffee.
    if (!next && day.noLunchRoom) return [];
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


type ListedCafe = { id: string; name: string; latitude: number; longitude: number; address: string | null; budget: string | null; photo: string | null; url: string | null };

const plainName = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/[\s・･\-‐－―()（）]/g, "");

// Words any café may carry. They say nothing about which café it is, so two
// names are compared on what is left once these are gone.
const GENERIC_CAFE_WORDS = /cafe|café|coffee|カフェ|コーヒー|珈琲|喫茶|店|shop|house|stand|the|and|&/g;

/**
 * Two names for one café: what is distinctive in them is equal, or one is
 * the start of the other ("スターバックス" and "スターバックス コーヒー 寺前店").
 * A shared opening is not enough: "Cafe Aoi" and "Cafe Midori" next door
 * are two shops, and so are two branches of one chain. Taking two shops
 * for one puts the wrong photo on a card and hides the other shop; taking
 * one shop for two only lists it twice, so doubt goes that way.
 */
function sameCafe(left: string, right: string) {
  const a = plainName(left);
  const b = plainName(right);
  if (!a || !b) return false;
  const [short, long] = [a.replace(GENERIC_CAFE_WORDS, ""), b.replace(GENERIC_CAFE_WORDS, "")].sort((x, y) => x.length - y.length);
  // A name made only of such words ("Cafe") has nothing distinctive to compare.
  if (!short) return a === b;
  return short === long || (short.length >= 2 && long.startsWith(short));
}

/**
 * The break's cafés with what the shop guide knows added: a café the guide
 * lists gets its photo and budget, and listed cafés the map search missed
 * join the list. The order stays what it was — least off the traveller's
 * way first — so a photo never buys a place further up.
 */
export function withListedCafes(picks: readonly CafePick[], brk: CafeBreak, listed: readonly ListedCafe[], limit = 6): CafePick[] {
  const straight = brk.to ? meters(brk.from, brk.to) : 0;
  const merged = picks.map((pick) => ({ ...pick }));
  for (const shop of listed) {
    const twin = merged.find((pick) => meters(pick, shop) <= 70 && sameCafe(pick.name, shop.name));
    if (twin) {
      if (shop.photo) twin.photo = shop.photo;
      if (shop.budget) twin.budget = shop.budget;
      continue;
    }
    if (merged.some((pick) => pick.id === `hotpepper-${shop.id}`)) continue;
    const extra = brk.reason === "on-the-way" && brk.to ? meters(brk.from, shop) + meters(shop, brk.to) - straight : meters(brk.from, shop);
    const coordinate = `${shop.latitude.toFixed(5)},${shop.longitude.toFixed(5)}`;
    merged.push({
      id: `hotpepper-${shop.id}`.slice(0, 160),
      name: shop.name,
      address: shop.address ?? "",
      latitude: shop.latitude,
      longitude: shop.longitude,
      kind: "cafe",
      detourMinutes: Math.max(0, Math.round(extra * 1.3 / 75)),
      mapsUrl: shop.url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${coordinate}`)}`,
      ...(shop.photo ? { photo: shop.photo } : {}),
      ...(shop.budget ? { budget: shop.budget } : {}),
    });
  }
  return merged.sort((left, right) => left.detourMinutes - right.detourMinutes).slice(0, limit);
}
