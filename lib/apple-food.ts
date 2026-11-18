import { defaultFoodDiscoveryQuery, type FoodCandidate, type FoodSearchRequest } from "./google-food.ts";
/** What this module needs from a place search, server client or browser relay alike. */
type AppleMapsPlace = Readonly<{
  id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  poiCategory: string | null;
}>;
type AppleFoodSearch = {
  search(options: {
    query: string;
    language: string;
    near: { latitude: number; longitude: number };
    withinMeters: number;
    poiCategories: readonly string[];
    poiOnly: boolean;
    signal?: AbortSignal;
  }): Promise<AppleMapsPlace[]>;
};

/*
 * Meal candidates from Apple Maps. Apple returns places, not ratings, so a
 * candidate here is "an eating place that exists this close to your route",
 * ordered by distance — never dressed up as a quality ranking. Rating fields
 * stay null and the card's reason falls back to the walk and the address.
 */

const FOOD_CATEGORIES = ["Restaurant", "Cafe", "Bakery"] as const;
const NEAR_METERS = 1_200;
const WIDE_METERS = 3_000;
const MINIMUM_CANDIDATES = 3;
const MAXIMUM_CANDIDATES = 8;

function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(to.latitude - from.latitude) / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function categoryLabel(category: string | null, languageCode: "en" | "ja") {
  const ja = languageCode === "ja";
  if (category === "Cafe") return ja ? "カフェ" : "Cafe";
  if (category === "Bakery") return ja ? "ベーカリー" : "Bakery";
  return ja ? "レストラン" : "Restaurant";
}

const APPLE_PLACE_ID = /^[A-Za-z0-9]{4,64}$/;

/** A place of Apple's, opened in Apple Maps. */
export function appleMapsLink(name: string, coordinate: string) {
  return `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${coordinate}`;
}

function candidateFromPlace(place: AppleMapsPlace, request: FoodSearchRequest): FoodCandidate {
  const coordinate = `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`;
  return {
    id: `apple-${place.id}`,
    name: place.name,
    address: place.formattedAddress,
    type: categoryLabel(place.poiCategory, request.languageCode),
    // The field is the card's outbound map link. Apple's place opens in
    // Apple Maps, where the traveller can check hours and reviews this
    // source does not carry; Apple's data is not handed to another map.
    googleMapsUrl: appleMapsLink(place.name, coordinate),
    latitude: place.latitude,
    longitude: place.longitude,
    distanceMeters: Math.round(distanceMeters(request, place)),
    rating: null,
    userRatingCount: null,
    openNow: null,
    plannedOpen: null,
    hours: [],
    businessStatus: null,
    paymentEvidence: [],
    reviewSnippets: [],
    websiteUrl: null,
  };
}

export async function fetchAppleFoodCandidates(
  request: FoodSearchRequest,
  client: AppleFoodSearch,
  signal?: AbortSignal,
): Promise<FoodCandidate[]> {
  // The built-in discovery phrase is written for a text-search ranker. Apple
  // matches names and categories, so the default becomes a plain category
  // word; a traveller's own query ("ramen", "飲茶") is passed through.
  const isDefaultQuery = request.query === defaultFoodDiscoveryQuery(request.languageCode);
  const query = isDefaultQuery
    ? request.languageCode === "ja" ? "レストラン" : "restaurant"
    : request.query;
  const search = (withinMeters: number) => client.search({
    query,
    language: request.languageCode === "ja" ? "ja-JP" : "en-US",
    near: { latitude: request.latitude, longitude: request.longitude },
    withinMeters,
    poiCategories: FOOD_CATEGORIES,
    poiOnly: true,
    signal,
  });

  let places = await search(NEAR_METERS);
  // A quiet stretch of route deserves a wider look before "nothing nearby".
  if (places.length < MINIMUM_CANDIDATES) places = [...places, ...await search(WIDE_METERS)];

  const seen = new Set<string>();
  return places
    // Kept in a trip as its Apple Place ID only: a hit without one cannot be added.
    .filter((place) => place.id !== null && APPLE_PLACE_ID.test(place.id))
    .map((place) => candidateFromPlace(place, request))
    .filter((candidate) => {
      const key = `${candidate.name.normalize("NFKC").toLocaleLowerCase()}@${candidate.latitude?.toFixed(3)},${candidate.longitude?.toFixed(3)}`;
      if (seen.has(key) || (candidate.distanceMeters ?? 0) > WIDE_METERS * 1.5) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (left.distanceMeters ?? 0) - (right.distanceMeters ?? 0) || left.id.localeCompare(right.id))
    .slice(0, MAXIMUM_CANDIDATES);
}
