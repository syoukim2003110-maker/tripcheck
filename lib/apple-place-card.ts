import { appleRelaySearch, appleRelayUrl, type AppleRelayPlace } from "./apple-relay-client.ts";

/*
 * Apple's embeddable place card (MapKit JS `PlaceDetail`): opening hours,
 * phone and official website for one place, drawn by Apple inside the booklet.
 *
 * Nothing here runs on page load. Apple's script is fetched the first time a
 * traveller asks for a card, with a short-lived token the site's own relay
 * signs for this origin; the private key stays on the server.
 */

export type MapToken = Readonly<{ token: string; expiresAt: number }>;

/** A token is replaced this long before it runs out, so a request never leaves with a dying one. */
const TOKEN_MARGIN_SECONDS = 60;

/**
 * Hands out the current token, asking for a new one only when there is none
 * or it is about to expire. Callers arriving together share one request, and
 * a failed request is not remembered: the next call tries again.
 */
export function createMapTokenSource(fetchToken: () => Promise<MapToken>, nowSeconds: () => number = () => Date.now() / 1000) {
  let current: MapToken | null = null;
  let pending: Promise<MapToken> | null = null;
  return async function mapToken(): Promise<string> {
    if (current && current.expiresAt - TOKEN_MARGIN_SECONDS > nowSeconds()) return current.token;
    pending ??= fetchToken().then(
      (next) => { current = next; pending = null; return next; },
      (error) => { pending = null; throw error; },
    );
    return (await pending).token;
  };
}

