import type { AppleRelayPlace } from "../apple-relay-client";

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
    const id = place.id ? `apple-${place.id}` : `apple-${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`;
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
