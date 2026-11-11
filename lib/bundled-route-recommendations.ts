import type { GapSuggestionKind } from "./gap-detection.ts";
import { placeTypesFromKinds } from "./open-place-resolver.ts";
import type { PopularDestination } from "./popular-sights.ts";
import type { RouteRecommendation, RouteRecommendationPoint } from "./route-recommendations.ts";

/*
 * "Near today's plan" without a paid provider.
 *
 * Two keyless sources, each used for what it honestly knows:
 *   - the bundled sights list: well-known places close to the day's route
 *     that are not on the wishlist yet (ordered by fame, then distance);
 *   - the Apple relay, when configured: cafés and bakeries beside the route
 *     for a short gap.
 * Neither carries a rating, so none is shown.
 */

type CafePlace = Readonly<{ id: string | null; name: string; latitude: number; longitude: number; formattedAddress: string; poiCategory: string | null }>;
export type CafeSearch = (options: {
  query: string;
  language: string;
  near: { latitude: number; longitude: number };
  withinMeters: number;
  poiCategories: readonly string[];
  poiOnly: boolean;
  signal?: AbortSignal;
}) => Promise<CafePlace[]>;

const NEAR_METERS = 1_500;
const WIDE_METERS = 3_000;
const cafeKinds: readonly GapSuggestionKind[] = ["CAFE", "BAKERY", "CAFE_AND_WALK"];
const sightKinds: readonly GapSuggestionKind[] = ["PARK", "LOOKOUT", "SMALL_FACILITY", "WALK", "CAFE_AND_WALK", "ATTRACTION"];

function fold(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}ー]+/gu, "");
}

function distanceMeters(from: RouteRecommendationPoint, to: RouteRecommendationPoint) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const h = Math.sin(radians(to.latitude - from.latitude) / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function routeDistance(point: RouteRecommendationPoint, route: readonly RouteRecommendationPoint[]) {
  return Math.round(Math.min(...route.map((routePoint) => distanceMeters(routePoint, point))));
}

function typeLabel(placeTypes: readonly string[], languageCode: "en" | "ja") {
  const ja = languageCode === "ja";
  const has = (...types: string[]) => types.some((type) => placeTypes.includes(type));
  if (has("buddhist_temple")) return ja ? "寺院" : "Temple";
  if (has("shinto_shrine")) return ja ? "神社" : "Shrine";
  if (has("church")) return ja ? "教会" : "Church";
  if (has("museum")) return ja ? "博物館・美術館" : "Museum";
  if (has("park", "botanical_garden", "national_park")) return ja ? "公園・庭園" : "Park";
  if (has("market", "shopping_mall")) return ja ? "市場・買い物" : "Market";
  if (has("observation_deck")) return ja ? "展望スポット" : "Viewpoint";
  if (has("castle")) return ja ? "城・宮殿" : "Castle";
  if (has("zoo", "aquarium", "amusement_park")) return ja ? "レジャー施設" : "Attraction";
  return ja ? "観光スポット" : "Sight";
}

function mapsUrl(name: string, latitude: number, longitude: number) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${latitude.toFixed(5)},${longitude.toFixed(5)}`)}`;
}

