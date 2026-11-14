import type { AppleRelayPlace } from "../apple-relay-client";
import type { ShioriPlace } from "./plan.ts";
import { safePlaceId, togglePlace, type ShioriTrip } from "./state.ts";

/*
 * Looking up a place the traveller typed in. The map search is asked near the
 * trip, and what comes back is shown as a short list to choose from: the first
 * hit of a nationwide search was too often a same-named shop in another city,
 * added without a word.
 */

export type AddCandidate = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** A line that tells two same-named places apart. */
  address: string;
  category: string | null;
  /** Straight-line distance from the trip, in km. */
  km: number;
  /** Known only when the open lookup, not the map search, found the place. */
  stayMinutes?: number;
  kind?: string;
  /**
   * The lookup itself was not sure this is the place meant (it answered
   * "one of these"), or there is no address to tell it by: never added
   * without the traveller choosing it.
   */
  unsure?: boolean;
};

export type AddAnchor = { latitude: number; longitude: number };

export function kmBetween(a: AddAnchor, b: AddAnchor) {
  const lat = (b.latitude - a.latitude) * 111.32;
  const lon = (b.longitude - a.longitude) * 111.32 * Math.cos(((a.latitude + b.latitude) / 2) * Math.PI / 180);
  return Math.hypot(lat, lon);
}

/** Where the trip is: its city when one was chosen, else the middle of its places. */
export function addAnchor(city: { lat: number; lon: number } | null, places: ReadonlyArray<{ lat: number; lon: number }>): AddAnchor | null {
  if (city) return { latitude: city.lat, longitude: city.lon };
  if (places.length === 0) return null;
  return {
    latitude: places.reduce((sum, place) => sum + place.lat, 0) / places.length,
    longitude: places.reduce((sum, place) => sum + place.lon, 0) / places.length,
  };
}

/**
 * The search results a traveller can pick from: only those within reach of the
 * trip, those inside the city first, otherwise in the map's own order, no doubles.
 */
