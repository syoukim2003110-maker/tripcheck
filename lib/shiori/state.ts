import type { PopularDestination, PopularSight } from "../popular-sights.ts";
import { MAX_TRIP_DAYS, clockOfDay, type ShioriHotel, type ShioriPace, type ShioriPlace, type ShioriReservation } from "./plan.ts";
import { sightNote } from "./sight-notes.ts";
import { EXTERIOR_STAY, namedParkStay, shioriStayMinutes } from "./stay.ts";
import { usableStartDate } from "./trip-dates.ts";

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
  /**
   * The first day of the trip ("2026-11-20"), if the traveller gave one. It
   * is optional and absent on every trip made before dates existed: without
   * it the booklet has numbered days only and asks nobody about the weather.
   */
  startDate?: string;
  /**
   * When the traveller can start moving on day 1 ("13:00") and by when the
   * last day has to be over ("15:00"). Both optional, both absent on every
   * trip made before they existed.
   */
  firstDayStart?: string;
  lastDayFinish?: string;
  /**
   * The traveller asked for every place to be planned on the days asked for,
   * even where that makes a day run far into the evening. Absent — on every
   * trip made before the choice existed too — a list too full for its days
   * is planned as the set that fits and the rest is listed as left out.
   */
  packAnyway?: true;
};

export const emptyTrip: ShioriTrip = { cityId: null, cityName: "", places: [], days: 3, pace: "standard", hotel: null };

export const MAX_PLACES = 24;
export const MAX_DAYS = MAX_TRIP_DAYS;
/** Trips saved by an earlier build could carry up to this many days; they are read and shortened, not refused. */
const MAX_DAYS_READ = 14;
const MAX_NAME = 120;
const MAX_KIND = 80;
const PLACE_ID = /^[\w.:,@-]{1,160}$/;

/**
 * An id as the saved form accepts it. Ids come from outside (a map search, a
 * restaurant listing); one odd character or an over-long id would otherwise
 * make the whole saved trip unreadable.
 */
export function safePlaceId(raw: string) {
  return raw.replace(/[^\w.:,@-]/g, "_").slice(0, 160);
}

/** A name short enough to be read back. Cut by whole characters, so an emoji is never split in two. */
function clipName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length <= MAX_NAME) return trimmed;
  const characters = Array.from(trimmed).slice(0, MAX_NAME);
  while (characters.join("").length > MAX_NAME) characters.pop();
  return characters.join("").trim();
}

/**
 * What to do with the stored trip after a change. An empty trip clears the
 * stored one only if this visit wrote it: the home screen starts with an
 * empty trip and must not wipe what the traveller saved last time, but
 * removing the last place must not leave the old list to come back.
 */
export function storageStep(trip: ShioriTrip, wroteBefore: boolean): "write" | "clear" | "none" {
  if (trip.places.length > 0) return "write";
  return wroteBefore ? "clear" : "none";
}

/**
 * The trip to keep as "the previous one" when `next` replaces what this
 * device holds: the trip in hand, or — when nothing has been opened yet on
 * this visit — the one saved last time. Null when nothing would be lost.
 */
export function keepAside(inHand: ShioriTrip, saved: ShioriTrip | null, next: ShioriTrip): ShioriTrip | null {
  const leaving = inHand.places.length > 0 ? inHand : saved && saved.places.length > 0 ? saved : null;
  if (!leaving || encodeTrip(leaving) === encodeTrip(next)) return null;
  return leaving;
}

/**
 * How long a bundled sight is planned at when it is added. A park that takes
 * the day is named in stay.ts and keeps its day; otherwise the usual stay
 * both drafts of the sight notes agreed on (sight-notes.ts); otherwise the
 * rule by kind. A place seen from outside only is a short stop whatever the
 * rest says. An estimate, as every stay is: the traveller changes it.
 */
export function sightStayMinutes(sight: Pick<PopularSight, "q" | "ja" | "en" | "kind">) {
  const name = `${sight.ja} ${sight.en}`;
  const note = sightNote(sight.q);
  const minutes = namedParkStay(sight.kind, name) ?? note?.stay ?? shioriStayMinutes(sight.kind, name);
  return note?.access === "exterior" ? Math.min(minutes, EXTERIOR_STAY) : minutes;
}