/** Well-known places near the route that the traveller has not listed. */
export function bundledSightsNearRoute(input: {
  routePoints: readonly RouteRecommendationPoint[];
  excludedNames: readonly string[];
  excludedPlaceIds?: readonly string[];
  languageCode: "en" | "ja";
  suggestionKinds?: readonly GapSuggestionKind[];
  cities: readonly PopularDestination[];
}): RouteRecommendation[] {
  if (input.routePoints.length === 0) return [];
  if (input.suggestionKinds && !input.suggestionKinds.some((kind) => sightKinds.includes(kind))) return [];
  const excluded = new Set(input.excludedNames.map(fold));
  const excludedIds = new Set(input.excludedPlaceIds ?? []);
  const wantsOnlyParks = input.suggestionKinds?.length
    && input.suggestionKinds.every((kind) => kind === "PARK" || kind === "WALK" || kind === "CAFE_AND_WALK");
  const wantsOnlyLookouts = input.suggestionKinds?.length && input.suggestionKinds.every((kind) => kind === "LOOKOUT");

  const found: Array<{ recommendation: RouteRecommendation; fame: number }> = [];
  const seen = new Set<string>();
  for (const city of input.cities) {
    // A cheap reject: the route is nowhere near this destination.
    if (routeDistance({ latitude: city.lat, longitude: city.lon }, input.routePoints) > (city.radiusKm + 5) * 1_000) continue;
    city.sights.forEach((sight, fame) => {
      if (seen.has(sight.q) || excluded.has(fold(sight.ja)) || excluded.has(fold(sight.en))) return;
      if (excludedIds.has(`wikidata-${sight.q}`) || excludedIds.has(sight.q)) return;
      const placeTypes = placeTypesFromKinds([sight.kind]);
      // A full-day venue is never a "while you are nearby" idea.
      if (placeTypes.some((type) => type === "amusement_park" || type === "zoo")) return;
      if (wantsOnlyParks && !placeTypes.some((type) => type === "park" || type === "botanical_garden" || type === "promenade")) return;
      if (wantsOnlyLookouts && !placeTypes.includes("observation_deck")) return;
      const meters = routeDistance({ latitude: sight.lat, longitude: sight.lon }, input.routePoints);
      if (meters > WIDE_METERS) return;
      seen.add(sight.q);
      const name = (input.languageCode === "ja" ? sight.ja : sight.en).trim();
      found.push({
        fame,
        recommendation: {
          id: `wikidata-${sight.q}`,
          providerRef: "",
          name,
          address: input.languageCode === "ja" ? city.ja : city.en,
          type: typeLabel(placeTypes, input.languageCode),
          placeTypes,
          businessStatus: null,
          regularOpeningPeriods: null,
          googleMapsUrl: mapsUrl(name, sight.lat, sight.lon),
          latitude: sight.lat,
          longitude: sight.lon,
          rating: null,
          userRatingCount: null,
          routeDistanceMeters: meters,
          photoName: null,
          photoAttribution: null,
        },
      });
    });
  }
  const near = found.filter((entry) => entry.recommendation.routeDistanceMeters <= NEAR_METERS);
  // Fame first among places a short walk away; a quiet route looks wider.
  return (near.length >= 3 ? near : found)
    .sort((left, right) => (
      (left.fame + left.recommendation.routeDistanceMeters / 250) - (right.fame + right.recommendation.routeDistanceMeters / 250)
      || left.recommendation.id.localeCompare(right.recommendation.id)
    ))
    .slice(0, 6)
    .map((entry) => entry.recommendation);
}

/** Cafés and bakeries beside the route, for a short gap. */
export async function cafesNearRoute(input: {
  routePoints: readonly RouteRecommendationPoint[];
  excludedNames: readonly string[];
  languageCode: "en" | "ja";
  suggestionKinds?: readonly GapSuggestionKind[];
  search: CafeSearch;
  signal?: AbortSignal;
}): Promise<RouteRecommendation[]> {
  if (input.routePoints.length === 0) return [];
  if (input.suggestionKinds && !input.suggestionKinds.some((kind) => cafeKinds.includes(kind))) return [];
  const middle = input.routePoints[Math.floor(input.routePoints.length / 2)];
  const places = await input.search({
    query: input.languageCode === "ja" ? "カフェ" : "cafe",
    language: input.languageCode === "ja" ? "ja-JP" : "en-US",
    near: middle,
    withinMeters: 800,
    poiCategories: ["Cafe", "Bakery"],
    poiOnly: true,
    signal: input.signal,
  });
  const excluded = new Set(input.excludedNames.map(fold));
  const seen = new Set<string>();
  return places.flatMap((place): RouteRecommendation[] => {
    const key = fold(place.name);
    if (excluded.has(key) || seen.has(key)) return [];
    seen.add(key);
    const bakery = place.poiCategory === "Bakery";
    return [{
      id: `apple-${place.id ?? `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`}`.slice(0, 160),
      providerRef: "",
      name: place.name,
      address: place.formattedAddress.replace(/\n/g, " "),
      type: input.languageCode === "ja" ? (bakery ? "ベーカリー" : "カフェ") : (bakery ? "Bakery" : "Cafe"),
      placeTypes: [bakery ? "bakery" : "cafe"],
      businessStatus: null,
      regularOpeningPeriods: null,
      googleMapsUrl: mapsUrl(place.name, place.latitude, place.longitude),
      latitude: place.latitude,
      longitude: place.longitude,
      rating: null,
      userRatingCount: null,
      routeDistanceMeters: routeDistance(place, input.routePoints),
      photoName: null,
      photoAttribution: null,
    }];
  }).sort((left, right) => left.routeDistanceMeters - right.routeDistanceMeters).slice(0, 4);
}