export function addCandidates(results: readonly AppleRelayPlace[], anchor: AddAnchor | null, maxKm: number, limit = 6, cityKm = maxKm): AddCandidate[] {
  const seen = new Set<string>();
  const candidates: AddCandidate[] = [];
  for (const place of results) {
    const km = anchor ? kmBetween(anchor, place) : 0;
    if (anchor && km > maxKm) continue;
    // The map's id is text from outside: kept in the form the saved trip accepts.
    const id = safePlaceId(place.id ? `apple-${place.id}` : `apple-${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`);
    const twin = `${place.name}|${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
    if (seen.has(id) || seen.has(twin)) continue;
    seen.add(id);
    seen.add(twin);
    candidates.push({
      id,
      name: place.name,
      lat: place.latitude,
      lon: place.longitude,
      address: place.formattedAddress || [place.locality, place.subLocality].filter(Boolean).join(" "),
      category: place.poiCategory,
      km,
    });
  }
  // Inside the city first, each group in the map's own order: the best name
  // match in the next city over must not sit above the one in this city.
  return [...candidates.filter((entry) => entry.km <= cityKm), ...candidates.filter((entry) => entry.km > cityKm)].slice(0, limit);
}

const CATEGORY_KIND: Record<string, string> = {
  Restaurant: "restaurant", Cafe: "cafe", Bakery: "bakery", Hotel: "hotel", Museum: "museum", Park: "park",
  Store: "shop", Nightlife: "bar", Theater: "theatre", Zoo: "zoo", Aquarium: "aquarium", AmusementPark: "theme park",
  Beach: "beach", NationalPark: "park", Winery: "winery", Brewery: "brewery", FoodMarket: "market",
};

/** The booklet's kind label for a map category, when it has one. */
export function kindOfCategory(category: string | null) {
  return category ? CATEGORY_KIND[category] ?? null : null;
}

/** What the open lookup knows about a place it found. */
export type OpenLookupHit = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  planningDurationMinutes: number;
  placeTypes?: readonly string[];
};

/**
 * The answer of the open lookup for a typed name: the place it resolved, or —
 * marked as a guess — the first of the places it could not decide between.
 */
export function openLookupHit<Hit>(
  result: { places: ReadonlyArray<Hit & { input: string }>; ambiguous: ReadonlyArray<{ input: string; candidates: readonly Hit[] }> },
  name: string,
): { hit: Hit; ambiguous: boolean } | null {
  const sure = result.places.find((place) => place.input === name);
  if (sure) return { hit: sure, ambiguous: false };
  const guess = result.ambiguous.find((entry) => entry.input === name)?.candidates[0];
  return guess ? { hit: guess, ambiguous: true } : null;
}

/**
 * The open lookup's hit as a candidate, or null when it is out of the trip's
 * reach. It is marked unsure when the lookup was (`ambiguous`), and whenever
 * it has no address to show: a bare name cannot be told from its namesake.
 */
export function openCandidate(hit: OpenLookupHit, anchor: AddAnchor | null, reachKm: number, ambiguous = false): AddCandidate | null {
  const km = anchor ? Math.hypot(hit.latitude - anchor.latitude, (hit.longitude - anchor.longitude) * Math.cos((anchor.latitude * Math.PI) / 180)) * 111 : 0;
  if (km > reachKm) return null;
  const address = "";
  return {
    id: safePlaceId(hit.id), name: hit.name, lat: hit.latitude, lon: hit.longitude, address, category: null, km,
    ...(ambiguous || !address ? { unsure: true } : {}),
    stayMinutes: Math.min(240, Math.max(30, hit.planningDurationMinutes)),
    ...(hit.placeTypes?.[0] ? { kind: hit.placeTypes[0].replace(/_/g, " ") } : {}),
  };
}

export type AddSearch = {
  /** A restaurant or a hotel is first asked for among points of interest only. */
  poiFirst: boolean;
  anchor: AddAnchor | null;
  /** How far from the trip a hit may be, and how far still counts as inside the city. */
  reachKm: number;
  cityKm: number;
  /** The map search near the trip; null in a build that has none. */
  mapSearch: ((poiOnly: boolean) => Promise<readonly AppleRelayPlace[]>) | null;
  /** The open lookup: its one hit, or null. */
  openLookup: () => Promise<AddCandidate | null>;
  /** False once the traveller has moved on (typed, changed the kind, searched again). */
  isCurrent: () => boolean;
};

/**
 * Looks a typed name up: the map search first, the open lookup when the map
 * search has nothing — or cannot be reached. The map relay being down or out
 * of quota is exactly when the fallback is needed, so its error is not the
 * search's error. Returns null when the answer is for a search the traveller
 * has already left: such an answer must change nothing on screen, and a stale
 * search stops before spending another request.
 */
export async function searchAddCandidates(search: AddSearch): Promise<AddCandidate[] | null> {
  let candidates: AddCandidate[] = [];
  if (search.mapSearch) {
    try {
      candidates = addCandidates(await search.mapSearch(search.poiFirst), search.anchor, search.reachKm, 6, search.cityKm);
      if (!search.isCurrent()) return null;
      if (candidates.length === 0 && search.poiFirst) {
        candidates = addCandidates(await search.mapSearch(false), search.anchor, search.reachKm, 6, search.cityKm);
      }
    } catch {
      candidates = [];
    }
    if (!search.isCurrent()) return null;
  }
  if (candidates.length === 0) {
    try {
      const hit = await search.openLookup();
      if (hit) candidates = [hit];
    } catch {
      // Neither source answered: the caller says "not found".
    }
    if (!search.isCurrent()) return null;
  }
  return candidates;
}

/** A chosen candidate as a place of the trip: a sight to see, or the restaurant for one meal. */
export function placeOfCandidate(candidate: AddCandidate, kind: "place" | "lunch" | "dinner"): ShioriPlace {
  const label = kindOfCategory(candidate.category);
  return {
    id: candidate.id,
    name: candidate.name,
    lat: candidate.lat,
    lon: candidate.lon,
    ...(kind === "place"
      ? { stayMinutes: candidate.stayMinutes ?? 60, ...(candidate.kind ?? label ? { kind: candidate.kind ?? label ?? undefined } : {}) }
      : { stayMinutes: kind === "lunch" ? 60 : 90, kind: "restaurant", meal: kind }),
  };
}

/**
 * The trip with this place in it. Adding a place that is already listed
 * updates it (a sight that is really tonight's dinner) instead of removing it.
 */
export function putPlace(trip: ShioriTrip, place: ShioriPlace): ShioriTrip {
  return trip.places.some((entry) => entry.id === place.id)
    ? { ...trip, places: trip.places.map((entry) => entry.id === place.id ? { ...entry, ...place } : entry) }
    : togglePlace(trip, place);
}
