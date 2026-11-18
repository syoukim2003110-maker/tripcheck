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

/* ------------------------------------------------------------------ sources */

/**
 * Where a stop came from, read from its id. This decides what of it may be
 * kept on the traveller's device and in a share link:
 *
 *   - "apple": found through Apple Maps search. Apple's terms let a Place ID
 *     be kept and shared, but not Apple's name, address, category or
 *     position of the place (Apple Developer Program License Agreement,
 *     Attachment 6, 2.5; Apple's Place ID article). Such a stop is kept as
 *     `apple-<Place ID>` with only what the traveller set (stay, day, meal,
 *     booking, and a kind word only when the traveller's own action gave it;
 *     see keptAppleKind), and its name and position are looked up again
 *     whenever the trip is opened.
 *   - "apple-legacy": an Apple stop saved before Place IDs were kept, with
 *     no Place ID in it (`apple-<lat>,<lon>`). There is nothing to look it
 *     up by, so it is kept as it was until the page has found it again by
 *     its name (see appleRematches) and can keep it as a Place ID.
 *   - everything else ("wikidata" bundled sights, "hotpepper" shops — name,
 *     position and shop ID, as the guide allows — and the open lookups'
 *     "osm" places) is kept as it always was.
 *
 * `maps-<id>` is how the open lookup named an Apple hit; it is the same as
 * `apple-<id>` and is read as that.
 */
export type PlaceSource = "apple" | "apple-legacy" | "wikidata" | "hotpepper" | "osm" | "other";

