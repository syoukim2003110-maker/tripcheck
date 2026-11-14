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
export function readMapToken(payload: unknown, nowSeconds: () => number = () => Date.now() / 1000): MapToken | null {
  if (!payload || typeof payload !== "object") return null;
  const { token, expiresAt, expiresIn } = payload as Record<string, unknown>;
  if (typeof token !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  // The lifetime is counted on this device's own clock: a phone twenty minutes
  // slow would otherwise keep handing Apple a token that has already run out.
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) return { token, expiresAt: nowSeconds() + expiresIn };
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

/** Old-form characters a sign may use where the booklet has the everyday one (靖國神社 / 靖国神社). */
const OLD_FORMS: Record<string, string> = { "國": "国", "澤": "沢", "濱": "浜", "邊": "辺", "邉": "辺", "齋": "斎", "齊": "斉", "髙": "高", "﨑": "崎", "藝": "芸", "壽": "寿", "應": "応", "櫻": "桜", "龍": "竜", "寶": "宝", "廣": "広", "萬": "万", "會": "会", "學": "学", "驛": "駅", "圓": "円", "德": "徳", "禪": "禅", "眞": "真", "惠": "恵", "榮": "栄", "條": "条", "嶋": "島", "嶌": "島", "ヶ": "ケ", "ヵ": "カ" };

function normalisedName(name: string) {
  return [...name.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")].map((letter) => OLD_FORMS[letter] ?? letter).join("");
}

/** What may be left over when one name contains the other and they are still the same place. */
const HARMLESS_REST = /^(本店|本館|本堂|本殿|本宮|総本店|総本山|town|タウン)$/;

/**
 * How surely two names are one place: 2 when they are the same name, 1 when
 * one is the other plus a word that does not make it another place (本店,
 * 本堂…), 0 otherwise. "東京タワー水族館" contains "東京タワー" and is not the
 * tower; "清水寺前" is a bus stop: containing a name proves nothing.
 */
export function placeNameCertainty(left: string, right: string): 0 | 1 | 2 {
  const a = normalisedName(left);
  const b = normalisedName(right);
  // One character ("the", "寺") is contained in almost anything.
  if (a.length < 2 || b.length < 2) return 0;
  if (a === b) return 2;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && HARMLESS_REST.test(long.slice(short.length))) return 1;
  if (long.endsWith(short) && HARMLESS_REST.test(long.slice(0, long.length - short.length))) return 1;
  return 0;
}

/** Two names for the same place. */
export function placeNamesMatch(left: string, right: string) {
  return placeNameCertainty(left, right) > 0;
}

export function metersBetween(a: { lat: number; lon: number }, b: { latitude: number; longitude: number }) {
  const lat = (b.latitude - a.lat) * 111_320;
  const lon = (b.longitude - a.lon) * 111_320 * Math.cos(((a.lat + b.latitude) / 2) * Math.PI / 180);
  return Math.hypot(lat, lon);
}

/** Map categories that are a way to reach a place, never the place a traveller put on the list. */
export const NOT_THE_SIGHT = new Set(["PublicTransport", "Parking", "EVCharger", "GasStation", "ATM", "CarRental", "Restroom", "Airport", "AirportGate", "AirportTerminal"]);

/** How far the map's pin may sit from the booklet's: further for the very same name (a shrine's grounds are large). */
export const PLACE_MATCH_METERS = 150;
export const EXACT_NAME_MATCH_METERS = 400;

/**
 * The search result that is this stop, or null. It must carry an Apple id
 * and bear the stop's name; the same name beats a longer one, and only then
 * does the nearer one win. A card for the wrong place is worse than no card,
 * so anything less certain is refused.
 */
export function matchApplePlace(stop: { name: string; lat: number; lon: number }, results: readonly AppleRelayPlace[]): AppleRelayPlace | null {
  let best: AppleRelayPlace | null = null;
  let bestCertainty = 0;
  let bestMeters = Infinity;
  for (const place of results) {
    if (!place.id || !applePlaceIdOfStop(`apple-${place.id}`)) continue;
    // A bus stop or car park is named after the sight it serves, letter for letter.
    if (place.poiCategory && NOT_THE_SIGHT.has(place.poiCategory)) continue;
    const certainty = placeNameCertainty(stop.name, place.name);
    const meters = metersBetween(stop, place);
    if (certainty === 0 || meters > (certainty === 2 ? EXACT_NAME_MATCH_METERS : PLACE_MATCH_METERS)) continue;
    if (certainty < bestCertainty || (certainty === bestCertainty && meters >= bestMeters)) continue;
    best = place;
    bestCertainty = certainty;
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
    // As wide as the rule's widest case; the rule itself, not the search box, decides what is close enough.
    withinMeters: 450,
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
      if (!mapkit?.PlaceDetail || !mapkit.PlaceLookup) { script.remove(); reject(new Error("mapkit_without_place_detail")); return; }
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