/** What the relay's `op=maptoken` answered, or null when it is not a usable token. */
export function readMapToken(payload: unknown): MapToken | null {
  if (!payload || typeof payload !== "object") return null;
  const { token, expiresAt } = payload as Record<string, unknown>;
  if (typeof token !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { token, expiresAt };
}

/**
 * The Apple place id carried by a stop added through the map search
 * ("apple-I63802885C8189B2B"). A stop the search returned without an id is
 * named after its coordinates ("apple-35.65858,139.74543"): that is no id.
 */
export function applePlaceIdOfStop(stopId: string): string | null {
  const id = stopId.startsWith("apple-") ? stopId.slice("apple-".length) : "";
  return /^[A-Za-z0-9]{8,}$/.test(id) ? id : null;
}

function normalisedName(name: string) {
  return name.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Two names for the same place: one contains the other, or they start with the same four characters. */
export function placeNamesMatch(left: string, right: string) {
  const a = normalisedName(left);
  const b = normalisedName(right);
  // One character ("the", "寺") is contained in almost anything.
  if (a.length < 2 || b.length < 2) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const head = (value: string) => [...value].slice(0, 4).join("");
  return [...a].length >= 4 && [...b].length >= 4 && head(a) === head(b);
}

export function metersBetween(a: { lat: number; lon: number }, b: { latitude: number; longitude: number }) {
  const lat = (b.latitude - a.lat) * 111_320;
  const lon = (b.longitude - a.lon) * 111_320 * Math.cos(((a.lat + b.latitude) / 2) * Math.PI / 180);
  return Math.hypot(lat, lon);
}

export const PLACE_MATCH_METERS = 150;

/**
 * The search result that is this stop, or null. It must carry an Apple id,
 * lie within 150 m of the stop and share its name; the nearest such result
 * wins. A card for the wrong place is worse than no card, so anything less
 * certain is refused.
 */
export function matchApplePlace(stop: { name: string; lat: number; lon: number }, results: readonly AppleRelayPlace[]): AppleRelayPlace | null {
  let best: AppleRelayPlace | null = null;
  let bestMeters = Infinity;
  for (const place of results) {
    if (!place.id || !applePlaceIdOfStop(`apple-${place.id}`)) continue;
    const meters = metersBetween(stop, place);
    if (meters > PLACE_MATCH_METERS || meters >= bestMeters || !placeNamesMatch(stop.name, place.name)) continue;
    best = place;
    bestMeters = meters;
  }
  return best;
}

export type PlaceCardStop = Readonly<{ id: string; name: string; lat: number; lon: number }>;

const placeIds = new Map<string, string | null>();

/**
 * The Apple place id for a stop: its own when it came from the map search,
 * otherwise the id of a search result that is certainly the same place.
 * Null means no card. Remembered per stop, so reopening a card costs nothing.
 */
export async function applePlaceIdFor(
  stop: PlaceCardStop,
  language: "ja" | "en",
  search: typeof appleRelaySearch = appleRelaySearch,
): Promise<string | null> {
  const own = applePlaceIdOfStop(stop.id);
  if (own) return own;
  const key = `${stop.id}|${stop.lat.toFixed(5)},${stop.lon.toFixed(5)}`;
  const known = placeIds.get(key);
  if (known !== undefined) return known;
  const results = await search({
    query: stop.name.slice(0, 120),
    language: language === "ja" ? "ja-JP" : "en-US",
    near: { latitude: stop.lat, longitude: stop.lon },
    // Wider than the 150 m rule: a large site's pin and Apple's can sit apart,
    // and the rule itself, not the search box, decides what is close enough.
    withinMeters: 400,
    poiOnly: true,
  });
  const id = matchApplePlace(stop, results)?.id ?? null;
  placeIds.set(key, id);
  return id;
}

/* ------------------------------------------------------------- MapKit JS */

type MapKitPlace = { name?: string };
export type MapKitPlaceDetail = { destroy?: () => void };
type MapKit = {
  init: (options: { authorizationCallback: (done: (token: string) => void) => void; language?: string }) => void;
  PlaceLookup: new () => { getPlace: (id: string, callback: (error: unknown, place: MapKitPlace | null) => void) => void };
  PlaceDetail: new (host: HTMLElement, place: MapKitPlace, options: { colorScheme?: string; displaysMap?: boolean }) => MapKitPlaceDetail;
};

export const MAPKIT_SCRIPT_URL = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";

async function fetchMapToken(): Promise<MapToken> {
  const relay = appleRelayUrl();
  if (!relay) throw new Error("apple_relay_not_configured");
  const url = new URL(relay, window.location.href);
  url.searchParams.set("op", "maptoken");
  const response = await globalThis.fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const token = response.ok ? readMapToken(await response.json().catch(() => null)) : null;
  if (!token) throw new Error("apple_map_token_unavailable");
  return token;
}

const mapToken = createMapTokenSource(fetchMapToken);
let mapkitReady: Promise<MapKit> | null = null;

/** Apple's script, added to the page once, on the first card anyone opens. */
function loadMapKit(language: "ja" | "en"): Promise<MapKit> {
  mapkitReady ??= new Promise<MapKit>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MAPKIT_SCRIPT_URL;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.onload = () => {
      const mapkit = (window as unknown as { mapkit?: MapKit }).mapkit;
      if (!mapkit?.PlaceDetail || !mapkit.PlaceLookup) { reject(new Error("mapkit_without_place_detail")); return; }
      mapkit.init({
        // Apple calls this again whenever it wants a fresh token.
        authorizationCallback: (done) => { mapToken().then(done, () => done("")); },
        language,
      });
      resolve(mapkit);
    };
    script.onerror = () => { script.remove(); reject(new Error("mapkit_script_failed")); };
    document.head.appendChild(script);
  }).catch((error) => {
    // A failed load (offline, blocked) may be tried again on the next press.
    mapkitReady = null;
    throw error;
  });
  return mapkitReady;
}

/** True when this build can show place cards at all. */
export function placeCardsAvailable() {
  return appleRelayUrl() !== null;
}

/**
 * Draws the card for a stop into `host`. Answers "none" when Apple has no
 * place that is certainly this stop; throws when Apple could not be reached.
 * The returned card must be destroyed when it is closed.
 */
export async function showPlaceCard(host: HTMLElement, stop: PlaceCardStop, language: "ja" | "en"): Promise<MapKitPlaceDetail | "none"> {
  const id = await applePlaceIdFor(stop, language);
  if (!id) return "none";
  // Asked for before the script, so a relay that cannot sign fails here rather than as a silent empty card.
  await mapToken();
  const mapkit = await loadMapKit(language);
  const place = await new Promise<MapKitPlace | null>((resolve, reject) => {
    new mapkit.PlaceLookup().getPlace(id, (error, found) => { if (error) reject(new Error("apple_place_lookup_failed")); else resolve(found); });
  });
  if (!place) return "none";
  return new mapkit.PlaceDetail(host, place, { colorScheme: "light", displaysMap: false });
}
