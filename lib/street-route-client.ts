import { appleRelayRoute, appleRelayUrl } from "./apple-relay-client.ts";

/*
 * The way along the streets between two places, for drawing a leg on the map
 * and for the real length of a walk.
 *
 * Apple answers first where the operator has connected it. Where it has no
 * answer — it will not walk anyone into the middle of the Imperial Palace —
 * or is not connected at all, the community routing service run by FOSSGIS on
 * OpenStreetMap data is asked instead. That service is a shared, volunteer-run
 * resource: it is asked one route at a time, only for legs nothing else could
 * draw, and every answer is remembered for the visit.
 */

export type StreetPoint = { latitude: number; longitude: number };

export type StreetRoute = Readonly<{
  /** Null when the source's duration is not one to plan with (a drive without traffic). */
  minutes: number | null;
  path: StreetPoint[];
  source: "apple" | "osm";
}>;

export const OPEN_ROUTER_ORIGIN = "https://routing.openstreetmap.de";
const PATH_POINT_LIMIT = 160;

type Dependencies = {
  /** Null means "no relay configured"; undefined reads the build's setting. */
  relayUrl?: string | null;
  fetcher?: typeof fetch;
};

/** found: a path · none: the sources have no route · failed: could not ask (offline, busy); ask again later. */
export type StreetRouteAnswer =
  | { status: "found"; route: StreetRoute }
  | { status: "none" }
  | { status: "failed" };

const REQUEST_DEADLINE_MS = 9_000;
const RELAY_REST_MS = 60_000;

const remembered = new Map<string, Promise<StreetRouteAnswer>>();
// One open-router request at a time, whatever the number of callers.
let openRouterTurn: Promise<unknown> = Promise.resolve();
// After the relay fails once it is left alone for a minute, so an outage
// costs one wait, not one per leg.
let relayRestsUntil = 0;

function thin(path: StreetPoint[]) {
  if (path.length <= PATH_POINT_LIMIT) return path;
  const stride = (path.length - 1) / (PATH_POINT_LIMIT - 1);
  return Array.from({ length: PATH_POINT_LIMIT }, (_, index) => path[Math.round(index * stride)]);
}

async function openRoute(
  origin: StreetPoint,
  destination: StreetPoint,
  mode: "walk" | "drive",
  fetcher: typeof fetch,
): Promise<StreetRouteAnswer> {
  const profile = mode === "walk" ? ["routed-foot", "foot"] : ["routed-car", "driving"];
  const pair = [origin, destination].map((point) => `${point.longitude.toFixed(5)},${point.latitude.toFixed(5)}`).join(";");
  const url = `${OPEN_ROUTER_ORIGIN}/${profile[0]}/route/v1/${profile[1]}/${pair}?overview=full&geometries=geojson&steps=false&alternatives=false`;
  // The deadline covers the body as well as the headers.
  const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) });
  const payload = await response.json().catch(() => null) as {
    code?: unknown;
    routes?: Array<{ duration?: unknown; geometry?: { coordinates?: unknown } }>;
  } | null;
  // The router says "NoRoute"/"NoSegment" with a 400 when the pair cannot be
  // joined; anything else that is not a route is the service being unwell.
  if (payload?.code === "NoRoute" || payload?.code === "NoSegment") return { status: "none" };
  if (!response.ok || payload?.code !== "Ok") return { status: "failed" };
  const route = payload.routes?.[0];
  const coordinates = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];
  const path = coordinates.flatMap((raw): StreetPoint[] => {
    if (!Array.isArray(raw)) return [];
    const longitude = Number(raw[0]);
    const latitude = Number(raw[1]);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
      ? [{ latitude, longitude }]
      : [];
  });
  if (path.length < 2) return { status: "none" };
  const seconds = Number(route?.duration);
  return {
    status: "found",
    route: {
      // Walking pace is walking pace anywhere; a drive time that knows nothing
      // of traffic or parking is not offered as a duration.
      minutes: mode === "walk" && Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null,
      path: thin(path),
      source: "osm",
    },
  };
}

async function lookUp(
  origin: StreetPoint,
  destination: StreetPoint,
  mode: "walk" | "drive",
  relayUrl: string | null,
  fetcher: typeof fetch,
): Promise<StreetRouteAnswer> {
  if (relayUrl && Date.now() >= relayRestsUntil) {
    try {
      const route = await appleRelayRoute({ origin, destination, mode, signal: AbortSignal.timeout(REQUEST_DEADLINE_MS) }, relayUrl, fetcher);
      if (route) return { status: "found", route: { minutes: route.minutes, path: route.path, source: "apple" } };
    } catch {
      // Down, over budget or too slow: that is what the second source is for.
      relayRestsUntil = Date.now() + RELAY_REST_MS;
    }
  }
  const turn = openRouterTurn.then(() => openRoute(origin, destination, mode, fetcher));
  openRouterTurn = turn.catch(() => undefined);
  return turn.catch((): StreetRouteAnswer => ({ status: "failed" }));
}

/**
 * Never rejects. "none" is an answer and is remembered for the visit;
 * "failed" is not an answer and is forgotten, so the leg can be asked about
 * again once the connection is back.
 */
export function fetchStreetRoute(
  options: Readonly<{ origin: StreetPoint; destination: StreetPoint; mode: "walk" | "drive" }>,
  dependencies: Dependencies = {},
): Promise<StreetRouteAnswer> {
  const relayUrl = dependencies.relayUrl === undefined ? appleRelayUrl() : dependencies.relayUrl;
  const fetcher = dependencies.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  const point = (value: StreetPoint) => `${value.latitude.toFixed(5)},${value.longitude.toFixed(5)}`;
  const key = [relayUrl ?? "-", options.mode, point(options.origin), point(options.destination)].join("|");
  const known = remembered.get(key);
  if (known) return known;
  const pending = lookUp(options.origin, options.destination, options.mode, relayUrl, fetcher).then((answer) => {
    if (answer.status === "failed") remembered.delete(key);
    return answer;
  });
  remembered.set(key, pending);
  if (remembered.size > 600) remembered.delete(remembered.keys().next().value as string);
  return pending;
}