const APPLE_STOP = /^(?:apple|maps)-([A-Za-z0-9]{4,64})$/;
const APPLE_LEGACY_STOP = /^(?:apple|maps)-(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;

export function placeSource(id: string | undefined): PlaceSource {
  if (!id) return "other";
  if (APPLE_STOP.test(id)) return "apple";
  if (APPLE_LEGACY_STOP.test(id)) return "apple-legacy";
  if (id.startsWith("wikidata-")) return "wikidata";
  if (id.startsWith("hotpepper-")) return "hotpepper";
  if (id.startsWith("osm-")) return "osm";
  return "other";
}

/** The Apple Place ID in a stop's id, or null when the stop is not an Apple place with one. */
export function applePlaceIdOf(id: string | undefined): string | null {
  return id ? APPLE_STOP.exec(id)?.[1] ?? null : null;
}

/** The id the trip keeps an Apple place under. */
export const appleStopId = (placeId: string) => `apple-${placeId}`;

/**
 * An id as the trip keeps it: an Apple hit the open lookup named `maps-<id>`
 * is `apple-<id>`, so one place is one stop whichever search found it.
 */
export function canonicalPlaceId(id: string) {
  const placeId = applePlaceIdOf(id);
  return placeId ? appleStopId(placeId) : id;
}

/**
 * The kind word an Apple stop may keep: only one the traveller's own action
 * gave it — a restaurant chosen for a meal ("restaurant" with its meal), a
 * café chosen for a break ("cafe"). Any other kind word of an Apple place is
 * Apple's category put into the booklet's words (add-search.ts maps Apple's
 * categories onto them), which is Apple map data in another form and is not
 * kept (Attachment 6, 2.2 and 2.5); it lives in the page's memory for the
 * visit. After a reload such a place is planned as a sight of no particular
 * kind (Apple's lookup by Place ID does not answer a category).
 */
export function keptAppleKind(kind: string | undefined, meal: string | null | undefined): string | null {
  if (kind === "restaurant" && (meal === "lunch" || meal === "dinner")) return "restaurant";
  if (kind === "cafe" || kind === "bakery cafe") return "cafe";
  return null;
}

/** What the page needs to look up again: the Apple Place IDs of the stops (and hotel) whose name and position are not in hand. */
export function pendingAppleIds(trip: ShioriTrip): string[] {
  const ids = trip.places.flatMap((place) => place.pending ? [applePlaceIdOf(place.id) ?? ""] : []);
  if (trip.hotel?.pending) ids.push(applePlaceIdOf(trip.hotel.id) ?? "");
  return [...new Set(ids.filter(Boolean))];
}

export type AppleDetails = Readonly<{ name: string; latitude: number; longitude: number }>;

/**
 * The trip with the Apple places whose details have arrived filled in, in
 * the page's memory. encodeTrip leaves them out again, so what is kept does
 * not change. Places still missing stay pending.
 */
export function withAppleDetails(trip: ShioriTrip, found: ReadonlyMap<string, AppleDetails>): ShioriTrip {
  const fill = <T extends { id?: string; pending?: true; name: string; lat: number; lon: number }>(entry: T): T => {
    if (!entry.pending) return entry;
    const details = found.get(applePlaceIdOf(entry.id) ?? "");
    if (!details) return entry;
    const { pending: _dropped, ...rest } = entry;
    void _dropped;
    return { ...rest, name: clipName(details.name), lat: details.latitude, lon: details.longitude } as T;
  };
  const places = trip.places.map(fill);
  const hotel = trip.hotel ? fill(trip.hotel) : null;
  return places.every((place, index) => place === trip.places[index]) && hotel === trip.hotel ? trip : { ...trip, places, hotel };
}

/** The trip as it can be planned and drawn: Apple places not yet looked up are set aside (never removed). */
export function plannableTrip(trip: ShioriTrip): ShioriTrip {
  if (!trip.places.some((place) => place.pending) && !trip.hotel?.pending) return trip;
  return { ...trip, places: trip.places.filter((place) => !place.pending), hotel: trip.hotel?.pending ? null : trip.hotel };
}

/** Whether a stop (or the hotel) holds what Apple said about a place: found through Apple, kept from before Place IDs were, or a hotel kept without an id (most were Apple's). */
export function holdsAppleData(entry: { id?: string } | null | undefined, hotel = false): boolean {
  if (!entry) return false;
  const source = placeSource(entry.id);
  return source === "apple" || source === "apple-legacy" || (hotel && !entry.id);
}

/**
 * The trip as it may be planned and shown while no Apple map is on screen:
 * every place (and the hotel) known from Apple is set aside, never removed.
 * Apple's terms allow its map data to be shown only with an Apple map
 * (Attachment 6, 2.4), and the plan, its order and its minutes are made from
 * Apple's positions of them.
 */
export function withoutAppleData(trip: ShioriTrip): ShioriTrip {
  const places = trip.places.filter((place) => !holdsAppleData(place));
  const hotel = holdsAppleData(trip.hotel, true) ? null : trip.hotel;
  return places.length === trip.places.length && hotel === trip.hotel ? trip : { ...trip, places, hotel };
}

/** How many of the trip's places (and its hotel) withoutAppleData sets aside. */
export function appleDataCount(trip: ShioriTrip): number {
  return trip.places.filter((place) => holdsAppleData(place)).length + (holdsAppleData(trip.hotel, true) ? 1 : 0);
}

/** The name a trip goes by (its title, the resume button, the LINE text): its destination, or else the first place not found through Apple. */
export function tripTitleName(trip: ShioriTrip): string {
  return trip.cityName || trip.places.find((place) => place.name && !holdsAppleData(place))?.name || "";
}

/**
 * The stops kept from before Place IDs were kept that may be Apple's: an
 * Apple stop with no Place ID in it, and a hotel chosen before hotels had an
 * id (most were found through Apple; the open lookup's few are found again
 * just the same, or stay as they are). Each is looked for again by its
 * name, around where it is; a hit of the very same name gives its Place ID.
 */
export function appleRematches(trip: ShioriTrip): Array<{ key: string; name: string; lat: number; lon: number }> {
  const stops = trip.places.flatMap((place) => placeSource(place.id) === "apple-legacy" && !place.pending ? [{ key: place.id, name: place.name, lat: place.lat, lon: place.lon }] : []);
  if (trip.hotel && !trip.hotel.id && !trip.hotel.pending && trip.hotel.name) stops.push({ key: "hotel", name: trip.hotel.name, lat: trip.hotel.lat, lon: trip.hotel.lon });
  return stops;
}

/**
 * The trip with a legacy stop (or the id-less hotel, key "hotel") found
 * again under its Place ID, with what Apple says about it now. From here on
 * it is kept as that Place ID alone. A stop whose Place ID the trip already
 * has is the same place twice: the legacy copy goes.
 */
export function withRematch(trip: ShioriTrip, key: string, placeId: string, details: AppleDetails): ShioriTrip {
  const id = appleStopId(placeId);
  const now = { name: clipName(details.name), lat: details.latitude, lon: details.longitude };
  if (key === "hotel") return trip.hotel && !trip.hotel.id ? { ...trip, hotel: { ...now, id } } : trip;
  if (trip.places.some((place) => place.id === id)) return { ...trip, places: trip.places.filter((place) => place.id !== key) };
  return { ...trip, places: trip.places.map((place) => place.id === key ? { ...place, ...now, id } : place) };
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
  /**
   * The hotel. A fourth element is where it was found (as a place's id); a
   * hotel found through Apple is `["", 0, 0, "apple-<Place ID>"]`, like an
   * Apple place. A hotel chosen before hotels had ids has three elements.
   */
  h: [name: string, lat: number, lon: number, id?: string] | null;
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

function hotelWire(hotel: ShioriHotel): NonNullable<Wire["h"]> {
  if (placeSource(hotel.id) === "apple") return ["", 0, 0, canonicalPlaceId(hotel.id!)];
  const kept: NonNullable<Wire["h"]> = [clipName(hotel.name), Number(hotel.lat.toFixed(5)), Number(hotel.lon.toFixed(5))];
  if (hotel.id && PLACE_ID.test(hotel.id)) kept.push(hotel.id);
  return kept;
}

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
      // An Apple place is kept as its Place ID and what the traveller set:
      // no name, no position, no category of Apple's (see placeSource).
      const apple = placeSource(place.id) === "apple";
      const entry: Wire["s"][number] = [
        apple ? canonicalPlaceId(place.id) : place.id,
        apple ? "" : clipName(place.name),
        apple ? 0 : Number(place.lat.toFixed(5)),
        apple ? 0 : Number(place.lon.toFixed(5)),
        place.stayMinutes,
        // A booking's day is the place's day.
        reserve ? reserve.day : place.day ?? null,
        apple ? keptAppleKind(place.kind, place.meal) : place.kind && place.kind.length <= MAX_KIND ? place.kind : null,
        apple ? null : place.img ?? null,
        place.meal ?? null,
      ];
      if (reserve) entry.push([reserve.day, clockOfDay(reserve.time)!]);
      return entry;
    }),
    h: trip.hotel ? hotelWire(trip.hotel) : null,
    ...(trip.startDate ? { t: trip.startDate } : {}),
    ...(start !== null || finish !== null ? { w: [start, finish] as [number | null, number | null] } : {}),
    ...(trip.packAnyway ? { a: 1 as const } : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The hotel as it was written; null when there is none or it is malformed. */
function readHotel(raw: unknown): ShioriHotel | null {
  if (!Array.isArray(raw)) return null;
  const [name, lat, lon, id] = raw as unknown[];
  if (typeof id === "string" && placeSource(id) === "apple") return { name: "", lat: 0, lon: 0, id: canonicalPlaceId(id), pending: true };
  if (typeof name !== "string" || name.length > MAX_NAME || !finite(lat, -90, 90) || !finite(lon, -180, 180)) return null;
  return { name, lat, lon, ...(typeof id === "string" && PLACE_ID.test(id) ? { id } : {}) };
}

/**
 * What a stored trip should be saved as now that it has been read: the same
 * trip in the form kept today, when the stored text still carries what Apple
 * said about an Apple place (a trip or link from before Place IDs alone were
 * kept); null when it is already in that form or cannot be read.
 */
export function resavedForm(raw: string, now: Date = new Date()): string | null {
  const trip = decodeTrip(raw, now);
  if (!trip) return null;
  const apple = [...trip.places.map((place) => place.id), trip.hotel?.id].some((id) => placeSource(id) === "apple");
  const kept = encodeTrip(trip);
  return apple && kept !== raw ? kept : null;
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
      const [rawId, name, lat, lon, stay, day, kind, img, meal, booked] = entry as unknown[];
      const reserve = wholeReservation(booked);
      if (typeof rawId !== "string" || !PLACE_ID.test(rawId) || !finite(stay, 15, 720)) return null;
      // An Apple place is read as its Place ID alone, whatever else an
      // older link or an older save carried with it (its name and position
      // are looked up again; see placeSource). `maps-<id>` is `apple-<id>`.
      const apple = placeSource(rawId) === "apple";
      const id = canonicalPlaceId(rawId);
      if (seen.has(id)) {
        // The same Apple place under both of its old names is one place; any other repeat is a forged list.
        if (apple) continue;
        return null;
      }
      if (!apple) {
        if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME) return null;
        if (!finite(lat, -90, 90) || !finite(lon, -180, 180)) return null;
      }
      seen.add(id);
      const settings = {
        stayMinutes: Math.round(stay),
        // A booking's day is the place's day.
        ...(reserve ? { day: reserve.day } : finite(day, 1, MAX_DAYS) ? { day: Math.round(day) } : {}),
        ...(apple
          ? (keptAppleKind(typeof kind === "string" ? kind : undefined, typeof meal === "string" ? meal : null) ? { kind: keptAppleKind(kind as string, meal as string)! } : {})
          : typeof kind === "string" && kind.length <= MAX_KIND ? { kind } : {}),
        ...(meal === "lunch" || meal === "dinner" ? { meal } : {}),
        ...(reserve ? { reserve } : {}),
      } satisfies Partial<ShioriPlace>;
      if (apple) {
        places.push({ id, name: "", lat: 0, lon: 0, ...settings, pending: true });
        continue;
      }
      places.push({
        id,
        name: (name as string).trim(),
        lat: lat as number,
        lon: lon as number,
        ...settings,
        // A file name, never a URL: it is only ever appended to the Commons path.
        ...(typeof img === "string" && img.length <= 240 && !/[\\/?#]|\.\./.test(img) ? { img } : {}),
      });
    }
    const hotel = readHotel(wire.h);
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
