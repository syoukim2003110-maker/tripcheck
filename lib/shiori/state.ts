import type { PopularDestination, PopularSight } from "../popular-sights.ts";
import type { ShioriHotel, ShioriPace, ShioriPlace } from "./plan.ts";
import { shioriStayMinutes } from "./stay.ts";

/*
 * What a traveller has chosen: where, which places, how many days, how fast.
 * Small enough to live in localStorage and in a share link; the plan itself is
 * always recomputed from it, never stored.
 */
export type ShioriTrip = {
  cityId: string | null;
  cityName: string;
  places: ShioriPlace[];
  days: number;
  pace: ShioriPace;
  hotel: ShioriHotel | null;
};

export const emptyTrip: ShioriTrip = { cityId: null, cityName: "", places: [], days: 3, pace: "standard", hotel: null };

export const MAX_PLACES = 24;
export const MAX_DAYS = 7;

export function placeFromSight(sight: PopularSight, locale: "ja" | "en"): ShioriPlace {
  const name = (locale === "ja" ? sight.ja : sight.en).trim();
  return {
    id: `wikidata-${sight.q}`,
    name,
    lat: sight.lat,
    lon: sight.lon,
    kind: sight.kind,
    stayMinutes: shioriStayMinutes(sight.kind, `${sight.ja} ${sight.en}`),
    ...(sight.img ? { img: sight.img } : {}),
    ...(sight.desc ? { desc: sight.desc } : {}),
  };
}

export function togglePlace(trip: ShioriTrip, place: ShioriPlace): ShioriTrip {
  if (trip.places.some((existing) => existing.id === place.id)) {
    return { ...trip, places: trip.places.filter((existing) => existing.id !== place.id) };
  }
  if (trip.places.length >= MAX_PLACES) return trip;
  return { ...trip, places: [...trip.places, place] };
}

export function withCity(trip: ShioriTrip, city: PopularDestination, locale: "ja" | "en"): ShioriTrip {
  if (trip.cityId === city.id) return trip;
  // A new destination is a new trip: places from another city make no sense
  // on this one's map.
  return { ...emptyTrip, days: trip.days, pace: trip.pace, cityId: city.id, cityName: locale === "ja" ? city.ja : city.en };
}

/* ------------------------------------------------------------- persistence */

type Wire = {
  v: 1;
  c: string | null;
  n: string;
  d: number;
  p: ShioriPace;
  s: Array<[id: string, name: string, lat: number, lon: number, stay: number, day: number | null, kind: string | null, img: string | null, meal?: "lunch" | "dinner" | null]>;
  h: [name: string, lat: number, lon: number] | null;
};