export function placeFromSight(sight: PopularSight, locale: "ja" | "en"): ShioriPlace {
  const name = (locale === "ja" ? sight.ja : sight.en).trim();
  return {
    id: `wikidata-${sight.q}`,
    name,
    lat: sight.lat,
    lon: sight.lon,
    kind: sight.kind,
    stayMinutes: sightStayMinutes(sight),
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
  // The dates are the traveller's, not the city's: they carry over with the day count.
  return {
    ...emptyTrip,
    days: trip.days,
    pace: trip.pace,
    cityId: city.id,
    cityName: locale === "ja" ? city.ja : city.en,
    ...(trip.startDate ? { startDate: trip.startDate } : {}),
    // So are the hours the traveller arrives and has to leave.
    ...(trip.firstDayStart ? { firstDayStart: trip.firstDayStart } : {}),
    ...(trip.lastDayFinish ? { lastDayFinish: trip.lastDayFinish } : {}),
  };
}

/**
 * The trip with the time a time field handed over for day 1's start or the
 * last day's finish. An empty field removes it; anything that is not a whole
 * "HH:MM" (half-typed) leaves the trip as it is.
 */
function withClock(trip: ShioriTrip, key: "firstDayStart" | "lastDayFinish", value: string): ShioriTrip {
  if (value === "") {
    const rest = { ...trip };
    delete rest[key];
    return rest;
  }
  return clockOfDay(value) === null ? trip : { ...trip, [key]: value };
}
export const withFirstDayStart = (trip: ShioriTrip, value: string) => withClock(trip, "firstDayStart", value);
export const withLastDayFinish = (trip: ShioriTrip, value: string) => withClock(trip, "lastDayFinish", value);

/**
 * What a time field hands over, and when. While a time is being typed the
 * browser reports every step on the way — "01:00" and "16:00" before
 * "16:30", and "" while one part of it is being retyped — and none of those
 * is the traveller's time: a plan made from each would throw the very stop
 * being edited off its day in the middle of a keystroke.
 *
 * `typed` is what the field shows (null: untouched), `kept` what the trip
 * holds ("" for none). Returned is the time to hand over, "" to remove the
 * time, or null to leave the trip alone:
 *   - a whole time that differs from the trip's is handed over on leaving
 *     the field and after a pause in typing (a phone's time picker sets the
 *     time without ever leaving the field);
 *   - an emptied field removes the time only on leaving it, and only where
 *     the field is the one way to remove it (`emptyClears`) — a booking has
 *     its own button, and an emptied booking field goes back to the booking.
 */
export function settledTime(typed: string | null, kept: string, how: "pause" | "leave", emptyClears: boolean): string | null {
  if (typed === null || typed === kept) return null;
  if (clockOfDay(typed) !== null) return typed;
  return typed === "" && how === "leave" && emptyClears && kept !== "" ? "" : null;
}

/** A booking as the trip keeps it: a whole day from 1 to the longest trip, and a whole "HH:MM". Anything else is no booking. */
function usableReservation(reserve: unknown): ShioriReservation | null {
  if (!reserve || typeof reserve !== "object") return null;
  const { day, time } = reserve as Partial<ShioriReservation>;
  return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= MAX_DAYS && clockOfDay(time) !== null ? { day, time: time as string } : null;
}

/**
 * Sets or clears the fixed time of a place. Day and time come together. A
 * booking also puts the place on its day; clearing it leaves the place on
 * that day (the traveller chose it), free to be moved again. A booking that
 * is not usable leaves the trip as it is.
 */
export function withReservation(trip: ShioriTrip, placeId: string, reserve: ShioriReservation | null): ShioriTrip {
  const usable = reserve === null ? null : usableReservation(reserve);
  if (reserve !== null && !usable) return trip;
  return {
    ...trip,
    places: trip.places.map((place) => {
      if (place.id !== placeId) return place;
      if (usable) return { ...place, day: usable.day, reserve: usable };
      const { reserve: _dropped, ...rest } = place;
      void _dropped;
      return rest;
    }),
  };
}

/**
 * The trip with everything planned anyway (`on`), or back to the booklet
 * that leaves out what does not fit its days.
 */
export function withPackAnyway(trip: ShioriTrip, on: boolean): ShioriTrip {
  const { packAnyway: _dropped, ...rest } = trip;
  void _dropped;
  return on ? { ...rest, packAnyway: true } : rest;
}

/**
 * The trip with the start date a date field handed over. An empty field
 * removes the date; anything else that cannot be used (half-typed, long
 * past) leaves the trip as it is, so a slip of the keyboard loses nothing.
 */
export function withStartDate(trip: ShioriTrip, value: string, now: Date = new Date()): ShioriTrip {
  if (value === "") {
    const { startDate: _dropped, ...rest } = trip;
    void _dropped;
    return rest;
  }
  return usableStartDate(value, now) ? { ...trip, startDate: value } : trip;
}

/* ------------------------------------------------------------- persistence */

type Wire = {
  v: 1;
  c: string | null;
  n: string;
  d: number;
  p: ShioriPace;
  /**
   * The tenth element is a booking, `[day, minutes since midnight]`. It is
   * written only for a place that has one, so a place without encodes
   * exactly as it always did.
   */
  s: Array<[id: string, name: string, lat: number, lon: number, stay: number, day: number | null, kind: string | null, img: string | null, meal?: "lunch" | "dinner" | null, reserve?: [day: number, minutes: number] | null]>;
  h: [name: string, lat: number, lon: number] | null;
  /** Start date. Written only when there is one, so a trip without a date encodes exactly as it always did. */
  t?: string;
  /**
   * `[start of day 1, finish of the last day]` in minutes since midnight,
   * null for the one not set. Written only when one of them is set.
   */
  w?: [number | null, number | null];
  /** 1 when the traveller asked for everything to be planned anyway. Written only then, so any other trip encodes exactly as it always did. */
  a?: 1;
};

function isPace(value: unknown): value is ShioriPace {
  return value === "relaxed" || value === "standard" || value === "packed";
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/**
 * Writes only what decodeTrip reads back: a name that is too long is cut and
 * an over-long kind dropped here, at the one place every trip passes through,
 * so no single place can make the saved trip or its link unreadable.
 */
export function encodeTrip(trip: ShioriTrip): string {
  const start = clockOfDay(trip.firstDayStart);
  const finish = clockOfDay(trip.lastDayFinish);
  const wire: Wire = {
    v: 1,
    c: trip.cityId,
    n: trip.cityName,
    d: Math.min(MAX_DAYS, Math.max(1, Math.round(trip.days))),
    p: trip.pace,
    s: trip.places.map((place): Wire["s"][number] => {
      const reserve = usableReservation(place.reserve);
      const entry: Wire["s"][number] = [
        place.id,
        clipName(place.name),
        Number(place.lat.toFixed(5)),
        Number(place.lon.toFixed(5)),
        place.stayMinutes,
        // A booking's day is the place's day.
        reserve ? reserve.day : place.day ?? null,
        place.kind && place.kind.length <= MAX_KIND ? place.kind : null,
        place.img ?? null,
        place.meal ?? null,
      ];
      if (reserve) entry.push([reserve.day, clockOfDay(reserve.time)!]);
      return entry;
    }),
    h: trip.hotel ? [clipName(trip.hotel.name), Number(trip.hotel.lat.toFixed(5)), Number(trip.hotel.lon.toFixed(5))] : null,
    ...(trip.startDate ? { t: trip.startDate } : {}),
    ...(start !== null || finish !== null ? { w: [start, finish] as [number | null, number | null] } : {}),
    ...(trip.packAnyway ? { a: 1 as const } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const wholeMinute = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_439;
const clockText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A booking as it was written: exactly `[day, minutes]`, both whole and in range. */
function wholeReservation(value: unknown): ShioriReservation | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [day, minutes] = value as unknown[];
  return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= MAX_DAYS && wholeMinute(minutes) ? { day, time: clockText(minutes) } : null;
}

/** Day 1's start and the last day's finish as they were written: exactly two entries, each null or a whole minute of the day. */
function wholeFrames(value: unknown): Pick<ShioriTrip, "firstDayStart" | "lastDayFinish"> {
  if (!Array.isArray(value) || value.length !== 2) return {};
  const [start, finish] = value as unknown[];
  if (!(start === null || wholeMinute(start)) || !(finish === null || wholeMinute(finish))) return {};
  return { ...(start === null ? {} : { firstDayStart: clockText(start) }), ...(finish === null ? {} : { lastDayFinish: clockText(finish) }) };
}

/**
 * Reads a stored or shared trip. Anything malformed is dropped rather than
 * repaired: a share link is text from somewhere else, and the worst it may do
 * is fail to open. (The start date is the one exception: it is an extra, so
 * a bad or expired one is left out and the rest is read. The times a
 * traveller entered — day 1's start, the last day's finish, a booking — are
 * extras in the same way: one that is not exactly a whole day and a whole
 * minute of the day is left out, and the place or the trip opens without
 * it. A booking's day is never moved: one beyond the trip's days is kept as
 * entered and the plan says it does not fit.)
 */
export function decodeTrip(encoded: string, now: Date = new Date()): ShioriTrip | null {
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const wire = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Wire>;
    if (wire.v !== 1 || !Array.isArray(wire.s) || wire.s.length > MAX_PLACES) return null;
    if (!finite(wire.d, 1, MAX_DAYS_READ) || !isPace(wire.p)) return null;
    const seen = new Set<string>();
    const places: ShioriPlace[] = [];
    for (const entry of wire.s) {
      if (!Array.isArray(entry)) return null;
      const [id, name, lat, lon, stay, day, kind, img, meal, booked] = entry as unknown[];
      const reserve = wholeReservation(booked);
      if (typeof id !== "string" || !PLACE_ID.test(id) || seen.has(id)) return null;
      if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME) return null;
      if (!finite(lat, -90, 90) || !finite(lon, -180, 180) || !finite(stay, 15, 720)) return null;
      seen.add(id);
      places.push({
        id,
        name: name.trim(),
        lat,
        lon,
        stayMinutes: Math.round(stay),
        // A booking's day is the place's day.
        ...(reserve ? { day: reserve.day } : finite(day, 1, MAX_DAYS) ? { day: Math.round(day) } : {}),
        ...(typeof kind === "string" && kind.length <= MAX_KIND ? { kind } : {}),
        // A file name, never a URL: it is only ever appended to the Commons path.
        ...(typeof img === "string" && img.length <= 240 && !/[\\/?#]|\.\./.test(img) ? { img } : {}),
        ...(meal === "lunch" || meal === "dinner" ? { meal } : {}),
        ...(reserve ? { reserve } : {}),
      });
    }
    const hotel = Array.isArray(wire.h) && typeof wire.h[0] === "string" && wire.h[0].length <= MAX_NAME
      && finite(wire.h[1], -90, 90) && finite(wire.h[2], -180, 180)
      ? { name: wire.h[0], lat: wire.h[1], lon: wire.h[2] }
      : null;
    return {
      cityId: typeof wire.c === "string" && /^[a-z]{2,24}$/.test(wire.c) ? wire.c : null,
      cityName: typeof wire.n === "string" ? wire.n.slice(0, 60) : "",
      places,
      // A length from before the limits agreed: the places matter more than the eighth day.
      days: Math.min(MAX_DAYS, Math.round(wire.d)),
      pace: wire.p,
      hotel,
      // A date that is malformed or long past is forgotten; the trip still opens.
      ...(usableStartDate(wire.t, now) ? { startDate: wire.t } : {}),
      ...wholeFrames(wire.w),
      // Exactly the mark that is written; anything else is the default.
      ...(wire.a === 1 ? { packAnyway: true as const } : {}),
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
