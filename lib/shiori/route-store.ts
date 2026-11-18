import type { ShioriRoute } from "./plan.ts";

/*
 * Street paths kept in the traveller's own browser, so a reopened booklet
 * keeps its lines and clock offline.
 *
 * Only paths from the OpenStreetMap router are kept, each tagged with that
 * source. Apple's terms allow its map data only temporarily and only on an
 * Apple map, so nothing from Apple is ever written here. The first store
 * ("shiori-routes-v1") held paths without a source, some of them Apple's: it
 * is deleted on load, never read.
 *
 * Nor is a path that starts or ends at a place found through Apple (or at a
 * hotel found through Apple): the OpenStreetMap router drew it from Apple's
 * position of the place, so its ends are Apple's coordinates, and a trip
 * keeps such a place as its Place ID alone (see placeSource in state.ts).
 * Those legs are drawn for the visit and asked for again on the next.
 */

export const ROUTES_KEY = "shiori-routes-v2";
/** Stores that may hold Apple paths: deleted, never read. */
export const RETIRED_ROUTE_KEYS = ["shiori-routes-v1"] as const;

const KEEP_ROUTES = 120;
const KEEP_POINTS = 60;

/** A leg ("walk|<from>::<to>") one end of which is an Apple place: never kept. */
const APPLE_END = /(?:^(?:walk|drive)\||::)(?:base-)?(?:apple|maps)-/;
/** A leg to or from the hotel, whose key carries the hotel's position. */
const HOTEL_END = /(?:^(?:walk|drive)\||::)(?:base-)?shiori-hotel@/;

/** Whether a path may be kept: from OpenStreetMap, with no end at Apple's position of a place (`appleHotel`: the trip's hotel is Apple's). */
export function keepableRoute(key: string, route: ShioriRoute | null, appleHotel = false): route is ShioriRoute {
  return Boolean(route && route.source === "osm" && !APPLE_END.test(key) && !(appleHotel && HOTEL_END.test(key)));
}

/** The paths in the stored text that came from OpenStreetMap; anything else is dropped. */
export function parseStoredRoutes(raw: string | null): Map<string, ShioriRoute> {
  const routes = new Map<string, ShioriRoute>();
  if (!raw) return routes;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return routes;
  }
  if (!Array.isArray(stored)) return routes;
  for (const entry of stored.slice(0, 160)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !/^(walk|drive)\|.{3,400}$/.test(entry[0]) || !Array.isArray(entry[2])) continue;
    // An entry without the OpenStreetMap tag is not kept, whatever it holds; nor one kept before Apple places' ends were left out.
    if (entry[3] !== "osm" || APPLE_END.test(entry[0])) continue;
    const minutes = typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0 && entry[1] < 1_440 ? Math.round(entry[1]) : null;
    const path = entry[2].flatMap((point: unknown) => (
      Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number" && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180
        ? [{ latitude: point[0], longitude: point[1] }]
        : []
    )).slice(0, 80);
    if (path.length >= 2) routes.set(entry[0], { minutes, path, source: "osm" });
  }
  return routes;
}

/** The text to store: OpenStreetMap paths only, none with an end at an Apple place, thinned, each tagged "osm". */
export function serializeRoutes(routes: ReadonlyMap<string, ShioriRoute | null>, appleHotel = false): string {
  const entries = [...routes].flatMap(([key, route]) => {
    if (!keepableRoute(key, route, appleHotel)) return [];
    const stride = Math.max(1, (route.path.length - 1) / (KEEP_POINTS - 1));
    const count = Math.min(route.path.length, KEEP_POINTS);
    const path = Array.from({ length: count }, (_, index) => route.path[Math.min(route.path.length - 1, Math.round(index * stride))]);
    return [[key, route.minutes, path.map((point) => [Number(point.latitude.toFixed(5)), Number(point.longitude.toFixed(5))]), "osm"]];
  }).slice(-KEEP_ROUTES);
  return JSON.stringify(entries);
}