function isPace(value: unknown): value is ShioriPace {
  return value === "relaxed" || value === "standard" || value === "packed";
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function encodeTrip(trip: ShioriTrip): string {
  const wire: Wire = {
    v: 1,
    c: trip.cityId,
    n: trip.cityName,
    d: trip.days,
    p: trip.pace,
    s: trip.places.map((place) => [
      place.id,
      place.name,
      Number(place.lat.toFixed(5)),
      Number(place.lon.toFixed(5)),
      place.stayMinutes,
      place.day ?? null,
      place.kind ?? null,
      place.img ?? null,
      place.meal ?? null,
    ]),
    h: trip.hotel ? [trip.hotel.name, Number(trip.hotel.lat.toFixed(5)), Number(trip.hotel.lon.toFixed(5))] : null,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Reads a stored or shared trip. Anything malformed is dropped rather than
 * repaired: a share link is text from somewhere else, and the worst it may do
 * is fail to open.
 */
export function decodeTrip(encoded: string): ShioriTrip | null {
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const wire = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Wire>;
    if (wire.v !== 1 || !Array.isArray(wire.s) || wire.s.length > MAX_PLACES) return null;
    if (!finite(wire.d, 1, MAX_DAYS) || !isPace(wire.p)) return null;
    const seen = new Set<string>();
    const places: ShioriPlace[] = [];
    for (const entry of wire.s) {
      if (!Array.isArray(entry)) return null;
      const [id, name, lat, lon, stay, day, kind, img, meal] = entry;
      if (typeof id !== "string" || !/^[\w.:,@-]{1,160}$/.test(id) || seen.has(id)) return null;
      if (typeof name !== "string" || name.trim().length === 0 || name.length > 120) return null;
      if (!finite(lat, -90, 90) || !finite(lon, -180, 180) || !finite(stay, 15, 720)) return null;
      seen.add(id);
      places.push({
        id,
        name: name.trim(),
        lat,
        lon,
        stayMinutes: Math.round(stay),
        ...(finite(day, 1, MAX_DAYS) ? { day: Math.round(day) } : {}),
        ...(typeof kind === "string" && kind.length <= 80 ? { kind } : {}),
        // A file name, never a URL: it is only ever appended to the Commons path.
        ...(typeof img === "string" && img.length <= 240 && !/[\\/?#]|\.\./.test(img) ? { img } : {}),
        ...(meal === "lunch" || meal === "dinner" ? { meal } : {}),
      });
    }
    const hotel = Array.isArray(wire.h) && typeof wire.h[0] === "string" && wire.h[0].length <= 120
      && finite(wire.h[1], -90, 90) && finite(wire.h[2], -180, 180)
      ? { name: wire.h[0], lat: wire.h[1], lon: wire.h[2] }
      : null;
    return {
      cityId: typeof wire.c === "string" && /^[a-z]{2,24}$/.test(wire.c) ? wire.c : null,
      cityName: typeof wire.n === "string" ? wire.n.slice(0, 60) : "",
      places,
      days: Math.round(wire.d),
      pace: wire.p,
      hotel,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ labels */

const kindLabels: Array<[RegExp, string, string]> = [
  [/restaurant|cafe|food/, "飲食店", "Restaurant"],
  [/amusement|theme park/, "テーマパーク", "Theme park"],
  [/\bzoo\b|safari/, "動物園", "Zoo"],
  [/aquarium/, "水族館", "Aquarium"],
  [/art museum|gallery/, "美術館", "Art museum"],
  [/museum/, "博物館", "Museum"],
  [/shinto shrine|shrine/, "神社", "Shrine"],
  [/buddhist temple|temple|pagoda|monastery/, "寺院", "Temple"],
  [/church|cathedral|basilica|chapel/, "教会", "Church"],
  [/mosque/, "モスク", "Mosque"],
  [/castle|fortress|citadel/, "城", "Castle"],
  [/palace/, "宮殿", "Palace"],
  [/market|bazaar/, "市場", "Market"],
  [/shopping|department store/, "買い物", "Shopping"],
  [/observation|tower|skyscraper|ferris/, "展望・タワー", "Viewpoint"],
  [/botanical|garden/, "庭園", "Garden"],
  [/park/, "公園", "Park"],
  [/mountain|volcano|\bhill\b/, "山", "Mountain"],
  [/island/, "島", "Island"],
  [/beach/, "ビーチ", "Beach"],
  [/hot spring|onsen/, "温泉", "Hot spring"],
  [/bridge/, "橋", "Bridge"],
  [/square|plaza/, "広場", "Square"],
  [/street|avenue|boulevard/, "通り", "Street"],
  [/neighbou?rhood|quarter|chinatown|old town/, "エリア", "Area"],
  [/statue|sculpture|monument|memorial|fountain|gate/, "名所", "Landmark"],
  [/theat|opera|concert/, "劇場", "Theatre"],
];

export function kindLabel(kind: string | undefined, locale: "ja" | "en") {
  const lowered = (kind ?? "").toLowerCase();
  const match = kindLabels.find(([pattern]) => pattern.test(lowered));
  return match ? (locale === "ja" ? match[1] : match[2]) : locale === "ja" ? "観光スポット" : "Sight";
}

/** A Wikimedia Commons thumbnail for a bundled photo file name. */
export function photoUrl(img: string | undefined, width: number) {
  if (!img) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=${width}`;
}

export function photoCreditUrl(img: string) {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(img)}`;
}

/** "1時間30分" / "1 h 30 min". */
export function durationText(minutes: number, locale: "ja" | "en") {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (locale === "ja") return hours === 0 ? `${rest}分` : rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
